"use strict";
var errors = require("../errors"),
  err = errors.err,
  MAX_REDIRECTS = 5,
  BLOCKED_HOST_SUFFIXES = [
    ".local",
    ".localdomain",
    ".internal",
    ".intranet",
    ".lan",
    ".home",
    ".home.arpa",
    ".corp",
    ".private",
    ".localhost",
  ],
  BLOCKED_HOST_EXACT = {
    localhost: 1,
    "localhost.localdomain": 1,
    "ip6-localhost": 1,
    "ip6-loopback": 1,
    metadata: 1,
    "metadata.google.internal": 1,
    "instance-data": 1,
  },
  SENSITIVE_HEADERS = [
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-hwid",
  ];
function parseIpv4(e) {
  var r,
    t,
    i = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(e || "")),
    n = [];
  if (!i) return null;
  for (r = 1; r <= 4; r++) {
    if ((t = i[r]).length > 1 && "0" === t.charAt(0)) return null;
    if (!((t = parseInt(t, 10)) >= 0 && t <= 255)) return null;
    n.push(t);
  }
  return n;
}
function inCidr4(e, r, t, i, n, l) {
  var o = 0 === l ? 0 : (4294967295 << (32 - l)) >>> 0;
  return (
    (((((e[0] << 24) >>> 0) + (e[1] << 16) + (e[2] << 8) + e[3]) >>> 0) & o) >>>
      0 ==
    (((((r << 24) >>> 0) + (t << 16) + (i << 8) + n) >>> 0) & o) >>> 0
  );
}
function blockedIpv4Reason(e) {
  return inCidr4(e, 0, 0, 0, 0, 8)
    ? "unspecified"
    : inCidr4(e, 10, 0, 0, 0, 8)
      ? "private"
      : inCidr4(e, 100, 64, 0, 0, 10)
        ? "carrier-grade-nat"
        : inCidr4(e, 127, 0, 0, 0, 8)
          ? "loopback"
          : inCidr4(e, 169, 254, 0, 0, 16)
            ? "link-local"
            : inCidr4(e, 172, 16, 0, 0, 12)
              ? "private"
              : inCidr4(e, 192, 0, 0, 0, 24)
                ? "reserved"
                : inCidr4(e, 192, 0, 2, 0, 24)
                  ? "documentation"
                  : inCidr4(e, 192, 88, 99, 0, 24)
                    ? "reserved"
                    : inCidr4(e, 192, 168, 0, 0, 16)
                      ? "private"
                      : inCidr4(e, 198, 18, 0, 0, 15)
                        ? "benchmarking"
                        : inCidr4(e, 198, 51, 100, 0, 24) ||
                            inCidr4(e, 203, 0, 113, 0, 24)
                          ? "documentation"
                          : inCidr4(e, 224, 0, 0, 0, 4)
                            ? "multicast"
                            : inCidr4(e, 240, 0, 0, 0, 4)
                              ? "reserved"
                              : "";
}
function parseIpv6(e) {
  var r,
    t,
    i,
    n,
    l,
    o = String(e || "").trim();
  if (
    ("[" === o.charAt(0) &&
      "]" === o.charAt(o.length - 1) &&
      (o = o.slice(1, -1)),
    o.indexOf("%") >= 0)
  )
    return null;
  if (o.indexOf(":") < 0) return null;
  if (o.indexOf(":::") >= 0) return null;
  if ((r = o.split("::")).length > 2) return null;
  function s(e) {
    var r,
      t,
      i,
      n = "" === e ? [] : e.split(":"),
      l = [];
    for (r = 0; r < n.length; r++) {
      if ("" === (t = n[r])) return null;
      if (t.indexOf(".") >= 0) {
        if (r !== n.length - 1) return null;
        if (!(i = parseIpv4(t))) return null;
        (l.push((i[0] << 8) | i[1]), l.push((i[2] << 8) | i[3]));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(t)) return null;
        l.push(parseInt(t, 16));
      }
    }
    return l;
  }
  if (1 === r.length) return (t = s(r[0])) && 8 === t.length ? t : null;
  if (
    ((t = "" === r[0] ? [] : s(r[0])),
    (i = "" === r[1] ? [] : s(r[1])),
    !t || !i)
  )
    return null;
  if (t.length + i.length > 7) return null;
  for (n = t.slice(0), l = t.length + i.length; l < 8; l++) n.push(0);
  for (l = 0; l < i.length; l++) n.push(i[l]);
  return 8 === n.length ? n : null;
}
function allZero(e, r) {
  var t;
  for (t = 0; t < r; t++) if (0 !== e[t]) return !1;
  return !0;
}
function embeddedIpv4(e) {
  return [e[6] >> 8, 255 & e[6], e[7] >> 8, 255 & e[7]];
}
function blockedIpv6Reason(e) {
  var r,
    t,
    i = !1;
  for (r = 0; r < 8; r++) 0 !== e[r] && (i = !0);
  return i
    ? allZero(e, 7) && 1 === e[7]
      ? "loopback"
      : allZero(e, 5) && 65535 === e[5]
        ? (t = blockedIpv4Reason(embeddedIpv4(e)))
          ? "ipv4-mapped-" + t
          : ""
        : allZero(e, 6)
          ? "ipv4-compatible"
          : 100 === e[0] && 65435 === e[1] && allZero(e.slice(2), 4)
            ? (t = blockedIpv4Reason(embeddedIpv4(e)))
              ? "nat64-" + t
              : ""
            : 8194 === e[0]
              ? (t = blockedIpv4Reason([
                  e[1] >> 8,
                  255 & e[1],
                  e[2] >> 8,
                  255 & e[2],
                ]))
                ? "6to4-" + t
                : ""
              : 256 === e[0] && allZero(e.slice(1), 3)
                ? "discard"
                : 8193 === e[0] && 3512 === e[1]
                  ? "documentation"
                  : 8193 === e[0] && 0 === e[1]
                    ? "teredo"
                    : 64512 == (65024 & e[0])
                      ? "unique-local"
                      : 65152 == (65472 & e[0])
                        ? "link-local"
                        : 65280 == (65280 & e[0])
                          ? "multicast"
                          : ""
    : "unspecified";
}
function assertAddressAllowed(e, r) {
  var t, i, n;
  if (4 === r || parseIpv4(e)) {
    if (!(t = parseIpv4(e))) throw err("BLOCKED_ADDRESS", "malformed ipv4");
    if ((n = blockedIpv4Reason(t))) throw err("BLOCKED_ADDRESS", n);
  } else {
    if (!(i = parseIpv6(e))) throw err("BLOCKED_ADDRESS", "malformed address");
    if ((n = blockedIpv6Reason(i))) throw err("BLOCKED_ADDRESS", n);
  }
}
function isAddressAllowed(e, r) {
  try {
    return (assertAddressAllowed(e, r), !0);
  } catch (e) {
    return !1;
  }
}
function assertHostnameAllowed(e) {
  var r,
    t = String(e || "")
      .toLowerCase()
      .replace(/\.$/, "");
  if (!t) throw err("INVALID_URL", "empty host");
  if (BLOCKED_HOST_EXACT[t]) throw err("BLOCKED_ADDRESS", "local hostname");
  for (r = 0; r < BLOCKED_HOST_SUFFIXES.length; r++)
    if (
      t.length > BLOCKED_HOST_SUFFIXES[r].length &&
      t.slice(-BLOCKED_HOST_SUFFIXES[r].length) === BLOCKED_HOST_SUFFIXES[r]
    )
      throw err("BLOCKED_ADDRESS", "local hostname");
  if (parseIpv4(t) || t.indexOf(":") >= 0) return (assertAddressAllowed(t), t);
  if (t.indexOf(".") < 0) throw err("BLOCKED_ADDRESS", "single-label hostname");
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(t)
  )
    throw err("INVALID_URL", "malformed hostname");
  return t;
}
function assertUrlAllowed(e) {
  var r,
    t,
    i,
    n,
    l,
    o,
    s,
    a,
    d,
    f = String(e || "").trim();
  if (!f) throw err("INVALID_URL", "empty url");
  if (f.length > 2048) throw err("INVALID_URL", "url too long");
  if (/[\u0000-\u0020\u007f]/.test(f))
    throw err("INVALID_URL", "illegal character");
  if (!(r = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([\s\S]*)$/.exec(f)))
    throw err("INVALID_URL", "malformed url");
  if (
    ((t = r[1].toLowerCase()),
    (i = r[2]),
    (n = r[3] || ""),
    "http" !== t && "https" !== t)
  )
    throw err("BLOCKED_SCHEME", t);
  if (i.indexOf("@") >= 0)
    throw err("URL_CREDENTIALS_REJECTED", "credentials in url");
  if (!i) throw err("INVALID_URL", "missing host");
  if ("[" === i.charAt(0)) {
    if ((d = i.indexOf("]")) < 0)
      throw err("INVALID_URL", "malformed ipv6 literal");
    if (((l = i.slice(1, d)), (o = i.slice(d + 1)) && ":" !== o.charAt(0)))
      throw err("INVALID_URL", "malformed port");
    if (((o = o ? o.slice(1) : ""), !parseIpv6(l)))
      throw err("INVALID_URL", "malformed ipv6 literal");
  } else if ((d = i.lastIndexOf(":")) >= 0 && i.indexOf(":") === d)
    ((l = i.slice(0, d)), (o = i.slice(d + 1)));
  else {
    if (d >= 0) throw err("INVALID_URL", "ambiguous authority");
    ((l = i), (o = ""));
  }
  if ("" !== o) {
    if (!/^\d{1,5}$/.test(o)) throw err("INVALID_URL", "malformed port");
    if ((a = parseInt(o, 10)) < 1 || a > 65535)
      throw err("INVALID_URL", "port out of range");
  } else a = "https" === t ? 443 : 80;
  return {
    scheme: t,
    hostname: (s = assertHostnameAllowed(l)),
    port: a,
    path: n || "/",
    origin: t + "://" + s + ":" + a,
    isLiteralAddress: !!(parseIpv4(s) || s.indexOf(":") >= 0),
  };
}
function assertResolvedAddresses(e) {
  var r, t;
  if (!e || !e.length) throw err("DNS_FAILED", "no addresses");
  for (r = 0; r < e.length; r++)
    assertAddressAllowed((t = e[r]).address, t.family);
  return e;
}
function sameOrigin(e, r) {
  return !!e && !!r && e.origin === r.origin;
}
function stripSensitiveHeaders(e) {
  var r,
    t,
    i,
    n = {},
    l = {};
  for (i = 0; i < SENSITIVE_HEADERS.length; i++) l[SENSITIVE_HEADERS[i]] = 1;
  for (r in e)
    Object.prototype.hasOwnProperty.call(e, r) &&
      (l[(t = String(r).toLowerCase())] ||
        0 === t.indexOf("x-device-") ||
        (n[r] = e[r]));
  return n;
}
module.exports = {
  MAX_REDIRECTS: MAX_REDIRECTS,
  SENSITIVE_HEADERS: SENSITIVE_HEADERS,
  parseIpv4: parseIpv4,
  parseIpv6: parseIpv6,
  blockedIpv4Reason: blockedIpv4Reason,
  blockedIpv6Reason: blockedIpv6Reason,
  assertAddressAllowed: assertAddressAllowed,
  isAddressAllowed: isAddressAllowed,
  assertHostnameAllowed: assertHostnameAllowed,
  assertUrlAllowed: assertUrlAllowed,
  assertResolvedAddresses: assertResolvedAddresses,
  sameOrigin: sameOrigin,
  stripSensitiveHeaders: stripSensitiveHeaders,
};
