"use strict";
var fs = require("fs"),
  validate = require("./validate"),
  errors = require("./errors"),
  err = errors.err,
  parsers = require("./proto/parsers"),
  subscriptionsLib = require("./net/subscriptions"),
  subscriptionCompat = require("./subscription-compat"),
  privilege = require("./privilege");
function Api(t, e) {
  ((e = e || {}),
    (this.ctx = t),
    (this.autostartTimer = null),
    (this.autostartActive = !1),
    (this.autostartNetworkWait = null),
    (this.autostartPhase = "idle"),
    (this.autostartAttempts = 0),
    (this.setTimeout = e.setTimeout || setTimeout),
    (this.clearTimeout = e.clearTimeout || clearTimeout),
    (this.autostartInitialDelay =
      void 0 === e.autostartInitialDelay ? 0 : e.autostartInitialDelay),
    (this.autostartRetryDelay =
      void 0 === e.autostartRetryDelay ? 1e4 : e.autostartRetryDelay),
    (this.autostartMaxAttempts =
      void 0 === e.autostartMaxAttempts ? 12 : e.autostartMaxAttempts));
}
function guard(t) {
  return function (e, r) {
    try {
      t.call(this, e || {}, r);
    } catch (t) {
      r(errors.isAlcyoneError(t) ? t : err("INTERNAL", ""));
    }
  };
}
function storedAutostartProfile(t) {
  return t.store && "function" == typeof t.store.autostartProfile
    ? t.store.autostartProfile()
    : t.store && "function" == typeof t.store.activeProfile
      ? t.store.activeProfile()
      : null;
}
function bootId() {
  try {
    return String(fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  } catch (error) {
    return "unknown-boot";
  }
}
function getHwid(t, e) {
  if (t.deviceInfo && "function" == typeof t.deviceInfo.getHwid)
    return t.deviceInfo.getHwid(e);
  try {
    var r = require("os"),
      o = require("crypto"),
      i = r.hostname() || "alcyone-device";
    return e(
      null,
      o
        .createHash("sha256")
        .update("alcyone:" + i, "utf8")
        .digest("hex")
        .slice(0, 32),
    );
  } catch (t) {
    return e(null, "");
  }
}
function requestOptions(t, e, r) {
  var o =
      t.deviceInfo && "function" == typeof t.deviceInfo.getDiagnostics
        ? t.deviceInfo.getDiagnostics() || {}
        : {},
    i = String(o.locale || "en-US").replace(/_/g, "-"),
    n = {
      compatMode: !0,
      hwid: e || "",
      deviceOS: o.osName || "webOS",
      verOS: o.osVersion || o.sdkVersion || "unknown",
      deviceModel: o.modelName || "TV",
      acceptLanguage: i,
      deviceLocale: i.replace(/-/g, "_"),
    };
  return r && (n.providerHwid = r), n;
}
function skippedCount(r) {
  var e,
    o = 0;
  for (e = 0; e < (r || []).length; e++) o += parseInt(r[e].count, 10) || 0;
  return o;
}
function filterSubscriptionResult(t, e, r) {
  var o = subscriptionCompat.filterDescriptors(t.edition, e.imported),
    i = subscriptionCompat.mergeSkippedReasons(
      o.skippedReasons,
      subscriptionCompat.summarizeUnsupportedProtocols(e.unsupportedProtocols),
    );
  return (
    (r = r || {}),
    (r.skippedReasons = i),
    (r.skippedCount = skippedCount(i)),
    (r.imported = o.imported),
    r
  );
}
function requireImportable(t) {
  if (t && t.imported && t.imported.length) return;
  if (t && t.skippedReasons && t.skippedReasons.length)
    throw err(
      "UNSUPPORTED_SUBSCRIPTION_PROTOCOL",
      "no protocols supported by this edition",
    );
  throw err("NO_SERVERS_FOUND", "no supported servers");
}
((Api.prototype.reconcileAutostart = function () {
  var t = this.ctx,
    e = storedAutostartProfile(t);
  return (
    !e &&
      t.autostart &&
      t.autostart.isEnabled &&
      t.autostart.isEnabled() &&
      (t.autostart.set(!1),
      t.store.setAutostartEnabled && t.store.setAutostartEnabled(!1),
      this.stopAutostartScheduler(),
      t.logger &&
        t.logger.warn("autostart disabled because its profile disappeared", {
          code: "NO_AUTOSTART_PROFILE",
        })),
    e
  );
}),
  (Api.prototype.getState = guard(function (t, e) {
    var r,
      o,
      i,
      n = this.ctx;
    if (
      (validate.rejectUnknown(validate.requireObject(t), ["homebrewRoot"]),
      void 0 !== t.homebrewRoot)
    ) {
      if ("boolean" != typeof t.homebrewRoot)
        return e(err("INVALID_PARAMS", "homebrewRoot must be a boolean"));
      "function" == typeof n.vpn.setHomebrewRoot &&
        n.vpn.setHomebrewRoot(t.homebrewRoot);
    }
    ((i = null),
      (r = n.vpn.status()),
      (o = n.pairing.status()),
      (i =
        i ||
        (n.vpn.capabilitySnapshot
          ? n.vpn.capabilitySnapshot()
          : {
              tun: { available: !0, reason: "" },
              systemProxy: { available: !1, reason: "unavailable" },
            })),
      e(null, {
        edition: {
          id: n.edition.id,
          core: n.edition.core,
          coreLabel: n.edition.coreLabel,
          title: n.edition.title,
          version: n.edition.version || "",
        },
        vpn: {
          state: r.state,
          connected: r.connected,
          connectedAt: r.connectedAt,
          profileId: r.profileId,
          lastErrorCode: r.lastErrorCode,
          mode: r.mode,
          activeMode: r.activeMode,
          capabilities: i,
          ownsConnection: r.ownsConnection,
          connectionOwner: r.connectionOwner,
          ownsTunnel: r.ownsTunnel,
          tunnelOwner: r.tunnelOwner,
          routingBackend: r.routingBackend || "",
          watchdog: r.watchdog || null,
          breaker: r.breaker || null,
        },
        lan: {
          pairingActive: o.pairingActive,
          secondsRemaining: o.secondsRemaining,
          sessions: o.sessions,
          port:
            (n.importer && (n.importer.boundPort || n.importer.port)) ||
            n.edition.webPort,
          addresses: n.localAddresses(),
        },
        autostart: n.store.autostartEnabled
          ? n.store.autostartEnabled()
          : n.autostart.isEnabled(),
        autostartRuntime: {
          desired: n.store.runtimeIntent
            ? n.store.runtimeIntent().desiredConnection
            : n.autostart.isEnabled(),
          phase: this.autostartPhase,
          profileId: n.store.getAutostartProfileId
            ? n.store.getAutostartProfileId()
            : null,
          hookHealthy: n.autostart.isEnabled(),
          wakeCapability: n.lifecycle
            ? n.lifecycle.status().wakeCapability
            : "degraded",
          lastErrorCode: r.lastErrorCode || "",
        },
        compatibility: n.networkObserver
          ? n.networkObserver.status()
          : { networkSource: "kernel", connManVariant: "" },
        privilege: privilege.probe(n.paths),
        device:
          n.deviceInfo && "function" == typeof n.deviceInfo.getDiagnostics
            ? n.deviceInfo.getDiagnostics()
            : null,
        health:
          "function" == typeof n.vpn.healthSummary
            ? n.vpn.healthSummary()
            : null,
        revision: n.store.revision(),
      }));
  })),
  (Api.prototype.restartService = guard(function (t, e) {
    var r = this.ctx;
    if (
      (validate.rejectUnknown(validate.requireObject(t), []),
      "function" != typeof r.requestRestart)
    )
      return e(
        err(
          "ILLEGAL_STATE",
          "restart is only available under the platform launcher",
        ),
      );
    (r.requestRestart("restartService"),
      e(null, { restarting: !0, privilege: privilege.probe(r.paths) }));
  })),
  (Api.prototype.getProfiles = guard(function (t, e) {
    var r = this.ctx;
    (validate.rejectUnknown(validate.requireObject(t), []),
      this.reconcileAutostart());
    var o = r.store.read();
    e(null, {
      profiles: r.store.sanitizedProfiles(o),
      subscriptions: r.store.sanitizedSubscriptions(o),
      activeId: o.activeId || null,
      autostartProfileId: o.autostartProfileId || null,
      autostartEnabled: !!o.autostartEnabled,
      dnsServer: r.store.getDnsServer ? r.store.getDnsServer() : null,
      lang: o.lang || "auto",
      connectionMode: "tun",
      revision: r.store.revision(),
    });
  })),
  (Api.prototype.getProfilesMeta = guard(function (t, e) {
    (validate.rejectUnknown(validate.requireObject(t), []),
      e(null, { revision: this.ctx.store.revision() }));
  })),
  (Api.prototype.selectProfile = guard(function (t, e) {
    var r,
      o = this.ctx;
    if (
      (validate.rejectUnknown(validate.requireObject(t), [
        "profileId",
        "reconnect",
      ]),
      (r = validate.profileId(t, "profileId", !0)),
      o.store.setActive(r),
      validate.optionalBoolean(t, "reconnect", !1) && o.vpn.status().connected)
    )
      return o.vpn.disconnect(function () {
        o.vpn.connect(function (t) {
          if (t) return e(t);
          e(null, { profileId: r, reconnected: !0 });
        });
      });
    e(null, { profileId: r, reconnected: !1 });
  })),
  (Api.prototype.deleteProfile = guard(function (t, e) {
    (validate.rejectUnknown(validate.requireObject(t), ["profileId"]),
      this.ctx.store.deleteProfile(validate.profileId(t, "profileId", !0)),
      this.reconcileAutostart(),
      e(null, {}));
  })),
  (Api.prototype.importLink = guard(function (t, e) {
    var r,
      o,
      i,
      n = this.ctx;
    (validate.rejectUnknown(validate.requireObject(t), ["link", "name"]),
      (r = validate.proxyLink(t, "link")),
      (o = validate.displayName(t, "name")),
      parsers.validateLink(r),
      subscriptionCompat.assertManualSupported(n.edition, { link: r }),
      (i = n.store.upsertManualProfile(r, o)),
      n.logger.info("manual profile imported"),
      e(null, { profileId: i.profile.id }));
  })),
  (Api.prototype.addSubscription = guard(function (t, e) {
    var r,
      o,
      p,
      i = this.ctx,
      n = this;
    (validate.rejectUnknown(validate.requireObject(t), [
      "url",
      "name",
      "compatMode",
      "providerHwid",
    ]),
      (r = validate.subscriptionUrl(t, "url")),
      (o = validate.displayName(t, "name")),
      void 0 !== t.compatMode && validate.optionalBoolean(t, "compatMode", !0),
      (p = validate.optionalProviderHwid(t, "providerHwid")),
      getHwid(i, function (t, a) {
        var s = requestOptions(i, a, p || "");
        subscriptionsLib.download(
          r,
          function (t, a) {
            if (t)
              return (
                i.logger.warn("subscription import failed", {
                  code: t.code || "INTERNAL",
                }),
                e(t)
              );
            var u, l;
            try {
              (l = filterSubscriptionResult(i, a), requireImportable(l));
              ((s.skippedCount = l.skippedCount),
                (s.skippedReasons = l.skippedReasons),
                (u = i.store.applySubscription(
                  r,
                  o,
                  l.imported,
                  a.headers,
                  s,
                )));
            } catch (t) {
              return e(t);
            }
            (i.logger.info("subscription imported", {
              count: u.count,
              skipped: l.skippedCount,
            }),
              n.reconcileAutostart(),
              e(null, {
                subscriptionId: u.subscription.id,
                count: u.count,
                skippedCount: l.skippedCount,
                skippedReasons: l.skippedReasons,
                warnings: a.warnings || [],
              }));
          },
          s,
        );
      }));
  })),
  (Api.prototype.updateSubscriptions = guard(function (t, e) {
    var r,
      o,
      i,
      n = this.ctx,
      a = this,
      s = 0,
      u = 0,
      l = [],
      c = [];
    if (
      (validate.rejectUnknown(validate.requireObject(t), [
        "subscriptionId",
        "compatMode",
      ]),
      (r = validate.profileId(t, "subscriptionId", !1)),
      void 0 !== t.compatMode && validate.optionalBoolean(t, "compatMode", !0),
      (o = n.store.read()),
      (i = o.subscriptions.filter(function (t) {
        return !r || t.id === r;
      })),
      r && !i.length)
    )
      return e(err("SUBSCRIPTION_NOT_FOUND", "unknown subscription"));
    getHwid(n, function (t, r) {
      !(function t() {
        if (s >= i.length)
          return (
            a.reconcileAutostart(),
            e(null, { updated: u, failed: l.length, failures: l, results: c })
          );
        var o = i[s++],
          d = requestOptions(n, r, o.providerHwid || "");
        subscriptionsLib.download(
          o.url,
          function (e, r) {
            if (e) return (l.push({ id: o.id, errorCode: e.code }), t());
            try {
              var i,
                a = filterSubscriptionResult(n, r);
              requireImportable(a);
              ((d.skippedCount = a.skippedCount),
                (d.skippedReasons = a.skippedReasons),
                (i = n.store.applySubscription(
                  o.url,
                  o.name,
                  a.imported,
                  r.headers,
                  d,
                )),
                c.push({
                  subscriptionId: i.subscription.id,
                  count: i.count,
                  skippedCount: a.skippedCount,
                  skippedReasons: a.skippedReasons,
                  warnings: r.warnings || [],
                }),
                u++);
            } catch (t) {
              l.push({ id: o.id, errorCode: t.code || "INTERNAL" });
            }
            t();
          },
          d,
        );
      })();
    });
  })),
  (Api.prototype.setSubscriptionHwid = guard(function (t, e) {
    var r, o;
    (validate.rejectUnknown(validate.requireObject(t), [
      "subscriptionId",
      "providerHwid",
    ]),
      (r = validate.profileId(t, "subscriptionId", !0)),
      (o = validate.optionalProviderHwid(t, "providerHwid")),
      this.ctx.store.setSubscriptionHwid(r, o || ""),
      e(null, { subscriptionId: r, hasProviderHwid: !!o }));
  })),
  (Api.prototype.deleteSubscription = guard(function (t, e) {
    (validate.rejectUnknown(validate.requireObject(t), ["subscriptionId"]),
      this.ctx.store.deleteSubscription(
        validate.profileId(t, "subscriptionId", !0),
      ),
      this.reconcileAutostart(),
      e(null, {}));
  })),
  (Api.prototype.importValue = function (t, e, r, o) {
    var i = {};
    "function" == typeof r
      ? ((o = r), (r = !0))
      : r && "object" == typeof r && ((i = r), (r = !0));
    return /^https?:\/\//i.test(t)
      ? this.addSubscription(
          {
            url: t,
            name: e,
            compatMode: !0,
            providerHwid: i.providerHwid,
          },
          o,
        )
      : parsers.PROTO_RE.test(t)
        ? this.importLink({ link: t, name: e }, o)
        : o(err("INVALID_LINK", "unsupported input"));
  }),
  (Api.prototype.connect = guard(function (t, e) {
    var r = this.ctx,
      o = this;
    validate.rejectUnknown(validate.requireObject(t), ["profileId"]);
    var i = validate.profileId(t, "profileId", !1);
    (i && r.store.setActive(i),
      r.store.setDesiredConnection && r.store.setDesiredConnection(!0, null),
      r.vpn.resetBreaker && r.vpn.resetBreaker(),
      r.vpn.connect(function (t, r) {
        if (t) return e(t);
        (o.stopAutostartScheduler(), e(null, r));
      }));
  })),
  (Api.prototype.disconnect = guard(function (t, e) {
    (validate.rejectUnknown(validate.requireObject(t), []),
      this.ctx.store.setDesiredConnection &&
        this.ctx.store.setDesiredConnection(!1, bootId()),
      this.ctx.vpn.disconnect(function (t, r) {
        if (t) return e(t);
        e(null, r);
      }));
  })),
  (Api.prototype.restart = guard(function (t, e) {
    var r = this.ctx,
      o = this;
    (validate.rejectUnknown(validate.requireObject(t), []),
      r.vpn.disconnect(function (t) {
        if (t) return e(t);
        r.vpn.connect(function (t, r) {
          if (t) return e(t);
          (o.stopAutostartScheduler(), e(null, r));
        });
      }));
  })),
  (Api.prototype.stopAutostartScheduler = function () {
    (this.autostartTimer && this.clearTimeout(this.autostartTimer),
      this.autostartNetworkWait && this.autostartNetworkWait.cancel && this.autostartNetworkWait.cancel(),
      (this.autostartTimer = null),
      (this.autostartNetworkWait = null),
      (this.autostartActive = !1),
      (this.autostartAttempts = 0),
      (this.autostartPhase = "idle"));
  }),
  (Api.prototype.scheduleAutostart = function () {
    var profile;
    var self = this;
    var context = this.ctx;
    if (this.autostartActive) return false;
    function enabled() {
      return context.store.autostartEnabled
        ? context.store.autostartEnabled()
        : context.autostart.isEnabled();
    }
    function terminal() {
      var status = context.vpn.status();
      return !enabled() || !!status.connected ||
        (!!status.connectionOwner && status.connectionOwner !== context.edition.id) ||
        !storedAutostartProfile(context) ||
        (context.vpn.healthSummary &&
          context.vpn.healthSummary().code === "SHARED_DIRECTORY_REPAIR_FAILED");
    }
    function stop() { self.stopAutostartScheduler(); }
    function retry() {
      self.autostartPhase = "retrying";
      self.autostartTimer = self.setTimeout(attempt, self.autostartRetryDelay);
      if (self.autostartTimer.unref) self.autostartTimer.unref();
    }
    function attempt() {
      self.autostartTimer = null;
      if (terminal()) return stop();
      if (context.vpn.isBusy && context.vpn.isBusy()) return retry();
      profile = storedAutostartProfile(context);
      if (!profile) return stop();
      self.autostartAttempts++;
      self.autostartPhase = "connecting";
      var connect = context.vpn.connectProfile
        ? function (callback) { context.vpn.connectProfile(profile.id, callback); }
        : function (callback) { context.vpn.connect(callback); };
      connect(function (error) {
        if (!error) return stop();
        if (context.logger && typeof context.logger.warn === "function") context.logger.warn("autostart attempt failed", {
          attempt: self.autostartAttempts,
          code: error.code || "INTERNAL",
        });
        if (error.code === "NO_ACTIVE_PROFILE" ||
            error.code === "TUNNEL_OWNED_BY_OTHER_EDITION" ||
            error.code === "CONNECTION_OWNED_BY_OTHER_EDITION" ||
            error.code === "SHARED_DIRECTORY_REPAIR_FAILED") return stop();
        if (self.autostartAttempts >= self.autostartMaxAttempts) {
          self.autostartPhase = "exhausted";
          context.logger && typeof context.logger.error === "function" &&
            context.logger.error("autostart retry limit reached", { code: error.code || "INTERNAL" });
          return stop();
        }
        retry();
      });
    }
    function networkReady() {
      self.autostartNetworkWait = null;
      if (terminal()) return stop();
      self.autostartPhase = "ready";
      self.autostartTimer = self.setTimeout(attempt, self.autostartInitialDelay);
      if (self.autostartTimer.unref) self.autostartTimer.unref();
    }
    if (terminal()) return false;
    this.autostartActive = true;
    this.autostartPhase = "waitingNetwork";
    if (context.networkObserver && context.networkObserver.waitUntilReady)
      this.autostartNetworkWait = context.networkObserver.waitUntilReady(networkReady);
    else networkReady();
    return true;
  }),
  (Api.prototype.autostartTrigger = guard(function (t, e) {
    var r = this.ctx;
    if (
      (validate.rejectUnknown(validate.requireObject(t), ["source"]),
      r.logger &&
        "function" == typeof r.logger.info &&
        r.logger.info("autostart trigger received", {
          state: r.vpn.status().state,
        }),
      this.reconcileAutostart(),
      !(r.store.autostartEnabled ? r.store.autostartEnabled() : r.autostart.isEnabled()))
    )
      return (
        r.logger &&
          "function" == typeof r.logger.info &&
          r.logger.info("autostart trigger ignored", { state: "disabled" }),
        e(null, { started: !1, accepted: !0, source: t.source || "boot" })
      );
    if (r.vpn.status().connected)
      return (
        r.logger &&
          "function" == typeof r.logger.info &&
          r.logger.info("autostart already connected", { state: "connected" }),
        e(null, { started: !0, queued: !1, accepted: !0, source: t.source || "boot" })
      );
    var o = this.scheduleAutostart();
    (r.logger &&
      "function" == typeof r.logger.info &&
      r.logger.info("autostart trigger queued", {
        queued: !!o,
        state: o ? "queued" : "idle",
      }),
      e(null, { started: !1, queued: o, accepted: !0, source: t.source || "boot" }));
  })),
  (Api.prototype.probeProfiles = guard(function (t, e) {
    var r,
      o,
      i = Object.create(null);
    if (
      (validate.rejectUnknown(validate.requireObject(t), ["profileIds"]),
      void 0 !== t.profileIds)
    ) {
      if ("[object Array]" !== Object.prototype.toString.call(t.profileIds))
        throw err("INVALID_PARAMS", "profileIds must be an array");
      for (r = [], o = 0; o < t.profileIds.length; o++) {
        var n = validate.profileId(
          { profileId: t.profileIds[o] },
          "profileId",
          !0,
        );
        i[n] || ((i[n] = !0), r.push(n));
      }
      if (r.length > 12)
        throw err(
          "INVALID_PARAMS",
          "profileIds must contain at most 12 unique ids",
        );
    }
    this.ctx.diagnostics.probeProfiles(
      function (t, r) {
        if (t) return e(t);
        e(null, { probes: r });
      },
      void 0 === r ? {} : { profileIds: r },
    );
  })),
  (Api.prototype.setConnectionMode = guard(function (t, e) {
    var r,
      o,
      i = this.ctx;
    if (
      (validate.rejectUnknown(validate.requireObject(t), ["mode"]),
      "tun" !== (r = String(t.mode || "")))
    )
      return e(err("MODE_UNSUPPORTED", "system proxy mode is not supported"));
    if ((o = i.vpn.status && i.vpn.status()) && o.state && "idle" !== o.state)
      return e(
        err(
          "MODE_CHANGE_REQUIRES_DISCONNECT",
          "disconnect before changing mode",
        ),
      );
    !(function () {
      try {
        i.vpn.setConnectionMode(r);
      } catch (t) {
        return e(errors.isAlcyoneError(t) ? t : err("INTERNAL", ""));
      }
      e(null, { mode: r });
    })();
  })),
  (Api.prototype.checkExternalIp = guard(function (t, e) {
    validate.rejectUnknown(validate.requireObject(t), []);
    var r = this.ctx;
    this.ctx.diagnostics.externalIp(function (t, o) {
      var i, n;
      if (t) return e(t);
      ((i = r.vpn.status()),
        (n = !!(
          o &&
          i.connected &&
          i.dataPlaneVerified &&
          i.routes &&
          i.routes.routeActive &&
          i.routes.directBypassActive
        )),
        e(null, { address: o || "", viaVpn: n }));
    });
  })),
  (Api.prototype.getLogs = guard(function (t, e) {
    validate.rejectUnknown(validate.requireObject(t), ["lines"]);
    var r = void 0 === t.lines ? 200 : parseInt(t.lines, 10);
    ((r > 0 && r <= 500) || (r = 200),
      e(null, {
        log: this.ctx.logger.tail(r),
        tunnelLog: this.ctx.tunnelLogger ? this.ctx.tunnelLogger.tail(r) : "",
        routes: this.ctx.vpn.status().routes,
      }));
  })),
  (Api.prototype.clearLogs = guard(function (t, e) {
    validate.rejectUnknown(validate.requireObject(t), []);
    var r = this.ctx.logger.clear(),
      o = !this.ctx.tunnelLogger || this.ctx.tunnelLogger.clear();
    e(null, { cleared: r && o });
  })),
  (Api.prototype.setAutostart = guard(function (t, e) {
    var r, o;
    if (
      (validate.rejectUnknown(validate.requireObject(t), ["enabled"]),
      "boolean" != typeof t.enabled)
    )
      throw err("INVALID_PARAMS", "enabled must be a boolean");
    if (((r = t.enabled), (o = this.reconcileAutostart()), r && !o))
      throw err("NO_AUTOSTART_PROFILE", "choose a server for autostart first");
    (this.ctx.autostart.set(r),
      this.ctx.store.setAutostartEnabled && this.ctx.store.setAutostartEnabled(r),
      r || this.stopAutostartScheduler(),
      e(null, {
        enabled: this.ctx.autostart.isEnabled(),
        profileId: o ? o.id : null,
      }));
  })),
  (Api.prototype.setAutostartProfile = guard(function (t, e) {
    var r,
      o = this.ctx;
    if (
      (validate.rejectUnknown(validate.requireObject(t), ["profileId"]),
      void 0 === t.profileId)
    )
      throw err("MISSING_FIELD", "profileId");
    ((r =
      null === t.profileId || "" === t.profileId
        ? null
        : validate.profileId(t, "profileId", !0)),
      o.store.setAutostartProfile(r),
      null === r && (o.autostart.set(!1), this.stopAutostartScheduler()),
      e(null, { profileId: r, enabled: o.autostart.isEnabled() }));
  })),
  (Api.prototype.setLanguage = guard(function (t, e) {
    (validate.rejectUnknown(validate.requireObject(t), ["lang"]),
      this.ctx.store.setLanguage(validate.language(t, "lang")),
      e(null, { lang: t.lang }));
  })),
  (Api.prototype.setDnsServer = guard(function (t, e) {
    var r,
      o = this.ctx;
    (validate.rejectUnknown(validate.requireObject(t), ["dnsServer"]),
      (r = validate.dnsServer(t, "dnsServer")),
      e(null, { dnsServer: (r = o.store.setDnsServer(r)) }));
  })),
  (Api.prototype.startPairing = guard(function (t, e) {
    var r = this.ctx;
    validate.rejectUnknown(validate.requireObject(t), ["forceNew"]);
    var o = validate.optionalBoolean(t, "forceNew", !1),
      i = r.pairing.enable(void 0, o);
    r.importer.listen(!0, function (t, o) {
      if (t)
        return (
          r.pairing.disable(),
          e(err("INTERNAL", "importer failed to start"))
        );
      var n =
        (o && o.port) ||
        (r.importer && (r.importer.boundPort || r.importer.port)) ||
        r.edition.webPort;
      e(null, {
        code: i.code,
        expiresAt: i.expiresAt,
        port: n,
        addresses: r.localAddresses(),
      });
    });
  })),
  (Api.prototype.stopPairing = guard(function (t, e) {
    var r = this.ctx;
    (validate.rejectUnknown(validate.requireObject(t), []),
      r.pairing.disable(),
      r.importer.listen(!1, function () {
        e(null, { pairingActive: !1 });
      }));
  })),
  (module.exports = { Api: Api }));
