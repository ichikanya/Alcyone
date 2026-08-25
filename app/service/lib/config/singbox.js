"use strict";
var parsers = require("../proto/parsers"),
  errors = require("../errors"),
  err = errors.err,
  /* Edition-specific interface: the sing-box edition owns als0, so it can
     never collide with (or be destroyed by) the XRay edition's alx0. */
  TUN_INTERFACE = "als0",
  mtuPolicy = require("../mtu-policy").mtuPolicy,
  TUN_ADDRESS = "198.18.0.1/30",
  TUN_MTU = 1500,
  SOCKS_PORT = 10801,
  HTTP_PORT = 10802,
  BOOTSTRAP_TAG = "alcyone-bootstrap",
  DNS_TAG = "alcyone-dns";
function own(t, r) {
  return Object.prototype.hasOwnProperty.call(t, r);
}
function canonicalHost(t) {
  return String(t || "").toLowerCase();
}
function tlsFor(t, r, e) {
  var o, s;
  return (
    (t = t || {}),
    "tls" !== (o = String(t.security || (e ? "tls" : "none")).toLowerCase()) &&
    "reality" !== o
      ? null
      : ((s = {
          enabled: !0,
          server_name: t.sni || t.serverName || t.servername || t.peer || r,
          insecure: parsers.truthy(
            t.allowInsecure || t.insecure || t["skip-cert-verify"],
          ),
        }),
        t.alpn && (s.alpn = String(t.alpn).split(",").filter(Boolean)),
        (t.fp || t.fingerprint) &&
          (s.utls = { enabled: !0, fingerprint: t.fp || t.fingerprint }),
        "reality" === o &&
          (s.reality = {
            enabled: !0,
            public_key: t.pbk || t.publicKey || t.public_key || "",
            short_id: t.sid || t.shortId || t.short_id || "",
          }),
        s)
  );
}
function transportFor(t) {
  var r, e, o;
  if (
    ((t = t || {}),
    "h2" === (r = String(t.type || t.network || "tcp").toLowerCase()) &&
      (r = "http"),
    "xhttp" === r || "splithttp" === r)
  )
    throw err("UNSUPPORTED_TRANSPORT", "xhttp", {
      transport: "xhttp",
      edition: "sing-box",
    });
  if ("tcp" === r || "raw" === r || "none" === r) return null;
  if ("ws" === r || "websocket" === r)
    return (
      (e = { type: "ws", path: t.path || "/", headers: {} }),
      t.host && (e.headers.Host = t.host),
      (o = parseInt(t.ed || t.maxEarlyData, 10)) > 0 && (e.max_early_data = o),
      (t.eh || t.earlyDataHeaderName) &&
        (e.early_data_header_name = t.eh || t.earlyDataHeaderName),
      e
    );
  if ("grpc" === r)
    return {
      type: "grpc",
      service_name: t.serviceName || t.service_name || t.service || "",
    };
  if ("http" === r)
    return {
      type: "http",
      host: t.host ? String(t.host).split(",").filter(Boolean) : [],
      path: t.path || "/",
    };
  if ("httpupgrade" === r)
    return {
      type: "httpupgrade",
      host: t.host || "",
      path: t.path || "/",
      headers: {},
    };
  if ("quic" === r) return { type: "quic" };
  throw err("UNSUPPORTED_TRANSPORT", r, { transport: r, edition: "sing-box" });
}
function outboundFor(t) {
  var r,
    e,
    o,
    s = parsers.parseProxyLink(t.link),
    n = s.params || {},
    p = {
      type: "ss" === s.protocol ? "shadowsocks" : s.protocol,
      tag: "proxy",
      server: s.host,
      server_port: s.port,
    };
  return "hysteria2" === s.protocol
    ? ((p.type = "hysteria2"),
      (p.password = s.password),
      (p.tls = tlsFor(
        {
          security: "tls",
          sni: n.sni || n.peer || n.serverName || n.servername,
          insecure: n.insecure || n.allowInsecure || n["skip-cert-verify"],
          alpn: n.alpn,
          fp: n.fp || n.fingerprint,
        },
        s.host,
        !0,
      )),
      n.obfs &&
        ((p.obfs = { type: n.obfs }),
        (o = n["obfs-password"] || n.obfsPassword || n.obfs_password) &&
          (p.obfs.password = o)),
      (o = parseInt(n.upmbps || n.up_mbps, 10)) > 0 && (p.up_mbps = o),
      (o = parseInt(n.downmbps || n.down_mbps, 10)) > 0 && (p.down_mbps = o),
      p)
    : "ss" === s.protocol
      ? ((p.method = s.method),
        (p.password = s.password),
        n.plugin && (p.plugin = n.plugin),
        (n.plugin_opts || n.pluginOpts) &&
          (p.plugin_opts = n.plugin_opts || n.pluginOpts),
        p)
      : "socks" === s.protocol
        ? ((p.type = "socks"),
          (p.version = "5"),
          s.user && (p.username = s.user),
          s.pass && (p.password = s.pass),
          p)
        : ("trojan" === s.protocol
            ? ((p.password = s.password), (p.tls = tlsFor(n, s.host, !0)))
            : "vmess" === s.protocol
              ? ((p.uuid = s.uuid),
                (p.security = s.scy || "auto"),
                (p.alter_id = s.aid || 0),
                (e = tlsFor(n, s.host, !1)) && (p.tls = e))
              : ((p.type = "vless"),
                (p.uuid = s.uuid),
                n.flow && (p.flow = n.flow),
                (e = tlsFor(n, s.host, !1)) && (p.tls = e)),
          (r = transportFor(n)) && (p.transport = r),
          p);
}
function applyBootstrap(t, r) {
  var e,
    o,
    s,
    n,
    p,
    a,
    i,
    u = r && r.map,
    l = Object.create(null),
    c = Object.create(null),
    d = !1;
  if (!u) return t;
  for (e in u)
    own(u, e) &&
      "[object Array]" === Object.prototype.toString.call(u[e]) &&
      u[e].length &&
      ((c[(o = canonicalHost(e))] = u[e].slice(0)),
      (l[o] = c[o].slice(0)),
      (d = !0));
  if (!d) return t;
  for (
    (t.dns && "object" == typeof t.dns) || (t.dns = {}),
      p =
        "[object Array]" === Object.prototype.toString.call(t.dns.servers)
          ? t.dns.servers
          : [],
      n = Object.create(null),
      i = 0;
    i < p.length;
    i++
  )
    p[i] && p[i].tag && (n[String(p[i].tag)] = !0);
  for (s = BOOTSTRAP_TAG, i = 2; n[s];) ((s = BOOTSTRAP_TAG + "-" + i), i++);
  for (
    (p = p.slice(0)).unshift({ type: "hosts", tag: s, predefined: l }),
      t.dns.servers = p,
      a =
        "[object Array]" === Object.prototype.toString.call(t.outbounds)
          ? t.outbounds
          : [],
      i = 0;
    i < a.length;
    i++
  )
    a[i] &&
      own(c, canonicalHost(a[i].server)) &&
      (a[i].domain_resolver = { server: s, strategy: "ipv4_only" });
  return t;
}
function uniqueDnsTag(t) {
  var r,
    e = {},
    o = DNS_TAG,
    s = 0;
  for (r = 0; r < t.length; r++) t[r] && t[r].tag && (e[String(t[r].tag)] = !0);
  for (; e[o];) o = DNS_TAG + "-" + ++s;
  return o;
}
function applyDns(t, r) {
  var e, o, s;
  return r
    ? ((e = t.dns && "object" == typeof t.dns ? t.dns : {}),
      (s = uniqueDnsTag(
        (o =
          "[object Array]" === Object.prototype.toString.call(e.servers)
            ? e.servers.slice(0)
            : []),
      )),
      o.push({
        type: "udp",
        tag: s,
        server: String(r),
        server_port: 53,
        detour: "proxy",
      }),
      (e.servers = o),
      (e.final = s),
      (t.dns = e),
      (t.route && "object" == typeof t.route) || (t.route = { rules: [] }),
      "[object Array]" !== Object.prototype.toString.call(t.route.rules) &&
        (t.route.rules = []),
      t.route.rules.unshift({ port: [53], action: "hijack-dns" }),
      t)
    : t;
}
function buildTun(t, r, e) {
  if (!t) throw err("NO_ACTIVE_PROFILE", "no profile");
  return (
    (e = e || {}),
    applyBootstrap(
      applyDns(
        {
          log: { level: "warn", timestamp: !1 },
          inbounds: [
            {
              type: "tun",
              tag: "tun-in",
              interface_name: e.interfaceName || TUN_INTERFACE,
              address: [TUN_ADDRESS],
              mtu: e.mtu || mtuPolicy(),
              auto_route: !1,
              stack: "system",
              udp_timeout: "30s",
            },
            {
              type: "socks",
              tag: "health-in",
              listen: "127.0.0.1",
              listen_port: SOCKS_PORT,
            },
          ],
          outbounds: [outboundFor(t), { type: "direct", tag: "direct" }],
          route: {
            auto_detect_interface: !0,
            final: "proxy",
            rules: [{ ip_is_private: !0, action: "route", outbound: "direct" }],
          },
        },
        e.dnsServer,
      ),
      r,
    )
  );
}
function build(t, r, e) {
  return "systemProxy" === (e = e || {}).mode
    ? buildSystemProxy(t, r, e)
    : buildTun(t, r, e);
}
function buildSystemProxy(t, r, e) {
  var o = buildTun(t, r, e || {});
  return (
    (o.inbounds = [
      {
        type: "http",
        tag: "http-in",
        listen: "127.0.0.1",
        listen_port: HTTP_PORT,
      },
    ]),
    o
  );
}
function endpoints(t) {
  var r = parsers.parseProxyLink(t.link);
  return [
    {
      host: r.host,
      port: r.port,
      network: "hysteria2" === r.protocol ? "udp" : "tcp",
    },
  ];
}
module.exports = {
  TUN_INTERFACE: TUN_INTERFACE,
  TUN_ADDRESS: TUN_ADDRESS,
  SOCKS_PORT: SOCKS_PORT,
  HTTP_PORT: HTTP_PORT,
  BOOTSTRAP_TAG: BOOTSTRAP_TAG,
  build: build,
  buildTun: buildTun,
  buildSystemProxy: buildSystemProxy,
  applyBootstrap: applyBootstrap,
  applyDns: applyDns,
  outboundFor: outboundFor,
  tlsFor: tlsFor,
  transportFor: transportFor,
  endpoints: endpoints,
};
