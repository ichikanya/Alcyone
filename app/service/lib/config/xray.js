'use strict';

/* Xray configuration builder (XRay Edition).

   Config generation used to live in the TV frontend, which then shipped the
   JSON to a shell command. It now runs inside the service: the frontend never
   sees profile secrets and never constructs a command line.

   Full user-supplied Xray configurations are preserved verbatim apart from the
   inbound, which is pinned to a loopback SOCKS listener, and a leading routing
   rule that keeps private destinations off the tunnel. XHTTP transports and
   balancers therefore keep working. */

var parsers = require('../proto/parsers');
var errors = require('../errors');
var err = errors.err;

var SOCKS_PORT = 10801;
var PRIVATE_RANGES = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
  '::1/128', 'fc00::/7', 'fe80::/10'
];

function isObject(value) {
  return !!value && typeof value === 'object' && Object.prototype.toString.call(value) !== '[object Array]';
}
function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}
function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function canonicalHost(host) {
  return String(host || '').toLowerCase();
}

function buildStreamSettings(p, fallbackHost, defSecurity) {
  var security = String(p.security || defSecurity || 'none').toLowerCase();
  var network = String(p.type || p.network || 'tcp').toLowerCase();
  var stream;
  if (network === 'h2') network = 'http';
  if (network === 'xhttp' || network === 'splithttp') network = 'xhttp';
  stream = { network: network, security: security === 'reality' ? 'reality' : (security === 'tls' ? 'tls' : 'none') };

  if (stream.security === 'reality') {
    stream.realitySettings = {
      serverName: p.sni || p.serverName || fallbackHost,
      fingerprint: p.fp || 'chrome',
      publicKey: p.pbk || '',
      shortId: p.sid || '',
      spiderX: p.spx || '/'
    };
  } else if (stream.security === 'tls') {
    stream.tlsSettings = {
      serverName: p.sni || p.serverName || fallbackHost,
      allowInsecure: p.allowInsecure === '1' || p.allowInsecure === 'true' || parsers.truthy(p.insecure)
    };
    if (p.alpn) stream.tlsSettings.alpn = String(p.alpn).split(',').filter(Boolean);
    if (p.fp) stream.tlsSettings.fingerprint = p.fp;
  }

  if (network === 'ws') {
    stream.wsSettings = { path: p.path || '/', headers: {} };
    if (p.host) stream.wsSettings.headers.Host = p.host;
  } else if (network === 'grpc') {
    stream.grpcSettings = { serviceName: p.serviceName || '' };
  } else if (network === 'http') {
    stream.httpSettings = {};
    if (p.host) stream.httpSettings.host = String(p.host).split(',').filter(Boolean);
    if (p.path) stream.httpSettings.path = p.path;
  } else if (network === 'xhttp') {
    stream.xhttpSettings = { path: p.path || '/', mode: p.mode || 'auto' };
    if (p.host) stream.xhttpSettings.host = p.host;
    if (p.extra) { try { stream.xhttpSettings.extra = JSON.parse(p.extra); } catch (e) {} }
    if (p.noGRPCHeader === '1' || p.noGRPCHeader === 'true') stream.xhttpSettings.noGRPCHeader = true;
  } else if (network === 'httpupgrade') {
    stream.httpupgradeSettings = { path: p.path || '/', headers: {} };
    if (p.host) stream.httpupgradeSettings.headers.Host = p.host;
  }
  return stream;
}

function outboundFor(profile) {
  var parsed = parsers.parseProxyLink(profile.link);
  var p = parsed.params || {};
  var hp, tls, alpn, hyst, settings, stream, obfsType, obfsPassword, srv, vu, user;

  if (parsed.protocol === 'hysteria2') {
    hp = p;
    tls = {
      serverName: hp.sni || hp.peer || hp.serverName || hp.servername || parsed.host,
      allowInsecure: parsers.truthy(hp.insecure || hp.allowInsecure || hp['skip-cert-verify'])
    };
    alpn = hp.alpn ? String(hp.alpn).split(',').filter(Boolean) : ['h3'];
    if (alpn.length) tls.alpn = alpn;
    if (hp.fp || hp.fingerprint) tls.fingerprint = hp.fp || hp.fingerprint;
    hyst = { version: 2, auth: parsed.password };
    stream = { network: 'hysteria', security: 'tls', hysteriaSettings: hyst, tlsSettings: tls };
    if (hp.obfs) {
      /* Hysteria2's Salamander obfuscation is a FinalMask UDP layer in XRay,
         not a hysteriaSettings field. Emitting the old shape silently produced
         a config that could not interoperate with obfuscated Hysteria2 servers. */
      obfsType = String(hp.obfs).toLowerCase();
      obfsPassword = hp['obfs-password'] || hp.obfsPassword || hp.obfs_password;
      if (obfsType !== 'salamander' || !obfsPassword) {
        throw err('UNSUPPORTED_TRANSPORT', 'only Hysteria2 Salamander obfuscation is supported');
      }
      stream.finalmask = {
        udp: [{ type: 'salamander', settings: { password: String(obfsPassword) } }]
      };
    }
    settings = { version: 2, address: parsed.host, port: parsed.port };
    return {
      protocol: 'hysteria', tag: 'proxy', settings: settings,
      streamSettings: stream
    };
  }
  if (parsed.protocol === 'ss') {
    return {
      protocol: 'shadowsocks', tag: 'proxy',
      settings: { servers: [{ address: parsed.host, port: parsed.port, method: parsed.method, password: parsed.password }] }
    };
  }
  if (parsed.protocol === 'socks') {
    srv = { address: parsed.host, port: parsed.port };
    if (parsed.user) srv.users = [{ user: parsed.user, pass: parsed.pass || '' }];
    return { protocol: 'socks', tag: 'proxy', settings: { servers: [srv] } };
  }
  if (parsed.protocol === 'trojan') {
    return {
      protocol: 'trojan', tag: 'proxy',
      settings: { servers: [{ address: parsed.host, port: parsed.port, password: parsed.password }] },
      streamSettings: buildStreamSettings(p, parsed.host, 'tls')
    };
  }
  if (parsed.protocol === 'vmess') {
    vu = { id: parsed.uuid, alterId: parsed.aid || 0, security: parsed.scy || 'auto' };
    return {
      protocol: 'vmess', tag: 'proxy',
      settings: { vnext: [{ address: parsed.host, port: parsed.port, users: [vu] }] },
      streamSettings: buildStreamSettings(p, parsed.host, 'none')
    };
  }
  user = { id: parsed.uuid, encryption: 'none' };
  if (p.flow) user.flow = p.flow;
  return {
    protocol: 'vless', tag: 'proxy',
    settings: { vnext: [{ address: parsed.host, port: parsed.port, users: [user] }] },
    streamSettings: buildStreamSettings(p, parsed.host, 'none')
  };
}

/* Bound XHTTP multiplexing so a hostile or misconfigured server cannot make
   the core open an unbounded number of concurrent streams on a small TV. */
function applyXhttpLimits(settings) {
  var target, download;
  if (!isObject(settings)) return;
  target = isObject(settings.extra) ? settings.extra : settings;
  if (!isObject(target.xmux)) {
    target.xmux = {
      maxConcurrency: '16-32',
      cMaxReuseTimes: '128-256',
      hMaxRequestTimes: '600-900',
      hMaxReusableSecs: '300-600'
    };
  }
  download = isObject(target.downloadSettings) ? target.downloadSettings
    : (isObject(settings.downloadSettings) ? settings.downloadSettings : null);
  if (download) applyXhttpLimits(download.xhttpSettings || download.splitHTTPSettings || download.splithttpSettings);
}

function boundedPolicyValue(level, key, fallback, maximum) {
  var value = level[key];
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) level[key] = fallback;
  else if (value > maximum) level[key] = maximum;
}

/* Clamp logging and connection policy. Access logging stays off so proxy
   destinations are never written to disk. */
function applyResourcePolicy(cfg) {
  var outbounds, i, stream, xhttp, network;
  if (!isObject(cfg.log)) cfg.log = {};
  cfg.log.access = 'none';
  cfg.log.error = '';
  cfg.log.dnsLog = false;
  if (cfg.log.loglevel !== 'warning' && cfg.log.loglevel !== 'error' && cfg.log.loglevel !== 'none') {
    cfg.log.loglevel = 'warning';
  }
  if (!isObject(cfg.policy)) cfg.policy = {};
  if (!isObject(cfg.policy.levels)) cfg.policy.levels = {};
  if (!isObject(cfg.policy.levels['0'])) cfg.policy.levels['0'] = {};
  boundedPolicyValue(cfg.policy.levels['0'], 'handshake', 5, 8);
  boundedPolicyValue(cfg.policy.levels['0'], 'connIdle', 60, 60);
  boundedPolicyValue(cfg.policy.levels['0'], 'uplinkOnly', 5, 10);
  boundedPolicyValue(cfg.policy.levels['0'], 'downlinkOnly', 5, 10);

  outbounds = isArray(cfg.outbounds) ? cfg.outbounds : [];
  for (i = 0; i < outbounds.length; i++) {
    stream = outbounds[i] && outbounds[i].streamSettings;
    if (!isObject(stream)) continue;
    xhttp = stream.xhttpSettings || stream.splitHTTPSettings || stream.splithttpSettings;
    network = String(stream.network || '').toLowerCase();
    if (network === 'xhttp' || network === 'splithttp' || xhttp) applyXhttpLimits(xhttp);
  }
  return cfg;
}

/* Give the core the endpoint addresses that were resolved before the routes
   changed, so establishing the first outbound needs no network DNS.

   Two things are required, and neither works alone. This was established on
   hardware against the pinned Xray 26.3.27:

     - `dns.hosts` supplies the answer without a network query, but the outbound
       dialer does not consult Xray's DNS by default: it hands the domain to
       Go's system resolver, which is exactly the resolver the split routes
       just made unreachable;
     - `sockopt.domainStrategy` moves the dial onto Xray's internal DNS, but on
       its own that DNS still has to ask the configured (public) servers.

   Together the dial resolves from the static table and never leaves the box.

   The outbound `address` keeps the original domain throughout, which is what
   preserves TLS hostname verification, SNI, REALITY serverName, gRPC authority
   and WebSocket/HTTP Host. Only the name->address lookup is short-circuited. */
function applyBootstrap(cfg, bootstrap) {
  var map = bootstrap && bootstrap.map;
  var normalized = Object.create(null);
  var outbounds, i, j, host, key, hosts, item, settings, nodes, stream, touched;

  if (!map) return cfg;
  hosts = null;
  for (host in map) {
    if (!own(map, host) || !isArray(map[host]) || !map[host].length) continue;
    key = canonicalHost(host);
    normalized[key] = map[host].slice(0);
    if (!hosts) hosts = {};
    /* In the pinned XRay 26.3.27 parser an unprefixed hosts key is
       DomainMatchingType_Full (infra/conf/dns.go, HostsWrapper.Build).
       Keep the key byte-for-byte equal to the outbound hostname: the runtime
       full matcher is deliberately exact and case-sensitive. */
    hosts[key] = normalized[key].slice(0);
  }
  if (!hosts) return cfg;

  if (!isObject(cfg.dns)) cfg.dns = {};
  if (!isObject(cfg.dns.hosts)) cfg.dns.hosts = {};
  for (host in hosts) {
    if (own(hosts, host)) cfg.dns.hosts[host] = hosts[host];
  }

  outbounds = isArray(cfg.outbounds) ? cfg.outbounds : [];
  for (i = 0; i < outbounds.length; i++) {
    item = outbounds[i] || {};
    settings = item.settings || {};
    nodes = settings.vnext || settings.servers || [];
    touched = false;
    for (j = 0; j < nodes.length; j++) {
      if (nodes[j] && own(normalized, canonicalHost(nodes[j].address || nodes[j].server))) touched = true;
    }
    if (own(normalized, canonicalHost(settings.address || item.address || item.server))) touched = true;
    if (!touched) continue;
    if (!isObject(item.streamSettings)) item.streamSettings = {};
    stream = item.streamSettings;
    if (!isObject(stream.sockopt)) stream.sockopt = {};
    /* Preserve every explicit strategy that can use an IPv4 answer. AsIs
       retains the system-resolver deadlock, while the IPv6-only strategies
       cannot use this IPv4 bootstrap result; those three cases become UseIP. */
    key = String(stream.sockopt.domainStrategy || '').toLowerCase();
    if (!key || key === 'asis' || key === 'useipv6' || key === 'forceipv6') {
      stream.sockopt.domainStrategy = 'UseIP';
    }
  }
  return cfg;
}

/* Preserve a complete user config, pinning only the inbound and the
   private-range bypass rule. */
function buildFullConfig(source, bootstrap) {
  var cfg = JSON.parse(JSON.stringify(source));
  var originalInbounds = isArray(cfg.inbounds) ? cfg.inbounds : [];
  var inboundTag = (originalInbounds[0] && originalInbounds[0].tag) || 'socks-in';
  var outbounds = isArray(cfg.outbounds) ? cfg.outbounds : [];
  var directTag = '', i;

  for (i = 0; i < outbounds.length; i++) {
    if (String((outbounds[i] && outbounds[i].protocol) || '').toLowerCase() === 'freedom') {
      directTag = outbounds[i].tag || 'direct';
      break;
    }
  }
  if (!directTag) { directTag = 'alcyone-direct'; outbounds.push({ protocol: 'freedom', tag: directTag }); }

  cfg.inbounds = [{
    tag: inboundTag, listen: '127.0.0.1', port: SOCKS_PORT, protocol: 'socks',
    settings: { auth: 'noauth', udp: true },
    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] }
  }];
  cfg.outbounds = outbounds;
  if (!cfg.log) cfg.log = { loglevel: 'warning' };
  if (!isObject(cfg.routing)) cfg.routing = { domainStrategy: 'AsIs', rules: [] };
  if (!isArray(cfg.routing.rules)) cfg.routing.rules = [];
  cfg.routing.rules.unshift({ type: 'field', ip: PRIVATE_RANGES.slice(0), outboundTag: directTag });
  delete cfg.remarks;
  delete cfg.meta;
  return applyBootstrap(applyResourcePolicy(cfg), bootstrap);
}

function build(profile, bootstrap) {
  if (!profile) throw err('NO_ACTIVE_PROFILE', 'no profile');
  if (profile.fullConfig) return buildFullConfig(profile.fullConfig, bootstrap);
  return applyBootstrap(applyResourcePolicy({
    log: { loglevel: 'warning' },
    inbounds: [{
      tag: 'socks-in', listen: '127.0.0.1', port: SOCKS_PORT, protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] }
    }],
    outbounds: [outboundFor(profile), { protocol: 'freedom', tag: 'direct' }, { protocol: 'blackhole', tag: 'block' }],
    routing: {
      domainStrategy: 'AsIs',
      rules: [{ type: 'field', ip: PRIVATE_RANGES.slice(0), outboundTag: 'direct' }]
    }
  }), bootstrap);
}

/* Hosts the tunnel must reach directly, so routing can bypass them. */
function endpoints(profile) {
  var result = [], seen = {}, outbounds, i, j, item, settings, nodes, parsed;

  function networkFor(outbound) {
    var protocol = String((outbound && outbound.protocol) || '').toLowerCase();
    if (protocol === 'hysteria' || protocol === 'hysteria2' ||
        protocol === 'tuic' || protocol === 'wireguard') return 'udp';
    return 'tcp';
  }

  function add(host, port, network) {
    var key;
    host = String(host || '').trim();
    key = host.toLowerCase() + '|' + String(port || '') + '|' + String(network || 'tcp');
    if (!host || seen[key]) return;
    seen[key] = true;
    result.push({ host: host, port: port || '', network: network || 'tcp' });
  }

  if (profile && profile.fullConfig) {
    outbounds = (profile.fullConfig && profile.fullConfig.outbounds) || [];
    for (i = 0; i < outbounds.length; i++) {
      item = outbounds[i] || {};
      settings = item.settings || {};
      nodes = settings.vnext || settings.servers || [];
      for (j = 0; j < nodes.length; j++) {
        add(nodes[j] && (nodes[j].address || nodes[j].server),
          nodes[j] && nodes[j].port, networkFor(item));
      }
      add(settings.address || item.address || item.server,
        settings.port || item.port || item.server_port, networkFor(item));
    }
    return result;
  }
  parsed = parsers.parseProxyLink(profile.link);
  add(parsed.host, parsed.port, parsed.protocol === 'hysteria2' ? 'udp' : 'tcp');
  return result;
}

module.exports = {
  SOCKS_PORT: SOCKS_PORT,
  PRIVATE_RANGES: PRIVATE_RANGES,
  build: build,
  buildFullConfig: buildFullConfig,
  outboundFor: outboundFor,
  buildStreamSettings: buildStreamSettings,
  applyResourcePolicy: applyResourcePolicy,
  applyBootstrap: applyBootstrap,
  endpoints: endpoints
};
