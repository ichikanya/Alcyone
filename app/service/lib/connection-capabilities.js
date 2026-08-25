"use strict";
var fs = require("fs"),
  systemProxyLib = require("./system-proxy"),
  CACHE_MS = 15e3;
function ConnectionCapabilities(i) {
  ((i = i || {}),
    (this.paths = i.paths || {}),
    (this.edition = i.edition || {}),
    (this.health = i.health || null),
    (this.systemProxy =
      i.systemProxy || new systemProxyLib.SystemProxyManager(i)),
    (this.logger = i.logger || null),
    (this.cached = null),
    (this.cachedAt = 0),
    (this.inFlight = !1),
    (this.waiters = []));
}
((ConnectionCapabilities.prototype.tun = function () {
  var i, e, t, a;
  if ("function" == typeof process.getuid)
    try {
      if (0 !== process.getuid())
        return { available: !1, reason: "root privileges required" };
    } catch (i) {}
  try {
    i = fs.statSync("/dev/net/tun");
  } catch (i) {
    return { available: !1, reason: "TUN device unavailable" };
  }
  if (!i || !i.isCharacterDevice || !i.isCharacterDevice())
    return { available: !1, reason: "TUN device unavailable" };
  if (
    ((t = (e = this.paths.appDir ? this.paths.appDir + "/bin" : "")
      ? e + "/" + ("sing-box" === this.edition.core ? "sing-box" : "xray")
      : ""),
    (a = e ? e + "/tun2socks" : ""),
    "sing-box" === this.edition.core)
  ) {
    if (!t || !fs.existsSync(t))
      return { available: !1, reason: "sing-box binary unavailable" };
  } else if (!(t && a && fs.existsSync(t) && fs.existsSync(a)))
    return { available: !1, reason: "TUN binaries unavailable" };
  return { available: !0, reason: "" };
}),
  (ConnectionCapabilities.prototype.probe = function (i, e) {
    var t = this,
      a = Date.now();
    if (!e && this.cached && a - this.cachedAt < CACHE_MS)
      return i(null, this.cached);
    if (this.inFlight) this.waiters.push(i);
    else if (
      ((this.inFlight = !0),
      (this.waiters = [i]),
      this.systemProxy && "function" == typeof this.systemProxy.preflight)
    )
      this.systemProxy.preflight(function (i, e) {
        var a = {
          tun: t.tun(),
          systemProxy: i
            ? { available: !1, reason: "connection manager unavailable" }
            : {
                available: !(!e || !e.available),
                reason: (e && e.reason) || "",
              },
        };
        ((t.cached = a), (t.cachedAt = Date.now()), (t.inFlight = !1));
        var s = t.waiters.slice(0);
        t.waiters = [];
        for (var n = 0; n < s.length; n++) s[n](null, a);
      });
    else {
      var s = {
        tun: t.tun(),
        systemProxy: {
          available: !1,
          reason: "connection manager unavailable",
        },
      };
      ((this.cached = s), (this.cachedAt = Date.now()), (this.inFlight = !1));
      var n = this.waiters.slice(0);
      this.waiters = [];
      for (var r = 0; r < n.length; r++) n[r](null, s);
    }
  }),
  (ConnectionCapabilities.prototype.snapshot = function () {
    return (
      this.cached || {
        tun: { available: !1, reason: "capability check pending" },
        systemProxy: { available: !1, reason: "capability check pending" },
      }
    );
  }),
  (module.exports = {
    CACHE_MS: CACHE_MS,
    ConnectionCapabilities: ConnectionCapabilities,
  }));
