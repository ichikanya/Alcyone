"use strict";
var httpClient = require("./http-client"),
  ssrf = require("./ssrf"),
  parsers = require("../proto/parsers"),
  errors = require("../errors"),
  err = errors.err,
  MAX_NESTED = 32,
  MAX_TOTAL_BYTES = 4194304,
  IMPORT_TIMEOUT_MS = httpClient.TOTAL_TIMEOUT_MS || 45e3,
  MAX_ATTEMPTS = 7,
  MAX_PARALLEL_NESTED = 4,
  INCY_COMPAT_VERSION = "3.3.5",
  INCY_RUNTIME_VERSION = "21.0.8";

function markNested(e) {
  var r = (e && e.meta) || {},
    t = {
      stage: r.stage || "nested-fetch",
      redirectHop: "number" == typeof r.redirectHop ? r.redirectHop : 0,
      protocol: r.protocol || "unknown",
      originChanged: !0 === r.originChanged,
      nested: !0,
    };
  return (
    r.transportErrorCode && (t.transportErrorCode = r.transportErrorCode),
    r.transportErrorName && (t.transportErrorName = r.transportErrorName),
    r.tlsPhase && (t.tlsPhase = r.tlsPhase),
    err((e && e.code) || "NETWORK_ERROR", (e && e.detail) || "", t)
  );
}

var CLIENT_PROFILES = [
  { name: "Happ", ua: "Happ/3.1.0/android" },
  { name: "sing-box", ua: "sing-box/1.13.0" },
  { name: "v2RayTun", ua: "v2RayTun/5.23.73" },
  { name: "Clash Meta", ua: "ClashMetaForAndroid/2.11.16.Meta" },
  {
    name: "Browser",
    ua: "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  },
];
var INCY_PROFILE = {
  name: "INCY",
  compatProfile: "incy",
  ua: "INCY/" + INCY_COMPAT_VERSION + "/webos Dalvik/" + INCY_RUNTIME_VERSION,
};

function headersFor(e, r) {
  r = r || {};
  var t = {
    "User-Agent":
      r.compatProfile === "incy"
        ? INCY_PROFILE.ua
        : r.ua || (CLIENT_PROFILES[e] || CLIENT_PROFILES[0]).ua,
    Accept: "*/*",
  };
  if (r.compatProfile === "incy") {
    if (!r.isHttps || !r.hwid) return t;
    return (
      (t["Accept-Language"] = r.acceptLanguage || "en-US"),
      (t["x-app-version"] = INCY_COMPAT_VERSION),
      (t["x-device-locale"] = r.deviceLocale || "en_US"),
      (t["x-client"] = "INCY"),
      (t["x-hwid"] = r.hwid),
      (t["x-device-os"] = r.deviceOS || "webOS"),
      (t["x-ver-os"] = r.verOS || "unknown"),
      (t["x-device-model"] = r.deviceModel || "TV"),
      t
    );
  }
  return (
    !0 === r.compatMode &&
      r.isHttps &&
      r.hwid &&
      (r.ua && (t["User-Agent"] = r.ua),
      (t["X-HWID"] = r.hwid),
      (t["X-Device-OS"] = r.deviceOS || "webOS"),
      (t["X-Ver-OS"] = r.verOS || "4.0.0"),
      (t["X-Device-model"] = r.deviceModel || "TV")),
    t
  );
}
function profileLabel(e) {
  return e && e.compatProfile === "incy"
    ? INCY_PROFILE.name
    : (CLIENT_PROFILES[e && "number" == typeof e.index ? e.index : e] ||
        CLIENT_PROFILES[0]).name;
}
function expandNested(e, r, t) {
  var n,
    o,
    a = String(e || "").split(/\r?\n/),
    i = [],
    s = 0,
    d = a.slice(0),
    l = Buffer.byteLength(d.join("\n"), "utf8"),
    p = 0,
    u = 0,
    E = !1,
    c = null,
    safeHeaders = ssrf.stripSensitiveHeaders((r && r.headers) || {});
  for (n = 0; n < a.length; n++)
    (o = parsers.safeText(a[n], 2048)) &&
      "#" !== o.charAt(0) &&
      0 !== o.indexOf("//") &&
      (s++, /^https?:\/\/\S+$/i.test(o) && i.push({ index: n, url: o }));
  if (!i.length || i.length !== s) return t(null, e);
  if (i.length > MAX_NESTED) return t(err("TOO_MANY_NESTED", String(i.length)));
  !(function e() {
    for (; !E && !c && p < MAX_PARALLEL_NESTED && u < i.length; )
      !(function (t) {
        (p++,
          httpClient.fetchUrl(
            t.url,
            { headers: safeHeaders, deadline: r.deadline },
            function (r, n) {
              if ((p--, !E)) {
                if (r) c = markNested(r);
                else {
                  var o = parsers.safeBase64Decode(n || "");
                  (l =
                    l -
                      Buffer.byteLength(d[t.index] || "", "utf8") +
                      Buffer.byteLength(o, "utf8") >
                    MAX_TOTAL_BYTES
                      ? (c = err("RESPONSE_TOO_LARGE", "nested total too large"))
                      : (d[t.index] = o));
                }
                e();
              }
            }
          ));
      })(i[u++]);
    !(function () {
      if (!E && 0 === p && (c || !(u < i.length))) {
        if (((E = !0), c)) return t(c);
        t(null, d.join("\n"));
      }
    })();
  })();
}

function normalizedBody(e) {
  var r = parsers.htmlEntityDecode(String(e || "")),
    t = parsers.percentDecodeLoose(r),
    n = parsers.safeBase64Decode(t);
  return (r + "\n" + t + "\n" + (n || "")).toLowerCase();
}
function hasAny(e, r) {
  var t;
  for (t = 0; t < r.length; t++) if (r[t].test(e)) return !0;
  return !1;
}
var CONTROL_MARKERS = [
  /(?:application|app|client)\s*(?:is\s*)?(?:not\s+supported|unsupported)/i,
  /(?:не\s+поддерж|приложен[^\n]{0,32}(?:не\s+поддерж|поддерживает))/i,
  /(?:go|open|перейдите|перейти)[^\n]{0,32}(?:settings|настрой)/i,
  /(?:turn\s+on|enable|send|requires?|нужен|включите|переда)[^\n]{0,32}hwid/i,
  /(?:device\s+limit|too\s+many\s+devices|device[^\n]{0,24}(?:limit|maximum)[^\n]{0,24}(?:reached|exceeded)|лимит\s+устрой|превысили\s+лимит|достигнут[^\n]{0,32}(?:предел|лимит)[^\n]{0,32}устрой|предел[^\n]{0,32}колич[^\n]{0,32}устрой)/i,
];
var STATUS_MARKERS = [
  /(?:inactive|expired|subscription\s+ended|balance|top[\s_-]*up|renew)/i,
  /(?:неактив|истек|законч|баланс|пополн|продл)[^\n]{0,48}/i,
];
var HWID_MARKERS = [
  /(?:turn\s+on|enable|send|requires?|нужен|включите|переда)[^\n]{0,32}hwid/i,
  /hwid[^\n]{0,32}(?:required|нужен|обязател)/i,
];
var DEVICE_LIMIT_MARKERS = [
  /device\s+limit/i,
  /too\s+many\s+devices/i,
  /device[^\n]{0,24}(?:limit|maximum)[^\n]{0,24}(?:reached|exceeded)/i,
  /лимит\s+устрой/i,
  /превысили\s+лимит/i,
  /достигнут[^\n]{0,32}(?:предел|лимит)[^\n]{0,32}устрой/i,
  /предел[^\n]{0,32}колич[^\n]{0,32}устрой/i,
];
function classifyCandidate(e, r, t) {
  var n,
    o,
    s,
    i = 0,
    a = 0,
    c = 0,
    d = normalizedBody(r),
    u = hasAny(d, CONTROL_MARKERS),
    l = hasAny(d, HWID_MARKERS),
    h = hasAny(d, DEVICE_LIMIT_MARKERS);
  for (n = 0; n < e.length; n++)
    ((o = String((e[n] && e[n].name) || "").toLowerCase()),
      (s = hasAny(o, CONTROL_MARKERS)),
      s ? i++ : hasAny(o, STATUS_MARKERS) ? a++ : c++);
  return {
    kind:
      e.length && c
        ? "usable"
        : e.length && a === e.length
          ? "status"
          : e.length && (i === e.length || (e.length === 1 && u))
            ? "control"
            : !e.length && t && Object.keys(t).length
              ? "unsupported"
              : !e.length && u
                ? "control"
                : "empty",
    usableCount: c,
    statusCount: a,
    controlCount: i,
    requiresHwid: l,
    deviceLimit: h,
  };
}
function mergeResponseHeaders(e, r, t) {
  var n, o;
  for (n in t || {})
    Object.prototype.hasOwnProperty.call(t, n) &&
      (e[String(n).toLowerCase()] = t[n]);
  o = parsers.parseContentHeaders(r);
  for (n in o)
    Object.prototype.hasOwnProperty.call(o, n) && (e[n] || (e[n] = o[n]));
  return e;
}
function fetchCandidate(e, r, t, n, o) {
  o = o || {};
  var a = /^https:/i.test(e),
    i = {
      compatMode: !0 === o.compatMode,
      compatProfile: o.compatProfile || "",
      hwid: o.hwid || "",
      isHttps: a,
      ua: o.ua,
      deviceOS: o.deviceOS,
      verOS: o.verOS,
      deviceModel: o.deviceModel,
      deviceLocale: o.deviceLocale,
      acceptLanguage: o.acceptLanguage,
    },
    s = headersFor(r, i);
  httpClient.fetchUrl(e, { headers: s, deadline: t }, function (e, o, a) {
    if (e) return n(e);
    expandNested(o, { headers: s, deadline: t }, function (e, t) {
      var r,
        i,
        d = {};
      if (e) return n(e);
      try {
        i = parsers.extractSubscriptionProfiles(t);
      } catch (e) {
        return n(err("NO_SERVERS_FOUND", "subscription parse failed"));
      }
      r = parsers.findUnsupportedSubscriptionProtocols(t);
      d = mergeResponseHeaders(d, t, a);
      var u = classifyCandidate(i, t, r);
      n(null, {
        imported: i,
        headers: d,
        clientIndex: o,
        kind: u.kind,
        usableCount: u.usableCount,
        statusCount: u.statusCount,
        controlCount: u.controlCount,
        requiresHwid: u.requiresHwid,
        deviceLimit: u.deviceLimit,
        unsupportedProtocols: r,
      });
    });
  });
}
function requestErrorRetryable(e) {
  var r = e && e.meta && e.meta.status;
  return (
    !!e &&
    ("PROVIDER_REJECTED" === e.code ||
      ("HTTP_ERROR" === e.code &&
        (400 === r || 403 === r || 406 === r || 415 === r)) ||
      "NO_SERVERS_FOUND" === e.code ||
      "HWID_REQUIRED" === e.code)
  );
}
function download(e, r, t) {
  t = t || {};
  var n = Date.now() + Math.min(t.timeout || IMPORT_TIMEOUT_MS, IMPORT_TIMEOUT_MS),
    o = t.providerHwid || "",
    a = o || t.hwid || "",
    i = /^https:/i.test(e),
    s = [],
    d = {},
    l = {},
    u = 0,
    c = null,
    h = null,
    E = !1,
    T = { unsupported: {} };
  function enqueue(v) {
    var y =
      (v.compatProfile || "legacy") + ":" +
      ("number" == typeof v.index ? v.index : "incy") +
      ":" +
      (v.identity ? "id" : "anon");
    if (!d[y] && !l[y] && u < MAX_ATTEMPTS) (d[y] = !0), s.push(v);
  }
  function attemptOptions(v) {
    var y,
      b = {};
    for (y in t) Object.prototype.hasOwnProperty.call(t, y) && (b[y] = t[y]);
    return (
      (b.compatMode = !!v.identity),
      (b.compatProfile = v.compatProfile || ""),
      (b.hwid = v.identity ? a : ""),
      (b.providerHwid = o),
      b
    );
  }
  function addLegacyAfter(v) {
    var y;
    for (y = 0; y < CLIENT_PROFILES.length; y++)
      if (!(v && v.compatProfile === "" && y === v.index && !v.identity))
        enqueue({ index: y, compatProfile: "", identity: !1 });
  }
  function finishError(v) {
    var y, b;
    if (c) return;
    c = !0;
    if (h) {
      y = { imported: h.imported, headers: h.headers, clients: h.clients };
      return (
        h.unsupportedProtocols &&
          (y.unsupportedProtocols = h.unsupportedProtocols),
        E && (y.warnings = ["PROVIDER_HWID_REJECTED"]),
        r(null, y)
      );
    }
    b = v || T.lastError;
    if (!b && T.unsupported && Object.keys(T.unsupported).length)
      b = err("UNSUPPORTED_SUBSCRIPTION_PROTOCOL", "unsupported protocol");
    if (!b && T.deviceLimit)
      b = err("SUBSCRIPTION_DEVICE_LIMIT", "provider device limit");
    if (!b && T.clientUnsupported)
      b = err("SUBSCRIPTION_CLIENT_UNSUPPORTED", "client mode rejected");
    r(b || err("NO_SERVERS_FOUND", "no supported servers"));
  }
  function finishCandidate(v, b) {
    var y, m, g;
    if (c) return;
    if (!v || !v.imported || !v.imported.length) return next(b);
    if (v.kind === "control" || v.kind === "empty" || v.kind === "unsupported")
      return next(b);
    y = {};
    for (m in v.unsupportedProtocols || {})
      Object.prototype.hasOwnProperty.call(v.unsupportedProtocols, m) &&
        (y[m] = v.unsupportedProtocols[m]);
    g = {
      imported: v.imported,
      headers: v.headers || {},
      clients: profileLabel(b),
      unsupportedProtocols: y,
    };
    if (E) g.warnings = ["PROVIDER_HWID_REJECTED"];
    c = !0;
    r(null, g);
  }
  function next(previousError) {
    var v, b, y;
    if (c) return;
    if (Date.now() >= n || u >= MAX_ATTEMPTS || !s.length)
      return finishError(previousError);
    v = s.shift();
    y =
      (v.compatProfile || "legacy") + ":" +
      ("number" == typeof v.index ? v.index : "incy") +
      ":" +
      (v.identity ? "id" : "anon");
    delete d[y];
    if (l[y]) return next(previousError);
    l[y] = !0;
    u++;
    fetchCandidate(e, v.index, n, function (e, r) {
      if (e) {
        T.lastError = e;
        if ("RATE_LIMITED" === e.code || "PROVIDER_AUTH_FAILED" === e.code)
          return finishError(e);
        if (requestErrorRetryable(e)) {
          addLegacyAfter(v);
          return next(e);
        }
        return finishError(e);
      }
      if (r.unsupportedProtocols)
        for (b in r.unsupportedProtocols)
          Object.prototype.hasOwnProperty.call(r.unsupportedProtocols, b) &&
            (T.unsupported[b] = r.unsupportedProtocols[b]);
      if (r.kind === "usable" || r.kind === "status") {
        h = {
          imported: r.imported,
          headers: r.headers,
          clients: profileLabel(v),
          unsupportedProtocols: r.unsupportedProtocols,
        };
        return finishCandidate(r, v);
      }
      if (r.kind === "control") {
        r.deviceLimit && (T.deviceLimit = !0);
        T.clientUnsupported = !0;
        if (v.identity && o) E = !0;
        if (r.requiresHwid && !v.identity && a && i)
          enqueue({ index: v.index, compatProfile: v.compatProfile, identity: !0 });
        if (!d["incy:incy:id"] && !l["incy:incy:id"] && a && i)
          enqueue({ index: -1, compatProfile: "incy", identity: !0 });
        addLegacyAfter(v);
        return next();
      }
      if (r.kind === "unsupported") {
        for (b in r.unsupportedProtocols)
          Object.prototype.hasOwnProperty.call(r.unsupportedProtocols, b) &&
            (T.unsupported[b] = r.unsupportedProtocols[b]);
        return next();
      }
      if (r.requiresHwid && !v.identity && a && i)
        enqueue({ index: v.index, compatProfile: v.compatProfile, identity: !0 });
      if (!d["incy:incy:id"] && !l["incy:incy:id"] && a && i)
        enqueue({ index: -1, compatProfile: "incy", identity: !0 });
      addLegacyAfter(v);
      next();
    }, attemptOptions(v));
  }
  if (o && i) enqueue({ index: -1, compatProfile: "incy", identity: !0 });
  else enqueue({ index: 0, compatProfile: "", identity: !1 });
  next();
}
module.exports = {
  MAX_NESTED: MAX_NESTED,
  MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
  IMPORT_TIMEOUT_MS: IMPORT_TIMEOUT_MS,
  MAX_ATTEMPTS: MAX_ATTEMPTS,
  CLIENT_PROFILES: CLIENT_PROFILES,
  INCY_PROFILE: INCY_PROFILE,
  download: download,
  fetchCandidate: fetchCandidate,
  expandNested: expandNested,
  headersFor: headersFor,
};
