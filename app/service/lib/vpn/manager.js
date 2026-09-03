"use strict";
var fs = require("fs"),
  net = require("net"),
  atomic = require("../atomic"),
  supervisorLib = require("../supervisor"),
  routesLib = require("../net/routes"),
  endpointBootstrap = require("../net/endpoint-bootstrap"),
  loggerLib = require("../logger"),
  coreIntegrityLib = require("../core-integrity"),
  coreDiagnostics = require("./core-diagnostics-lite"),
  xrayConfig = require("../config/xray"),
  xrayAssets = require("../xray-assets"),
  singboxConfig = require("../config/singbox"),
  healthLib = require("../health"),
  privilege = require("../privilege"),
  systemProxyLib = require("../system-proxy"),
  capabilitiesLib = require("../connection-capabilities"),
  watchdogLib = require("./watchdog"),
  recoveryBudgetLib = require("./recovery-budget"),
  livenessProbeLib = require("./liveness-probe"),
  errors = require("../errors"),
  err = errors.err,
  STATE = {
    IDLE: "idle",
    STARTING: "starting",
    CONNECTED: "connected",
    STOPPING: "stopping",
  },
  XRAY_START_ATTEMPTS = 3,
  XRAY_RETRY_DELAY_MS = 500,
  NETWORK_GUARD_INTERVAL_MS = 5e3,
  CONNECT_TIMEOUT_MS = 3e4,
  CLEANUP_TIMEOUT_MS = 5e3,
  CORE_ENV_BASE = {
    PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
    LD_PRELOAD: "",
    HOME: "/home/root",
  },
  CORE_ENV_CLEAR_KEYS = [
    "LD_LIBRARY_PATH",
    "NODE_PATH",
    "APPFRWK_MASK_PATH",
    "COMPONENTS_PATH",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_PATH_1_n",
    "GST_PLUGIN_SCANNER",
    "GST_PLUGIN_SCANNER_1_n",
    "GST_REGISTRY",
    "GST_REGISTRY_1_n",
    "GST_REGISTRY_UPDATE",
    "QML2_IMPORT_PATH",
    "QMLSCENE_DEVICE",
    "QML_DISABLE_DISK_CACHE",
    "QSG_PROGRAM_BINARY_STORE",
    "QT_HARFBUZZ",
    "QT_IM_MODULE",
    "QT_QPA_FONTDIR",
    "QT_QPA_PLATFORM",
    "QT_VER",
    "QT_WAYLAND_DISABLE_WINDOWDECORATION",
    "QT_WAYLAND_HARDWARE_INTEGRATION",
    "QT_WAYLAND_SHELL_INTEGRATION",
    "QT_WAYLAND_XKB_RULE_NAMES",
    "SDL_VIDEODRIVER",
    "SDP_SYS_PATH",
    "WEBAPPFACTORY",
    "WEBOS_GL_DISABLE_THREADED_RENDERING",
    "XDG_DIR",
    "XDG_RUNTIME_DIR",
    "LS_SERVICE_FILE_NAME",
    "LS_SERVICE_NAMES",
    "NOTIFY_SOCKET",
    "PWD",
    "OLDPWD",
    "UPSTART_JOB",
    "INVOCATION_ID",
  ];
function once(e) {
  var t = !1;
  return function () {
    t || ((t = !0), e.apply(null, arguments));
  };
}
function VpnManager(e) {
  ((e = e || {}),
    (this.edition = e.edition),
    (this.store = e.store),
    (this.logger = e.logger),
    (this.lock = e.lock),
    (this.paths = e.paths),
    (this.state = STATE.IDLE),
    (this.lastError = null),
    (this.connectedAt = 0),
    (this.activeProfileId = ""),
    (this.requestedProfileId = ""),
    (this.dataPlaneProbe = e.dataPlaneProbe),
    (this.setTimeout = e.setTimeout || setTimeout),
    (this.clearTimeout = e.clearTimeout || clearTimeout),
    (this.connectTimeoutMs =
      "number" == typeof e.connectTimeoutMs
        ? e.connectTimeoutMs
        : CONNECT_TIMEOUT_MS),
    (this.cleanupTimeoutMs =
      "number" == typeof e.cleanupTimeoutMs
        ? e.cleanupTimeoutMs
        : CLEANUP_TIMEOUT_MS),
    (this.dataPlaneVerified = !1),
    (this.verifiedExternalIp = ""),
    (this.logCapTimer = null),
    (this.networkGuardTimer = null),
    (this.networkGuardBusy = !1),
    (this.operationGeneration = 0),
    (this.activeOperation = null),
    (this.cleanupInProgress = null),
    (this.cleanupTimedOut = !1),
    (this.cleanupTimeoutError = null),
    (this.recoveryInProgress = !1),
    (this.recoveryTimer = null),
    (this.watchdogRecoveryTimer = null),
    (this.lastWatchdogIncidentAt = 0),
    (this.breakerOpen = !1),
    (this.launches = {}),
    (this.launcher = e.launcher || null),
    (this.coreIntegrity = e.coreIntegrity || coreIntegrityLib),
    (this.homebrewRoot = null),
    (this.startupSafetyError = ""),
    (this.connectionMode =
      this.store && this.store.getConnectionMode
        ? this.store.getConnectionMode()
        : "tun"),
    (this.activeMode = ""),
    (this.health =
      e.health ||
      new healthLib.HealthGate({
        edition: this.edition,
        paths: this.paths,
        logger: this.logger,
      })),
    (this.systemProxy =
      e.systemProxy ||
      new systemProxyLib.SystemProxyManager({
        edition: this.edition,
        logger: this.logger,
        routes: null,
        stateFile: e.systemProxyStateFile,
        hookFile: e.systemProxyHookFile,
      })),
    (this.routes = new routesLib.RouteManager({
      logger: this.logger,
      core: this.edition.core,
      stateFile: this.paths.routeState,
      netguardFlagFile: this.paths.dataDir + "/netguard.enabled",
      netguardDirs: [this.paths.dataDir + "/bin"],
    })),
    (this.systemProxy.routes = this.routes),
    (this.recoveryBudget =
      e.recoveryBudget ||
      new recoveryBudgetLib.RecoveryBudget({
        file: this.paths.dataDir + "/recovery-budget.json",
        logger: this.logger,
      })),
    (this.capabilities =
      e.capabilities ||
      new capabilitiesLib.ConnectionCapabilities({
        paths: this.paths,
        edition: this.edition,
        health: this.health,
        systemProxy: this.systemProxy,
        logger: this.logger,
      })));
  var t = this;
  this.supervisor = new supervisorLib.Supervisor({
    logger: this.logger,
    maxProcesses: 3,
    ownedExecutableDir: this.paths.dataDir + "/bin",
    findExecutablePids: e.findExecutablePids,
    onExit: function (e, r, i, n) {
      t.onCoreExit(e, r, i, n);
    },
  });
  this.livenessProbe = e.livenessProbe || new livenessProbeLib.LivenessProbe();
  this.watchdog = e.watchdog || new watchdogLib.Watchdog({
    supervisor: this.supervisor,
    routes: this.routes,
    probe: this.livenessProbe,
    logger: this.logger,
    tunStatsDir:
      "/sys/class/net/" +
      routesLib.tunNameFor(this.edition.core) +
      "/statistics",
    physicalAvailable: function () {
      var route = t.routes.readDefaultRoute();
      return !!(route && route.device && route.device !== t.routes.tunName);
    },
    onIncident: function (code, detail) { t.failSafe(code, detail); },
  });
}
((VpnManager.prototype.isBusy = function () {
  return this.state === STATE.STARTING || this.state === STATE.STOPPING;
}),
  (VpnManager.prototype.resetBreaker = function () {
    this.breakerOpen = !1;
    return !0;
  }),
  (VpnManager.prototype.connectProfile = function (profileId, callback) {
    if (!profileId || !this.store || !this.store.profileById || !this.store.profileById(profileId))
      return callback(err("NO_AUTOSTART_PROFILE", "autostart profile unavailable"));
    this.requestedProfileId = profileId;
    this.connect(callback);
  }),
  (VpnManager.prototype.setService = function (e) {
    this.systemProxy &&
      this.systemProxy.setService &&
      this.systemProxy.setService(e);
  }),
  (VpnManager.prototype.selectedMode = function () {
    return "tun";
  }),
  (VpnManager.prototype.setConnectionMode = function (e) {
    if ("tun" !== e)
      throw err("MODE_UNSUPPORTED", "system proxy mode is not supported");
    if (
      this.recoveryInProgress ||
      (this.systemProxy &&
        this.systemProxy.readState &&
        this.systemProxy.readState())
    )
      throw err("SYSTEM_PROXY_RESTORE_PENDING", "proxy restoration is pending");
    if (
      this.state !== STATE.IDLE ||
      this.activeOperation ||
      this.cleanupInProgress
    )
      throw err(
        "MODE_CHANGE_REQUIRES_DISCONNECT",
        "disconnect before changing mode",
      );
    return (
      this.store &&
        this.store.setConnectionMode &&
        this.store.setConnectionMode(e, !0),
      (this.connectionMode = e),
      e
    );
  }),
  (VpnManager.prototype.refreshCapabilities = function (e, t) {
    var r = this;
    this.capabilities && "function" == typeof this.capabilities.probe
      ? this.capabilities.probe(function (t, i) {
          e && e(t, i || r.capabilitySnapshot());
        }, t)
      : e && e(null, this.capabilitySnapshot());
  }),
  (VpnManager.prototype.capabilitySnapshot = function () {
    return this.capabilities && "function" == typeof this.capabilities.snapshot
      ? this.capabilities.snapshot()
      : {
          tun: { available: !0, reason: "" },
          systemProxy: {
            available: !1,
            reason: "system proxy mode is not supported",
          },
        };
  }),
  (VpnManager.prototype.onCoreExit = function (e, t, r, i) {
    (i && this.supervisor.entryFor(e) !== i) ||
      (this.state !== STATE.CONNECTED && this.state !== STATE.STARTING) ||
      (this.state !== STATE.STARTING &&
        (this.logger.warn("core exited unexpectedly, restoring connection", {
          core: e,
          code: t,
          signal: r || "",
          mode: this.activeMode || this.selectedMode(),
        }),
        (this.state = STATE.STOPPING),
        (this.dataPlaneVerified = !1),
        (this.verifiedExternalIp = ""),
        (this.lastError = { code: "CORE_START_FAILED", detail: "core exited" }),
        this.cleanup(function () {})));
  }),
  (VpnManager.prototype.failSafe = function (code, detail) {
    if (this.state !== STATE.CONNECTED || this.cleanupInProgress) return false;
    var self = this;
    var now = Date.now();
    this.lastWatchdogIncidentAt = now;
    this.state = STATE.STOPPING;
    this.dataPlaneVerified = false;
    this.verifiedExternalIp = "";
    this.lastError = { code: code || "VPN_LIVENESS_FAILED", detail: detail || "" };
    this.logger && this.logger.warn("watchdog fail-safe started", { code: this.lastError.code });
    this.cleanup(function (cleanupError) {
      if (cleanupError) {
        self.breakerOpen = true;
        self.lastError = {
          code: cleanupError.code || "CORE_START_FAILED",
          detail: cleanupError.detail || "cleanup timed out",
        };
        self.logger &&
          self.logger.error("watchdog recovery blocked by a live core", {
            code: self.lastError.code,
          });
        return;
      }
      var restored = false;
      try { restored = self.routes.physicalRestored(); } catch (error) {}
      if (!restored) {
        self.lastError = { code: "SAFE_FALLBACK_FAILED", detail: "" };
        self.logger && self.logger.error("safe fallback route verification failed");
        return self.rollbackWithRetry(function () {});
      }
      if (self.breakerOpen) return;
      var budgetPlan = self.recoveryBudget.plan();
      if (!budgetPlan.allowed) {
        self.breakerOpen = true;
        self.lastError = { code: "RECOVERY_BUDGET_EXHAUSTED", detail: budgetPlan.reason };
        self.logger && self.logger.warn("automatic reconnect denied by recovery budget", { reason: budgetPlan.reason });
        return;
      }
      self.watchdogRecoveryTimer = self.setTimeout(function () {
        self.watchdogRecoveryTimer = null;
        if (self.state !== STATE.IDLE || self.breakerOpen) return;
        /* Spending the budget happens only when a reconnect actually
           starts; waiting for network stability is free. */
        self.recoveryBudget.commitAttempt();
        self.connect(function (error) {
          if (error) {
            self.breakerOpen = true;
            self.lastError = { code: error.code || "AUTOSTART_RETRY_EXHAUSTED", detail: "" };
          }
        });
      }, Math.max(0, budgetPlan.readyAt - Date.now()));
      if (self.watchdogRecoveryTimer && self.watchdogRecoveryTimer.unref)
        self.watchdogRecoveryTimer.unref();
    });
    return true;
  }),
  (VpnManager.prototype.scheduleBudgetForgiveness = function () {
    var self = this;
    if (this.budgetForgiveTimer) return;
    this.budgetForgiveTimer = this.setTimeout(function () {
      self.budgetForgiveTimer = null;
      if (self.state !== STATE.CONNECTED || !self.connectedAt) return;
      /* Ten minutes of verified healthy connected time forgives the
         oldest automatic attempt, so long stable sessions gradually
         restore full recovery capacity. */
      if (Date.now() - self.connectedAt >= recoveryBudgetLib.FORGIVE_AFTER_HEALTHY_MS)
        self.recoveryBudget.forgiveOldest();
    }, recoveryBudgetLib.FORGIVE_AFTER_HEALTHY_MS);
    if (this.budgetForgiveTimer && this.budgetForgiveTimer.unref)
      this.budgetForgiveTimer.unref();
  }),
  (VpnManager.prototype.rollbackWithRetry = function (callback) {    var self = this;
    var delays = [1000, 2000, 5000];
    var attempt = 0;
    function run() {
      var restored = false;
      try {
        restored = self.routes.rollback() !== false;
        if (self.routes.physicalRestored) restored = restored && self.routes.physicalRestored();
      } catch (error) { restored = false; }
      if (restored) return callback();
      self.lastError = { code: "SAFE_FALLBACK_FAILED", detail: "" };
      self.logger && self.logger.error("safe fallback route verification failed", { attempt: attempt + 1 });
      var delay = attempt < delays.length ? delays[attempt++] : 30000;
      var timer = self.setTimeout(run, delay);
      if (timer && timer.unref) timer.unref();
    }
    run();
  }),
  (VpnManager.prototype.resolveEndpoints = function (e, t) {
    var r =
      "sing-box" === this.edition.core
        ? singboxConfig.endpoints(e)
        : xrayConfig.endpoints(e);
    return endpointBootstrap.resolve(r, t, arguments[2] || {});
  }),
  (VpnManager.prototype.endpointForNetwork = function () {
    var profile = this.store && this.store.autostartProfile && this.store.autostartProfile();
    if (!profile && this.store && this.store.activeProfile) profile = this.store.activeProfile();
    if (!profile) return null;
    try {
      var endpoints = "sing-box" === this.edition.core
        ? singboxConfig.endpoints(profile)
        : xrayConfig.endpoints(profile);
      var i;
      for (i = 0; i < endpoints.length; i++)
        if (endpoints[i].host && endpoints[i].port && endpoints[i].network !== "udp")
          return { address: endpoints[i].host, port: endpoints[i].port };
    } catch (error) {}
    return null;
  }),
  (VpnManager.prototype.resolveCores = function (e) {
    var t = this.paths.dataDir,
      r = this.paths.appDir;
    if ("sing-box" === this.edition.core) {
      var i = r + "/bin/sing-box",
        n = t + "/bin/sing-box";
      return {
        singbox: this.coreIntegrity.prepare(i, n, "sing-box"),
        expected: n,
      };
    }
    var o = r + "/bin/xray",
      s = t + "/bin/xray",
      a = { xray: this.coreIntegrity.prepare(o, s, "xray"), expectedXray: s };
    if ("systemProxy" === e) return a;
    var c = r + "/bin/tun2socks",
      u = t + "/bin/tun2socks";
    return (
      (a.tun2socks = this.coreIntegrity.prepare(c, u, "tun2socks")),
      (a.expectedTun2socks = u),
      a
    );
  }),
  (VpnManager.prototype.setHomebrewRoot = function (e) {
    return (
      "boolean" != typeof e ||
        (this.homebrewRoot !== e &&
          ((this.homebrewRoot = e), this.health.invalidate())),
      this.homebrewRoot
    );
  }),
  (VpnManager.prototype.setStartupSafetyError = function (e) {
    var t =
      "SHARED_DIRECTORY_REPAIR_FAILED" === e || "STORE_UNRECOVERABLE" === e
        ? e
        : "";
    return (
      this.startupSafetyError !== t &&
        ((this.startupSafetyError = t), this.health.invalidate()),
      this.startupSafetyError
    );
  }),
  (VpnManager.prototype.healthFacts = function () {
    return {
      privilege: privilege.probe(this.paths),
      homebrewRoot: this.homebrewRoot,
      startupSafetyError: this.startupSafetyError,
      mode: this.selectedMode(),
    };
  }),
  (VpnManager.prototype.checkHealth = function () {
    return this.health.check(this.healthFacts());
  }),
  (VpnManager.prototype.writeConfig = function (e) {
    atomic.writeJsonAtomic(this.paths.configFile, e, atomic.FILE_MODE);
  }),
  (VpnManager.prototype.healthSummary = function () {
    return this.health.summary(this.healthFacts());
  }),
  (VpnManager.prototype.beginOperation = function (e) {
    var t = this,
      r = {
        generation: ++this.operationGeneration,
        active: !0,
        settling: !1,
        callbackCalled: !1,
        callback: e || function () {},
        waiters: [],
        cancellables: [],
        entries: {},
        lockAcquired: !1,
        routesSaved: !1,
        routeState: null,
        childStarted: !1,
        mode: t.selectedMode(),
        proxyState: null,
        proxyApplied: !1,
        deadlineAt: Date.now() + t.connectTimeoutMs,
        deadlineTimer: null,
        timedOut: !1,
        cancelRequested: !1,
        dnsServer:
          t.store && "function" == typeof t.store.getDnsServer
            ? t.store.getDnsServer()
            : null,
        remaining: function () {
          return Math.max(0, r.deadlineAt - Date.now());
        },
      };
    return (
      (r.finish = once(function (e, i) {
        (r.deadlineTimer &&
          (t.clearTimeout(r.deadlineTimer), (r.deadlineTimer = null)),
          t.activeOperation === r && (t.activeOperation = null),
          (r.active = !1),
          (r.callbackCalled = !0),
          r.callback(e || null, i));
      })),
      (this.activeOperation = r),
      (r.deadlineTimer = this.setTimeout(
        function () {
          t.expireOperation(r);
        },
        Math.max(1, this.connectTimeoutMs),
      )),
      r.deadlineTimer && r.deadlineTimer.unref && r.deadlineTimer.unref(),
      r
    );
  }),
  (VpnManager.prototype.isCurrentOperation = function (e) {
    return (
      !(!e || !e.active || e.settling || this.activeOperation !== e) &&
      (!(e.deadlineAt && Date.now() >= e.deadlineAt) ||
        (this.expireOperation(e), !1))
    );
  }),
  (VpnManager.prototype.registerWaiter = function (e, t) {
    e && t && "function" == typeof t.cancel && e.waiters.push(t);
  }),
  (VpnManager.prototype.cancelOperationWaiters = function (e) {
    var t;
    if (e) {
      for (t = 0; t < e.waiters.length; t++)
        try {
          e.waiters[t].cancel();
        } catch (e) {}
      for (t = 0; t < e.cancellables.length; t++)
        try {
          e.cancellables[t].cancel();
        } catch (e) {}
      ((e.waiters.length = 0), (e.cancellables.length = 0));
    }
  }),
  (VpnManager.prototype.expireOperation = function (e) {
    var t,
      r = this;
    e &&
      e.active &&
      !e.settling &&
      ((e.settling = !0),
      (e.timedOut = !0),
      this.cancelOperationWaiters(e),
      (t = err("CONNECTION_TIMEOUT", "connection attempt timed out")),
      (this.lastError = { code: t.code, detail: t.detail || "" }),
      this.logger &&
        this.logger.warn("vpn connection deadline reached", { code: t.code }),
      (this.state = STATE.STOPPING),
      (this.dataPlaneVerified = !1),
      (this.verifiedExternalIp = ""),
      this.cleanup(
        function () {
          e.active && r.activeOperation === e && e.finish(t);
        },
        { mode: e.mode },
      ));
  }),
  (VpnManager.prototype.cancelOperation = function (e, t) {
    var r = this;
    e &&
      e.active &&
      !e.settling &&
      ((e.settling = !0),
      (e.cancelRequested = !0),
      this.cancelOperationWaiters(e),
      (this.state = STATE.STOPPING),
      this.cleanup(
        function () {
          e.active &&
            r.activeOperation === e &&
            e.finish(t || err("CANCELLED", "connect cancelled"));
        },
        { mode: e.mode },
      ));
  }),
  (VpnManager.prototype.scheduleRecoveryRetry = function () {
    var e = this;
    !this.recoveryTimer &&
      this.systemProxy &&
      this.systemProxy.readState &&
      this.systemProxy.readState() &&
      ((this.recoveryTimer = setTimeout(function () {
        ((e.recoveryTimer = null),
          e.systemProxy &&
            e.systemProxy.readState &&
            e.systemProxy.readState() &&
            e.recover());
      }, NETWORK_GUARD_INTERVAL_MS)),
      this.recoveryTimer.unref && this.recoveryTimer.unref());
  }),
  (VpnManager.prototype.cleanup = function (e, t) {
    var r = this;
    t = t || {};
    var i,
      n = once(e || function () {}),
      o = null,
      s = null,
      a = null;
    if (this.cleanupInProgress) {
      this.cleanupInProgress.push(n);
      this.cleanupTimedOut && n(this.cleanupTimeoutError);
    }
    else {
      ((this.cleanupInProgress = [n]),
        (this.cleanupTimedOut = !1),
        (this.cleanupTimeoutError = null),
        this.recoveryTimer &&
          (clearTimeout(this.recoveryTimer), (this.recoveryTimer = null)),
        this.stopLogGuard(),
        this.stopNetworkGuard(),
        this.watchdog && this.watchdog.stop(),
        "systemProxy" !== (this.activeMode || t.mode || "tun") &&
          (function () {
            try {
              r.routes.rollback(t);
            } catch (routeError) {
              o = err("SAFE_FALLBACK_FAILED", "route rollback failed");
              r.logger && r.logger.error("route rollback failed");
            }
          })(),
        (i = once(function () {
          var e,
            i = r.cleanupInProgress || [];
          if (
            ((a = once(function () {
              s && (r.clearTimeout(s), (s = null));
              var n = r.activeMode || t.mode || "tun";
              if (r.systemProxy && r.systemProxy.readState && r.systemProxy.readState())
                n = "systemProxy";
              try {
                r.lock.release();
              } catch (e) {
                r.logger && r.logger.error("connection lock release failed");
              }
              for (
                r.state = STATE.IDLE,
                  r.connectedAt = 0,
                  r.activeProfileId = "",
                  r.activeMode = "",
                  r.dataPlaneVerified = !1,
                  r.verifiedExternalIp = "",
                  r.cleanupInProgress = null,
                  r.cleanupTimedOut = !1,
                  r.cleanupTimeoutError = null,
                  r.recoveryInProgress = !1,
                  o &&
                    "SYSTEM_PROXY_RESTORE_PENDING" === o.code &&
                    ((r.recoveryInProgress = !0), r.scheduleRecoveryRetry()),
                  e = 0;
                e < i.length;
                e++
              )
                i[e](o || null);
            })),
            ("systemProxy" === (r.activeMode || t.mode) ||
              (r.systemProxy &&
                r.systemProxy.readState &&
                r.systemProxy.readState())) &&
              r.systemProxy)
          )
            try {
              return r.systemProxy.restore(function (e) {
                (e && (o = e), r.supervisor.stopAll(a));
              });
            } catch (e) {
              o = err(
                "SYSTEM_PROXY_RESTORE_FAILED",
                "proxy restoration failed",
              );
            }
          r.supervisor.stopAll(a);
        })));
      try {
        ((s = r.setTimeout(function () {
          ((r.cleanupTimedOut = !0),
            (r.cleanupTimeoutError =
              o || err("CORE_START_FAILED", "cleanup timed out")),
            (o = r.cleanupTimeoutError),
            r.logger &&
              r.logger.warn(
                "vpn cleanup deadline reached; lock retained until core exit",
                { code: o.code },
              ));
          var e,
            t = r.cleanupInProgress || [];
          for (e = 0; e < t.length; e++) t[e](o);
        }, r.cleanupTimeoutMs)) &&
          s.unref &&
          s.unref(),
          i());
      } catch (e) {
        o = err("CORE_START_FAILED", "core cleanup failed");
        try {
          this.supervisor.stopAll(i);
        } catch (e) {
          i();
        }
      }
    }
  }),
  (VpnManager.prototype.connect = function (e) {
    var t,
      r,
      i,
      n,
      o = this;
    if (((e = e || function () {}), this.state === STATE.CONNECTED))
      return e(err("ALREADY_RUNNING", "vpn already connected"));
    if (this.isBusy() || this.cleanupInProgress)
      return e(err("BUSY", this.state));
    this.cleanupTimedOut ||
    (this.supervisor && this.supervisor.count && this.supervisor.count() > 0)
      ? this.cleanup(
          function (t) {
            if (t) return e(t);
            o.connect(e);
          },
          { mode: this.activeMode || "tun" },
        )
      : (((n = this.beginOperation(e)).mode = this.selectedMode()),
        (function (e) {
          var s;
          if (o.isCurrentOperation(n)) {
            if (
              o.systemProxy &&
              o.systemProxy.readState &&
              o.systemProxy.readState()
            )
              return (
                (s = err(
                  "SYSTEM_PROXY_RESTORE_PENDING",
                  "proxy restoration is pending",
                )),
                (o.lastError = { code: s.code, detail: s.detail || "" }),
                n.finish(s)
              );
            if (!(
              "systemProxy" !== n.mode ||
              (e && e.systemProxy && e.systemProxy.available)
            ))
              return (
                (s = err(
                  "MODE_UNSUPPORTED",
                  (e && e.systemProxy && e.systemProxy.reason) ||
                    "system proxy unavailable",
                )),
                (o.lastError = { code: s.code, detail: s.detail || "" }),
                n.finish(s)
              );
            if ((s = o.checkHealth()))
              return (
                (o.lastError = { code: s.code, detail: s.detail || "" }),
                n.finish(s)
              );
            t = o.requestedProfileId && o.store.profileById
              ? o.store.profileById(o.requestedProfileId)
              : o.store.activeProfile();
            o.requestedProfileId = "";
            if (!t)
              return n.finish(
                err("NO_ACTIVE_PROFILE", "select a server first"),
              );
            try {
              r = o.resolveCores(n.mode);
            } catch (e) {
              return (
                (e = errors.isAlcyoneError(e)
                  ? e
                  : err("CORE_INTEGRITY_FAILED", "core verification failed")),
                (o.lastError = { code: e.code, detail: e.detail || "" }),
                n.finish(e)
              );
            }
            if ("sing-box" === o.edition.core && !r.singbox)
              return n.finish(err("CORE_MISSING", "sing-box binary missing"));
            if (
              "sing-box" !== o.edition.core &&
              (!r.xray ||
                ("tun" === n.mode &&
                  !r.tun2socks &&
                  "tun2socks" === xrayConfig.dataPlaneFor(o.edition)))
            )
              return n.finish(err("CORE_MISSING", "VPN core binary missing"));
            if ("systemProxy" === n.mode)
              try {
                (o.lock.acquire(n.mode), (n.lockAcquired = !0));
              } catch (e) {
                return (
                  (o.lastError = { code: e.code, detail: e.detail || "" }),
                  n.finish(e)
                );
              }
            ((o.state = STATE.STARTING),
              (o.connectedAt = 0),
              (o.activeProfileId = ""),
              (o.activeMode = n.mode),
              (o.dataPlaneVerified = !1),
              (o.verifiedExternalIp = ""));
            try {
              ((i = o.resolveEndpoints(
                t,
                function (e, i) {
                  if (o.isCurrentOperation(n)) {
                    if (e) {
                      if (
                        ((o.state = STATE.IDLE),
                        (o.activeMode = ""),
                        n.lockAcquired)
                      ) {
                        try {
                          o.lock.release();
                        } catch (e) {}
                        n.lockAcquired = !1;
                      }
                      return (
                        (o.lastError = {
                          code: e.code,
                          detail: e.detail || "",
                        }),
                        o.logger.error("endpoint resolution failed", {
                          code: e.code,
                        }),
                        n.finish(e)
                      );
                    }
                    o.startWithBootstrap(t, r, i, n);
                  }
                },
                {
                  isCurrent: function () {
                    return o.isCurrentOperation(n);
                  },
                  timeoutMs: Math.max(1, n.remaining()),
                },
              )),
                n.active &&
                  i &&
                  "function" == typeof i.cancel &&
                  n.cancellables.push(i));
            } catch (e) {
              if (!o.isCurrentOperation(n)) return;
              if (
                ((o.state = STATE.IDLE), (o.activeMode = ""), n.lockAcquired)
              ) {
                try {
                  o.lock.release();
                } catch (e) {}
                n.lockAcquired = !1;
              }
              ((o.lastError = {
                code: "ENDPOINT_RESOLUTION_FAILED",
                detail: "invalid endpoint profile",
              }),
                n.finish(
                  err("ENDPOINT_RESOLUTION_FAILED", "invalid endpoint profile"),
                ));
            }
          }
        })(this.capabilitySnapshot()));
  }),
  (VpnManager.prototype.startWithBootstrap = function (e, t, r, i) {
    var n,
      o,
      s = this;
    function a(e) {
      if (s.isCurrentOperation(i)) {
        if (((i.settling = !0), i.lockAcquired)) {
          try {
            s.lock.release();
          } catch (e) {}
          i.lockAcquired = !1;
        }
        ((s.state = STATE.IDLE),
          (s.connectedAt = 0),
          (s.dataPlaneVerified = !1),
          (s.verifiedExternalIp = ""),
          (s.lastError = {
            code: e.code || "INTERNAL",
            detail: e.detail || "",
          }),
          i.finish(e));
      }
    }
    function c(e) {
      s.isCurrentOperation(i) &&
        ((i.settling = !0),
        (s.dataPlaneVerified = !1),
        (s.verifiedExternalIp = ""),
        (s.lastError = { code: e.code || "INTERNAL", detail: e.detail || "" }),
        s.logger.error("vpn start failed", { code: e.code || "INTERNAL" }),
        s.cleanup(function () {
          i.active && s.activeOperation === i && i.finish(e);
        }));
    }
    if (s.isCurrentOperation(i)) {
      try {
        var dataPlaneMode = xrayConfig.dataPlaneFor(this.edition),
          tunMtu = routesLib.mtuPolicy(this.routes.physicalMtu()),
          physicalRoute =
            "systemProxy" !== i.mode && this.routes.readDefaultRoute
              ? this.routes.readDefaultRoute()
              : null,
          physicalInterface =
            physicalRoute && physicalRoute.device
              ? String(physicalRoute.device)
              : "";
        n =
          "sing-box" === this.edition.core
            ? singboxConfig.build(e, r, {
                dnsServer: i.dnsServer,
                mode: i.mode,
                interfaceName: this.routes.tunName,
                mtu: tunMtu,
              })
            : xrayConfig.build(e, r, {
                dnsServer: i.dnsServer,
                mode: i.mode,
                dataPlane: dataPlaneMode,
                interfaceName: this.routes.tunName,
                physicalInterface: physicalInterface,
                mtu: tunMtu,
              });
      } catch (e) {
        return a(
          errors.isAlcyoneError(e)
            ? e
            : err("CONFIG_BUILD_FAILED", "invalid profile"),
        );
      }
      if (s.isCurrentOperation(i)) {
        if (
          "xray" === this.edition.core &&
          (o = xrayAssets.verifyReferenced(n, this.paths.dataDir + "/bin"))
        )
          return a(o);
        if (s.isCurrentOperation(i)) {
          if (!i.lockAcquired)
            try {
              (this.lock.acquire(i.mode), (i.lockAcquired = !0));
            } catch (e) {
              return a(e);
            }
          if (
            ((this.lastError = null),
            (this.activeProfileId = e.id),
            !s.isCurrentOperation(i))
          )
            return c(err("CANCELLED", "connect cancelled"));
          if ("systemProxy" === i.mode)
            return this.systemProxy.prepare(i, function (e) {
              if (s.isCurrentOperation(i)) return e ? c(e) : void p();
            });
          try {
            ((i.routeState = this.routes.saveState(r.addresses)),
              (i.routesSaved = !0));
          } catch (e) {
            return c(err("ROUTE_FAILED", "cannot snapshot routes"));
          }
          p();
        }
      }
    }
    function u() {
      if (s.isCurrentOperation(i)) {
        if (!s.coresAlive(i))
          return c(
            err(
              "CORE_START_FAILED",
              "core stopped during traffic verification",
            ),
          );
        ((s.dataPlaneVerified = !0),
          (s.state = STATE.CONNECTED),
          (s.connectedAt = Date.now()),
          s.logger.info("vpn connected", {
            core: s.edition.core,
            mode: i.mode,
            dataPlaneVerified: !0,
          }),
          s.startNetworkGuard(),
          s.watchdog && s.watchdog.start(),
          s.scheduleBudgetForgiveness(),
          i.finish(null, { state: s.state, profileId: e.id, mode: i.mode }));
      }
    }
    function l(e) {
      var t;
      if (s.isCurrentOperation(i)) {
        if (e) return c(e);
        if ("systemProxy" === i.mode)
          return s.coresAlive(i) && s.httpReady()
            ? s.systemProxy.verifyTraffic(function (e) {
                if (s.isCurrentOperation(i))
                  return e
                    ? c(e)
                    : void s.systemProxy.apply(i, function (e) {
                        if (s.isCurrentOperation(i)) {
                          if (e) return c(e);
                          ((i.proxyApplied = !0), u());
                        }
                      });
              })
            : c(err("CORE_START_FAILED", "core stopped before proxy setup"));
        if (!(s.coresAlive(i) && s.routes.tunExists()))
          return c(
            err("CORE_START_FAILED", "core stopped before route install"),
          );
        if (s.isCurrentOperation(i)) {
          try {
            ((t = i.routeState), s.routes.applyTunRoutes(t));
          } catch (e) {
            return (
              s.logger &&
                s.logger.warn("route setup rejected", {
                  detail: errors.isAlcyoneError(e)
                    ? e.detail || "route failure"
                    : "route exception",
                }),
              c(
                errors.isAlcyoneError(e)
                  ? e
                  : err("ROUTE_FAILED", "route install failed"),
              )
            );
          }
          if (s.isCurrentOperation(i))
            return s.routes.routeActive()
              ? s.routesProtected(t)
                ? s.coresAlive(i) && s.routes.tunExists()
                  ? void s.verifyDataPlane(i, function (e, r) {
                      if (s.isCurrentOperation(i)) {
                        if (e) return c(e);
                        if (!s.coresAlive(i) || !s.routes.tunExists())
                          return c(
                            err(
                              "CORE_START_FAILED",
                              "core stopped during traffic verification",
                            ),
                          );
                        if (
                          !s.routes.routeActive() ||
                          !s.routesProtected(t)
                        )
                          return c(
                            err(
                              "HEALTH_CHECK_FAILED",
                              "routes changed during traffic verification",
                            ),
                          );
                        ((s.verifiedExternalIp = r), u());
                      }
                    })
                  : c(
                      err(
                        "CORE_START_FAILED",
                        "core stopped during route install",
                      ),
                    )
                : c(err("HEALTH_CHECK_FAILED", "bypass routes not protected"))
              : c(err("HEALTH_CHECK_FAILED", "tunnel route not active"));
        }
      }
    }
    function p() {
      if (!s.isCurrentOperation(i))
        return c(err("CANCELLED", "connect cancelled"));
      try {
        s.writeConfig(n);
      } catch (e) {
        return c(err("STORE_WRITE_FAILED", "cannot write core config"));
      }
      if (!s.isCurrentOperation(i))
        return c(err("CANCELLED", "connect cancelled"));
      s.startCores.length < 3 ? s.startCores(t, l) : s.startCores(t, i, l);
    }
  }),
  (VpnManager.prototype.verifyDataPlane = function (e, t) {
    var r = this,
      i = once(t || function () {});
    if ("function" != typeof this.dataPlaneProbe)
      return i(err("HEALTH_CHECK_FAILED", "traffic verification unavailable"));
    try {
      this.dataPlaneProbe(
        function (t, n) {
          if (
            ((n = String(n || "").replace(/\s+/g, "")), r.isCurrentOperation(e))
          )
            return t || 0 === net.isIP(n)
              ? i(err("HEALTH_CHECK_FAILED", "external traffic unavailable"))
              : void i(null, n);
        },
        {
          deadlineAt: e && e.deadlineAt,
          isCurrent: function () {
            return r.isCurrentOperation(e);
          },
        },
      );
    } catch (e) {
      i(err("HEALTH_CHECK_FAILED", "external traffic verification failed"));
    }
  }),
  (VpnManager.prototype.coresAlive = function (e) {
    var t = this;
    function r(r) {
      var i,
        n = e && e.entries[r];
      return n && t.supervisor.entryFor && (i = t.supervisor.entryFor(r))
        ? i === n && !i.exited
        : t.supervisor.isRunning(r);
    }
    return "sing-box" === this.edition.core
      ? r("sing-box")
      : e && "systemProxy" === e.mode
        ? r("xray")
        : r("xray") && r("tun2socks");
  }),
  (VpnManager.prototype.startCores = function (e, t, r) {
    var i = this,
      n = once(r || function () {});
    function o() {
      return i.isCurrentOperation(t);
    }
    function s() {
      return o() && i.routes.tunExists();
    }
    function a() {
      return o() && i.httpReady();
    }
    function c(e, r, n) {
      var s;
      o() &&
        ((s = supervisorLib.waitFor(
          e,
          {
            timeout: Math.max(1, Math.min(2e4, t.remaining())),
            isCurrent: o,
            isAlive: function () {
              return o() && i.supervisor.isRunning(r);
            },
          },
          function (e) {
            o() && n(e);
          },
        )),
        i.registerWaiter(t, s));
    }
    function u(e, r, n, s) {
      var a;
      return (
        !!o() &&
        ((a = i.spawnLogged(e, r, n, s, t)),
        (t.entries[e] = a),
        (t.childStarted = !0),
        !0)
      );
    }
    if ("sing-box" === this.edition.core) {
      try {
        if (
          !u("sing-box", e.singbox, ["run", "-c", this.paths.configFile], {
            captureOutput: !1,
          })
        )
          return;
      } catch (e) {
        return n(e);
      }
      return c(
        function () {
          return "systemProxy" === t.mode ? a() : s() && i.socksReady();
        },
        "sing-box",
        n,
      );
    }
    !(function r(l) {
      var p;
      try {
        if (
          !u("xray", e.xray, ["-config", i.paths.configFile], {
            env: {
              PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
              XRAY_LOCATION_ASSET: i.paths.dataDir + "/bin",
            },
          })
        )
          return;
      } catch (e) {
        return n(e);
      }
      c(
        function () {
          return o() && ("systemProxy" === t.mode ? a() : i.socksReady());
        },
        "xray",
        function (a) {
          if (o())
            return a
              ? "systemProxy" === t.mode
                ? n(err("CORE_START_FAILED", "proxy port did not open"))
                : void i.diagnoseCoreFailure("xray", e.xray, t, function () {
                    if (o()) {
                      if (l >= XRAY_START_ATTEMPTS)
                        return n(
                          err("CORE_START_FAILED", "proxy port did not open"),
                        );
                      if (
                        (i.logger &&
                          i.logger.warn(
                            "retrying xray after pre-readiness exit",
                            { attempt: l + 1 },
                          ),
                        t.remaining() <= 0)
                      )
                        return n(
                          err(
                            "CONNECTION_TIMEOUT",
                            "connection attempt timed out",
                          ),
                        );
                      ((p = i.setTimeout(
                        function () {
                          ((p = null), o() && r(l + 1));
                        },
                        Math.min(
                          XRAY_RETRY_DELAY_MS,
                          Math.max(1, t.remaining()),
                        ),
                      )),
                        i.registerWaiter(t, {
                          cancel: function () {
                            (p && clearTimeout(p), (p = null));
                          },
                        }));
                    }
                  })
              : "systemProxy" === t.mode
                ? n()
                : (function () {
                    /* Native TUN mode: XRay creates the device itself and
                       is the only data-plane process; go-tun2socks is not
                       started and readiness waits for the owned device. */
                    if (
                      "native-tun" === xrayConfig.dataPlaneFor(i.edition)
                    )
                      return c(s, "xray-tun", n);
                    try {
                      if (
                        !u("tun2socks", e.tun2socks, [
                          "-tunName",
                          routesLib.tunNameFor(i.edition.core),
                          "-tunAddr",
                          routesLib.TUN_IP,
                          "-tunGw",
                          routesLib.TUN_GW,
                          "-tunMask",
                          "255.255.255.252",
                          "-proxyType",
                          "socks",
                          "-proxyServer",
                          "127.0.0.1:" + xrayConfig.SOCKS_PORT,
                          "-udpTimeout",
                          "2m",
                          "-loglevel",
                          "warn",
                        ])
                      )
                        return;
                    } catch (e) {
                      return n(e);
                    }
                    c(s, "tun2socks", n);
                  })();
        },
      );
    })(1);
  }),
  (VpnManager.prototype.spawnLogged = function (e, t, r, i, n) {
    var o,
      s,
      a,
      c,
      launcherExecutable,
      u = "ignore";
    if (
      ((c = !1 !== (i = i || {}).captureOutput),
      n && !this.isCurrentOperation(n))
    )
      throw err("CANCELLED", "connect cancelled");
    if (this.launcher)
      try {
        launcherExecutable = this.coreIntegrity.prepare(
          this.launcher.executable,
          this.paths.dataDir + "/bin/alcyone-exec",
          "alcyone-exec",
        );
        this.coreIntegrity.verifyForLaunch(launcherExecutable, "alcyone-exec");
      } catch (launcherError) {
        throw err("PACKAGE_INCOMPLETE", "process launcher integrity failed");
      }
    if ((this.coreIntegrity.verifyForLaunch(t, e), c))
      try {
        (loggerLib.capFile(this.paths.tunnelLog),
          (u = fs.openSync(this.paths.tunnelLog, "a", atomic.FILE_MODE)));
      } catch (e) {
        u = "ignore";
      }
    for (a in ((s = {}), CORE_ENV_BASE))
      Object.prototype.hasOwnProperty.call(CORE_ENV_BASE, a) &&
        (s[a] = CORE_ENV_BASE[a]);
    for (a = 0; a < CORE_ENV_CLEAR_KEYS.length; a++)
      s[CORE_ENV_CLEAR_KEYS[a]] = "";
    if (i.env)
      for (a in i.env)
        Object.prototype.hasOwnProperty.call(i.env, a) && (s[a] = i.env[a]);
    for (a = 0; a < CORE_ENV_CLEAR_KEYS.length; a++)
      s[CORE_ENV_CLEAR_KEYS[a]] = "";
    ((s.LD_PRELOAD = ""),
      this.launcher &&
        (i.launcher = {
          executable: launcherExecutable,
          nofile:
            "xray" === e ? 32768 : "tun2socks" === e ? 8192 : 8192,
        }),
      (i.env = s),
      (i.cwd = i.cwd || "/"),
      (this.launches[e] = {
        args: r,
        env: i.env,
        cwd: i.cwd,
        logOffset: this.tunnelLogSize(),
      }));
    try {
      if (((i.stdio = c ? u : "ignore"), n && !this.isCurrentOperation(n)))
        throw err("CANCELLED", "connect cancelled");
      o = this.supervisor.start(e, t, r, i);
    } finally {
      if ("number" == typeof u)
        try {
          fs.closeSync(u);
        } catch (e) {}
    }
    return (this.startLogGuard(), o);
  }),
  (VpnManager.prototype.tunnelLogSize = function () {
    try {
      return fs.statSync(this.paths.tunnelLog).size;
    } catch (e) {
      return 0;
    }
  }),
  (VpnManager.prototype.diagnoseCoreFailure = function (e, t, r, i) {
    var n = this,
      o = this.launches[e] || {},
      s = this.supervisor.entryFor(e),
      a = {
        pid: s ? s.pid : null,
        exitCode: s ? s.exitCode : null,
        exitSignal: s ? s.exitSignal : "",
        spawnErrorCode: s ? s.spawnErrorCode : "",
      };
    function c() {
      if (n.isCurrentOperation(r)) {
        try {
          coreDiagnostics.report(n.logger, {
            core: e,
            pid: a.pid,
            exitCode: a.exitCode,
            exitSignal: a.exitSignal,
            spawnErrorCode: a.spawnErrorCode,
            failureStage: "core-readiness",
            coreOutputText: coreDiagnostics.readSince(
              n.paths.tunnelLog,
              o.logOffset,
            ),
          });
        } catch (e) {}
        n.isCurrentOperation(r) && i();
      }
    }
    if (this.supervisor.isRunning(e)) return this.supervisor.stop(e, c);
    c();
  }),
  (VpnManager.prototype.startLogGuard = function () {
    var e = this;
    this.logCapTimer ||
      ((this.logCapTimer = setInterval(function () {
        loggerLib.capFile(e.paths.tunnelLog);
      }, 3e4)),
      this.logCapTimer.unref && this.logCapTimer.unref());
  }),
  (VpnManager.prototype.stopLogGuard = function () {
    (this.logCapTimer &&
      (clearInterval(this.logCapTimer), (this.logCapTimer = null)),
      loggerLib.capFile(this.paths.tunnelLog));
  }),
  (VpnManager.prototype.startNetworkGuard = function () {
    var e = this;
    this.networkGuardTimer ||
      ((this.networkGuardTimer = setInterval(function () {
        e.checkNetworkChange();
      }, NETWORK_GUARD_INTERVAL_MS)),
      this.networkGuardTimer.unref && this.networkGuardTimer.unref());
  }),
  (VpnManager.prototype.stopNetworkGuard = function () {
    this.networkGuardTimer &&
      (clearInterval(this.networkGuardTimer), (this.networkGuardTimer = null));
  }),
  (VpnManager.prototype.handleNetworkChange = function () {
    var e = this;
    return (
      this.state === STATE.CONNECTED &&
      !this.cleanupInProgress &&
      ((this.state = STATE.STOPPING),
      (this.dataPlaneVerified = !1),
      (this.verifiedExternalIp = ""),
      (this.lastError = { code: "NETWORK_CHANGED", detail: "" }),
      this.logger &&
        this.logger.warn(
          "physical network changed, restoring current network",
          { mode: this.activeMode || "" },
        ),
      this.cleanup(
        function () {
          e.logger &&
            e.logger.info("vpn disconnected after physical network change");
        },
        { preserveCurrentNetwork: !0, mode: this.activeMode || "tun" },
      ),
      !0)
    );
  }),
  (VpnManager.prototype.checkNetworkChange = function () {
    var e,
      t,
      r = this;
    if (this.state !== STATE.CONNECTED || this.cleanupInProgress) return !1;
    if ("systemProxy" === this.activeMode)
      return (
        this.networkGuardBusy ||
          ((this.networkGuardBusy = !0),
          this.systemProxy.guard(function (e, t) {
            ((r.networkGuardBusy = !1),
              e &&
                r.state === STATE.CONNECTED &&
                ((r.lastError = {
                  code:
                    "proxy" === t
                      ? "SYSTEM_PROXY_RESTORE_CONFLICT"
                      : "NETWORK_CHANGED",
                  detail: "",
                }),
                r.handleNetworkChange()));
          })),
        !1
      );
    try {
      e = this.routes.loadState();
      t = this.routes.networkChanged(e);
      if (!t && this.routes.routeActive() && !this.routesProtected(e))
        t = true;
    } catch (e) {
      t = true;
    }
    return !!t && this.handleNetworkChange();
  }),
  (VpnManager.prototype.routesProtected = function (e) {
    return !!(
      this.routes &&
      "function" == typeof this.routes.directRoutesActive &&
      "function" == typeof this.routes.serverBypassesActive &&
      this.routes.directRoutesActive(e) &&
      this.routes.serverBypassesActive(e)
    );
  }),
  (VpnManager.prototype.portReady = function (e) {
    var t,
      r,
      i,
      n,
      o,
      s,
      a = ("0000" + Number(e).toString(16).toUpperCase()).slice(-4),
      c = ["/proc/net/tcp", "/proc/net/tcp6"];
    for (t = 0; t < c.length; t++)
      try {
        for (
          r = fs.readFileSync(c[t], "utf8").split("\n"), i = 1;
          i < r.length;
          i++
        )
          if (
            !((n = r[i].trim().split(/\s+/)).length < 4 || "0A" !== n[3]) &&
            2 === (o = n[1].split(":")).length &&
            o[1].toUpperCase() === a
          ) {
            if (((s = o[0].toUpperCase()), 0 === t && "0100007F" === s))
              return !0;
            if (
              1 === t &&
              ("00000000000000000000000001000000" === s ||
                "00000000000000000000000000000001" === s ||
                "0000000000000000FFFF00000100007F" === s)
            )
              return !0;
          }
      } catch (e) {}
    return !1;
  }),
  (VpnManager.prototype.socksReady = function () {
    return this.portReady(xrayConfig.SOCKS_PORT);
  }),
  (VpnManager.prototype.httpReady = function () {
    return this.portReady(systemProxyLib.HTTP_PORT);
  }),
  (VpnManager.prototype.disconnect = function (e) {
    var t = this,
      r = this.activeOperation,
      i = !1;
    return (
      (e = once(e || function () {})),
      this.watchdogRecoveryTimer &&
        (this.clearTimeout(this.watchdogRecoveryTimer), (this.watchdogRecoveryTimer = null)),
      this.state === STATE.STARTING &&
        r &&
        (this.cancelOperation(r, err("CANCELLED", "connect cancelled")),
        (this.state = STATE.STOPPING),
        (i = !0)),
      this.state === STATE.IDLE &&
        r &&
        r.active &&
        (this.cancelOperation(r, err("CANCELLED", "connect cancelled")),
        (this.state = STATE.STOPPING),
        (i = !0)),
      this.state === STATE.IDLE
        ? this.cleanup(function () {
            e(null, { state: STATE.IDLE });
          })
        : this.state !== STATE.STOPPING || i
          ? ((this.state = STATE.STOPPING),
            void this.cleanup(function () {
              (t.logger.info("vpn disconnected"),
                e(null, { state: STATE.IDLE }));
            }))
          : e(err("BUSY", "stopping"))
    );
  }),
  (VpnManager.prototype.recover = function () {
    var e = this,
      t = this.routes.loadState(),
      r = this.lock.status(),
      i =
        this.systemProxy && this.systemProxy.readState
          ? this.systemProxy.readState()
          : null;
    if (this.state === STATE.CONNECTED) return !1;
    if (i) {
      if (i.edition && i.edition !== this.edition.id) return !1;
      this.logger &&
        this.logger.info("recovering stale system proxy state after restart");
      try {
        this.lock.acquire("systemProxy");
      } catch (e) {
        return !1;
      }
      return (
        (this.recoveryInProgress = !0),
        this.systemProxy &&
          this.systemProxy.recover &&
          this.systemProxy.recover(function (t) {
            if (t)
              if ("SYSTEM_PROXY_RESTORE_PENDING" === t.code)
                ((e.recoveryInProgress = !0), e.scheduleRecoveryRetry());
              else {
                e.recoveryInProgress = !1;
                try {
                  e.lock.release();
                } catch (e) {}
              }
            else {
              e.recoveryInProgress = !1;
              try {
                e.lock.release();
              } catch (e) {}
              e.recoveryTimer &&
                (clearTimeout(e.recoveryTimer), (e.recoveryTimer = null));
            }
          }),
        !0
      );
    }
    return (
      !!(t || (r.held && r.mine)) &&
      (this.logger.info("recovering stale tunnel state after restart"),
      this.routes.rollback(),
      this.lock.release(),
      !0)
    );
  }),
  (VpnManager.prototype.status = function () {
    var e = this.lock.status(),
      t = this.state === STATE.CONNECTED && this.dataPlaneVerified;
    return {
      state: this.state,
      connected: t,
      dataPlaneVerified: t,
      connectedAt: this.connectedAt,
      profileId: t ? this.activeProfileId : "",
      mode: this.selectedMode(),
      activeMode: this.activeMode || (t ? this.selectedMode() : ""),
      core: this.edition.core,
      processes: this.supervisor.status(),
      tunnelOwner: e.held ? e.edition : "",
      ownsTunnel: !!e.mine,
      connectionOwner: e.held ? e.edition : "",
      ownsConnection: !!e.mine,
      connectionMode: e.held ? e.mode || "tun" : "",
      lastErrorCode: (this.lastError && this.lastError.code) || "",
      routingBackend: (this.routes.loadState() && this.routes.loadState().routingBackend) || "",
      watchdog: this.watchdog ? this.watchdog.status() : { state: "unavailable" },
      breaker: { open: this.breakerOpen, lastIncidentAt: this.lastWatchdogIncidentAt || 0, budget: this.recoveryBudget ? this.recoveryBudget.status() : null },
      routes: this.routes.diagnostics(),
    };
  }),
  (module.exports = {
    STATE: STATE,
    XRAY_START_ATTEMPTS: XRAY_START_ATTEMPTS,
    XRAY_RETRY_DELAY_MS: XRAY_RETRY_DELAY_MS,
    NETWORK_GUARD_INTERVAL_MS: NETWORK_GUARD_INTERVAL_MS,
    CONNECT_TIMEOUT_MS: CONNECT_TIMEOUT_MS,
    CLEANUP_TIMEOUT_MS: CLEANUP_TIMEOUT_MS,
    VpnManager: VpnManager,
  }));
