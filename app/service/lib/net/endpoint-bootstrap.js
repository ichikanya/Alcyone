"use strict";
var dnsResolver = require("./dns-resolver"),
  ssrf = require("./ssrf"),
  errors = require("../errors"),
  err = errors.err,
  MAX_HOSTNAME = 253,
  MAX_LABEL = 63,
  MAX_ENDPOINTS = 32,
  MAX_ADDRESSES_PER_HOST = 8,
  MAX_BYPASS_ADDRESSES = 64,
  RESOLUTION_TIMEOUT_MS = 1e4;
function own(e, r) {
  return Object.prototype.hasOwnProperty.call(e, r);
}
function once(e) {
  var r = !1;
  return function () {
    r || ((r = !0), e.apply(null, arguments));
  };
}
function canonicalHost(e) {
  return String(e || "").toLowerCase();
}
function isLiteralAddress(e) {
  return !(!ssrf.parseIpv4(e) && !ssrf.parseIpv6(e));
}
function isValidHostname(e) {
  var r, t, n;
  if (!e || "string" != typeof e) return !1;
  if (e.length > MAX_HOSTNAME) return !1;
  if (/[\s\u0000-\u001f\u007f]/.test(e)) return !1;
  if ("." === e.charAt(0) || "." === e.charAt(e.length - 1)) return !1;
  if (/^[0-9.]+$/.test(e)) return !1;
  for (r = e.split("."), t = 0; t < r.length; t++) {
    if (!(n = r[t]).length || n.length > MAX_LABEL) return !1;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(n)) return !1;
  }
  return !0;
}
function normalizeTarget(e) {
  var r = parseInt(e && e.port, 10);
  return (
    (r > 0 && r <= 65535) || (r = 0),
    {
      port: r,
      network:
        "udp" === String((e && e.network) || "tcp").toLowerCase()
          ? "udp"
          : "tcp",
    }
  );
}
function Result() {
  ((this.entries = []),
    (this.addresses = []),
    (this.map = Object.create(null)));
}
function buildResult(e) {
  var r,
    t,
    n,
    s,
    o = new Result(),
    i = Object.create(null);
  for (r = 0; r < e.length; r++)
    for (
      n = e[r],
        o.entries.push({
          host: n.host,
          literal: n.literal,
          addresses: n.addresses.slice(0),
          targets: n.targets.slice(0),
        }),
        n.literal || (o.map[n.key] = n.addresses.slice(0)),
        t = 0;
      t < n.addresses.length;
      t++
    )
      if (
        !i[(s = n.addresses[t])] &&
        ((i[s] = !0),
        o.addresses.push(s),
        o.addresses.length > MAX_BYPASS_ADDRESSES)
      )
        throw err("ENDPOINT_RESOLUTION_FAILED", "too many endpoint addresses");
  return o;
}
function resolve(e, r, t) {
  var n,
    s,
    o,
    i,
    a,
    l,
    u,
    d,
    f,
    S,
    c = once(r),
    p = [],
    E = Object.create(null),
    h = 0,
    A = null,
    _ = !1,
    O = !1;
  function T() {
    return !_ && !O && (!t.isCurrent || t.isCurrent());
  }
  function g(e) {
    T() &&
      ((_ = !0), A && clearTimeout(A), c(err("ENDPOINT_RESOLUTION_FAILED", e)));
  }
  function I() {
    var e;
    if (T() && !(h > 0)) {
      ((_ = !0), A && clearTimeout(A));
      try {
        e = buildResult(p);
      } catch (e) {
        return c(
          errors.isAlcyoneError(e)
            ? e
            : err("ENDPOINT_RESOLUTION_FAILED", "invalid endpoint result"),
        );
      }
      c(null, e);
    }
  }
  if (
    ((n = (t = t || {}).resolver || dnsResolver),
    (s = "number" == typeof t.timeoutMs ? t.timeoutMs : RESOLUTION_TIMEOUT_MS),
    (o = {
      cancel: function () {
        _ || O || ((O = !0), (_ = !0), A && (clearTimeout(A), (A = null)));
      },
    }),
    !(e = e || []).length || e.length > MAX_ENDPOINTS)
  )
    return (g(e.length ? "too many endpoints" : "no endpoint in profile"), o);
  for (i = 0; i < e.length; i++) {
    if (((a = e[i] || {}), !(l = String(a.host || "").trim())))
      return g("no endpoint in profile");
    if (ssrf.parseIpv6(l)) return (g("endpoint has no usable IPv4 address"), o);
    if (!ssrf.parseIpv4(l) && !isValidHostname(l))
      return (g("invalid endpoint hostname"), o);
    ((d = E[(u = canonicalHost(l))]) ||
      ((d = {
        host: l,
        key: u,
        literal: !!ssrf.parseIpv4(l),
        addresses: [],
        targets: [],
        targetSeen: Object.create(null),
      }),
      (E[u] = d),
      p.push(d)),
      (S = (f = normalizeTarget(a)).network + ":" + f.port),
      d.targetSeen[S] || ((d.targetSeen[S] = !0), d.targets.push(f)));
  }
  for (i = 0; i < p.length; i++)
    p[i].literal ? (p[i].addresses = [p[i].host]) : h++;
  if (!h) return (I(), o);
  function M(e) {
    try {
      n.resolveAll(e.host, function (r, t) {
        var n,
          s,
          o = [],
          i = Object.create(null);
        if (T()) {
          if (r || !t || !t.length) return g("endpoint lookup failed");
          for (
            n = 0;
            n < t.length &&
            ((s = String((t[n] && t[n].address) || "")),
            !(
              ssrf.parseIpv4(s) &&
              !i[s] &&
              ((i[s] = !0), o.push(s), o.length >= MAX_ADDRESSES_PER_HOST)
            ));
            n++
          );
          if (!o.length) return g("endpoint has no IPv4 address");
          ((e.addresses = o), h--, I());
        }
      });
    } catch (e) {
      g("endpoint lookup failed");
    }
  }
  for (
    A = setTimeout(
      function () {
        g("endpoint lookup timed out");
      },
      Math.max(1, s),
    ),
      i = 0;
    i < p.length;
    i++
  )
    p[i].literal || M(p[i]);
  return o;
}
((Result.prototype.hasMappings = function () {
  var e;
  for (e in this.map) if (own(this.map, e)) return !0;
  return !1;
}),
  (module.exports = {
    MAX_ENDPOINTS: MAX_ENDPOINTS,
    MAX_ADDRESSES_PER_HOST: MAX_ADDRESSES_PER_HOST,
    MAX_BYPASS_ADDRESSES: MAX_BYPASS_ADDRESSES,
    RESOLUTION_TIMEOUT_MS: RESOLUTION_TIMEOUT_MS,
    resolve: resolve,
    isValidHostname: isValidHostname,
    isLiteralAddress: isLiteralAddress,
    canonicalHost: canonicalHost,
  }));
