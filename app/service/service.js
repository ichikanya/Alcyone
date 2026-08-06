'use strict';

/* Alcyone Luna service entry point.

   Responsibilities: build the object graph, run idempotent startup
   initialization, register Luna methods, and clean up on shutdown.

   Root privileges are required and are granted by the Homebrew Channel's
   elevate-service mechanism, not by anything this service does. Root is needed
   for exactly two reasons: creating/configuring the tun0 device, and editing
   the kernel routing table. Everything else (profile storage, subscription
   downloads, the LAN importer) would run unprivileged, but webOS gives a
   service a single identity, so the whole service runs elevated and is written
   defensively for that reason.

   Written to ES5 for the Node runtime on webOS 4. */

var path = require('path');
var os = require('os');

var editionLib = require('./lib/edition');
var loggerLib = require('./lib/logger');
var storeLib = require('./lib/store/profiles');
var pairingLib = require('./lib/pairing');
var lockLib = require('./lib/tunnel-lock');
var vpnLib = require('./lib/vpn/manager');
var serverLib = require('./lib/web/server');
var migrateLib = require('./lib/migrate');
var autostartLib = require('./lib/autostart');
var diagnosticsLib = require('./lib/diagnostics');
var apiLib = require('./lib/api');
var errors = require('./lib/errors');
var DeviceInfo = require('./lib/device-info');

var edition = editionLib.load(__dirname);
/* Services and applications are sibling trees under usr/palm. */
var appDir = path.resolve(__dirname, '..', '..', 'applications', edition.appId);
var paths = editionLib.paths(edition, appDir);

var runId = loggerLib.newRunId ? loggerLib.newRunId() : '';
var logger = new loggerLib.Logger({ file: paths.serviceLog, runId: runId, source: 'service' });
var tunnelLogger = new loggerLib.Logger({ file: paths.tunnelLog, runId: logger.runId, source: 'core' });
var store = new storeLib.ProfileStore({ file: paths.storeFile, logger: logger });
var pairing = new pairingLib.PairingManager({ logger: logger });
var lock = new lockLib.TunnelLock({ edition: edition.id, serviceId: edition.serviceId, logger: logger });
var autostart = new autostartLib.Autostart({ edition: edition, logger: logger });
var diagnostics = new diagnosticsLib.Diagnostics({ store: store, edition: edition, logger: logger });
var vpn = new vpnLib.VpnManager({
  edition: edition,
  store: store,
  logger: logger,
  lock: lock,
  paths: paths,
  dataPlaneProbe: function (callback) { diagnostics.externalIp(callback); }
});
var deviceInfo = new DeviceInfo({ logger: logger });

function localAddresses() {
  var interfaces = os.networkInterfaces();
  var out = [];
  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (address) {
      if (address.family === 'IPv4' && !address.internal) out.push(address.address);
    });
  });
  return out;
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
  localAddresses: localAddresses
};

var api = new apiLib.Api(context);

/* The importer delegates every mutation back through the same validated API,
   so the LAN surface can never do more than the TV UI can. */
var importer = new serverLib.ImporterServer({
  pairing: pairing,
  store: store,
  logger: logger,
  port: edition.webPort,
  handlers: {
    importValue: function (value, name, compatMode, cb) {
      if (typeof compatMode === 'function') { cb = compatMode; compatMode = true; }
      api.importValue(value, name, compatMode, cb);
    },
    updateSubscriptions: function (id, cb) { api.updateSubscriptions(id ? { subscriptionId: id } : {}, cb); },
    deleteSubscription: function (id, cb) { api.deleteSubscription({ subscriptionId: id }, cb); },
    deleteProfile: function (id, cb) { api.deleteProfile({ profileId: id }, cb); },
    setActive: function (id, cb) { api.selectProfile({ profileId: id }, cb); }
  }
});
context.importer = importer;

/* Startup: idempotent initialization, then recover any stale tunnel state left
   by a crash or an unclean shutdown. */
function startup() {
  var migrator = new migrateLib.Migrator({ paths: paths, edition: edition, logger: logger });
  try {
    migrator.run();
  } catch (migrationError) {
    logger.error('startup migration failed', { detail: migrationError.code || 'error' });
  }
  try {
    autostart.repairLegacy();
  } catch (autostartError) {
    logger.error('autostart migration failed', { detail: autostartError.code || 'error' });
  }
  try {
    vpn.recover();
  } catch (recoveryError) {
    logger.error('startup recovery failed', { detail: recoveryError.code || 'error' });
  }
  /* The importer starts on loopback only. LAN exposure requires the user to
     start a pairing window from the TV. */
  importer.listen(false, function () {});
  tunnelLogger.info('core log started', { edition: edition.id, version: edition.version });
  logger.info('service started', { edition: edition.id, version: edition.version });
}

/* Shutdown: stop children, restore routes, release the tunnel lock. */
var shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('service stopping', { reason: reason });
  pairing.disable();
  importer.close(function () {
    vpn.disconnect(function () {
      try { lock.release(); } catch (e) {}
      process.exit(0);
    });
  });
  /* Never hang the platform's shutdown sequence. */
  setTimeout(function () { process.exit(0); }, 5000);
}

/* Restart on request.

   Homebrew's elevate-service rewrites this service's LS2 configuration but
   never restarts it, so a running jailed process keeps its old identity until
   it exits. Deferring the shutdown by a short delay lets the Luna response
   reach the caller first; the platform then relaunches the service on the next
   call with the rewritten configuration in effect.

   No process is killed by name and no shell is involved: this is the ordinary
   shutdown path.

   Idempotent on purpose. The Grant-permissions flow polls getState while the
   service is going down, and a user can press the button twice; scheduling a
   second shutdown must not double-run the disconnect path. `shutdown()` is
   already guarded, and the pending flag keeps a repeat call from even
   queueing. */
var restartPending = false;
function requestRestart(reason) {
  if (restartPending) return true;
  restartPending = true;
  setTimeout(function () { shutdown(reason || 'restartService'); }, 250);
  return true;
}
context.requestRestart = requestRestart;

/* --- Luna registration --- */

var METHODS = {
  getState: 'getState',
  getProfiles: 'getProfiles',
  getProfilesMeta: 'getProfilesMeta',
  selectProfile: 'selectProfile',
  deleteProfile: 'deleteProfile',
  importLink: 'importLink',
  addSubscription: 'addSubscription',
  updateSubscriptions: 'updateSubscriptions',
  deleteSubscription: 'deleteSubscription',
  connect: 'connect',
  disconnect: 'disconnect',
  restart: 'restart',
  autostart: 'autostartTrigger',
  probeProfiles: 'probeProfiles',
  checkExternalIp: 'checkExternalIp',
  getLogs: 'getLogs',
  clearLogs: 'clearLogs',
  setAutostart: 'setAutostart',
  setLanguage: 'setLanguage',
  startPairing: 'startPairing',
  stopPairing: 'stopPairing',
  restartService: 'restartService'
};

function respond(message, error, result) {
  var payload;
  if (error) {
    payload = errors.toResult(error);
    logger.warn('method failed', { method: message.method || '', code: payload.errorCode });
  } else {
    payload = result || {};
    payload.returnValue = true;
    payload.ok = true;
  }
  try {
    message.respond(payload);
  } catch (e) {
    logger.error('respond failed');
  }
}

function callerAllowed(message) {
  /* message.sender is the applicationID or service busID according to the
     webos-service contract. Never trust a caller-supplied payload field. */
  return !!message && String(message.sender || '') === edition.appId;
}

function register(service) {
  Object.keys(METHODS).forEach(function (name) {
    var handlerName = METHODS[name];
    service.register(name, function (message) {
      var payload = (message && message.payload) || {};
      if (!callerAllowed(message)) {
        logger.warn('unauthorized luna caller rejected', { method: name });
        return respond(message, errors.err('UNAUTHORIZED', 'caller not allowed'));
      }
      try {
        api[handlerName](payload, function (error, result) {
          respond(message, error, result);
        });
      } catch (e) {
        respond(message, errors.isAlcyoneError(e) ? e : errors.err('INTERNAL', ''));
      }
    });
  });
}

/* Keep the process resident.

   webos-service exits an idle JS service after five seconds unless it holds an
   ActivityManager activity or was launched by `run-js-service -k`. Alcyone is a
   supervisor: it owns the tunnel, the core processes and the LAN importer, so
   the process must outlive the request that woke it.

   Neither escape hatch is reliably available. The LS2 service file is generated
   by the installer, not shipped by us, and Homebrew's elevate-service rewrites
   only the jail wrapper — it never adds -k. Creating an activity needs outbound
   permission to com.webos.service.activitymanager, which the service does not
   have before elevation. On webOS 4.4.3 that combination makes the process exit
   five seconds after every launch, taking the importer's listening socket and
   the core supervisor down with it.

   --disable-timeouts is exactly the switch -k sets. ActivityManager reads it
   from argv when it is constructed inside the Service constructor, so it has to
   be in place before that happens. */
function keepResident() {
  if (process.argv.indexOf('--disable-timeouts') === -1) {
    process.argv.push('--disable-timeouts');
  }
}

function main() {
  var Service, service;
  try {
    Service = require('webos-service');
  } catch (e) {
    /* Outside webOS (tests, local runs) there is no bus; stay alive so the
       loopback importer and startup logic can still be exercised. */
    startup();
    logger.warn('webos-service unavailable, running without the Luna bus');
    return;
  }
  keepResident();
  /* Register immediately.  First-run migration copies large ARM binaries and
     must not delay the service name/method registration on low-powered TVs. */
  service = new Service(edition.serviceId);
  deviceInfo.service = service;
  register(service);
  logger.info('luna methods registered', { count: Object.keys(METHODS).length });
  startup();
  /* An activity is the platform's preferred residency signal, so still take one
     when the permission exists. Failure is expected before elevation and must
     not matter: --disable-timeouts already keeps the process alive. */
  if (service.activityManager && service.activityManager.create) {
    service.activityManager.create('alcyone-vpn-supervisor', function () {});
  }
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });
/* A crash here is the difference between a working TV and a dead one, and the
   log is the only way to see it: stdout goes to pmlog under the platform
   launcher and is not kept. `code` is undefined for ordinary errors, so
   recording only that reduced every startup failure to "detail=error". Log the
   name and message too — logger.scrubValue strips URIs and UUIDs and caps the
   length, so no stored secret can reach the file. */
process.on('uncaughtException', function (e) {
  logger.error('uncaught exception', {
    detail: (e && e.code) || (e && e.name) || 'error',
    reason: (e && e.message) || ''
  });
  shutdown('uncaughtException');
});

/* Platform entry point.

   webOS never runs this file as the main module. run-js-service hands the
   service directory to jsservicelauncher's bootstrap-node.js, which does

     var mod = require(service_dir);
     if (mod.run) { mod.run(name); }

   resolving package.json's "main". Two consequences, both verified on webOS
   4.4.3:

   1. `require.main === module` is false on a TV, so that guard alone leaves the
      module loaded but never started — no Luna methods, no importer, no log
      file, and every call from the app times out.

   2. `name` is an undeclared identifier in bootstrap-node.js. The argument is
      evaluated before the call, so exporting `run` at all makes the launcher
      throw `ReferenceError: name is not defined` and the service dies during
      startup. Exporting a run() is therefore a trap, not a fix.

   So: start from module load, which is the hook the launcher actually gives us,
   and export no `run`. The platform has already called palmbus.setAppId() and
   pushed the role by this point, so this is the correct moment. Tests require
   this module for its exports and must not start a service, hence the explicit
   launcher check rather than an unconditional call. */
var started = false;
function run() {
  if (started) return;
  started = true;
  main();
}

function launchedByPlatform() {
  /* process.mainModule rather than require.main: they are the same object, but
     require.main is a per-module snapshot, so only this one can be substituted
     in a test. */
  var main = process.mainModule;
  var entry = (main && main.filename) ? String(main.filename) : '';
  return entry.indexOf('bootstrap-node') >= 0 || entry.indexOf('jsservicelauncher') >= 0;
}

if (require.main === module || launchedByPlatform()) run();

module.exports = {
  context: context,
  api: api,
  importer: importer,
  METHODS: METHODS,
  startup: startup,
  shutdown: shutdown,
  register: register,
  callerAllowed: callerAllowed,
  keepResident: keepResident,
  launchedByPlatform: launchedByPlatform
  /* Deliberately no `run` export: see the launcher note above. */
};
