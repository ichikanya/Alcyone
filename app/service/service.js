"use strict";
var path = require("path"),
  os = require("os"),
  editionLib = require("./lib/edition"),
  loggerLib = require("./lib/logger"),
  storeLib = require("./lib/store/profiles"),
  pairingLib = require("./lib/pairing"),
  lockLib = require("./lib/tunnel-lock"),
  vpnLib = require("./lib/vpn/manager"),
  serverLib = require("./lib/web/server"),
  migrateLib = require("./lib/migrate"),
  autostartLib = require("./lib/autostart"),
  diagnosticsLib = require("./lib/diagnostics"),
  apiLib = require("./lib/api"),
  networkObserverLib = require("./lib/net/network-observer"),
  lifecycleLib = require("./lib/lifecycle-observer"),
  errors = require("./lib/errors"),
  DeviceInfo = require("./lib/device-info"),
  edition = editionLib.load(__dirname),
  appDir = path.resolve(__dirname, "..", "..", "applications", edition.appId),
  paths = editionLib.paths(edition, appDir),
  runId = loggerLib.newRunId ? loggerLib.newRunId() : "",
  logger = new loggerLib.Logger({
    file: paths.serviceLog,
    runId: runId,
    source: "service",
  }),
  tunnelLogger = new loggerLib.Logger({
    file: paths.tunnelLog,
    runId: logger.runId,
    source: "core",
  }),
  store = new storeLib.ProfileStore({ file: paths.storeFile, logger: logger }),
  pairing = new pairingLib.PairingManager({ logger: logger }),
  lock = new lockLib.TunnelLock({
    edition: edition.id,
    serviceId: edition.serviceId,
    logger: logger,
    errorCode: "CONNECTION_OWNED_BY_OTHER_EDITION",
  }),
  autostart = new autostartLib.Autostart({ edition: edition, logger: logger }),
  diagnostics = new diagnosticsLib.Diagnostics({
    store: store,
    edition: edition,
    logger: logger,
  }),
  vpn = new vpnLib.VpnManager({
    edition: edition,
    store: store,
    logger: logger,
    lock: lock,
    paths: paths,
    launcher: { executable: paths.launcher },
    dataPlaneProbe: function (e, r) {
      diagnostics.externalIp(e, r);
    },
  }),
  deviceInfo = new DeviceInfo({ logger: logger }),
  networkObserver = new networkObserverLib.NetworkObserver({
    routes: vpn.routes,
    logger: logger,
    endpointProvider: function () { return vpn.endpointForNetwork(); },
  });
function localAddresses() {
  var e = os.networkInterfaces(),
    r = [];
  return (
    Object.keys(e).forEach(function (t) {
      (e[t] || []).forEach(function (e) {
        "IPv4" !== e.family || e.internal || r.push(e.address);
      });
    }),
    r
  );
}
var context = {
    edition: edition,
    paths: paths,
    logger: logger,
    tunnelLogger: tunnelLogger,
    store: store,
    pairing: pairing,
    lock: lock,
    vpn: vpn,
    autostart: autostart,
    diagnostics: diagnostics,
    deviceInfo: deviceInfo,
    networkObserver: networkObserver,
    localAddresses: localAddresses,
  },
  api = new apiLib.Api(context),
  lifecycle = new lifecycleLib.LifecycleObserver({
    edition: edition,
    logger: logger,
    network: networkObserver,
    onResume: function () {
      var intent = store.runtimeIntent ? store.runtimeIntent() : { desiredConnection: !0 };
      if (store.setWakeGeneration) store.setWakeGeneration(lifecycle.wakeGeneration);
      if (intent.desiredConnection && intent.suppressedBootId !== lifecycleLib.bootId())
        api.autostartTrigger({ source: "resume" }, function () {});
    },
  }),
  importer = new serverLib.ImporterServer({
    pairing: pairing,
    store: store,
    logger: logger,
    port: edition.webPort,
    handlers: {
      importValue: function (e, r, t, i, n) {
        var o = {};
        ("function" == typeof t && ((i = t), (t = !0)),
          n && "object" == typeof n && (o = n),
          api.importValue(e, r, o, i));
      },
      updateSubscriptions: function (e, r) {
        api.updateSubscriptions(e ? { subscriptionId: e } : {}, r);
      },
      setSubscriptionHwid: function (e, r, t) {
        api.setSubscriptionHwid(
          { subscriptionId: e, providerHwid: r },
          t
        );
      },
      deleteSubscription: function (e, r) {
        api.deleteSubscription({ subscriptionId: e }, r);
      },
      deleteProfile: function (e, r) {
        api.deleteProfile({ profileId: e }, r);
      },
      setActive: function (e, r) {
        api.selectProfile({ profileId: e }, r);
      },
    },
  });
context.lifecycle = lifecycle;
function startup() {
  var e = new migrateLib.Migrator({
      paths: paths,
      edition: edition,
      logger: logger,
    }),
    r = !0;
  /* Network recovery runs before any data migration: after a failed or
     interrupted upgrade the TV must get its ordinary internet back first;
     only then may the new code touch the profile store. */
  try {
    vpn.recover();
  } catch (eRec) {
    logger.error("startup recovery failed", { detail: eRec.code || "error" });
  }
  try {
    (e.run(), vpn.setStartupSafetyError && vpn.setStartupSafetyError(""));
  } catch (e) {
    ((r = !1),
      logger.error("startup migration failed", { detail: e.code || "error" }),
      e &&
        vpn.setStartupSafetyError &&
        ("SHARED_DIRECTORY_REPAIR_FAILED" === e.code ||
          "STORE_UNRECOVERABLE" === e.code) &&
        vpn.setStartupSafetyError(e.code));
  }
  if (r)
    try {
      if (autostart.isEnabled() && store.setAutostartEnabled && !store.autostartEnabled())
        store.setAutostartEnabled(!0);
      (autostart.repairLegacy(),
        api.reconcileAutostart && api.reconcileAutostart());
    } catch (e) {
      logger.error("autostart migration failed", { detail: e.code || "error" });
    }
  try {
    deviceInfo.getDeviceInfo && deviceInfo.getDeviceInfo(function () {});
  } catch (e) {
    logger.warn("device info probe failed", { detail: e.code || "error" });
  }
  try {
    store.autostartEnabled &&
      store.autostartEnabled() &&
      api.autostartTrigger({ source: "service-start" }, function () {});
  } catch (e) {
    /* A corrupt store must degrade to no autostart, never kill startup. */
    logger.warn("autostart trigger skipped", { detail: e.code || "error" });
  }
  (importer.listen(!1, function () {}),
    lifecycle.start(),
    tunnelLogger.info("core log started", {
      edition: edition.id,
      version: edition.version,
    }),
    logger.info("service started", {
      edition: edition.id,
      version: edition.version,
    }));
}
context.importer = importer;
var shuttingDown = !1;
function shutdown(e) {
  shuttingDown ||
    ((shuttingDown = !0),
    logger.info("service stopping", { reason: e }),
    pairing.disable(),
    importer.close(function () {
      vpn.disconnect(function () {
        try {
          lock.release();
        } catch (e) {}
        process.exit(0);
      });
    }),
    setTimeout(function () {
      process.exit(0);
    }, 5e3));
}
var restartPending = !1;
function requestRestart(e) {
  return (
    restartPending ||
      ((restartPending = !0),
      setTimeout(function () {
        shutdown(e || "restartService");
      }, 250)),
    !0
  );
}
context.requestRestart = requestRestart;
var METHODS = {
  getState: "getState",
  getProfiles: "getProfiles",
  getProfilesMeta: "getProfilesMeta",
  selectProfile: "selectProfile",
  deleteProfile: "deleteProfile",
  importLink: "importLink",
  addSubscription: "addSubscription",
  updateSubscriptions: "updateSubscriptions",
  setSubscriptionHwid: "setSubscriptionHwid",
  deleteSubscription: "deleteSubscription",
  connect: "connect",
  disconnect: "disconnect",
  restart: "restart",
  autostart: "autostartTrigger",
  probeProfiles: "probeProfiles",
  checkExternalIp: "checkExternalIp",
  getLogs: "getLogs",
  clearLogs: "clearLogs",
  setAutostart: "setAutostart",
  setAutostartProfile: "setAutostartProfile",
  setLanguage: "setLanguage",
  setDnsServer: "setDnsServer",
  setConnectionMode: "setConnectionMode",
  startPairing: "startPairing",
  stopPairing: "stopPairing",
  restartService: "restartService",
};
function respond(e, r, t) {
  var i;
  r
    ? ((i = errors.toResult(r)),
      logger.warn("method failed", {
        method: e.method || "",
        code: i.errorCode,
      }))
    : (((i = t || {}).returnValue = !0), (i.ok = !0));
  try {
    e.respond(i);
  } catch (e) {
    logger.error("respond failed");
  }
}
function callerAllowed(e, method) {
  var sender = e && String(e.sender || "");
  if (sender === edition.appId) return !0;
  return method === "autostart" &&
    (sender === "com.webos.service.activitymanager" || sender === "com.palm.activitymanager");
}
function register(e) {
  Object.keys(METHODS).forEach(function (r) {
    var t = METHODS[r];
    e.register(r, function (e) {
      var i = (e && e.payload) || {};
      if (!callerAllowed(e, r))
        return (
          logger.warn("unauthorized luna caller rejected", { method: r }),
          respond(e, errors.err("UNAUTHORIZED", "caller not allowed"))
        );
      try {
        api[t](i, function (r, t) {
          respond(e, r, t);
        });
      } catch (r) {
        respond(e, errors.isAlcyoneError(r) ? r : errors.err("INTERNAL", ""));
      }
    });
  });
}
function keepResident() {
  -1 === process.argv.indexOf("--disable-timeouts") &&
    process.argv.push("--disable-timeouts");
}
function main() {
  var e, r;
  try {
    e = require("webos-service");
  } catch (e) {
    return (
      startup(),
      void logger.warn(
        "webos-service unavailable, running without the Luna bus"
      )
    );
  }
  (keepResident(),
    (r = new e(edition.serviceId)),
    (deviceInfo.service = r),
    vpn.setService && vpn.setService(r),
    networkObserver.setService(r),
    lifecycle.setService(r),
    register(r),
    logger.info("luna methods registered", {
      count: Object.keys(METHODS).length,
    }),
    startup());
}
(process.on("SIGTERM", function () {
  shutdown("SIGTERM");
}),
  process.on("SIGINT", function () {
    shutdown("SIGINT");
  }),
  process.on("uncaughtException", function (e) {
    (logger.error("uncaught exception", {
      detail: (e && e.code) || (e && e.name) || "error",
      reason: (e && e.message) || "",
    }),
      shutdown("uncaughtException"));
  }));
var started = !1;
function run() {
  started || ((started = !0), main());
}
function launchedByPlatform() {
  var e = process.mainModule,
    r = e && e.filename ? String(e.filename) : "";
  return (
    r.indexOf("bootstrap-node") >= 0 || r.indexOf("jsservicelauncher") >= 0
  );
}
((require.main === module || launchedByPlatform()) && run(),
  (module.exports = {
    context: context,
    api: api,
    importer: importer,
    METHODS: METHODS,
    startup: startup,
    shutdown: shutdown,
    register: register,
    callerAllowed: callerAllowed,
    keepResident: keepResident,
    launchedByPlatform: launchedByPlatform,
  }));
