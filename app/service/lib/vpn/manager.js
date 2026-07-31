'use strict';

/* VPN lifecycle.

   Owns the state machine for bringing the tunnel up and down, and guarantees
   that a failure never leaves the TV without a working default route.

   Startup order: resolve the proxy endpoints while ordinary DNS still works,
   take the cross-edition lock, snapshot the routes, write the core config,
   start the core(s), install the routes, then complete identity-aware liveness
   checks. Any
   failure after taking the lock runs the same cleanup path: stop children,
   roll back routes, release the lock.

   A core that dies while connected triggers the same cleanup, so a crash
   restores connectivity instead of stranding the TV behind a dead tunnel. */

var fs = require('fs');
var net = require('net');
var atomic = require('../atomic');
var supervisorLib = require('../supervisor');
var routesLib = require('../net/routes');
var endpointBootstrap = require('../net/endpoint-bootstrap');
var loggerLib = require('../logger');
var coreIntegrityLib = require('../core-integrity');
var coreDiagnostics = require('./core-diagnostics-lite');
var xrayConfig = require('../config/xray');
var xrayAssets = require('../xray-assets');
var singboxConfig = require('../config/singbox');
var healthLib = require('../health');
var privilege = require('../privilege');
var errors = require('../errors');
var err = errors.err;

var STATE = {
  IDLE: 'idle',
  STARTING: 'starting',
  CONNECTED: 'connected',
  STOPPING: 'stopping'
};
var XRAY_START_ATTEMPTS = 2;
var XRAY_RETRY_DELAY_MS = 500;
var NETWORK_GUARD_INTERVAL_MS = 5000;
/* webOS services may carry a platform LD_PRELOAD into their environment.
   Native VPN cores must not inherit that interposer: on affected firmware it
   prevents sing-box from creating its TUN device.  An explicit empty value is
   required for the Node 0.12 child-process implementation, which can retain
   inherited variables when an env object is supplied. */
var CORE_ENV_BASE = {
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  LD_PRELOAD: '',
  HOME: '/home/root'
};
/* The service environment also carries webOS UI, media and Luna context.
   Keep this list platform-only and explicit: older webOS Node builds can
   merge inherited variables even when a child env object is supplied. */
var CORE_ENV_CLEAR_KEYS = [
  'LD_LIBRARY_PATH', 'NODE_PATH', 'APPFRWK_MASK_PATH', 'COMPONENTS_PATH',
  'GST_PLUGIN_PATH', 'GST_PLUGIN_PATH_1_n', 'GST_PLUGIN_SCANNER',
  'GST_PLUGIN_SCANNER_1_n', 'GST_REGISTRY', 'GST_REGISTRY_1_n',
  'GST_REGISTRY_UPDATE', 'QML2_IMPORT_PATH', 'QMLSCENE_DEVICE',
  'QML_DISABLE_DISK_CACHE', 'QSG_PROGRAM_BINARY_STORE', 'QT_HARFBUZZ',
  'QT_IM_MODULE', 'QT_QPA_FONTDIR', 'QT_QPA_PLATFORM', 'QT_VER',
  'QT_WAYLAND_DISABLE_WINDOWDECORATION', 'QT_WAYLAND_HARDWARE_INTEGRATION',
  'QT_WAYLAND_SHELL_INTEGRATION', 'QT_WAYLAND_XKB_RULE_NAMES',
  'SDL_VIDEODRIVER', 'SDP_SYS_PATH', 'WEBAPPFACTORY',
  'WEBOS_GL_DISABLE_THREADED_RENDERING', 'XDG_DIR', 'XDG_RUNTIME_DIR',
  'LS_SERVICE_FILE_NAME', 'LS_SERVICE_NAMES', 'NOTIFY_SOCKET', 'PWD',
  'OLDPWD', 'UPSTART_JOB', 'INVOCATION_ID'
];

function once(callback) {
  var called = false;
  return function () {
    if (called) return;
    called = true;
    callback.apply(null, arguments);
  };
}

function VpnManager(options) {
  options = options || {};
  this.edition = options.edition;
  this.store = options.store;
  this.logger = options.logger;
  this.lock = options.lock;
  this.paths = options.paths;
  this.state = STATE.IDLE;
  this.lastError = null;
  this.connectedAt = 0;
  this.activeProfileId = '';
  this.dataPlaneProbe = options.dataPlaneProbe;
  this.dataPlaneVerified = false;
  this.verifiedExternalIp = '';
  this.logCapTimer = null;
  this.networkGuardTimer = null;
  this.operationGeneration = 0;
  this.activeOperation = null;
  this.cleanupInProgress = null;
  /* What each core was actually launched with, keyed by core name. Diagnostics
     must describe the real launch, not a reconstruction of it. */
  this.launches = {};
  this.coreIntegrity = options.coreIntegrity || coreIntegrityLib;
  /* Last read-only checkRoot verdict for the hard prerequisite. `null` means
     not determined; it is never assumed false, because assuming an unmet
     prerequisite would disable the app on a TV that is perfectly fine. */
  this.homebrewRoot = null;
  this.health = options.health || new healthLib.HealthGate({
    edition: this.edition,
    paths: this.paths,
    logger: this.logger
  });

  this.routes = new routesLib.RouteManager({
    logger: this.logger,
    core: this.edition.core,
    stateFile: this.paths.routeState
  });

  var self = this;
  this.supervisor = new supervisorLib.Supervisor({
    logger: this.logger,
    maxProcesses: 3,
    onExit: function (name, code, signal, entry) { self.onCoreExit(name, code, signal, entry); }
  });
}

VpnManager.prototype.isBusy = function () {
  return this.state === STATE.STARTING || this.state === STATE.STOPPING;
};

/* An unexpected core exit while connected must restore the routes. */
VpnManager.prototype.onCoreExit = function (name, code, signal, entry) {
  if (entry && this.supervisor.entryFor(name) !== entry) return;
  if (this.state !== STATE.CONNECTED && this.state !== STATE.STARTING) return;
  if (this.state === STATE.STARTING) return; /* startup path handles its own cleanup */
  this.logger.warn('core exited unexpectedly, restoring routes', { core: name, code: code, signal: signal || '' });
  this.state = STATE.STOPPING;
  this.dataPlaneVerified = false;
  this.verifiedExternalIp = '';
  this.lastError = { code: 'CORE_START_FAILED', detail: 'core exited' };
  this.cleanup(function () {});
};

/* Resolve the endpoints once, before anything touches the network.

   This used to be a best-effort bypass lookup whose failure was tolerated,
   because a missing bypass route only cost a little efficiency. That is no
   longer true: the same answer now also tells the core how to reach the
   endpoint without a DNS query, so an unresolved endpoint is a guaranteed
   deadlock rather than a lost optimisation. It is therefore fatal, and fatal
   early — while the TV's routing is still untouched. */
VpnManager.prototype.resolveEndpoints = function (profile, callback) {
  var endpoints = this.edition.core === 'sing-box'
    ? singboxConfig.endpoints(profile)
    : xrayConfig.endpoints(profile);
  return endpointBootstrap.resolve(endpoints, callback, arguments[2] || {});
};

/* Verify the immutable package payload and prepare the private staged copy.
   The staged path is the only path returned and therefore the only path that
   can reach spawn. A corrupt stage is repaired exclusively from a package
   binary whose pinned SHA-256 has already been verified. */
VpnManager.prototype.resolveCores = function () {
  var dataDir = this.paths.dataDir;
  var appDir = this.paths.appDir;

  if (this.edition.core === 'sing-box') {
    var packagedSb = appDir + '/bin/sing-box';
    var targetSb = dataDir + '/bin/sing-box';
    return {
      singbox: this.coreIntegrity.prepare(packagedSb, targetSb, 'sing-box'),
      expected: targetSb
    };
  }

  var packagedXray = appDir + '/bin/xray';
  var packagedTun = appDir + '/bin/tun2socks';
  var targetXray = dataDir + '/bin/xray';
  var targetTun = dataDir + '/bin/tun2socks';

  return {
    xray: this.coreIntegrity.prepare(packagedXray, targetXray, 'xray'),
    tun2socks: this.coreIntegrity.prepare(packagedTun, targetTun, 'tun2socks'),
    expectedXray: targetXray,
    expectedTun2socks: targetTun
  };
};

/* Record the read-only Homebrew Channel prerequisite verdict.

   Only a boolean is accepted, and it can only ever make the gate stricter:
   `false` reports HOMEBREW_REQUIRED, `true` simply lets the gate fall through
   to the elevation check, which still blocks activation for a jailed service.
   Nothing here grants a privilege, so this value cannot be abused to unlock
   anything. */
VpnManager.prototype.setHomebrewRoot = function (value) {
  if (typeof value !== 'boolean') return this.homebrewRoot;
  if (this.homebrewRoot !== value) {
    this.homebrewRoot = value;
    this.health.invalidate();
  }
  return this.homebrewRoot;
};

VpnManager.prototype.healthFacts = function () {
  return {
    privilege: privilege.probe(this.paths),
    homebrewRoot: this.homebrewRoot
  };
};

VpnManager.prototype.checkHealth = function () {
  return this.health.check(this.healthFacts());
};

VpnManager.prototype.writeConfig = function (config) {
  atomic.writeJsonAtomic(this.paths.configFile, config, atomic.FILE_MODE);
};

/* Sanitized code-only summary for getState. */
VpnManager.prototype.healthSummary = function () {
  return this.health.summary(this.healthFacts());
};

VpnManager.prototype.beginOperation = function (callback) {
  var self = this;
  var operation = {
    generation: ++this.operationGeneration,
    active: true,
    settling: false,
    callbackCalled: false,
    callback: callback || function () {},
    waiters: [],
    cancellables: [],
    entries: {},
    lockAcquired: false,
    routesSaved: false,
    routeState: null,
    childStarted: false
  };
  operation.finish = once(function (error, result) {
    if (self.activeOperation === operation) self.activeOperation = null;
    operation.active = false;
    operation.callbackCalled = true;
    operation.callback(error || null, result);
  });
  this.activeOperation = operation;
  return operation;
};

VpnManager.prototype.isCurrentOperation = function (operation) {
  return !!operation && operation.active && !operation.settling &&
    this.activeOperation === operation;
};

VpnManager.prototype.registerWaiter = function (operation, waiter) {
  if (!operation || !waiter || typeof waiter.cancel !== 'function') return;
  operation.waiters.push(waiter);
};

VpnManager.prototype.cancelOperation = function (operation, failure) {
  var i;
  if (!operation || !operation.active) return;
  operation.active = false;
  operation.settling = true;
  if (this.activeOperation === operation) this.activeOperation = null;
  for (i = 0; i < operation.waiters.length; i++) {
    try { operation.waiters[i].cancel(); } catch (waitError) {}
  }
  for (i = 0; i < operation.cancellables.length; i++) {
    try { operation.cancellables[i].cancel(); } catch (cancelError) {}
  }
  operation.finish(failure || err('CANCELLED', 'connect cancelled'));
};

/* Full cleanup used by both failure and normal shutdown paths. It is serialized
   so route rollback and lock release happen once even when two failure signals
   arrive in the same event turn. */
VpnManager.prototype.cleanup = function (callback, options) {
  var self = this;
  options = options || {};
  var finish = once(callback || function () {});
  var restore;
  if (this.cleanupInProgress) {
    this.cleanupInProgress.push(finish);
    return;
  }
  this.cleanupInProgress = [finish];
  this.stopLogGuard();
  this.stopNetworkGuard();

  restore = once(function () {
    var callbacks = self.cleanupInProgress || [];
    var i;
    try {
      self.routes.rollback(options);
    } catch (routeCleanupError) {
      if (self.logger) self.logger.error('route rollback failed');
    }
    try {
      self.lock.release();
    } catch (lockCleanupError) {
      if (self.logger) self.logger.error('tunnel lock release failed');
    }
    self.state = STATE.IDLE;
    self.connectedAt = 0;
    self.activeProfileId = '';
    self.dataPlaneVerified = false;
    self.verifiedExternalIp = '';
      self.cleanupInProgress = null;
    for (i = 0; i < callbacks.length; i++) callbacks[i]();
  });

  try {
    this.supervisor.stopAll(restore);
  } catch (stopError) {
    restore();
  }
};

VpnManager.prototype.connect = function (callback) {
  var self = this;
  var profile, cores, resolution;
  var operation;

  callback = callback || function () {};
  if (this.state === STATE.CONNECTED) return callback(err('ALREADY_RUNNING', 'vpn already connected'));
  if (this.isBusy()) return callback(err('BUSY', this.state));

  operation = this.beginOperation(callback);

  var gateError = this.checkHealth();
  if (gateError) {
    this.lastError = { code: gateError.code, detail: gateError.detail || '' };
    return operation.finish(gateError);
  }

  profile = this.store.activeProfile();
  if (!profile) return operation.finish(err('NO_ACTIVE_PROFILE', 'select a server first'));

  try {
    cores = this.resolveCores();
  } catch (integrityError) {
    integrityError = errors.isAlcyoneError(integrityError)
      ? integrityError
      : err('CORE_INTEGRITY_FAILED', 'core verification failed');
    this.lastError = { code: integrityError.code, detail: integrityError.detail || '' };
    return operation.finish(integrityError);
  }
  if (this.edition.core === 'sing-box' && !cores.singbox) {
    return operation.finish(err('CORE_MISSING', 'sing-box binary missing'));
  }
  if (this.edition.core !== 'sing-box' && (!cores.xray || !cores.tun2socks)) {
    return operation.finish(err('CORE_MISSING', 'VPN core binary missing'));
  }

  this.state = STATE.STARTING;
  this.connectedAt = 0;
  this.activeProfileId = '';
  this.dataPlaneVerified = false;
  this.verifiedExternalIp = '';
  try {
    resolution = this.resolveEndpoints(profile, function (resolveError, bootstrap) {
      if (!self.isCurrentOperation(operation)) return;
      if (resolveError) {
        self.state = STATE.IDLE;
        self.lastError = { code: resolveError.code, detail: resolveError.detail || '' };
        self.logger.error('endpoint resolution failed', { code: resolveError.code });
        return operation.finish(resolveError);
      }
      self.startWithBootstrap(profile, cores, bootstrap, operation);
    }, { isCurrent: function () { return self.isCurrentOperation(operation); } });
    if (operation.active && resolution && typeof resolution.cancel === 'function') {
      operation.cancellables.push(resolution);
    }
  } catch (resolveException) {
    if (!self.isCurrentOperation(operation)) return;
    this.state = STATE.IDLE;
    this.lastError = { code: 'ENDPOINT_RESOLUTION_FAILED', detail: 'invalid endpoint profile' };
    operation.finish(err('ENDPOINT_RESOLUTION_FAILED', 'invalid endpoint profile'));
  }
};

/* Everything from here on can modify system state, so every exit runs cleanup. */
VpnManager.prototype.startWithBootstrap = function (profile, cores, bootstrap, operation) {
  var self = this;
  var config, assetError;

  function abortBeforeLock(failure) {
    if (!self.isCurrentOperation(operation)) return;
    operation.settling = true;
    self.state = STATE.IDLE;
    self.connectedAt = 0;
    self.dataPlaneVerified = false;
    self.verifiedExternalIp = '';
    self.lastError = { code: failure.code || 'INTERNAL', detail: failure.detail || '' };
    operation.finish(failure);
  }

  function fail(failure) {
    if (!self.isCurrentOperation(operation)) return;
    operation.settling = true;
    self.dataPlaneVerified = false;
    self.verifiedExternalIp = '';
    self.lastError = { code: failure.code || 'INTERNAL', detail: failure.detail || '' };
    self.logger.error('vpn start failed', { code: failure.code || 'INTERNAL' });
    self.cleanup(function () {
      if (operation.active && self.activeOperation === operation) operation.finish(failure);
    });
  }

  if (!self.isCurrentOperation(operation)) return;
  try {
    config = this.edition.core === 'sing-box'
      ? singboxConfig.build(profile, bootstrap)
      : xrayConfig.build(profile, bootstrap);
  } catch (configError) {
    return abortBeforeLock(errors.isAlcyoneError(configError)
      ? configError
      : err('CONFIG_BUILD_FAILED', 'invalid profile'));
  }
  if (!self.isCurrentOperation(operation)) return;
  if (this.edition.core === 'xray') {
    assetError = xrayAssets.verifyReferenced(config, this.paths.dataDir + '/bin');
    if (assetError) return abortBeforeLock(assetError);
  }

  if (!self.isCurrentOperation(operation)) return;
  try {
    this.lock.acquire();
    operation.lockAcquired = true;
  } catch (lockError) {
    return abortBeforeLock(lockError);
  }
  this.lastError = null;
  this.activeProfileId = profile.id;

  if (!self.isCurrentOperation(operation)) return fail(err('CANCELLED', 'connect cancelled'));
  try {
    operation.routeState = this.routes.saveState(bootstrap.addresses);
    operation.routesSaved = true;
  } catch (stateError) {
    return fail(err('ROUTE_FAILED', 'cannot snapshot routes'));
  }
  if (!self.isCurrentOperation(operation)) return fail(err('CANCELLED', 'connect cancelled'));
  try {
    this.writeConfig(config);
  } catch (writeError) {
    return fail(err('STORE_WRITE_FAILED', 'cannot write core config'));
  }
  if (!self.isCurrentOperation(operation)) return fail(err('CANCELLED', 'connect cancelled'));

  var startDone = function (startError) {
    var alive, routeState;
    if (!self.isCurrentOperation(operation)) return;
    if (startError) return fail(startError);
    alive = self.coresAlive(operation) && self.routes.tunExists();
    if (!alive) return fail(err('CORE_START_FAILED', 'core stopped before route install'));
    if (!self.isCurrentOperation(operation)) return;
    try {
      /* Use the snapshot validated by this exact connection generation.
         Persistence remains the crash-recovery source, but startup must not
         depend on a second filesystem read after the cores are running. */
      routeState = operation.routeState;
      self.routes.applyTunRoutes(routeState);
    } catch (routeError) {
      if (self.logger) self.logger.warn('route setup rejected', {
        detail: errors.isAlcyoneError(routeError) ? (routeError.detail || 'route failure') : 'route exception'
      });
      return fail(errors.isAlcyoneError(routeError)
        ? routeError
        : err('ROUTE_FAILED', 'route install failed'));
    }
    if (!self.isCurrentOperation(operation)) return;
    if (!self.routes.routeActive()) return fail(err('HEALTH_CHECK_FAILED', 'tunnel route not active'));
    if (!self.routes.directRoutesActive(routeState)) {
      return fail(err('HEALTH_CHECK_FAILED', 'direct routes not protected'));
    }
    if (!self.coresAlive(operation) || !self.routes.tunExists()) {
      return fail(err('CORE_START_FAILED', 'core stopped during route install'));
    }

    self.verifyDataPlane(operation, function (probeError, externalIp) {
      if (!self.isCurrentOperation(operation)) return;
      if (probeError) return fail(probeError);
      /* The final identity-aware liveness and route checks close the async
         probe window: neither a stale child nor a route change can satisfy a
         newer connection generation. */
      if (!self.coresAlive(operation) || !self.routes.tunExists()) {
        return fail(err('CORE_START_FAILED', 'core stopped during traffic verification'));
      }
      if (!self.routes.routeActive() || !self.routes.directRoutesActive(routeState)) {
        return fail(err('HEALTH_CHECK_FAILED', 'routes changed during traffic verification'));
      }
      self.dataPlaneVerified = true;
      self.verifiedExternalIp = externalIp;
      self.state = STATE.CONNECTED;
      self.connectedAt = Date.now();
      if (!self.coresAlive(operation)) {
        self.state = STATE.STARTING;
        self.dataPlaneVerified = false;
        self.verifiedExternalIp = '';
        return fail(err('CORE_START_FAILED', 'core stopped during connected transition'));
      }
      self.logger.info('vpn connected', { core: self.edition.core, dataPlaneVerified: true });
      self.startNetworkGuard();
      operation.finish(null, { state: self.state, profileId: profile.id });
    });
  };
  /* Keep deterministic in-memory test doubles written for the old two-argument
     helper usable; the production implementation always receives the token. */
  if (this.startCores.length < 3) this.startCores(cores, startDone);
  else this.startCores(cores, operation, startDone);
};

VpnManager.prototype.verifyDataPlane = function (operation, callback) {
  var self = this;
  var done = once(callback || function () {});
  if (typeof this.dataPlaneProbe !== 'function') {
    return done(err('HEALTH_CHECK_FAILED', 'traffic verification unavailable'));
  }
  try {
    this.dataPlaneProbe(function (probeError, address) {
      address = String(address || '').replace(/\s+/g, '');
      if (!self.isCurrentOperation(operation)) return;
      if (probeError || net.isIP(address) === 0) {
        return done(err('HEALTH_CHECK_FAILED', 'external traffic unavailable'));
      }
      done(null, address);
    });
  } catch (probeException) {
    done(err('HEALTH_CHECK_FAILED', 'external traffic verification failed'));
  }
};

VpnManager.prototype.coresAlive = function (operation) {
  var self = this;
  function alive(name) {
    var expected = operation && operation.entries[name];
    var current;
    if (expected && self.supervisor.entryFor) {
      current = self.supervisor.entryFor(name);
      if (current) return current === expected && !current.exited;
    }
    return self.supervisor.isRunning(name);
  }
  if (this.edition.core === 'sing-box') return alive('sing-box');
  return alive('xray') && alive('tun2socks');
};

/* Start the edition's cores and wait until the tunnel device is usable. */
VpnManager.prototype.startCores = function (cores, operation, callback) {
  var self = this;
  var completed = once(callback || function () {});

  function current() { return self.isCurrentOperation(operation); }
  function tunReady() { return current() && self.routes.tunExists(); }
  function wait(check, name, done) {
    var waiter;
    if (!current()) return;
    waiter = supervisorLib.waitFor(check, {
      timeout: 20000,
      isCurrent: current,
      isAlive: function () {
        return current() && self.supervisor.isRunning(name);
      }
    }, function (waitError) {
      if (!current()) return;
      done(waitError);
    });
    self.registerWaiter(operation, waiter);
  }
  function spawn(name, executable, args, options) {
    var entry;
    if (!current()) return false;
    entry = self.spawnLogged(name, executable, args, options, operation);
    operation.entries[name] = entry;
    operation.childStarted = true;
    return true;
  }
  function startTun2socks() {
    try {
      if (!spawn('tun2socks', cores.tun2socks, [
        '-tunName', routesLib.TUN_NAME,
        '-tunAddr', routesLib.TUN_IP,
        '-tunGw', routesLib.TUN_GW,
        '-tunMask', '255.255.255.252',
        '-proxyType', 'socks',
        '-proxyServer', '127.0.0.1:' + xrayConfig.SOCKS_PORT,
        '-udpTimeout', '2m',
        '-loglevel', 'warn'
      ])) return;
    } catch (tunSpawnError) {
      return completed(tunSpawnError);
    }
    wait(tunReady, 'tun2socks', completed);
  }
  function startXray(attempt) {
    var retryTimer;
    try {
      if (!spawn('xray', cores.xray, ['-config', self.paths.configFile], {
        env: {
          PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
          XRAY_LOCATION_ASSET: self.paths.dataDir + '/bin'
        }
      })) return;
    } catch (xraySpawnError) {
      return completed(xraySpawnError);
    }

    /* xray must be accepting SOCKS connections before tun2socks points at it.
       A bounded second launch handles the observed transient pre-readiness
       SIGABRT without changing limits or allowing duplicate children. */
    wait(function () { return current() && self.socksReady(); }, 'xray', function (socksError) {
      if (!current()) return;
      if (!socksError) return startTun2socks();
      self.diagnoseCoreFailure('xray', cores.xray, operation, function () {
        if (!current()) return;
        if (attempt >= XRAY_START_ATTEMPTS) {
          return completed(err('CORE_START_FAILED', 'proxy port did not open'));
        }
        if (self.logger) self.logger.warn('retrying xray after pre-readiness exit', { attempt: attempt + 1 });
        retryTimer = setTimeout(function () {
          retryTimer = null;
          if (current()) startXray(attempt + 1);
        }, XRAY_RETRY_DELAY_MS);
        self.registerWaiter(operation, {
          cancel: function () {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
          }
        });
      });
    });
  }

  if (this.edition.core === 'sing-box') {
    try {
      /* On the affected webOS Node runtime, attaching a pipe or file
         descriptor to sing-box stdout/stderr makes the native core abort
         before it creates TUN. Keep this limited to sing-box; XRay retains
         its bounded launch diagnostics. */
      if (!spawn('sing-box', cores.singbox, ['run', '-c', this.paths.configFile], {
        captureOutput: false
      })) return;
    } catch (spawnError) {
      return completed(spawnError);
    }
    return wait(function () { return tunReady() && self.socksReady(); }, 'sing-box', completed);
  }

  startXray(1);
};

/* Give each child its own descriptor and close the parent's copy immediately
   after spawn. The child keeps its dup; reconnects no longer leak FDs. */
VpnManager.prototype.spawnLogged = function (name, executable, args, spawnOptions, operation) {
  var fd = 'ignore';
  var entry;
  var env, key, captureOutput;
  spawnOptions = spawnOptions || {};
  captureOutput = spawnOptions.captureOutput !== false;
  if (operation && !this.isCurrentOperation(operation)) throw err('CANCELLED', 'connect cancelled');
  /* Final synchronous verification: no executable reaches spawn based only on
     the earlier staging verdict. */
  this.coreIntegrity.verifyForLaunch(executable, name);
  if (captureOutput) {
    try {
      loggerLib.capFile(this.paths.tunnelLog);
      fd = fs.openSync(this.paths.tunnelLog, 'a', atomic.FILE_MODE);
    } catch (e) {
      fd = 'ignore';
    }
  }
  /* Pin the defaults the supervisor would otherwise apply, so what is recorded
     below is exactly what execve receives rather than a guess at it. */
  env = {};
  for (key in CORE_ENV_BASE) if (Object.prototype.hasOwnProperty.call(CORE_ENV_BASE, key)) {
    env[key] = CORE_ENV_BASE[key];
  }
  for (key = 0; key < CORE_ENV_CLEAR_KEYS.length; key++) env[CORE_ENV_CLEAR_KEYS[key]] = '';
  if (spawnOptions.env) {
    for (key in spawnOptions.env) if (Object.prototype.hasOwnProperty.call(spawnOptions.env, key)) {
      env[key] = spawnOptions.env[key];
    }
  }
  /* The scrub must win over copied service variables supplied by a caller. */
  for (key = 0; key < CORE_ENV_CLEAR_KEYS.length; key++) env[CORE_ENV_CLEAR_KEYS[key]] = '';
  /* The empty value must win even if a caller supplies a copied service env. */
  env.LD_PRELOAD = '';
  spawnOptions.env = env;
  spawnOptions.cwd = spawnOptions.cwd || '/';
  /* The tunnel log is shared and append-only, so remembering its length here is
     what later lets diagnostics quote this launch's output and nobody else's. */
  this.launches[name] = {
    args: args,
    env: spawnOptions.env,
    cwd: spawnOptions.cwd,
    logOffset: this.tunnelLogSize()
  };
  try {
    spawnOptions.stdio = captureOutput ? fd : 'ignore';
    if (operation && !this.isCurrentOperation(operation)) throw err('CANCELLED', 'connect cancelled');
    entry = this.supervisor.start(name, executable, args, spawnOptions);
  } finally {
    if (typeof fd === 'number') {
      try { fs.closeSync(fd); } catch (closeError) {}
    }
  }
  this.startLogGuard();
  return entry;
};

VpnManager.prototype.tunnelLogSize = function () {
  try {
    return fs.statSync(this.paths.tunnelLog).size;
  } catch (e) {
    return 0;
  }
};

/* Keep only bounded facts from the real launch. Diagnostics never spawn a
   second copy of a core and never inspect endpoints or complete configs. */
VpnManager.prototype.diagnoseCoreFailure = function (name, stagedPath, operation, done) {
  var self = this;
  var launch = this.launches[name] || {};
  var entry = this.supervisor.entryFor(name);
  var facts = {
    pid: entry ? entry.pid : null,
    exitCode: entry ? entry.exitCode : null,
    exitSignal: entry ? entry.exitSignal : '',
    spawnErrorCode: entry ? entry.spawnErrorCode : ''
  };

  function collect() {
    if (!self.isCurrentOperation(operation)) return;
    try {
      coreDiagnostics.report(self.logger, {
        core: name,
        pid: facts.pid,
        exitCode: facts.exitCode,
        exitSignal: facts.exitSignal,
        spawnErrorCode: facts.spawnErrorCode,
        failureStage: 'core-readiness',
        coreOutputText: coreDiagnostics.readSince(self.paths.tunnelLog, launch.logOffset)
      });
    } catch (diagnosticError) {
      /* Diagnostics are subordinate to the lifecycle result. */
    }
    if (self.isCurrentOperation(operation)) done();
  }

  if (this.supervisor.isRunning(name)) return this.supervisor.stop(name, collect);
  collect();
};

VpnManager.prototype.startLogGuard = function () {
  var self = this;
  if (this.logCapTimer) return;
  this.logCapTimer = setInterval(function () {
    loggerLib.capFile(self.paths.tunnelLog);
  }, 30000);
  if (this.logCapTimer.unref) this.logCapTimer.unref();
};

VpnManager.prototype.stopLogGuard = function () {
  if (this.logCapTimer) {
    clearInterval(this.logCapTimer);
    this.logCapTimer = null;
  }
  loggerLib.capFile(this.paths.tunnelLog);
};

/* Keep a connected tunnel tied to the physical route captured before takeover.
   The interval is bounded and unref'ed, so it cannot keep shutdown or tests
   alive. */
VpnManager.prototype.startNetworkGuard = function () {
  var self = this;
  if (this.networkGuardTimer) return;
  this.networkGuardTimer = setInterval(function () {
    self.checkNetworkChange();
  }, NETWORK_GUARD_INTERVAL_MS);
  if (this.networkGuardTimer.unref) this.networkGuardTimer.unref();
};

VpnManager.prototype.stopNetworkGuard = function () {
  if (this.networkGuardTimer) {
    clearInterval(this.networkGuardTimer);
    this.networkGuardTimer = null;
  }
};

VpnManager.prototype.handleNetworkChange = function () {
  var self = this;
  if (this.state !== STATE.CONNECTED || this.cleanupInProgress) return false;
  this.state = STATE.STOPPING;
  this.dataPlaneVerified = false;
  this.verifiedExternalIp = '';
  this.lastError = { code: 'NETWORK_CHANGED', detail: '' };
  if (this.logger) this.logger.warn('physical network changed, restoring current network');
  this.cleanup(function () {
    if (self.logger) self.logger.info('vpn disconnected after physical network change');
  }, { preserveCurrentNetwork: true });
  return true;
};

VpnManager.prototype.checkNetworkChange = function () {
  var state, changed;
  if (this.state !== STATE.CONNECTED || this.cleanupInProgress) return false;
  try {
    state = this.routes.loadState();
    changed = this.routes.networkChanged(state);
    if (!changed && (!this.routes.routeActive() || !this.routes.directRoutesActive(state))) changed = true;
  } catch (e) {
    changed = true;
  }
  return changed ? this.handleNetworkChange() : false;
};

/* Check the loopback SOCKS port by reading the kernel's socket table. */
VpnManager.prototype.socksReady = function () {
  var hex = ('0000' + xrayConfig.SOCKS_PORT.toString(16).toUpperCase()).slice(-4);
  var files = ['/proc/net/tcp', '/proc/net/tcp6'];
  var i, content, lines, j, fields, local, address;
  for (i = 0; i < files.length; i++) {
    try {
      content = fs.readFileSync(files[i], 'utf8');
      lines = content.split('\n');
      for (j = 1; j < lines.length; j++) {
        fields = lines[j].trim().split(/\s+/);
        if (fields.length < 4 || fields[3] !== '0A') continue;
        local = fields[1].split(':');
        if (local.length !== 2 || local[1].toUpperCase() !== hex) continue;
        address = local[0].toUpperCase();
        if (i === 0 && address === '0100007F') return true;
        if (i === 1 && (address === '00000000000000000000000001000000' ||
            address === '00000000000000000000000000000001' ||
            address === '0000000000000000FFFF00000100007F')) return true;
      }
    } catch (e) {}
  }
  return false;
};

VpnManager.prototype.disconnect = function (callback) {
  var self = this;
  var operation = this.activeOperation;
  var cancelledStarting = false;
  callback = once(callback || function () {});

  if (this.state === STATE.STARTING && operation) {
    this.cancelOperation(operation, err('CANCELLED', 'connect cancelled'));
    this.state = STATE.STOPPING;
    cancelledStarting = true;
  }
  if (this.state === STATE.IDLE) {
    /* Still roll back: a previous process may have left routes behind. */
    return this.cleanup(function () {
      callback(null, { state: STATE.IDLE });
    });
  }
  if (this.state === STATE.STOPPING && !cancelledStarting) return callback(err('BUSY', 'stopping'));
  this.state = STATE.STOPPING;
  this.cleanup(function () {
    self.logger.info('vpn disconnected');
    callback(null, { state: STATE.IDLE });
  });
};

/* Recover after an unclean service restart: if we are not connected but a
   stale tunnel or route state exists, clean it up. Idempotent by design. */
VpnManager.prototype.recover = function () {
  var state = this.routes.loadState();
  var status = this.lock.status();
  if (this.state === STATE.CONNECTED) return false;
  if (!state && !(status.held && status.mine)) return false;
  this.logger.info('recovering stale tunnel state after restart');
  this.routes.rollback();
  this.lock.release();
  return true;
};

VpnManager.prototype.status = function () {
  var lockStatus = this.lock.status();
  var connected = this.state === STATE.CONNECTED && this.dataPlaneVerified;
  return {
    state: this.state,
    connected: connected,
    dataPlaneVerified: connected,
    connectedAt: this.connectedAt,
    profileId: connected ? this.activeProfileId : '',
    core: this.edition.core,
    processes: this.supervisor.status(),
    tunnelOwner: lockStatus.held ? lockStatus.edition : '',
    ownsTunnel: !!lockStatus.mine,
    lastErrorCode: (this.lastError && this.lastError.code) || '',
    routes: this.routes.diagnostics()
  };
};

module.exports = {
  STATE: STATE,
  XRAY_START_ATTEMPTS: XRAY_START_ATTEMPTS,
  XRAY_RETRY_DELAY_MS: XRAY_RETRY_DELAY_MS,
  NETWORK_GUARD_INTERVAL_MS: NETWORK_GUARD_INTERVAL_MS,
  VpnManager: VpnManager
};
