'use strict';

/* Regressions that only appeared on TVs or across asynchronous boundaries. */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var dns = require('dns');

var ROOT = path.join(__dirname, '..');
var serverLib = require(path.join(ROOT, 'app', 'service', 'lib', 'web', 'server.js'));
var pairingLib = require(path.join(ROOT, 'app', 'service', 'lib', 'pairing.js'));
var subscriptions = require(path.join(ROOT, 'app', 'service', 'lib', 'net', 'subscriptions.js'));
var httpClient = require(path.join(ROOT, 'app', 'service', 'lib', 'net', 'http-client.js'));
var dnsResolver = require(path.join(ROOT, 'app', 'service', 'lib', 'net', 'dns-resolver.js'));
var autostartLib = require(path.join(ROOT, 'app', 'service', 'lib', 'autostart.js'));
var migrateLib = require(path.join(ROOT, 'app', 'service', 'lib', 'migrate.js'));
var editionLib = require(path.join(ROOT, 'app', 'service', 'lib', 'edition.js'));
var loggerLib = require(path.join(ROOT, 'app', 'service', 'lib', 'logger.js'));
var serviceLib = require(path.join(ROOT, 'app', 'service', 'service.js'));

var results = [];
function record(name, ok, detail) {
  results.push(!!ok);
  console.log((ok ? 'ok   - ' : 'FAIL - ') + name + (detail ? ' (' + detail + ')' : ''));
}

var quietLogger = { info: function () {}, warn: function () {}, error: function () {} };

function testDns(next) {
  var r4 = dns.resolve4;
  var r6 = dns.resolve6;
  dns.resolve4 = function (host, cb) {
    process.nextTick(function () { cb(null, ['93.184.216.34']); });
  };
  dns.resolve6 = function (host, cb) {
    var error = new Error('no AAAA');
    process.nextTick(function () { cb(error); });
  };
  dnsResolver.resolveAll('node012.test', function (error, addresses) {
    dns.resolve4 = r4;
    dns.resolve6 = r6;
    record('Node 0.12-compatible DNS returns address objects',
      !error && addresses.length === 1 && addresses[0].family === 4 &&
      addresses[0].address === '93.184.216.34');
    next();
  });
}

function testNestedFailure(next) {
  var originalFetch = httpClient.fetchUrl;
  var calls = 0;
  var callbackCount = 0;
  httpClient.fetchUrl = function (url, options, cb) {
    calls++;
    setImmediate(function () {
      if (url.indexOf('/1') >= 0) cb(new Error('failed'));
      else cb(null, 'dmxlc3M6Ly8xMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTV9hLmV4YW1wbGU6NDQz');
    });
  };
  subscriptions.expandNested(
    'https://example.com/1\nhttps://example.com/2\nhttps://example.com/3\n' +
    'https://example.com/4\nhttps://example.com/5',
    { headers: {}, deadline: Date.now() + 1000 },
    function (error) {
      callbackCount++;
      httpClient.fetchUrl = originalFetch;
      record('nested subscription failure completes instead of deadlocking',
        !!error && callbackCount === 1 && calls === 4);
      next();
    }
  );
}

function testAutostart(next) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-autostart-'));
  var edition = {
    appId: 'com.alcyone.vpn',
    serviceId: 'com.alcyone.vpn.service',
    autostartName: 'alcyone-vpn'
  };
  var hook = path.join(dir, edition.autostartName);
  fs.writeFileSync(hook, '#!/bin/sh\nold-controller start\n');
  var autostart = new autostartLib.Autostart({ edition: edition, logger: quietLogger, initDir: dir });
  record('legacy autostart hook is not reported as current', autostart.isEnabled() === false);
  record('legacy enabled hook is repaired', autostart.repairLegacy() === true && autostart.isEnabled());
  record('autostart identifies the app on Luna',
    fs.readFileSync(hook, 'utf8').indexOf('luna-send -a com.alcyone.vpn') >= 0);
  next();
}

function testLunaAuthorization(next) {
  var methods = {};
  var rejected = null;
  serviceLib.register({
    register: function (name, handler) { methods[name] = handler; }
  });
  methods.connect({
    sender: 'com.attacker.app',
    payload: {},
    method: 'connect',
    respond: function (payload) { rejected = payload; }
  });
  record('own TV app is accepted as Luna caller',
    serviceLib.callerAllowed({ sender: 'com.alcyone.vpn' }) === true);
  record('another installed app is rejected as Luna caller',
    serviceLib.callerAllowed({ sender: 'com.attacker.app' }) === false);
  record('payload cannot spoof the Luna sender',
    serviceLib.callerAllowed({ sender: '', payload: { $sender: 'com.alcyone.vpn' } }) === false);
  record('registered Luna method rejects before invoking the VPN API',
    rejected && rejected.returnValue === false && rejected.errorCode === 'UNAUTHORIZED');
  next();
}

function testEditionAndEarlyLogs(next) {
  var editionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-edition-'));
  fs.writeFileSync(path.join(editionDir, 'edition.json'), JSON.stringify({
    id: 'sing-box',
    appId: 'com.alcyone.vpn.singbox',
    serviceId: 'com.alcyone.vpn.singbox.service',
    dataDir: '/var/lib/alcyone-singbox'
  }));
  var loaded = editionLib.load(editionDir);
  record('service loads generated sing-box identity from its own directory',
    loaded.id === 'sing-box' &&
    loaded.appId === 'com.alcyone.vpn.singbox' &&
    loaded.serviceId === 'com.alcyone.vpn.singbox.service');

  var blockedParent = path.join(editionDir, 'not-a-directory');
  fs.writeFileSync(blockedParent, 'file');
  var earlyLogger = new loggerLib.Logger({ file: path.join(blockedParent, 'service.log') });
  earlyLogger.error('early startup marker');
  record('startup diagnostics remain readable when the log directory is unavailable',
    earlyLogger.tail(20).indexOf('early startup marker') >= 0);
  next();
}

function testLegacyRoutes(next) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-legacy-route-'));
  var routeFile = path.join(dir, 'route.state');
  fs.writeFileSync(routeFile,
    "ORIG_GW='192.168.1.1'\nORIG_DEV='wlan0'\n" +
    "SERVER_IP='93.184.216.34'\nSERVER_IPS='93.184.216.34 203.0.113.10'\n");
  var migrator = new migrateLib.Migrator({
    paths: { dataDir: dir, appDir: dir, routeState: routeFile },
    edition: { core: 'xray' },
    logger: quietLogger
  });
  var converted = migrator.migrateLegacyRouteState();
  var state = JSON.parse(fs.readFileSync(routeFile, 'utf8'));
  record('legacy route state is converted before old PID files are removed',
    converted && state.original.gateway === '192.168.1.1' &&
    state.original.device === 'wlan0' && state.serverAddresses.length === 2);
  next();
}

function testServer(next) {
  var pairing = new pairingLib.PairingManager();
  var importer = new serverLib.ImporterServer({
    pairing: pairing,
    store: { sanitizedProfiles: function () { return []; }, sanitizedSubscriptions: function () { return []; } },
    handlers: {},
    logger: quietLogger,
    port: 0
  });
  var callbacks = 0;
  importer.listen(false, function (firstError) {
    if (firstError) {
      record('importer starts on loopback', false, firstError.code || 'error');
      return next();
    }
    pairing.enable();
    importer.listen(true, function (lanError) {
      callbacks++;
      setTimeout(function () {
        var lanOk = !lanError && callbacks === 1 && importer.boundHost === '0.0.0.0' &&
          importer.server && importer.server.address();
        record('loopback-to-LAN switch has one callback and one tracked server', lanOk,
          lanError ? lanError.code : String(callbacks));
        importer.close(function () { next(); });
      }, 400);
    });
  });
}

/* The core processes keep an appending descriptor on the tunnel log. Capping
   or clearing it must reuse the same inode, or every later core write lands in
   an unlinked file and tunnel logging dies until the next reconnect. */
function testLogInodeStability() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-loginode-'));
  var capped = path.join(dir, 'cap.log');
  var cleared = path.join(dir, 'clear.log');
  var big = '', i, before, after, childFd, logger;

  for (i = 0; i < 9000; i++) big += 'core line ' + i + ' padding padding padding\n';
  fs.writeFileSync(capped, big);
  before = fs.statSync(capped).ino;
  record('capFile trims a log past the cap', loggerLib.capFile(capped) === true);
  after = fs.statSync(capped).ino;
  record('capFile keeps the same inode', before === after);
  record('capFile actually shrank the file', fs.statSync(capped).size < big.length);

  /* Stand in for a running core holding an append descriptor. */
  childFd = fs.openSync(capped, 'a');
  fs.writeSync(childFd, new Buffer('POST-CAP\n', 'utf8'));
  fs.closeSync(childFd);
  record('core output after a cap still reaches the log',
    fs.readFileSync(capped, 'utf8').indexOf('POST-CAP') >= 0);

  fs.writeFileSync(cleared, 'previous tunnel output\n');
  logger = new loggerLib.Logger({ file: cleared });
  before = fs.statSync(cleared).ino;
  record('clear() reports success', logger.clear() === true);
  record('clear() empties the file', fs.statSync(cleared).size === 0);
  record('clear() keeps the same inode', before === fs.statSync(cleared).ino);
  childFd = fs.openSync(cleared, 'a');
  fs.writeSync(childFd, new Buffer('POST-CLEAR\n', 'utf8'));
  fs.closeSync(childFd);
  record('core output after clear() still reaches the log',
    logger.tail(50).indexOf('POST-CLEAR') >= 0);

  record('clear() on a missing file is not an error',
    new loggerLib.Logger({ file: path.join(dir, 'absent.log') }).clear() === true);

  /* Service and core views share one ephemeral run id. This marks the current
     process lifetime while leaving retained historical lines intact. */
  var serviceRunLogger = new loggerLib.Logger({ file: path.join(dir, 'run.log'), runId: 'abcdef123456', source: 'service' });
  var coreRunLogger = new loggerLib.Logger({ file: path.join(dir, 'core-run.log'), runId: serviceRunLogger.runId, source: 'core' });
  serviceRunLogger.info('current service event');
  coreRunLogger.info('current core event');
  record('service and core logs share a validated run id',
    serviceRunLogger.runId === 'abcdef123456' && coreRunLogger.runId === serviceRunLogger.runId);
  record('log lines identify source and current run',
    /run=abcdef123456 source=service current service event/.test(serviceRunLogger.tail(10)) &&
    /run=abcdef123456 source=core current core event/.test(coreRunLogger.tail(10)));
  record('fresh logger run ids are ephemeral and bounded',
    /^[0-9a-f]{12}$/.test(new loggerLib.Logger({}).runId));
}

/* The importer page drives every mutation over XHR. connect-src falls back to
   default-src, so omitting it from the policy blocks the page's own API calls. */
function testImporterCsp() {
  var csp = serverLib.securityHeaders()['Content-Security-Policy'];
  record('CSP allows same-origin XHR from the importer page', csp.indexOf("connect-src 'self'") >= 0, csp);
  record('CSP still denies everything by default', csp.indexOf("default-src 'none'") >= 0);
  record('CSP grants no wildcard connect source', csp.indexOf('connect-src *') < 0);
}

/* webos-service exits an idle JS service after five seconds unless argv carries
   --disable-timeouts. Verified on webOS 4.4.3: without it the process dies five
   seconds after launch, taking the importer socket and core supervisor with it. */
function testResidency() {
  var had = process.argv.indexOf('--disable-timeouts') !== -1;
  var removed = null;
  if (had) removed = process.argv.splice(process.argv.indexOf('--disable-timeouts'), 1);
  serviceLib.keepResident();
  record('service marks itself long-running before the bus is constructed',
    process.argv.indexOf('--disable-timeouts') !== -1);
  serviceLib.keepResident();
  record('residency flag is not duplicated on repeat calls',
    process.argv.filter(function (a) { return a === '--disable-timeouts'; }).length === 1);
  if (!had && removed === null) {
    process.argv.splice(process.argv.indexOf('--disable-timeouts'), 1);
  }
}

/* startup() binds loopback asynchronously; a startPairing() arriving before that
   bind settles used to rebind the same port and fail with EADDRINUSE. */
function testOverlappingListen(next) {
  var importer = new serverLib.ImporterServer({
    pairing: new pairingLib.PairingManager(),
    store: { sanitizedProfiles: function () { return []; }, sanitizedSubscriptions: function () { return []; } },
    handlers: {}, logger: quietLogger, port: 0
  });
  var loopbackError = null, lanError = null, done = 0, settled = false;
  /* Without serialization one callback never fires, so bound the wait rather
     than letting the suite hang. */
  var guard = setTimeout(function () { finish(true); }, 5000);
  function finish(timedOut) {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    record('overlapping loopback and LAN binds both succeed',
      !timedOut && !loopbackError && !lanError,
      timedOut ? 'timed out: ' + done + '/2 callbacks' : (loopbackError || lanError || {}).code || '');
    record('importer ends up on the last requested scope', importer.boundHost === '0.0.0.0',
      importer.boundHost || 'unbound');
    importer.close(function () { next(); });
  }
  function both() {
    if (++done < 2) return;
    finish(false);
  }
  /* Same tick: exactly the startup() / startPairing() collision seen on the TV. */
  importer.listen(false, function (e) { loopbackError = e; both(); });
  importer.pairing.enable();
  importer.listen(true, function (e) { lanError = e; both(); });
}

/* The platform launcher decides how the service starts, and both halves of its
   contract are load-bearing. jsservicelauncher/bootstrap-node.js does:

     var mod = require(service_dir);
     if (mod.run) { mod.run(name); }

   `require.main` is bootstrap-node, never this module, so a
   `require.main === module` guard alone never starts the service. And `name` is
   an undeclared identifier in that file, so exporting `run` makes the launcher
   throw ReferenceError before our code is reached. Verified on webOS 4.4.3. */
function testPlatformEntryPoint() {
  var pkg = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'app', 'service', 'package.json'), 'utf8'));
  record('package.json main resolves to the service entry file',
    pkg.main === 'service.js');

  record('service exports no run(): bootstrap-node would call it with an ' +
    'undeclared `name` and throw', serviceLib.run === undefined);

  record('service exposes the launcher check it starts from',
    typeof serviceLib.launchedByPlatform === 'function');

  /* Requiring the module from a test must not start a service. */
  record('requiring the service from a test does not self-start',
    serviceLib.launchedByPlatform() === false,
    String(process.mainModule && process.mainModule.filename));

  /* Simulate the platform: the main module is jsservicelauncher's bootstrap. */
  var realMain = process.mainModule;
  try {
    process.mainModule = { filename: '/usr/palm/services/jsservicelauncher/bootstrap-node.js' };
    record('the platform launcher is recognized as a start trigger',
      serviceLib.launchedByPlatform() === true);
  } finally {
    process.mainModule = realMain;
  }

  /* A crash during startup must leave something diagnosable in the log: the
     launcher sends stdout to pmlog, which is not retained. */
  var source = fs.readFileSync(path.join(ROOT, 'app', 'service', 'service.js'), 'utf8');
  record('uncaught exceptions record a reason, not just "error"',
    /uncaught exception[\s\S]{0,200}reason:/.test(source));
}

testLogInodeStability();
testImporterCsp();
testResidency();
testPlatformEntryPoint();

testDns(function () {
  testNestedFailure(function () {
    testAutostart(function () {
      testLunaAuthorization(function () {
        testEditionAndEarlyLogs(function () {
          testLegacyRoutes(function () {
            testServer(function () {
              testOverlappingListen(function () {
                var passed = results.filter(Boolean).length;
                console.log('\n' + passed + '/' + results.length + ' checks passed');
                if (passed !== results.length) process.exit(1);
              });
            });
          });
        });
      });
    });
  });
});
