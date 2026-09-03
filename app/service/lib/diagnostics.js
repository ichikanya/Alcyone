"use strict";
var net = require("net"),
  httpClient = require("./net/http-client"),
  dnsResolver = require("./net/dns-resolver"),
  ssrf = require("./net/ssrf"),
  xrayConfig = require("./config/xray"),
  singboxConfig = require("./config/singbox"),
  PROBE_TIMEOUT_MS = 3e3,
  PROBE_RESOLVE_TIMEOUT_MS = 4e3,
  MAX_PARALLEL_PROBES = 6,
  MAX_ENDPOINTS_PER_PROFILE = 4,
  MAX_ADDRESSES_PER_ENDPOINT = 2,
  MAX_PARALLEL_JOBS = Math.max(
    1,
    Math.floor(MAX_PARALLEL_PROBES / MAX_ADDRESSES_PER_ENDPOINT)
  ),
  IP_CHECK_URLS = [
    "https://ipinfo.io/ip",
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://api64.ipify.org",
    "https://icanhazip.com",
  ];
function monotonicMs() {
  if (process && "function" == typeof process.hrtime) {
    var t = process.hrtime();
    return 1e3 * t[0] + t[1] / 1e6;
  }
  return Date.now();
}
function resolveIpv4(t, n) {
  var e,
    r = ssrf.parseIpv4(t),
    o = !1;
  if (r) return n(null, [r.join(".")]);
  if (net.isIP && net.isIP(t)) return n(null, []);
  function i(t, r) {
    var i,
      s,
      f = {},
      l = [];
    if (!o) {
      if (((o = !0), e && clearTimeout(e), t || !r))
        return n(t || new Error("DNS lookup failed"), []);
      for (i = 0; i < r.length && l.length < MAX_ADDRESSES_PER_ENDPOINT; i++)
        !(s = r[i]) ||
          (s.family && 4 !== s.family) ||
          !ssrf.parseIpv4(s.address) ||
          f[(s = ssrf.parseIpv4(s.address).join("."))] ||
          ((f[s] = !0), l.push(s));
      n(l.length ? null : new Error("no IPv4 address"), l);
    }
  }
  e = setTimeout(function () {
    i(new Error("DNS lookup timeout"), []);
  }, PROBE_RESOLVE_TIMEOUT_MS);
  try {
    dnsResolver.resolveAll(String(t), i);
  } catch (t) {
    i(t, []);
  }
}
function probeEndpoint(t, n, e, r) {
  var o = [],
    i = !1,
    s = e || PROBE_TIMEOUT_MS;
  function f(t) {
    var n;
    if (!i) {
      for (i = !0, n = 0; n < o.length; n++)
        try {
          o[n].destroy();
        } catch (t) {}
      r(t);
    }
  }
  resolveIpv4(String(t || ""), function (t, e) {
    var r, l;
    if (!i) {
      if (t || !e.length || !n) return f(null);
      for (r = e.length, l = 0; l < e.length; l++)
        !(function (t) {
          var e = new net.Socket(),
            r = monotonicMs(),
            i = !1;
          (o.push(e),
            e.setTimeout(s),
            e.once("connect", function () {
              i || ((i = !0), f(Math.max(1, Math.round(monotonicMs() - r))));
            }),
            e.once("timeout", function () {
              i || ((i = !0), E());
            }),
            e.once("error", function () {
              i || ((i = !0), E());
            }));
          try {
            e.connect(n, t);
          } catch (t) {
            ((i = !0), E());
          }
        })(e[l]);
    }
    function E() {
      --r <= 0 && f(null);
    }
  });
}
function Diagnostics(t) {
  ((t = t || {}),
    (this.store = t.store),
    (this.edition = t.edition),
    (this.logger = t.logger));
}
((Diagnostics.prototype.probeProfiles = function (t, n) {
  var e,
    r,
    o,
    i,
    s,
    f,
    l,
    E = this.store.read().profiles || [],
    c = [],
    u =
      this.edition && "sing-box" === this.edition.core
        ? singboxConfig
        : xrayConfig,
    _ = [],
    a = Object.create(null),
    p = [],
    h = [],
    S = 0,
    P = 0,
    g = !1;
  if (
    ((e = (n = n || {}).profileIds),
    "[object Array]" === Object.prototype.toString.call(e))
  ) {
    var R = Object.create(null);
    for (r = 0; r < e.length; r++) R[String(e[r])] = !0;
    for (r = 0; r < E.length; r++) R[E[r].id] && c.push(E[r]);
  } else c = E.slice(0);
  for (r = 0; r < c.length; r++) {
    ((l = c[r]), (p[r] = null), (h[r] = 0));
    try {
      i = u.endpoints(l) || [];
    } catch (t) {
      i = [];
    }
    for (o = 0; o < i.length && h[r] < MAX_ENDPOINTS_PER_PROFILE; o++)
      (s = i[o] || {}).host &&
        s.port &&
        ((f = String(s.host).toLowerCase() + "|" + String(s.port)),
        h[r]++,
        a[f] || ((a[f] = []), _.push({ key: f, host: s.host, port: s.port })),
        a[f].push(r));
  }
  function O() {
    var n,
      e = [];
    if (!(g || P || S < _.length)) {
      for (g = !0, n = 0; n < c.length; n++)
        e.push({ id: c[n].id, latencyMs: p[n] });
      t(null, e);
    }
  }
  if (!_.length) return O();
  !(function t() {
    for (; !g && P < MAX_PARALLEL_JOBS && S < _.length;)
      !(function (n) {
        (P++,
          probeEndpoint(n.host, n.port, PROBE_TIMEOUT_MS, function (e) {
            var r,
              o,
              i = a[n.key] || [];
            if (null !== e)
              for (r = 0; r < i.length; r++)
                ((o = i[r]), (null === p[o] || e < p[o]) && (p[o] = e));
            (P--, t(), O());
          }));
      })(_[S++]);
    O();
  })();
}),
  (Diagnostics.prototype.externalIp = function (t, n) {
    var e = 0,
      r =
        "number" == typeof (n = n || {}).deadlineAt
          ? n.deadlineAt
          : Date.now() + 4e4,
      o =
        "function" == typeof n.isCurrent
          ? n.isCurrent
          : function () {
              return !0;
            };
    !(function n() {
      var i;
      if (e >= IP_CHECK_URLS.length) return t(null, "");
      if (o()) {
        if ((i = r - Date.now()) <= 0)
          return t(new Error("external traffic probe deadline"), "");
        httpClient.fetchUrl(
          IP_CHECK_URLS[e++],
          {
            headers: { "User-Agent": "Alcyone" },
            deadline: Date.now() + Math.min(8e3, i),
          },
          function (e, r) {
            if (o()) {
              var i = String(r || "").replace(/\s+/g, "");
              if (!e && /^[0-9a-fA-F.:]{3,45}$/.test(i)) return t(null, i);
              n();
            }
          }
        );
      }
    })();
  }),
  (module.exports = {
    PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS,
    PROBE_RESOLVE_TIMEOUT_MS: PROBE_RESOLVE_TIMEOUT_MS,
    MAX_PARALLEL_PROBES: MAX_PARALLEL_PROBES,
    MAX_ENDPOINTS_PER_PROFILE: MAX_ENDPOINTS_PER_PROFILE,
    MAX_ADDRESSES_PER_ENDPOINT: MAX_ADDRESSES_PER_ENDPOINT,
    IP_CHECK_URLS: IP_CHECK_URLS,
    Diagnostics: Diagnostics,
    probeEndpoint: probeEndpoint,
  }));
