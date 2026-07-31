'use strict';

/* sing-box configuration builder (sing-box Edition).

   This edition targets low-powered TVs: one native system-TUN process, no
   auxiliary tun2socks, warn-level logging and a minimal rule set. Keeping the
   config small is a deliberate resource decision, not an oversight.

   XHTTP is an Xray-only transport; asking for it here returns a structured
   error the frontend localizes rather than silently producing a broken
   tunnel. */

var parsers = require('../proto/parsers');
var errors = require('../errors');
var err = errors.err;

var TUN_INTERFACE = 'tun0';
var TUN_ADDRESS = '198.18.0.1/30';
var TUN_MTU = 1500;
var SOCKS_PORT = 10801;
var BOOTSTRAP_TAG = 'alcyone-bootstrap';

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function canonicalHost(host) {
  return String(host || '').toLowerCase();
}

function tlsFor(p, fallbackHost, enabledByDefault) {
  var security, tls;
  p = p || {};
  security = String(p.security || (enabledByDefault ? 'tls' : 'none')).toLowerCase();
  if (security !== 'tls' && security !== 'reality') return null;
  tls = {
    enabled: true,
    server_name: p.sni || p.serverName || p.servername || p.peer || fallbackHost,
    insecure: parsers.truthy(p.allowInsecure || p.insecure || p['skip-cert-verify'])
  };
  if (p.alpn) tls.alpn = String(p.alpn).split(',').filter(Boolean);
  if (p.fp || p.fingerprint) tls.utls = { enabled: true, fingerprint: p.fp || p.fingerprint };
  if (security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: p.pbk || p.publicKey || p.public_key || '',
      short_id: p.sid || p.shortId || p.short_id || ''
    };
  }
  return tls;
}

function transportFor(p) {
  var network, ws, early;
  p = p || {};
  network = String(p.type || p.network || 'tcp').toLowerCase();
  if (network === 'h2') network = 'http';
  if (network === 'xhttp' || network === 'splithttp') {
    throw err('UNSUPPORTED_TRANSPORT', 'xhttp', { transport: 'xhttp', edition: 'sing-box' });
  }
  if (network === 'tcp' || network === 'raw' || network === 'none') return null;
  if (network === 'ws' || network === 'websocket') {
    ws = { type: 'ws', path: p.path || '/', headers: {} };
    if (p.host) ws.headers.Host = p.host;
    early = parseInt(p.ed || p.maxEarlyData, 10);
    if (early > 0) ws.max_early_data = early;
    if (p.eh || p.earlyDataHeaderName) ws.early_data_header_name = p.eh || p.earlyDataHeaderName;
    return ws;
  }
  if (network === 'grpc') return { type: 'grpc', service_name: p.serviceName || p.service_name || p.service || '' };
  if (network === 'http') {
    return { type: 'http', host: p.host ? String(p.host).split(',').filter(Boolean) : [], path: p.path || '/' };
  }
  if (network === 'httpupgrade') return { type: 'httpupgrade', host: p.host || '', path: p.path || '/', headers: {} };
  if (network === 'quic') return { type: 'quic' };
  throw err('UNSUPPORTED_TRANSPORT', network, { transport: network, edition: 'sing-box' });
}

function outboundFor(profile) {
  var parsed = parsers.parseProxyLink(profile.link);
  var p = parsed.params || {};
  var outbound = {
    type: parsed.protocol === 'ss' ? 'shadowsocks' : parsed.protocol,
    tag: 'proxy',
    server: parsed.host,
    server_port: parsed.port
  };
  var transport, tls, value;

  if (parsed.protocol === 'hysteria2') {
    outbound.type = 'hysteria2';
    outbound.password = parsed.password;
    outbound.tls = tlsFor({
      security: 'tls',
      sni: p.sni || p.peer || p.serverName || p.servername,
      insecure: p.insecure || p.allowInsecure || p['skip-cert-verify'],
      alpn: p.alpn,
      fp: p.fp || p.fingerprint
    }, parsed.host, true);
    if (p.obfs) {
      outbound.obfs = { type: p.obfs };
      value = p['obfs-password'] || p.obfsPassword || p.obfs_password;
      if (value) outbound.obfs.password = value;
    }
    value = parseInt(p.upmbps || p.up_mbps, 10);
    if (value > 0) outbound.up_mbps = value;
    value = parseInt(p.downmbps || p.down_mbps, 10);
    if (value > 0) outbound.down_mbps = value;
    return outbound;
  }
  if (parsed.protocol === 'ss') {
    outbound.method = parsed.method;
    outbound.password = parsed.password;
    if (p.plugin) outbound.plugin = p.plugin;
    if (p.plugin_opts || p.pluginOpts) outbound.plugin_opts = p.plugin_opts || p.pluginOpts;
    return outbound;
  }
  if (parsed.protocol === 'socks') {
    outbound.type = 'socks';
    outbound.version = '5';
    if (parsed.user) outbound.username = parsed.user;
    if (parsed.pass) outbound.password = parsed.pass;
    return outbound;
  }
  if (parsed.protocol === 'trojan') {
    outbound.password = parsed.password;
    outbound.tls = tlsFor(p, parsed.host, true);
  } else if (parsed.protocol === 'vmess') {
    outbound.uuid = parsed.uuid;
    outbound.security = parsed.scy || 'auto';
    outbound.alter_id = parsed.aid || 0;
    tls = tlsFor(p, parsed.host, false);
    if (tls) outbound.tls = tls;
  } else {
    outbound.type = 'vless';
    outbound.uuid = parsed.uuid;
    if (p.flow) outbound.flow = p.flow;
    tls = tlsFor(p, parsed.host, false);
    if (tls) outbound.tls = tls;
  }
  transport = transportFor(p);
  if (transport) outbound.transport = transport;
  return outbound;
}

/* Same bootstrap contract as the XRay edition, expressed in sing-box's schema.

   A `hosts` DNS server answers the endpoint from a static table, and the proxy
   outbound's `domain_resolver` points at it, so resolving the endpoint never
   needs the network. Only that one outbound is redirected; everything else
   keeps whatever resolver the edition already used.

   As in the XRay edition, `server` keeps the original domain, which is what
   preserves TLS verification, SNI, REALITY server_name, gRPC authority and
   WebSocket Host. */
function applyBootstrap(cfg, bootstrap) {
  var map = bootstrap && bootstrap.map;
  var predefined = Object.create(null);
  var normalized = Object.create(null);
  var any = false;
  var host, key, tag, usedTags, servers, outbounds, i;

  if (!map) return cfg;
  for (host in map) {
    if (!own(map, host) ||
        Object.prototype.toString.call(map[host]) !== '[object Array]' ||
        !map[host].length) continue;
    key = canonicalHost(host);
    normalized[key] = map[host].slice(0);
    predefined[key] = normalized[key].slice(0);
    any = true;
  }
  if (!any) return cfg;

  if (!cfg.dns || typeof cfg.dns !== 'object') cfg.dns = {};
  servers = Object.prototype.toString.call(cfg.dns.servers) === '[object Array]' ? cfg.dns.servers : [];
  /* Never remove or rewrite a user DNS server. Pick a deterministic free tag
     if a full config passed to this helper already owns the reserved name. */
  usedTags = Object.create(null);
  for (i = 0; i < servers.length; i++) {
    if (servers[i] && servers[i].tag) usedTags[String(servers[i].tag)] = true;
  }
  tag = BOOTSTRAP_TAG;
  i = 2;
  while (usedTags[tag]) {
    tag = BOOTSTRAP_TAG + '-' + i;
    i++;
  }
  servers = servers.slice(0);
  servers.unshift({ type: 'hosts', tag: tag, predefined: predefined });
  cfg.dns.servers = servers;

  outbounds = Object.prototype.toString.call(cfg.outbounds) === '[object Array]' ? cfg.outbounds : [];
  for (i = 0; i < outbounds.length; i++) {
    if (!outbounds[i] || !own(normalized, canonicalHost(outbounds[i].server))) continue;
    outbounds[i].domain_resolver = { server: tag, strategy: 'ipv4_only' };
  }
  return cfg;
}

function build(profile, bootstrap) {
  if (!profile) throw err('NO_ACTIVE_PROFILE', 'no profile');
  return applyBootstrap({
    log: { level: 'warn', timestamp: false },
    inbounds: [{
        type: 'tun',
        tag: 'tun-in',
        interface_name: TUN_INTERFACE,
        address: [TUN_ADDRESS],
        mtu: TUN_MTU,
        /* Routing is owned by the service's route manager so rollback stays
           under our control; sing-box must not install its own routes. */
        auto_route: false,
        stack: 'system',
        udp_timeout: '30s'
      }, {
        /* Loopback-only and used solely for the bounded post-route bootstrap
           check. It gives both editions the same health criterion without
           contacting an arbitrary third-party probe service. */
        type: 'socks',
        tag: 'health-in',
        listen: '127.0.0.1',
        listen_port: SOCKS_PORT
      }],
    outbounds: [outboundFor(profile), { type: 'direct', tag: 'direct' }],
    route: {
      auto_detect_interface: true,
      final: 'proxy',
      rules: [{ ip_is_private: true, action: 'route', outbound: 'direct' }]
    }
  }, bootstrap);
}

function endpoints(profile) {
  var parsed = parsers.parseProxyLink(profile.link);
  return [{
    host: parsed.host,
    port: parsed.port,
    network: parsed.protocol === 'hysteria2' ? 'udp' : 'tcp'
  }];
}

module.exports = {
  TUN_INTERFACE: TUN_INTERFACE,
  TUN_ADDRESS: TUN_ADDRESS,
  SOCKS_PORT: SOCKS_PORT,
  BOOTSTRAP_TAG: BOOTSTRAP_TAG,
  build: build,
  applyBootstrap: applyBootstrap,
  outboundFor: outboundFor,
  tlsFor: tlsFor,
  transportFor: transportFor,
  endpoints: endpoints
};
