"use strict";
var http = require("http"),
  https = require("https"),
  zlib = require("zlib"),
  fs = require("fs"),
  path = require("path"),
  url = require("url"),
  dnsResolver = require("./dns-resolver"),
  ssrf = require("./ssrf"),
  errors = require("../errors"),
  err = errors.err,
  CONNECT_TIMEOUT_MS = 1e4,
  READ_TIMEOUT_MS = 15e3,
  TOTAL_TIMEOUT_MS = 45e3,
  MAX_HEADER_BYTES = 32768,
  MAX_BODY_BYTES = 2097152,
  MAX_DECOMPRESSED_BYTES = 8388608,
  MAX_CONCURRENT = 4,
  MAX_COOKIE_COUNT = 16,
  MAX_COOKIE_BYTES = 16384,
  COMPAT_ECDH_CURVES = "prime256v1:secp384r1:secp521r1",
  activeRequests = 0,
  requestQueue = [],
  bundledCa = null;
function loadBundledCa() {
  if (null !== bundledCa) return bundledCa || null;
  try {
    bundledCa =
      fs
        .readFileSync(
          path.join(__dirname, "..", "..", "certs", "cacert.pem"),
          "utf8",
        )
        .match(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
        ) || [];
  } catch (e) {
    bundledCa = [];
  }
  return bundledCa.length ? bundledCa : null;
}
function isTlsError(e) {
  var r = String((e && (e.code || e.errno)) || ""),
    t = String((e && e.message) || "").toLowerCase();
  return (
    r.indexOf("CERT") >= 0 ||
    r.indexOf("SSL") >= 0 ||
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" === r ||
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE" === r ||
    "DEPTH_ZERO_SELF_SIGNED_CERT" === r ||
    "SELF_SIGNED_CERT_IN_CHAIN" === r ||
    "ERR_TLS_CERT_ALTNAME_INVALID" === r ||
    t.indexOf("certificate") >= 0 ||
    t.indexOf("issuer") >= 0 ||
    t.indexOf("altname") >= 0
  );
}
function compatibleEcdhCurves() {
  return parseInt(
    String((process && process.versions && process.versions.node) || "0").split(
      ".",
    )[0],
    10,
  ) >= 4
    ? COMPAT_ECDH_CURVES
    : null;
}
function resolveValidated(e, r, t) {
  "function" == typeof r && ((t = r), (r = Date.now() + TOTAL_TIMEOUT_MS));
  var n = ssrf.parseIpv4(e) ? 4 : e.indexOf(":") >= 0 ? 6 : 0;
  if (n) {
    try {
      ssrf.assertAddressAllowed(e, n);
    } catch (e) {
      return t(e);
    }
    return t(null, [{ address: e, family: n }]);
  }
  dnsResolver.resolveForConnection(e, r, function (e, r) {
    if (e || !r || !r.length)
      return t(
        err(
          e && "TIMEOUT" === e.code ? "TIMEOUT" : "DNS_FAILED",
          e && "TIMEOUT" === e.code ? "dns deadline exceeded" : "lookup failed",
        ),
      );
    try {
      ssrf.assertResolvedAddresses(r);
    } catch (e) {
      return t(e);
    }
    t(null, r);
  });
}
function decodeBody(e, r, t) {
  var n,
    o,
    s,
    i,
    a = String(r || "").toLowerCase();
  function c(r) {
    ((o = []), (s = 0), (i = !1));
    try {
      n = r();
    } catch (e) {
      return t(err("NETWORK_ERROR", "malformed compressed response"));
    }
    (n.on("data", function (e) {
      if (!i)
        if ((s += e.length) > MAX_DECOMPRESSED_BYTES) {
          ((i = !0), (o = []));
          try {
            n.destroy();
          } catch (e) {}
          t(err("DECOMPRESSED_TOO_LARGE", "response too large"));
        } else o.push(e);
    }),
      n.on("error", function () {
        i ||
          ((i = !0),
          (o = []),
          t(err("NETWORK_ERROR", "malformed compressed response")));
      }),
      n.on("end", function () {
        i || ((i = !0), t(null, Buffer.concat(o, s).toString("utf8")));
      }),
      n.end(e));
  }
  return "gzip" === a
    ? c(function () {
        return zlib.createGunzip();
      })
    : "deflate" === a
      ? c(function () {
          return zlib.createInflate();
        })
      : e.length > MAX_DECOMPRESSED_BYTES
        ? t(err("DECOMPRESSED_TOO_LARGE", "response too large"))
        : void t(null, e.toString("utf8"));
}
function targetUrl(e) {
  var r = e.hostname.indexOf(":") >= 0 ? "[" + e.hostname + "]" : e.hostname;
  return e.scheme + "://" + r + ":" + e.port + e.path;
}
function redirectOriginChanged(e, r) {
  var t, n, o, s;
  try {
    return (
      (t = url.parse(r)),
      (n = String(t.protocol || "")
        .replace(/:$/, "")
        .toLowerCase()),
      (o = String(t.hostname || "").toLowerCase()),
      (s = t.port ? parseInt(t.port, 10) : "https" === n ? 443 : 80),
      e.origin !== n + "://" + o + ":" + s
    );
  } catch (e) {
    return !1;
  }
}
function redirectUrl(e, r) {
  var t,
    n = url.resolve(targetUrl(e), String(r || ""));
  try {
    t = ssrf.assertUrlAllowed(n);
  } catch (r) {
    throw err(
      errors.isAlcyoneError(r) ? r.code : "INVALID_URL",
      errors.isAlcyoneError(r) ? r.detail : "invalid redirect",
      {
        stage: "redirect",
        protocol: protocolHint(n),
        originChanged: redirectOriginChanged(e, n),
      },
    );
  }
  if ("https" === e.scheme && "http" === t.scheme)
    throw err("HTTPS_DOWNGRADE_REJECTED", "https redirect downgrade", {
      stage: "redirect",
      protocol: t.scheme,
      originChanged: !ssrf.sameOrigin(e, t),
    });
  return n;
}
function sameRequestTarget(e, r) {
  var t;
  try {
    t = ssrf.assertUrlAllowed(r);
    return e.origin === t.origin && e.path === t.path;
  } catch (e) {
    return !1;
  }
}
function createCookieJar() {
  return { cookies: [] };
}
function cookieDefaultPath(e) {
  var r = String((e && e.path) || "/"),
    t = r.lastIndexOf("/");
  return t <= 0 ? "/" : r.slice(0, t);
}
function cookieState(e, r) {
  var t,
    n = [];
  if (!e || !e.cookies || !r) return "";
  for (t = 0; t < e.cookies.length; t++)
    e.cookies[t].origin === r.origin && n.push(
      e.cookies[t].name + "=" + e.cookies[t].value + ";" + e.cookies[t].path,
    );
  return n.sort().join("|");
}
function cookiePathMatches(e, r) {
  return "/" === e || e === r || (0 === r.indexOf(e) && "/" === r.charAt(e.length));
}
function cookieHeader(e, r) {
  var t,
    n = [],
    o = String((r && r.path) || "/");
  if (!e || !e.cookies || !r) return "";
  for (t = 0; t < e.cookies.length; t++)
    if (
      e.cookies[t].origin === r.origin &&
      (!e.cookies[t].secure || "https" === r.scheme) &&
      cookiePathMatches(e.cookies[t].path, o)
    )
      n.push(e.cookies[t].name + "=" + e.cookies[t].value);
  return n.join("; ");
}
function cookieBytes(e) {
  var r,
    t = 0;
  for (r = 0; r < e.cookies.length; r++)
    t += Buffer.byteLength(
      e.cookies[r].name + "=" + e.cookies[r].value + e.cookies[r].path,
      "utf8",
    );
  return t;
}
function storeSetCookie(e, r, t) {
  var n,
    o,
    s,
    i,
    a,
    c,
    d,
    u,
    l,
    h,
    O,
    R,
    T,
    f,
    p,
    oldCookie,
    _ = String(t || "").split(";"),
    m = String(_[0] || "").trim(),
    g = m.indexOf("=");
  if (!e || !r || g <= 0) return !1;
  if (
    ((n = m.slice(0, g).trim()),
    (o = m.slice(g + 1).trim()),
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(n) ||
      /[\u0000-\u001f\u007f]/.test(o) ||
      Buffer.byteLength(n + "=" + o, "utf8") > MAX_COOKIE_BYTES)
  )
    return !1;
  ((s = cookieDefaultPath(r)),
    (i = !1),
    (a = !1),
    (c = null),
    (d = 1 / 0));
  for (u = 1; u < _.length; u++)
    if (((l = String(_[u] || "").trim()), l)) {
      var v = l.indexOf("="),
        y = (v < 0 ? l : l.slice(0, v)).trim().toLowerCase(),
        b = v < 0 ? "" : l.slice(v + 1).trim();
      "path" === y && b && (s = b.charAt(0) === "/" ? b : "/"),
        "secure" === y && (i = !0),
        "max-age" === y &&
          ((T = parseInt(b, 10)), isFinite(T) && (d = T)),
        "expires" === y &&
          ((R = Date.parse(b)), isNaN(R) || (c = R));
    }
  if (i && "https" !== r.scheme) return !1;
  if (d <= 0 || (null !== c && c <= Date.now())) {
    for (f = e.cookies.length - 1; f >= 0; f--)
      e.cookies[f].origin === r.origin &&
        e.cookies[f].name === n &&
        e.cookies[f].path === s &&
        e.cookies.splice(f, 1);
    return !0;
  }
  ((p = {
    name: n,
    value: o,
    path: s,
    secure: i,
    origin: r.origin,
  }),
    (h = -1));
  for (f = 0; f < e.cookies.length; f++)
    e.cookies[f].origin === r.origin &&
      e.cookies[f].name === n &&
      e.cookies[f].path === s &&
      (h = f);
  oldCookie = h >= 0 ? e.cookies[h] : null;
  if (h >= 0) e.cookies[h] = p;
  else {
    if (e.cookies.length >= MAX_COOKIE_COUNT) return !1;
    e.cookies.push(p);
  }
  return cookieBytes(e) <= MAX_COOKIE_BYTES
    ? !0
    : (h >= 0 ? (e.cookies[h] = oldCookie) : e.cookies.pop(), !1);
}
function storeSetCookies(e, r, t) {
  var n,
    o = !1,
    s = (t && t["set-cookie"]) || [];
  "string" == typeof s && (s = [s]);
  for (n = 0; n < s.length; n++) storeSetCookie(e, r, s[n]) && (o = !0);
  return o;
}
function removeHeader(e, r) {
  var t, n = String(r || "").toLowerCase();
  for (t in e)
    Object.prototype.hasOwnProperty.call(e, t) &&
      String(t).toLowerCase() === n &&
      delete e[t];
  return e;
}
function copyHeaders(e) {
  var r, t = {};
  for (r in e)
    Object.prototype.hasOwnProperty.call(e, r) && (t[r] = e[r]);
  return t;
}
function protocolHint(e) {
  var r = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(String(e || "")),
    t = r ? r[1].toLowerCase() : "";
  return "http" === t || "https" === t ? t : "unknown";
}
function safeDiagnosticToken(e, r) {
  return ((e = String(e || "")), /^[A-Za-z0-9_.-]{1,64}$/.test(e) ? e : r);
}
function transportDiagnostic(e, r) {
  return {
    transportErrorCode: safeDiagnosticToken(
      e && (e.code || e.errno),
      "UNKNOWN",
    ),
    transportErrorName: safeDiagnosticToken(e && e.name, "Error"),
    tlsPhase: safeDiagnosticToken(r, "unknown"),
  };
}
function requestError(e, r, t, n, o, s) {
  var i = errors.isAlcyoneError(e) ? e.code : "NETWORK_ERROR",
    a = errors.isAlcyoneError(e)
      ? e.detail
      : String((e && e.code) || "request failed"),
    c = (e && e.meta) || {},
    d = {
      stage: String(c.stage || r || "unknown"),
      redirectHop: "number" == typeof c.redirectHop ? c.redirectHop : t,
      protocol: String(c.protocol || n || "unknown"),
      originChanged: !0 === c.originChanged || !!o,
    };
  return (
    (!0 === c.nested || (s && !0 === s.nested)) && (d.nested = !0),
    c.transportErrorCode &&
      (d.transportErrorCode = safeDiagnosticToken(
        c.transportErrorCode,
        "UNKNOWN",
      )),
    c.transportErrorName &&
      (d.transportErrorName = safeDiagnosticToken(
        c.transportErrorName,
        "Error",
      )),
    c.tlsPhase && (d.tlsPhase = safeDiagnosticToken(c.tlsPhase, "unknown")),
    "number" == typeof c.status &&
      c.status >= 100 &&
      c.status <= 599 &&
      (d.status = c.status),
    err(i, a, d)
  );
}
function fetchUrlNow(e, r, t) {
  var n,
    o = (r = r || {}).deadline || Date.now() + TOTAL_TIMEOUT_MS,
    s = r.redirects || 0,
    i = copyHeaders(r.headers || {}),
    a = r.previousTarget || null,
    jar = r.cookieJar || createCookieJar(),
    seen = r.redirectStates || {},
    session = r.session || { agent: null, closed: !1 },
    c = !1,
    d = null,
    u = protocolHint(e),
    l = !1,
    E = "url-validation",
    T = !1,
    f = "not-applicable",
    p = null;
  function cleanup() {
    if (!session.closed) {
      session.closed = !0;
      try {
        session.agent && session.agent.destroy && session.agent.destroy();
      } catch (e) {}
    }
  }
  function _(e, r, n) {
    c ||
      ((c = !0),
      d && (clearTimeout(d), (d = null)),
      cleanup(),
      t(e ? requestError(e, E, s, u, l) : null, r, n));
  }
  if (Date.now() >= o) return _(err("TIMEOUT", "deadline exceeded"));
  if (s > ssrf.MAX_REDIRECTS) return _(err("TOO_MANY_REDIRECTS", String(s)));
  try {
    n = ssrf.assertUrlAllowed(e);
  } catch (e) {
    return _(e);
  }
  ((u = n.scheme),
    (l = !!a && !ssrf.sameOrigin(a, n)) && (i = ssrf.stripSensitiveHeaders(i)));
  var stateKey = n.origin + n.path + "|" + cookieState(jar, n);
  if (seen[stateKey])
    return _(
      err("TOO_MANY_REDIRECTS", "redirect loop", {
        stage: "redirect",
        redirectHop: s,
        protocol: n.scheme,
        originChanged: l,
      }),
    );
  seen[stateKey] = !0;
  E = "dns-validation";
  d = setTimeout(
    function () {
      _(err("TIMEOUT", "total timeout", { tlsPhase: f }));
      try {
        p && p.destroy();
      } catch (e) {}
    },
    Math.max(1, o - Date.now()),
  );
  resolveValidated(n.hostname, o, function (e, r) {
    if (!c) {
      if (Date.now() >= o)
        return _(err("TIMEOUT", "total timeout", { tlsPhase: f }));
      if (e) return _(e);
      var a,
        u = r[0],
        l = "https" === n.scheme,
        h = l ? https : http,
        O = copyHeaders(i),
        cookie = cookieHeader(jar, n);
      removeHeader(O, "Cookie");
      cookie && (O.Cookie = cookie);
      ((O.Host = n.hostname),
        (O["Accept-Encoding"] = "gzip, deflate"),
        (O.Connection = "keep-alive"));
      session.agent ||
        (session.agent = new h.Agent({ keepAlive: !0, maxSockets: 1 }));
      var R = {
        host: u.address,
        port: n.port,
        path: n.path,
        method: "GET",
        headers: O,
        servername: l ? n.hostname : void 0,
        rejectUnauthorized: !0,
        agent: session.agent,
        maxHeaderSize: MAX_HEADER_BYTES,
      };
      (l && loadBundledCa() && (R.ca = bundledCa),
        l && compatibleEcdhCurves() && (R.ecdhCurve = compatibleEcdhCurves()),
        (E = "connect"),
        l && (f = "tcp-connect"),
        (p = h.request(R, function (e) {
          var r = e.statusCode || 0,
            a = e.headers && e.headers.location,
            u = [],
            p = 0;
          if (
            ((T = !0),
            (E = "response-status"),
            l && (f = "verified"),
            r >= 300 && r < 400 && a)
          ) {
            var beforeCookies = cookieState(jar, n);
            storeSetCookies(jar, n, e.headers || {});
            var cookieChanged = beforeCookies !== cookieState(jar, n);
            if ((e.resume(), c)) return;
            ((c = !0), (E = "redirect"));
            try {
              a = redirectUrl(n, a);
            } catch (e) {
              return (
                d && clearTimeout(d),
                cleanup(),
                t(
                  requestError(
                    e,
                    E,
                    s + 1,
                    protocolHint(a),
                    e && e.meta && e.meta.originChanged,
                  ),
                )
              );
            }
            if (sameRequestTarget(n, a) && !cookieChanged)
              return (
                d && clearTimeout(d),
                cleanup(),
                t(
                  requestError(
                    err("TOO_MANY_REDIRECTS", "self redirect", {
                      stage: "redirect",
                      redirectHop: s + 1,
                    }),
                    "redirect",
                    s + 1,
                    protocolHint(a),
                    !1,
                  ),
                )
              );
            var nextHeaders = copyHeaders(i);
            if (redirectOriginChanged(n, a))
              nextHeaders = ssrf.stripSensitiveHeaders(nextHeaders);
            return (
              d && clearTimeout(d),
              fetchUrlNow(
                a,
                {
                  deadline: o,
                  redirects: s + 1,
                  headers: nextHeaders,
                  previousTarget: n,
                  cookieJar: jar,
                  redirectStates: seen,
                  session: session,
                },
                t,
              )
            );
          }
          if (r < 200 || r >= 300)
            return (
              e.resume(),
              _(
                401 === r
                  ? err("PROVIDER_AUTH_FAILED", "401", { status: 401 })
                  : 403 === r
                    ? err("PROVIDER_REJECTED", "403", { status: 403 })
                    : 429 === r
                      ? err("RATE_LIMITED", "429", { status: 429 })
                      : err("HTTP_ERROR", String(r), { status: r }),
              )
            );
          ((E = "response-read"),
            e.on("data", function (r) {
              if (!c)
                if ((p += r.length) > MAX_BODY_BYTES) {
                  ((u = []),
                    _(err("RESPONSE_TOO_LARGE", "body limit exceeded")));
                  try {
                    e.destroy();
                  } catch (e) {}
                } else u.push(r);
            }),
            e.on("end", function () {
              if (!c) {
                var r = Buffer.concat(u);
                ((u = []),
                  (E = "decode"),
                  decodeBody(
                    r,
                    e.headers["content-encoding"],
                    function (r, t) {
                      if ((d && clearTimeout(d), r)) return _(r);
                      _(null, t, e.headers || {});
                    },
                  ));
              }
            }),
            e.on("error", function (e) {
              ((E = "response-read"),
                _(
                  err(
                    "NETWORK_ERROR",
                    (e && e.code) || "response failed",
                    transportDiagnostic(e, f),
                  ),
                ));
            }),
            e.setTimeout(READ_TIMEOUT_MS, function () {
              ((E = "response-read"), _(err("TIMEOUT", "read timeout")));
              try {
                e.destroy();
              } catch (e) {}
            }));
        })).on("socket", function (e) {
          l &&
            e &&
            "function" == typeof e.on &&
            (e.on("connect", function () {
              f = "tls-handshake";
            }),
            e.on("secure", function () {
              f = "certificate-verification";
            }),
            e.on("secureConnect", function () {
              f = "verified";
            }));
        }),
        p.setTimeout(CONNECT_TIMEOUT_MS, function () {
          _(err("TIMEOUT", "connect timeout", { tlsPhase: f }));
          try {
            p.destroy();
          } catch (e) {}
        }),
        p.on("error", function (e) {
          if (((E = T ? "response-read" : "connect"), isTlsError(e)))
            return _(
              err(
                "TLS_CERTIFICATE_INVALID",
                "certificate verification failed",
                transportDiagnostic(e, f),
              ),
            );
          _(
            err(
              "NETWORK_ERROR",
              e.code || "request failed",
              transportDiagnostic(e, f),
            ),
          );
        }),
        p.end());
    }
  });
}
function pumpQueue() {
  for (var e; activeRequests < MAX_CONCURRENT && requestQueue.length;)
    (e = requestQueue.shift()).options.deadline &&
    Date.now() >= e.options.deadline
      ? e.callback(err("TIMEOUT", "deadline exceeded"))
      : (activeRequests++,
        (function (e) {
          fetchUrlNow(e.url, e.options, function () {
            var r = arguments;
            (activeRequests--, e.callback.apply(null, r), pumpQueue());
          });
        })(e));
}
function fetchUrl(e, r, t) {
  (requestQueue.push({ url: e, options: r || {}, callback: t }), pumpQueue());
}
module.exports = {
  CONNECT_TIMEOUT_MS: CONNECT_TIMEOUT_MS,
  READ_TIMEOUT_MS: READ_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS: TOTAL_TIMEOUT_MS,
  MAX_HEADER_BYTES: MAX_HEADER_BYTES,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  MAX_DECOMPRESSED_BYTES: MAX_DECOMPRESSED_BYTES,
  MAX_CONCURRENT: MAX_CONCURRENT,
  MAX_COOKIE_COUNT: MAX_COOKIE_COUNT,
  MAX_COOKIE_BYTES: MAX_COOKIE_BYTES,
  fetchUrl: fetchUrl,
  resolveValidated: resolveValidated,
  isTlsError: isTlsError,
  decodeBody: decodeBody,
  loadBundledCa: loadBundledCa,
  redirectUrl: redirectUrl,
  sameRequestTarget: sameRequestTarget,
  requestError: requestError,
  protocolHint: protocolHint,
  transportDiagnostic: transportDiagnostic,
  compatibleEcdhCurves: compatibleEcdhCurves,
  createCookieJar: createCookieJar,
  cookieHeader: cookieHeader,
  cookieState: cookieState,
  storeSetCookie: storeSetCookie,
  storeSetCookies: storeSetCookies,
};
