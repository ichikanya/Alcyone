"use strict";
var parsers = require("../proto/parsers"),
  errors = require("../errors"),
  err = errors.err,
  SOCKS_PORT = 10801,
  HTTP_PORT = 10802,
  DNS_OUTBOUND_TAG = "alcyone-dns",
  PRIVATE_RANGES = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
  ];
function isObject(t) {
  return (
    !!t &&
    "object" == typeof t &&
    "[object Array]" !== Object.prototype.toString.call(t)
  );
}
function isArray(t) {
  return "[object Array]" === Object.prototype.toString.call(t);
}
function own(t, e) {
  return Object.prototype.hasOwnProperty.call(t, e);
}
function canonicalHost(t) {
  return String(t || "").toLowerCase();
}
function buildStreamSettings(t, e, r) {
  var s,
    o = String(t.security || r || "none").toLowerCase(),
    n = String(t.type || t.network || "tcp").toLowerCase();
  if (
    ("h2" === n && (n = "http"),
    ("xhttp" !== n && "splithttp" !== n) || (n = "xhttp"),
    "reality" ===
    (s = {
      network: n,
      security: "reality" === o ? "reality" : "tls" === o ? "tls" : "none",
    }).security
      ? (s.realitySettings = {
          serverName: t.sni || t.serverName || e,
          fingerprint: t.fp || "chrome",
          publicKey: t.pbk || "",
          shortId: t.sid || "",
          spiderX: t.spx || "/",
        })
      : "tls" === s.security &&
        ((s.tlsSettings = {
          serverName: t.sni || t.serverName || e,
          allowInsecure:
            "1" === t.allowInsecure ||
            "true" === t.allowInsecure ||
            parsers.truthy(t.insecure),
        }),
        t.alpn &&
          (s.tlsSettings.alpn = String(t.alpn).split(",").filter(Boolean)),
        t.fp && (s.tlsSettings.fingerprint = t.fp)),
    "ws" === n)
  )
    ((s.wsSettings = { path: t.path || "/", headers: {} }),
      t.host && (s.wsSettings.headers.Host = t.host));
  else if ("grpc" === n) s.grpcSettings = { serviceName: t.serviceName || "" };
  else if ("http" === n)
    ((s.httpSettings = {}),
      t.host &&
        (s.httpSettings.host = String(t.host).split(",").filter(Boolean)),
      t.path && (s.httpSettings.path = t.path));
  else if ("xhttp" === n) {
    if (
      ((s.xhttpSettings = { path: t.path || "/", mode: t.mode || "auto" }),
      t.host && (s.xhttpSettings.host = t.host),
      t.extra)
    )
      try {
        s.xhttpSettings.extra = JSON.parse(t.extra);
      } catch (t) {}
    ("1" !== t.noGRPCHeader && "true" !== t.noGRPCHeader) ||
      (s.xhttpSettings.noGRPCHeader = !0);
  } else
    "httpupgrade" === n &&
      ((s.httpupgradeSettings = { path: t.path || "/", headers: {} }),
      t.host && (s.httpupgradeSettings.headers.Host = t.host));
  return s;
}
function outboundFor(t) {
  var e,
    r,
    s,
    o,
    n,
    i,
    l,
    a,
    p,
    u = parsers.parseProxyLink(t.link),
    d = u.params || {};
  if ("hysteria2" === u.protocol) {
    if (
      ((r = {
        serverName:
          (e = d).sni || e.peer || e.serverName || e.servername || u.host,
        allowInsecure: parsers.truthy(
          e.insecure || e.allowInsecure || e["skip-cert-verify"]
        ),
      }),
      (s = e.alpn ? String(e.alpn).split(",").filter(Boolean) : ["h3"])
        .length && (r.alpn = s),
      (e.fp || e.fingerprint) && (r.fingerprint = e.fp || e.fingerprint),
      (o = {
        network: "hysteria",
        security: "tls",
        hysteriaSettings: { version: 2, auth: u.password },
        tlsSettings: r,
      }),
      e.obfs)
    ) {
      if (
        ((n = String(e.obfs).toLowerCase()),
        (i = e["obfs-password"] || e.obfsPassword || e.obfs_password),
        "salamander" !== n || !i)
      )
        throw err(
          "UNSUPPORTED_TRANSPORT",
          "only Hysteria2 Salamander obfuscation is supported"
        );
      o.finalmask = {
        udp: [{ type: "salamander", settings: { password: String(i) } }],
      };
    }
    return {
      protocol: "hysteria",
      tag: "proxy",
      settings: { version: 2, address: u.host, port: u.port },
      streamSettings: o,
    };
  }
  return "ss" === u.protocol
    ? {
        protocol: "shadowsocks",
        tag: "proxy",
        settings: {
          servers: [
            {
              address: u.host,
              port: u.port,
              method: u.method,
              password: u.password,
            },
          ],
        },
      }
    : "socks" === u.protocol
      ? ((l = { address: u.host, port: u.port }),
        u.user && (l.users = [{ user: u.user, pass: u.pass || "" }]),
        { protocol: "socks", tag: "proxy", settings: { servers: [l] } })
      : "trojan" === u.protocol
        ? {
            protocol: "trojan",
            tag: "proxy",
            settings: {
              servers: [
                { address: u.host, port: u.port, password: u.password },
              ],
            },
            streamSettings: buildStreamSettings(d, u.host, "tls"),
          }
        : "vmess" === u.protocol
          ? ((a = {
              id: u.uuid,
              alterId: u.aid || 0,
              security: u.scy || "auto",
            }),
            {
              protocol: "vmess",
              tag: "proxy",
              settings: {
                vnext: [{ address: u.host, port: u.port, users: [a] }],
              },
              streamSettings: buildStreamSettings(d, u.host, "none"),
            })
          : ((p = { id: u.uuid, encryption: "none" }),
            d.flow && (p.flow = d.flow),
            {
              protocol: "vless",
              tag: "proxy",
              settings: {
                vnext: [{ address: u.host, port: u.port, users: [p] }],
              },
              streamSettings: buildStreamSettings(d, u.host, "none"),
            });
}
function applyXhttpLimits(t) {
  var e, r;
  isObject(t) &&
    ((e = isObject(t.extra) ? t.extra : t),
    isObject(e.xmux) ||
      (e.xmux = {
        maxConcurrency: "16-32",
        cMaxReuseTimes: "128-256",
        hMaxRequestTimes: "600-900",
        hMaxReusableSecs: "300-600",
      }),
    (r = isObject(e.downloadSettings)
      ? e.downloadSettings
      : isObject(t.downloadSettings)
        ? t.downloadSettings
        : null) &&
      applyXhttpLimits(
        r.xhttpSettings || r.splitHTTPSettings || r.splithttpSettings
      ));
}
function boundedPolicyValue(t, e, r, s) {
  var o = t[e];
  "number" != typeof o || !isFinite(o) || o <= 0
    ? (t[e] = r)
    : o > s && (t[e] = s);
}
function applyResourcePolicy(t) {
  var e, r, s, o, n;
  for (
    isObject(t.log) || (t.log = {}),
      t.log.access = "none",
      t.log.error = "",
      t.log.dnsLog = !1,
      "warning" !== t.log.loglevel &&
        "error" !== t.log.loglevel &&
        "none" !== t.log.loglevel &&
        (t.log.loglevel = "warning"),
      isObject(t.policy) || (t.policy = {}),
      isObject(t.policy.levels) || (t.policy.levels = {}),
      isObject(t.policy.levels[0]) || (t.policy.levels[0] = {}),
      boundedPolicyValue(t.policy.levels[0], "handshake", 5, 8),
      boundedPolicyValue(t.policy.levels[0], "connIdle", 60, 60),
      boundedPolicyValue(t.policy.levels[0], "uplinkOnly", 5, 10),
      boundedPolicyValue(t.policy.levels[0], "downlinkOnly", 5, 10),
      e = isArray(t.outbounds) ? t.outbounds : [],
      r = 0;
    r < e.length;
    r++
  )
    isObject((s = e[r] && e[r].streamSettings)) &&
      ((o = s.xhttpSettings || s.splitHTTPSettings || s.splithttpSettings),
      ("xhttp" === (n = String(s.network || "").toLowerCase()) ||
        "splithttp" === n ||
        o) &&
        applyXhttpLimits(o));
  return t;
}
/* A freedom outbound inside a full-route TUN must never follow the kernel's
   split default back into the TUN.  That creates a recursion loop:
   Xray freedom -> TUN -> tun2socks -> Xray SOCKS -> freedom.  Pinning only
   freedom sockets to the discovered physical NIC preserves imported direct
   rules without weakening the proxy endpoint route checks. */
function applyDirectInterface(t, e) {
  var r, s, o, n;
  if (!e || !isObject(t)) return t;
  for (r = isArray(t.outbounds) ? t.outbounds : [], s = 0; s < r.length; s++)
    if (
      isObject((o = r[s])) &&
      "freedom" === String(o.protocol || "").toLowerCase()
    ) {
      (isObject(o.streamSettings) || (o.streamSettings = {}),
        isObject((n = o.streamSettings).sockopt) || (n.sockopt = {}),
        (n.sockopt.interface = String(e)));
    }
  return t;
}
function uniqueTag(t, e) {
  var r,
    s,
    o = {},
    n = 0;
  for (r = 0; r < t.length; r++) t[r] && t[r].tag && (o[String(t[r].tag)] = !0);
  for (s = e; o[s];) s = e + "-" + ++n;
  return s;
}
function applyDns(t, e) {
  var r,
    s,
    o,
    n,
    i,
    l = "";
  if (!e) return t;
  for (r = isArray(t.outbounds) ? t.outbounds : [], o = 0; o < r.length; o++)
    if (
      ((i = r[o] || {}),
      (n = String(i.protocol || "").toLowerCase()),
      i.tag && "freedom" !== n && "blackhole" !== n && "dns" !== n)
    ) {
      l = String(i.tag);
      break;
    }
  return (
    (i = {
      protocol: "dns",
      tag: (s = uniqueTag(r, DNS_OUTBOUND_TAG)),
      settings: { network: "udp", address: String(e), port: 53 },
    }),
    l && (i.proxySettings = { tag: l }),
    r.push(i),
    (t.outbounds = r),
    isObject(t.dns) || (t.dns = {}),
    (t.dns.servers = [String(e)]),
    isObject(t.routing) || (t.routing = { domainStrategy: "AsIs", rules: [] }),
    isArray(t.routing.rules) || (t.routing.rules = []),
    t.routing.rules.unshift({
      type: "field",
      network: "tcp,udp",
      port: "53",
      outboundTag: s,
    }),
    t
  );
}
function applyBootstrap(t, e) {
  var r,
    s,
    o,
    n,
    i,
    l,
    a,
    p,
    u,
    d,
    g,
    c = e && e.map,
    h = Object.create(null);
  if (!c) return t;
  for (n in ((l = null), c))
    own(c, n) &&
      isArray(c[n]) &&
      c[n].length &&
      ((h[(i = canonicalHost(n))] = c[n].slice(0)),
      l || (l = {}),
      (l[i] = h[i].slice(0)));
  if (!l) return t;
  for (n in (isObject(t.dns) || (t.dns = {}),
  isObject(t.dns.hosts) || (t.dns.hosts = {}),
  l))
    own(l, n) && (t.dns.hosts[n] = l[n]);
  for (r = isArray(t.outbounds) ? t.outbounds : [], s = 0; s < r.length; s++) {
    for (
      u = (p = (a = r[s] || {}).settings || {}).vnext || p.servers || [],
        g = !1,
        o = 0;
      o < u.length;
      o++
    )
      u[o] && own(h, canonicalHost(u[o].address || u[o].server)) && (g = !0);
    (own(h, canonicalHost(p.address || a.address || a.server)) && (g = !0),
      g &&
        (isObject(a.streamSettings) || (a.streamSettings = {}),
        isObject((d = a.streamSettings).sockopt) || (d.sockopt = {}),
        ((i = String(d.sockopt.domainStrategy || "").toLowerCase()) &&
          "asis" !== i &&
          "useipv6" !== i &&
          "forceipv6" !== i) ||
          (d.sockopt.domainStrategy = "UseIP")));
  }
  return t;
}
function buildFullConfig(t, e, r) {
  var s,
    o = JSON.parse(JSON.stringify(t)),
    n = isArray(o.inbounds) ? o.inbounds : [],
    i = (n[0] && n[0].tag) || "socks-in",
    l = isArray(o.outbounds) ? o.outbounds : [],
    a = "";
  for (s = 0; s < l.length; s++)
    if ("freedom" === String((l[s] && l[s].protocol) || "").toLowerCase()) {
      a = l[s].tag || "direct";
      break;
    }
  return (
    a || ((a = "alcyone-direct"), l.push({ protocol: "freedom", tag: a })),
    (o.inbounds = [
      {
        tag: i,
        listen: "127.0.0.1",
        port: SOCKS_PORT,
        protocol: "socks",
        settings: { auth: "noauth", udp: !0 },
        sniffing: { enabled: !0, destOverride: ["http", "tls", "quic"] },
      },
    ]),
    (o.outbounds = l),
    o.log || (o.log = { loglevel: "warning" }),
    isObject(o.routing) || (o.routing = { domainStrategy: "AsIs", rules: [] }),
    isArray(o.routing.rules) || (o.routing.rules = []),
    o.routing.rules.unshift({
      type: "field",
      ip: PRIVATE_RANGES.slice(0),
      outboundTag: a,
    }),
    delete o.remarks,
    delete o.meta,
    (r = r || {}),
    applyDirectInterface(
      applyBootstrap(applyDns(applyResourcePolicy(o), r.dnsServer), e),
      r.physicalInterface
    )
  );
}
function replaceWithHttpInbound(t) {
  var e = isArray(t.inbounds) ? t.inbounds : [],
    r = e[0] && e[0].tag ? e[0].tag : "http-in";
  return (
    (t.inbounds = [
      {
        tag: r,
        listen: "127.0.0.1",
        port: HTTP_PORT,
        protocol: "http",
        settings: { allowTransparent: !1 },
        sniffing: { enabled: !0, destOverride: ["http", "tls"] },
      },
    ]),
    t
  );
}
function buildTun(t, e, r) {
  if (!t) throw err("NO_ACTIVE_PROFILE", "no profile");
  return (
    (r = r || {}),
    t.fullConfig
      ? withNativeTun(
          r,
          buildFullConfig(t.fullConfig, e, r)
        )
      : withNativeTun(
          r,
          applyDirectInterface(
            applyBootstrap(
              applyDns(
                applyResourcePolicy({
                  log: { loglevel: "warning" },
                  inbounds: [
                    {
                      tag: "socks-in",
                      listen: "127.0.0.1",
                      port: SOCKS_PORT,
                      protocol: "socks",
                      settings: { auth: "noauth", udp: !0 },
                      sniffing: {
                        enabled: !0,
                        destOverride: ["http", "tls", "quic"],
                      },
                    },
                  ],
                  outbounds: [
                    outboundFor(t),
                    { protocol: "freedom", tag: "direct" },
                    { protocol: "blackhole", tag: "block" },
                  ],
                  routing: {
                    domainStrategy: "AsIs",
                    rules: [
                      {
                        type: "field",
                        ip: PRIVATE_RANGES.slice(0),
                        outboundTag: "direct",
                      },
                    ],
                  },
                }),
                r.dnsServer
              ),
              e
            ),
            r.physicalInterface
          )
        )
  );
}
/* Native TUN data plane (single-process XRay): prepends a tun inbound so
   XRay owns the device itself and go-tun2socks is not started. The loopback
   SOCKS inbound stays for health probes. The inbound shape is isolated
   here; edition configs may override it wholesale via tunInboundOverride
   while the on-device spike settles exact upstream field names. */
function nativeTunInbound(r) {
  return r && r.tunInboundOverride
    ? JSON.parse(JSON.stringify(r.tunInboundOverride))
    : {
        tag: "tun-in",
        protocol: "tun",
        settings: {
          name: (r && r.interfaceName) || "alx0",
          mtu: (r && r.mtu) || 1400,
        },
        sniffing: { enabled: !0, destOverride: ["http", "tls", "quic"] },
      };
}
function withNativeTun(r, e) {
  return "native-tun" === (r && r.dataPlane)
    ? ((e.inbounds = [nativeTunInbound(r)].concat(e.inbounds)), e)
    : e;
}
/* Data plane selection belongs to the edition config, not to probing:
   flipping modes is an explicit release decision backed by hardware
   qualification, never an automatic fallback. */
function dataPlaneFor(e) {
  return e && "native-tun" === e.dataPlane ? "native-tun" : "tun2socks";
}
function build(t, e, r) {
  return "systemProxy" === (r = r || {}).mode
    ? buildSystemProxy(t, e, r)
    : buildTun(t, e, r);
}
function buildSystemProxy(t, e, r) {
  return replaceWithHttpInbound(buildTun(t, e, r || {}));
}
function endpoints(t) {
  var e,
    r,
    s,
    o,
    n,
    i,
    l,
    a = [],
    p = {};
  function u(t) {
    var e = String((t && t.protocol) || "").toLowerCase();
    return "hysteria" === e ||
      "hysteria2" === e ||
      "tuic" === e ||
      "wireguard" === e
      ? "udp"
      : "tcp";
  }
  function d(t, e, r) {
    var s;
    ((s =
      (t = String(t || "").trim()).toLowerCase() +
      "|" +
      String(e || "") +
      "|" +
      String(r || "tcp")),
      t &&
        !p[s] &&
        ((p[s] = !0), a.push({ host: t, port: e || "", network: r || "tcp" })));
  }
  if (t && t.fullConfig) {
    for (
      e = (t.fullConfig && t.fullConfig.outbounds) || [], r = 0;
      r < e.length;
      r++
    )
      if (
        ((o = e[r] || {}),
        !/^(freedom|blackhole|dns)$/i.test(String(o.protocol || "")))
      ) {
        for (
          i = (n = o.settings || {}).vnext || n.servers || [], s = 0;
          s < i.length;
          s++
        )
          d(i[s] && (i[s].address || i[s].server), i[s] && i[s].port, u(o));
        d(
          n.address || o.address || o.server,
          n.port || o.port || o.server_port,
          u(o)
        );
      }
    return a;
  }
  return (
    d(
      (l = parsers.parseProxyLink(t.link)).host,
      l.port,
      "hysteria2" === l.protocol ? "udp" : "tcp"
    ),
    a
  );
}
module.exports = {
  SOCKS_PORT: SOCKS_PORT,
  HTTP_PORT: HTTP_PORT,
  PRIVATE_RANGES: PRIVATE_RANGES,
  build: build,
  buildTun: buildTun,
  buildSystemProxy: buildSystemProxy,
  buildFullConfig: buildFullConfig,
  outboundFor: outboundFor,
  buildStreamSettings: buildStreamSettings,
  applyResourcePolicy: applyResourcePolicy,
  applyDirectInterface: applyDirectInterface,
  applyDns: applyDns,
  applyBootstrap: applyBootstrap,
  endpoints: endpoints,
  nativeTunInbound: nativeTunInbound,
  dataPlaneFor: dataPlaneFor,
};
