"use strict";
var http = require("http"),
  templates = require("./templates"),
  validate = require("../validate"),
  errors = require("../errors"),
  err = errors.err,
  MAX_BODY_BYTES = 65536,
  MAX_CONNECTIONS = 16,
  HEADERS_TIMEOUT_MS = 1e4,
  REQUEST_TIMEOUT_MS = 12e4,
  SESSION_COOKIE = "alcyone_session";
function securityHeaders(e) {
  var r,
    t = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    };
  for (r in e || {})
    Object.prototype.hasOwnProperty.call(e, r) && (t[r] = e[r]);
  return t;
}
function parseCookies(e) {
  var r,
    t,
    o,
    i = {},
    n = ((e.headers && e.headers.cookie) || "").split(";");
  for (r = 0; r < n.length; r++)
    (o = (t = n[r].trim()).indexOf("=")) > 0 &&
      (i[t.slice(0, o)] = t.slice(o + 1));
  return i;
}
function clientKey(e) {
  var r = (e.socket && (e.socket.remoteAddress || "")) || "";
  return String(r).replace(/^::ffff:/, "") || "unknown";
}
function readBody(e, r) {
  var t = [],
    o = 0,
    i = !1;
  (e.on("data", function (n) {
    if (!i)
      if ((o += n.length) > MAX_BODY_BYTES) {
        ((i = !0),
          (t = []),
          r(err("BODY_TOO_LARGE", "request body too large")));
        try {
          e.destroy();
        } catch (e) {}
      } else t.push(n);
  }),
    e.on("end", function () {
      i || r(null, Buffer.concat(t).toString("utf8"));
    }),
    e.on("error", function () {
      i || ((i = !0), r(err("NETWORK_ERROR", "request failed")));
    }));
}
function ImporterServer(e) {
  ((e = e || {}),
    (this.pairing = e.pairing),
    (this.store = e.store),
    (this.logger = e.logger),
    (this.handlers = e.handlers || {}),
    (this.port = void 0 === e.port ? 8080 : e.port),
    (this.server = null),
    (this.boundHost = ""),
    (this.boundPort = 0),
    (this.exposureTimer = null),
    (this.binding = !1),
    (this.pendingListen = null));
}
((ImporterServer.prototype.originAllowed = function (e) {
  var r = e.headers || {},
    t = r.origin,
    o = r.host,
    i = r["sec-fetch-site"];
  return (
    !t ||
    (!!o &&
      ("null" === t
        ? "same-origin" === i || "none" === i
        : t === "http://" + o || t === "https://" + o))
  );
}),
  (ImporterServer.prototype.sendJson = function (e, r, t) {
    var o = JSON.stringify(t);
    (e.writeHead(
      r,
      securityHeaders({ "Content-Type": "application/json; charset=utf-8" })
    ),
      e.end(o));
  }),
  (ImporterServer.prototype.sendHtml = function (e, r, t, o) {
    var i,
      n = securityHeaders({ "Content-Type": "text/html; charset=utf-8" });
    for (i in o || {})
      Object.prototype.hasOwnProperty.call(o, i) && (n[i] = o[i]);
    (e.writeHead(r, n), e.end(t));
  }),
  (ImporterServer.prototype.sessionFor = function (e) {
    var r = parseCookies(e);
    try {
      return this.pairing.validateSession(r[SESSION_COOKIE]);
    } catch (e) {
      return null;
    }
  }),
  (ImporterServer.prototype.handle = function (e, r) {
    var t,
      o = this,
      i = String(e.url || "/").split("?")[0],
      n = templates.langFromAcceptLanguage(e.headers["accept-language"]),
      s = e.method || "GET";
    if ("OPTIONS" === s)
      return (
        r.writeHead(405, securityHeaders({ Allow: "GET, POST" })),
        r.end()
      );
    if ("GET" !== s && "POST" !== s)
      return (
        r.writeHead(405, securityHeaders({ Allow: "GET, POST" })),
        r.end()
      );
    if (!this.originAllowed(e))
      return (
        this.logger.warn("importer rejected a foreign origin", {
          endpoint: i,
          site: String(e.headers["sec-fetch-site"] || "absent"),
        }),
        this.sendJson(r, 403, { ok: !1, errorCode: errors.CODES.FORBIDDEN })
      );
    if (!this.pairing.accessActive())
      return this.sendHtml(
        r,
        403,
        templates.pairingPage(n, { error: templates.t(n, "session.expired") })
      );
    if (((t = this.sessionFor(e)), "/pair" === i && "POST" === s))
      return this.handlePair(e, r, n);
    if (!t)
      return 0 === i.indexOf("/api/")
        ? this.sendJson(r, 401, {
            ok: !1,
            errorCode: errors.CODES.UNAUTHORIZED,
          })
        : this.sendHtml(r, 200, templates.pairingPage(n, {}));
    if ("/" === i && "GET" === s)
      return this.sendHtml(
        r,
        200,
        templates.importerPage(n, {
          profiles: this.store.sanitizedProfiles(),
          subscriptions: this.store.sanitizedSubscriptions(),
          csrf: t.csrf,
        })
      );
    if ("/api/profiles" === i && "GET" === s)
      return this.sendJson(r, 200, {
        ok: !0,
        profiles: this.store.sanitizedProfiles(),
        subscriptions: this.store.sanitizedSubscriptions(),
      });
    if ("POST" === s && 0 === i.indexOf("/api/")) {
      try {
        this.pairing.assertCsrf(t, e.headers["x-alcyone-csrf"]);
      } catch (e) {
        return this.sendJson(r, 403, { ok: !1, errorCode: e.code });
      }
      return readBody(e, function (e, t) {
        var n;
        if (e) return o.sendJson(r, 413, { ok: !1, errorCode: e.code });
        try {
          n = t ? JSON.parse(t) : {};
        } catch (e) {
          return o.sendJson(r, 400, {
            ok: !1,
            errorCode: errors.CODES.INVALID_PARAMS,
          });
        }
        o.dispatch(i, n, function (e, t) {
          if (e) {
            var n = e.meta || {};
            return (
              o.logger.warn("lan importer request failed", {
                endpoint: i,
                code: e.code || "INTERNAL",
                stage: n.stage || "unknown",
                redirectHop:
                  "number" == typeof n.redirectHop ? n.redirectHop : 0,
                protocol: n.protocol || "unknown",
                originChanged: !0 === n.originChanged,
                nested: !0 === n.nested,
                transportErrorCode: n.transportErrorCode || "UNKNOWN",
                transportErrorName: n.transportErrorName || "Error",
                tlsPhase: n.tlsPhase || "unknown",
              }),
              o.sendJson(r, 400, errors.toResult(e))
            );
          }
          (((t = t || {}).ok = !0), o.sendJson(r, 200, t));
        });
      });
    }
    this.sendJson(r, 404, { ok: !1, errorCode: "NOT_FOUND" });
  }),
  (ImporterServer.prototype.dispatch = function (e, r, t) {
    var o = this.handlers;
    try {
      if ((validate.requireObject(r), "/api/import" === e)) {
        var providerHwid;
        (validate.rejectUnknown(r, [
          "name",
          "value",
          "compatMode",
          "providerHwid",
        ]),
          void 0 !== r.compatMode &&
            validate.optionalBoolean(r, "compatMode", !0),
          (providerHwid = validate.optionalProviderHwid(r, "providerHwid")));
        var i = validate.importValue(r, "value"),
          n = validate.displayName(r, "name");
        return o.importValue && o.importValue.length <= 3
          ? o.importValue(i, n, t)
          : o.importValue(i, n, !0, t, { providerHwid: providerHwid });
      }
      if ("/api/subscriptions/update" === e)
        return (
          validate.rejectUnknown(r, ["id"]),
          o.updateSubscriptions(validate.profileId(r, "id", !1), t)
        );
      if ("/api/subscriptions/hwid" === e)
        return (
          validate.rejectUnknown(r, ["id", "providerHwid"]),
          o.setSubscriptionHwid(
            validate.profileId(r, "id", !0),
            validate.optionalProviderHwid(r, "providerHwid"),
            t
          )
        );
      if ("/api/subscriptions/delete" === e)
        return (
          validate.rejectUnknown(r, ["id"]),
          o.deleteSubscription(validate.profileId(r, "id", !0), t)
        );
      if ("/api/profiles/delete" === e)
        return (
          validate.rejectUnknown(r, ["id"]),
          o.deleteProfile(validate.profileId(r, "id", !0), t)
        );
      if ("/api/active" === e)
        return (
          validate.rejectUnknown(r, ["id"]),
          o.setActive(validate.profileId(r, "id", !0), t)
        );
    } catch (e) {
      return t(e);
    }
    t(err("INVALID_PARAMS", "unknown endpoint"));
  }),
  (ImporterServer.prototype.handlePair = function (e, r, t) {
    var o = this;
    readBody(e, function (i, n) {
      var s,
        a,
        p = "";
      if (i) return o.sendJson(r, 413, { ok: !1, errorCode: i.code });
      if (n && "{" === n.charAt(0))
        try {
          p = JSON.parse(n).code || "";
        } catch (e) {
          p = "";
        }
      else
        p = (a = /(?:^|&)code=([^&]*)/.exec(String(n || "")))
          ? decodeURIComponent(a[1].replace(/\+/g, " "))
          : "";
      try {
        s = o.pairing.redeem(p, clientKey(e));
      } catch (e) {
        var d =
          "RATE_LIMITED" === e.code
            ? templates.t(t, "pair.limited")
            : templates.t(t, "pair.failed");
        return o.sendHtml(
          r,
          "RATE_LIMITED" === e.code ? 429 : 401,
          templates.pairingPage(t, { error: d })
        );
      }
      (r.writeHead(
        303,
        securityHeaders({
          Location: "/",
          "Set-Cookie":
            SESSION_COOKIE +
            "=" +
            s.id +
            "; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800",
        })
      ),
        r.end());
    });
  }),
  (ImporterServer.prototype.listen = function (e, r) {
    var t = this;
    ((r = r || function () {}),
      this.binding
        ? (this.pendingListen = { lanEnabled: e, callback: r })
        : ((this.binding = !0),
          this.bind(e, function (e, o) {
            var i = t.pendingListen;
            ((t.binding = !1),
              (t.pendingListen = null),
              r(e, o),
              i && t.listen(i.lanEnabled, i.callback));
          })));
  }),
  (ImporterServer.prototype.bind = function (e, r) {
    var t = this;
    !e || (this.pairing && this.pairing.accessActive()) || (e = !1);
    var o = e ? "0.0.0.0" : "127.0.0.1",
      i = !1;
    if (((r = r || function () {}), this.server && this.boundHost === o))
      return r(null, { host: o, port: this.port });
    function n(e, t) {
      i || ((i = !0), r(e || null, t));
    }
    this.close(function () {
      var r = http.createServer(function (e, r) {
        t.handle(e, r);
      });
      ((t.server = r),
        (r.maxConnections = MAX_CONNECTIONS),
        (r.headersTimeout = HEADERS_TIMEOUT_MS),
        (r.requestTimeout = REQUEST_TIMEOUT_MS),
        r.on("clientError", function (e, r) {
          t.logger.warn("importer client rejected", {
            detail: e.code || "bad request",
          });
          try {
            r.destroy();
          } catch (e) {}
        }),
        r.on("error", function (e) {
          (t.logger.error("importer listen failed", {
            detail: e.code || "error",
          }),
            t.server === r && ((t.server = null), (t.boundHost = "")),
            n(e));
        }),
        r.listen(t.port, o, function () {
          if (t.server === r) {
            var i = (r.address() && r.address().port) || t.port;
            ((t.boundHost = o),
              (t.boundPort = i),
              t.logger.info("importer listening", {
                scope: e ? "lan" : "loopback",
                port: i,
              }),
              e && t.startExposureGuard(),
              n(null, { host: o, port: i }));
          }
        }));
    });
  }),
  (ImporterServer.prototype.close = function (e) {
    var r = this.server,
      t = null,
      o = !1;
    if (
      ((e = e || function () {}),
      this.stopExposureGuard(),
      (this.server = null),
      (this.boundHost = ""),
      (this.boundPort = 0),
      !r)
    )
      return e();
    function i() {
      o || ((o = !0), t && clearTimeout(t), e());
    }
    try {
      (r.close(i), (t = setTimeout(i, 250)));
    } catch (e) {
      i();
    }
  }),
  (ImporterServer.prototype.startExposureGuard = function () {
    var e = this;
    this.exposureTimer ||
      ((this.exposureTimer = setInterval(function () {
        e.enforceExposure();
      }, 15e3)),
      this.exposureTimer.unref && this.exposureTimer.unref());
  }),
  (ImporterServer.prototype.enforceExposure = function (e) {
    if (
      ((e = e || function () {}),
      !this.pairing.accessActive() && "0.0.0.0" === this.boundHost)
    )
      return this.listen(!1, e);
    e(null, { host: this.boundHost, port: this.boundPort });
  }),
  (ImporterServer.prototype.stopExposureGuard = function () {
    this.exposureTimer &&
      (clearInterval(this.exposureTimer), (this.exposureTimer = null));
  }),
  (module.exports = {
    MAX_BODY_BYTES: MAX_BODY_BYTES,
    SESSION_COOKIE: SESSION_COOKIE,
    ImporterServer: ImporterServer,
    securityHeaders: securityHeaders,
    parseCookies: parseCookies,
  }));
