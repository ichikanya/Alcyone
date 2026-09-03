"use strict";
var fs = require("fs"),
  path = require("path"),
  http = require("http"),
  atomic = require("./atomic"),
  errors = require("./errors"),
  err = errors.err,
  SHARED_DIR = "/var/lib/alcyone-shared",
  STATE_FILE = SHARED_DIR + "/system-proxy.state",
  INIT_DIR = "/var/lib/webosbrew/init.d",
  RECOVERY_HOOK = INIT_DIR + "/alcyone-proxy-recovery",
  HTTP_PORT = 10802,
  PROBE_URL = "http://example.com/",
  CALL_TIMEOUT_MS = 5e3,
  SERVICE_URIS = [
    "luna://com.webos.service.connectionmanager",
    "luna://com.palm.connectionmanager",
  ];
function own(e, r) {
  return Object.prototype.hasOwnProperty.call(e, r);
}
function once(e) {
  var r = !1;
  return function () {
    r || ((r = !0), e.apply(null, arguments));
  };
}
function cleanString(e) {
  return String(null == e ? "" : e).trim();
}
function rootAvailable() {
  if ("function" != typeof process.getuid) return !0;
  try {
    return 0 === process.getuid();
  } catch (e) {
    return !0;
  }
}
function arrayCopy(e) {
  var r,
    t = [];
  if ("[object Array]" !== Object.prototype.toString.call(e)) return t;
  for (r = 0; r < e.length; r++) cleanString(e[r]) && t.push(cleanString(e[r]));
  return t;
}
function routeKey(e) {
  return e && e.device
    ? cleanString(e.device) + "|" + cleanString(e.gateway)
    : "";
}
function sameRoute(e, r) {
  return !!routeKey(e) && routeKey(e) === routeKey(r);
}
function networkKey(e) {
  return e
    ? [
        cleanString(e.kind),
        cleanString(e.serviceId),
        cleanString(e.interfaceName),
        cleanString(e.ssid),
      ].join("|")
    : "";
}
function sameNetwork(e, r) {
  var t, n, o, i;
  return (
    !(
      !e ||
      !r ||
      cleanString(e.kind) !== cleanString(r.kind) ||
      cleanString(e.interfaceName) !== cleanString(r.interfaceName)
    ) &&
    ((t = cleanString(e.serviceId)),
    (n = cleanString(r.serviceId)),
    (!t || !n || t === n) &&
      ((o = cleanString(e.ssid)),
      (i = cleanString(r.ssid)),
      !o || !i || o === i))
  );
}
function networkUsable(e) {
  return !(
    !e ||
    !cleanString(e.interfaceName) ||
    ("wifi" === cleanString(e.kind) && !cleanString(e.ssid))
  );
}
function normalizeMethod(e) {
  return "direct" === (e = cleanString(e).toLowerCase()) ||
    "auto" === e ||
    "manual" === e
    ? e
    : "";
}
function normalizeProxy(e) {
  var r = e || {},
    t = normalizeMethod(r.method || r.Method || r.proxyMethod),
    n = cleanString(r.url || r.URL || r.proxyUrl),
    o = arrayCopy(r.servers || r.Servers || r.proxyServers),
    i = arrayCopy(r.excludes || r.Excludes || r.proxyExcludes);
  return !t && r.proxyinfo
    ? normalizeProxy(r.proxyinfo)
    : !t && r.proxyInfo
      ? normalizeProxy(r.proxyInfo)
      : t
        ? { method: t, url: n, servers: o, excludes: i }
        : null;
}
function proxyEqual(e, r) {
  var t;
  if (!e || !r || e.method !== r.method) return !1;
  if ("auto" === e.method && cleanString(e.url) !== cleanString(r.url))
    return !1;
  if (
    (e.servers || []).length !== (r.servers || []).length ||
    (e.excludes || []).length !== (r.excludes || []).length
  )
    return !1;
  for (t = 0; t < (e.servers || []).length; t++)
    if (e.servers[t] !== r.servers[t]) return !1;
  for (t = 0; t < (e.excludes || []).length; t++)
    if (e.excludes[t] !== r.excludes[t]) return !1;
  return !0;
}
function proxyPayload(e, r) {
  var t = { method: e.method };
  return (
    "auto" === e.method && e.url && (t.url = e.url),
    "manual" === e.method &&
      ((t.servers = (e.servers || []).slice(0)),
      (t.excludes = (e.excludes || []).slice(0))),
    r && r.ssid && (t.ssid = r.ssid),
    t
  );
}
function proxyFromStatus(e) {
  return e
    ? normalizeProxy(e.proxyInfo || e.proxyinfo || e.proxy || null)
    : null;
}
function connectedNetwork(e, r) {
  var t,
    n,
    o,
    i,
    a,
    l = [],
    s = [],
    u = e && e.wired,
    c = e && e.wifi;
  if (
    (u && l.push({ kind: "wired", value: u }),
    c && l.push({ kind: "wifi", value: c }),
    !r || !r.device)
  )
    return null;
  for (t = 0; t < l.length; t++)
    ("connected" !== (o = cleanString((n = l[t]).value.state).toLowerCase()) &&
      "online" !== o &&
      "ready" !== o) ||
      ((i = cleanString(
        n.value.interfaceName ||
          n.value.ifName ||
          n.value.interface ||
          n.value.device
      )),
      r &&
        r.device &&
        i &&
        r.device === i &&
        ((a = {
          kind: n.kind,
          serviceId: cleanString(
            n.value.serviceId || n.value.service || n.value.id
          ),
          ssid: cleanString(n.value.ssid || n.value.SSID),
          interfaceName: i,
          value: n.value,
        }),
        s.push(a)));
  return 1 === s.length && networkUsable(s[0]) ? s[0] : null;
}
function parseConnmanList(e) {
  var r,
    t,
    n = cleanString(e),
    o = [];
  if (!n) return o;
  for (r = n.split(/[;,\s]+/), t = 0; t < r.length; t++) r[t] && o.push(r[t]);
  return o;
}
function parseSettings(e) {
  var r,
    t,
    n,
    o,
    i = {},
    a = String(e || "").split(/\r?\n/);
  for (r = 0; r < a.length; r++)
    (t = a[r].indexOf("=")) < 1 ||
      ((n = cleanString(a[r].slice(0, t))),
      (o = cleanString(a[r].slice(t + 1))),
      ("Proxy.Method" !== n &&
        "Proxy.URL" !== n &&
        "Proxy.Servers" !== n &&
        "Proxy.Excludes" !== n &&
        "Type" !== n &&
        "Name" !== n &&
        "Interface" !== n) ||
        (i[n] = o));
  return i;
}
function fallbackProxyFromConnman(e, r) {
  var t,
    n,
    o,
    i,
    a,
    l,
    s = [];
  r = r || "/var/lib/connman";
  try {
    t = fs.readdirSync(r);
  } catch (e) {
    return null;
  }
  for (n = 0; n < t.length; n++) {
    o = path.join(r, t[n]);
    try {
      i = fs.readFileSync(path.join(o, "settings"), "utf8");
    } catch (e) {
      continue;
    }
    ((a = parseSettings(i)),
      (e && e.serviceId && t[n] !== e.serviceId) ||
        (e &&
          e.interfaceName &&
          a.Interface &&
          a.Interface !== e.interfaceName) ||
        (e && "wifi" === e.kind && e.ssid && a.Name && a.Name !== e.ssid) ||
        ((l = normalizeMethod(a["Proxy.Method"])) &&
          s.push({
            proxy: {
              method: l,
              url: cleanString(a["Proxy.URL"]),
              servers: parseConnmanList(a["Proxy.Servers"]),
              excludes: parseConnmanList(a["Proxy.Excludes"]),
            },
            service: t[n],
          })));
  }
  return 1 === s.length ? s[0] : null;
}
function SystemProxyManager(e) {
  ((e = e || {}),
    (this.edition = e.edition || {}),
    (this.service = e.service || null),
    (this.logger = e.logger || null),
    (this.routes = e.routes || null),
    (this.stateFile = e.stateFile || STATE_FILE),
    (this.hookFile = e.hookFile || RECOVERY_HOOK),
    (this.connmanDir = e.connmanDir || "/var/lib/connman"),
    (this.serviceUri = ""),
    (this.lastCapability = null),
    (this.capabilityAt = 0),
    (this.proxyCall = e.proxyCall || null));
}
((SystemProxyManager.prototype.setService = function (e) {
  ((this.service = e || null),
    (this.serviceUri = ""),
    (this.lastCapability = null),
    (this.capabilityAt = 0));
}),
  (SystemProxyManager.prototype.call = function (e, r, t) {
    var n,
      o = this,
      i = this.serviceUri ? [this.serviceUri] : SERVICE_URIS.slice(0);
    if (this.serviceUri)
      for (n = 0; n < SERVICE_URIS.length; n++)
        SERVICE_URIS[n] !== this.serviceUri && i.push(SERVICE_URIS[n]);
    var a = 0,
      l = once(t || function () {});
    !(function t(n) {
      var s,
        u,
        c,
        y = !1;
      if (a >= i.length)
        return l(
          n ||
            err("SYSTEM_PROXY_UNAVAILABLE", "connection manager unavailable")
        );
      if (
        ((s = i[a++]),
        (u = function (e) {
          if (!y) {
            ((y = !0), clearTimeout(c));
            var r = (e && e.payload) || e || {};
            if (!1 === r.returnValue && a < i.length)
              return (
                o.serviceUri === s && (o.serviceUri = ""),
                t(
                  err(
                    "SYSTEM_PROXY_UNAVAILABLE",
                    "connection manager rejected request"
                  )
                )
              );
            if (!1 === r.returnValue)
              return l(
                err(
                  "SYSTEM_PROXY_UNAVAILABLE",
                  "connection manager rejected request"
                )
              );
            ((o.serviceUri = s), l(null, r));
          }
        }),
        (c = setTimeout(function () {
          y ||
            ((y = !0),
            o.serviceUri === s && (o.serviceUri = ""),
            t(err("SYSTEM_PROXY_UNAVAILABLE", "connection manager timeout")));
        }, CALL_TIMEOUT_MS)),
        o.proxyCall)
      )
        try {
          return o.proxyCall(s, e, r || {}, u);
        } catch (e) {
          return y
            ? void 0
            : ((y = !0),
              clearTimeout(c),
              o.serviceUri === s && (o.serviceUri = ""),
              t(e));
        }
      if (!o.service || "function" != typeof o.service.call)
        return (
          clearTimeout(c),
          (y = !0),
          l(err("SYSTEM_PROXY_UNAVAILABLE", "connection manager unavailable"))
        );
      try {
        o.service.call(s + "/" + e, r || {}, u);
      } catch (e) {
        y ||
          ((y = !0),
          clearTimeout(c),
          o.serviceUri === s && (o.serviceUri = ""),
          t(e));
      }
    })(null);
  }),
  (SystemProxyManager.prototype.readRoute = function () {
    return this.routes && "function" == typeof this.routes.readDefaultRoute
      ? this.routes.readDefaultRoute()
      : null;
  }),
  (SystemProxyManager.prototype.ensureStorage = function () {
    var e = path.dirname(this.stateFile);
    try {
      return (
        atomic.ensureOwnedDir(e),
        "function" == typeof fs.accessSync && fs.accessSync(e, fs.W_OK || 2),
        !0
      );
    } catch (e) {
      return !1;
    }
  }),
  (SystemProxyManager.prototype.getStatus = function (e) {
    this.call("getStatus", { subscribe: !1 }, e);
  }),
  (SystemProxyManager.prototype.findProxy = function (e) {
    this.call(
      "findProxyForURL",
      { url: PROBE_URL, host: "example.com" },
      function (r, t) {
        return r
          ? e(r)
          : t && cleanString(t.proxy)
            ? void e(null, cleanString(t.proxy))
            : e(
                err(
                  "SYSTEM_PROXY_UNAVAILABLE",
                  "proxy lookup returned no result"
                )
              );
      }
    );
  }),
  (SystemProxyManager.prototype.snapshot = function (e) {
    var r = this,
      t = this.readRoute();
    this.getStatus(function (n, o) {
      var i, a, l;
      return n
        ? e(n)
        : (i = connectedNetwork(o, t))
          ? ((a = proxyFromStatus(i.value)) ||
              (a = (l = fallbackProxyFromConnman(i, r.connmanDir)) && l.proxy),
            a
              ? void e(null, { route: t, network: i, proxy: a })
              : e(
                  err(
                    "SYSTEM_PROXY_UNAVAILABLE",
                    "original proxy cannot be read"
                  )
                ))
          : e(err("SYSTEM_PROXY_UNAVAILABLE", "active network is ambiguous"));
    });
  }),
  (SystemProxyManager.prototype.readCurrent = function (e) {
    var r = this,
      t = this.readRoute();
    this.getStatus(function (n, o) {
      var i, a, l;
      return n
        ? e(n)
        : (i = connectedNetwork(o, t))
          ? ((a = proxyFromStatus(i.value)) ||
              (a = (l = fallbackProxyFromConnman(i, r.connmanDir)) && l.proxy),
            a
              ? void e(null, { route: t, network: i, proxy: a })
              : e(
                  err(
                    "SYSTEM_PROXY_RESTORE_FAILED",
                    "live proxy configuration is unreadable"
                  )
                ))
          : e(
              err(
                "SYSTEM_PROXY_RESTORE_PENDING",
                "active network is ambiguous"
              )
            );
    });
  }),
  (SystemProxyManager.prototype.preflight = function (e, r) {
    var t = this;
    return (
      (r = r || {}),
      rootAvailable()
        ? this.service || this.proxyCall
          ? this.readState()
            ? e(null, { available: !1, reason: "proxy restoration pending" })
            : this.ensureStorage()
              ? void this.snapshot(function (n, o) {
                  if (n)
                    return e(null, {
                      available: !1,
                      reason: n.detail || "proxy snapshot unavailable",
                    });
                  t.findProxy(function (n) {
                    if (n)
                      return e(null, {
                        available: !1,
                        reason: "proxy lookup unavailable",
                      });
                    ((t.lastCapability = {
                      available: !0,
                      reason: "",
                      snapshot: r.includeSnapshot ? o : null,
                    }),
                      (t.capabilityAt = Date.now()),
                      e(null, {
                        available: !0,
                        reason: "",
                        snapshot: r.includeSnapshot ? o : null,
                      }));
                  });
                })
              : e(null, {
                  available: !1,
                  reason: "recovery storage unavailable",
                })
          : e(null, { available: !1, reason: "connection manager unavailable" })
        : e(null, { available: !1, reason: "root privileges required" })
    );
  }),
  (SystemProxyManager.prototype.writeState = function (e) {
    atomic.writeJsonAtomic(this.stateFile, e, atomic.FILE_MODE);
  }),
  (SystemProxyManager.prototype.readState = function () {
    return atomic.readJson(this.stateFile, null);
  }),
  (SystemProxyManager.prototype.hookScript = function () {
    var e = String(this.edition.appId || ""),
      r = String(this.edition.serviceId || "");
    return /^[A-Za-z0-9_.-]+$/.test(e) && /^[A-Za-z0-9_.-]+$/.test(r)
      ? [
          "#!/bin/sh",
          "# Generated by Alcyone. Wakes the owning service to recover its system proxy.",
          "luna-send -a " +
            e +
            " -n 1 -f luna://" +
            r +
            "/getState '{}' >/dev/null 2>&1 &",
          "",
        ].join("\n")
      : "";
  }),
  (SystemProxyManager.prototype.installHook = function () {
    var e = this.hookScript();
    if (!e)
      throw err("SYSTEM_PROXY_UNAVAILABLE", "recovery hook identity invalid");
    (atomic.ensureSharedDir(
      path.dirname(this.hookFile),
      atomic.SHARED_DIR_MODE
    ),
      atomic.writeSharedFileAtomic(this.hookFile, e, 493));
  }),
  (SystemProxyManager.prototype.removeHook = function () {
    var e = this.hookScript();
    try {
      if (fs.readFileSync(this.hookFile, "utf8") !== e) return !1;
    } catch (e) {
      return !1;
    }
    return atomic.removeQuiet(this.hookFile);
  }),
  (SystemProxyManager.prototype.prepare = function (e, r) {
    var t = this;
    this.snapshot(function (n, o) {
      var i;
      if (n) return r(n);
      if (t.readState())
        return r(
          err(
            "SYSTEM_PROXY_RESTORE_PENDING",
            "stale proxy recovery is pending"
          )
        );
      try {
        ((i = {
          edition: t.edition.id || "",
          serviceId: t.edition.serviceId || "",
          pid: process.pid,
          owner: {
            edition: t.edition.id || "",
            serviceId: t.edition.serviceId || "",
            pid: process.pid,
          },
          mode: "systemProxy",
          stage: "prepared",
          route: o.route,
          routeKey: routeKey(o.route),
          network: {
            kind: o.network.kind,
            serviceId: o.network.serviceId || "",
            ssid: o.network.ssid || "",
            interfaceName: o.network.interfaceName || "",
          },
          originalProxy: o.proxy,
          appliedProxy: null,
          savedAt: Date.now(),
          timestamp: Date.now(),
        }),
          t.writeState(i),
          t.installHook());
      } catch (e) {
        return r(err("SYSTEM_PROXY_UNAVAILABLE", "recovery state unavailable"));
      }
      ((e.proxyState = i), r(null, i));
    });
  }),
  (SystemProxyManager.prototype.setProxy = function (e, r, t) {
    this.call("setProxy", proxyPayload(e, r), function (e) {
      if (e) return t(err("SYSTEM_PROXY_SET_FAILED", "system proxy rejected"));
      t(null);
    });
  }),
  (SystemProxyManager.prototype.proxyIsApplied = function (e) {
    var r = cleanString(e).toUpperCase();
    return (
      r === "PROXY 127.0.0.1:" + HTTP_PORT ||
      r === "PROXY HTTP://127.0.0.1:" + HTTP_PORT
    );
  }),
  (SystemProxyManager.prototype.apply = function (e, r) {
    var t = this,
      n = e && e.proxyState,
      o = {
        method: "manual",
        servers: ["127.0.0.1:" + HTTP_PORT],
        excludes: [],
      };
    if (!n) return r(err("SYSTEM_PROXY_SET_FAILED", "proxy snapshot missing"));
    ((n.appliedProxy = o), (n.stage = "applying"), (n.appliedAt = Date.now()));
    try {
      t.writeState(n);
    } catch (e) {
      return r(err("SYSTEM_PROXY_SET_FAILED", "recovery state unavailable"));
    }
    this.setProxy(o, n.network, function (e) {
      if (e) return r(e);
      n.stage = "applied";
      try {
        t.writeState(n);
      } catch (e) {
        return r(err("SYSTEM_PROXY_SET_FAILED", "recovery state unavailable"));
      }
      t.findProxy(function (e, n) {
        if (e || !t.proxyIsApplied(n))
          return r(
            err(
              "SYSTEM_PROXY_VERIFY_FAILED",
              "system proxy verification failed"
            )
          );
        r(null, { proxy: o });
      });
    });
  }),
  (SystemProxyManager.prototype.verifyTraffic = function (e) {
    var r,
      t,
      n = once(function (r, n) {
        (t && clearTimeout(t), (e || function () {})(r, n));
      });
    ((r = http.request(
      {
        host: "127.0.0.1",
        port: HTTP_PORT,
        method: "GET",
        path: PROBE_URL,
        headers: { Host: "example.com", Connection: "close" },
      },
      function (e) {
        var r = e.statusCode;
        if (
          (e && "function" == typeof e.resume && e.resume(),
          r < 200 || r >= 500)
        )
          return n(
            err(
              "SYSTEM_PROXY_VERIFY_FAILED",
              "proxy traffic verification failed"
            )
          );
        e && "function" == typeof e.on
          ? (e.on("end", function () {
              n(null, "");
            }),
            e.on("error", function () {
              n(
                err(
                  "SYSTEM_PROXY_VERIFY_FAILED",
                  "proxy traffic verification failed"
                )
              );
            }))
          : n(null, "");
      }
    )),
      (t = setTimeout(function () {
        try {
          r.destroy();
        } catch (e) {}
        n(err("SYSTEM_PROXY_VERIFY_FAILED", "proxy traffic timeout"));
      }, 8e3)),
      r.on("error", function () {
        (clearTimeout(t),
          n(err("SYSTEM_PROXY_VERIFY_FAILED", "proxy traffic unavailable")));
      }));
    try {
      r.end();
    } catch (e) {
      (clearTimeout(t),
        n(err("SYSTEM_PROXY_VERIFY_FAILED", "proxy traffic unavailable")));
    }
  }),
  (SystemProxyManager.prototype.restore = function (e) {
    var r = this,
      t = this.readState(),
      n = once(e || function () {});
    if (!t) return n(null);
    r.readCurrent(function (e, o) {
      if (
        e ||
        !o ||
        (t.routeKey && !sameRoute(t.route, o.route)) ||
        (t.network && !sameNetwork(t.network, o.network))
      )
        return n(
          err(
            "SYSTEM_PROXY_RESTORE_PENDING",
            "original network is unavailable"
          )
        );
      if (t.originalProxy && proxyEqual(o.proxy, t.originalProxy))
        return (r.clearState(), n(null));
      if ("applied" === t.stage || "applying" === t.stage)
        return t.appliedProxy && proxyEqual(o.proxy, t.appliedProxy)
          ? ((i = o),
            void r.setProxy(t.originalProxy, i.network, function (e) {
              if (e)
                return n(
                  err(
                    "SYSTEM_PROXY_RESTORE_FAILED",
                    "original proxy could not be restored"
                  )
                );
              r.readCurrent(function (e, o) {
                if (e || !o || !proxyEqual(o.proxy, t.originalProxy))
                  return n(
                    err(
                      "SYSTEM_PROXY_RESTORE_FAILED",
                      "proxy restoration could not be verified"
                    )
                  );
                (r.clearState(), n(null));
              });
            }))
          : n(
              err(
                "SYSTEM_PROXY_RESTORE_CONFLICT",
                "system proxy changed externally"
              )
            );
      var i;
      n(
        err("SYSTEM_PROXY_RESTORE_CONFLICT", "system proxy changed externally")
      );
    });
  }),
  (SystemProxyManager.prototype.clearState = function () {
    (atomic.removeQuiet(this.stateFile), this.removeHook());
  }),
  (SystemProxyManager.prototype.recover = function (e) {
    if (!this.readState()) return (e || function () {})(null, !1);
    this.restore(function (r) {
      (e || function () {})(r || null, !0);
    });
  }),
  (SystemProxyManager.prototype.guard = function (e) {
    var r = this,
      t = this.readState();
    if (!t) return e(!1, "");
    this.readCurrent(function (n, o) {
      return n ||
        !o ||
        !sameRoute(t.route, o.route) ||
        (t.network && !sameNetwork(t.network, o.network))
        ? e(!0, "network")
        : ("applied" !== t.stage && "applying" !== t.stage) ||
            (t.appliedProxy && proxyEqual(o.proxy, t.appliedProxy))
          ? void r.findProxy(function (n, o) {
              if (
                n ||
                (("applied" === t.stage || "applying" === t.stage) &&
                  !r.proxyIsApplied(o))
              )
                return e(!0, "proxy");
              e(!1, "");
            })
          : e(!0, "proxy");
    });
  }),
  (module.exports = {
    SHARED_DIR: SHARED_DIR,
    STATE_FILE: STATE_FILE,
    INIT_DIR: INIT_DIR,
    RECOVERY_HOOK: RECOVERY_HOOK,
    HTTP_PORT: HTTP_PORT,
    CALL_TIMEOUT_MS: CALL_TIMEOUT_MS,
    SERVICE_URIS: SERVICE_URIS,
    normalizeProxy: normalizeProxy,
    rootAvailable: rootAvailable,
    proxyEqual: proxyEqual,
    proxyPayload: proxyPayload,
    connectedNetwork: connectedNetwork,
    networkUsable: networkUsable,
    fallbackProxyFromConnman: fallbackProxyFromConnman,
    routeKey: routeKey,
    sameRoute: sameRoute,
    networkKey: networkKey,
    sameNetwork: sameNetwork,
    SystemProxyManager: SystemProxyManager,
  }));
