'use strict';

/* Focused production lifecycle regressions. These tests use only in-memory
   children, routes and endpoint callbacks; no TV, build or install is needed. */

var assert = require('assert');
var events = require('events');
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');
var supervisorLib = require('../app/service/lib/supervisor');
var vpnLib = require('../app/service/lib/vpn/manager');
var lockLib = require('../app/service/lib/tunnel-lock');
var storeLib = require('../app/service/lib/store/profiles');
var errors = require('../app/service/lib/errors');
var xrayConfig = require('../app/service/lib/config/xray');
var diagnostics = require('../app/service/lib/vpn/core-diagnostics-lite');

var passed = 0;
function check(name, condition, detail) {
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''));
  passed++;
  console.log('ok   - ' + name);
}
function later(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function fakeChild(pid) {
  var child = new events.EventEmitter();
  child.pid = pid;
  child.kills = [];
  child.kill = function (signal) { child.kills.push(signal); };
  return child;
}

async function supervisorIdentityTests() {
  var originalSpawn = childProcess.spawn;
  var children = [];
  var exits = [];
  var supervisor = new supervisorLib.Supervisor({
    stopGraceMs: 5,
    onExit: function (name, code, signal) { exits.push([name, code, signal]); }
  });
  var ignoredOptions;
  childProcess.spawn = function () {
    if (arguments[2] && arguments[2].stdio === 'ignore') ignoredOptions = arguments[2];
    var child = fakeChild(7000 + children.length);
    children.push(child);
    return child;
  };
  try {
    var a = supervisor.start('xray', process.execPath, []);
    children[0].emit('exit', 1, 'SIGTERM');
    var b = supervisor.start('xray', process.execPath, []);
    children[0].emit('exit', 9, 'SIGKILL');
    check('late exit from child A cannot affect child B', supervisor.entryFor('xray') === b && !b.exited && exits.length === 1);

    children[0].emit('error', { code: 'ENOENT' });
    check('late spawn error from child A cannot affect child B', !b.exited && exits.length === 1);

    var stopDone = false;
    supervisor.stop('xray', function () { stopDone = true; });
    await later(15);
    var c = supervisor.start('xray', process.execPath, []);
    children[1].emit('error', { code: 'EIO' });
    children[1].emit('exit', 12, null);
    check('force-stop timeout followed by restart keeps generations separate',
      stopDone && supervisor.entryFor('xray') === c && !c.exited && exits.length === 1);
    check('supervisor has no stale entry after the replacement exits', supervisor.count() === 1 && supervisor.entryFor('xray') === c);
    children[2].emit('exit', 0, null);
    check('replacement exit is still delivered exactly once', exits.length === 2 && supervisor.entryFor('xray').exited);
    var ignoredSupervisor = new supervisorLib.Supervisor({ maxProcesses: 1 });
    var ignoredChild = ignoredSupervisor.start('sing-box', process.execPath, [], { stdio: 'ignore' });
    check('supervisor preserves the native single ignore stdio mode', ignoredChild && ignoredOptions && ignoredOptions.stdio === 'ignore');
  } finally {
    childProcess.spawn = originalSpawn;
  }
}

function makeManager(options) {
  options = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-race-'));
  var store = new storeLib.ProfileStore({ file: path.join(dir, 'profiles.json') });
  store.upsertManualProfile('vless://11111111-2222-3333-4444-555555555555@edge.example.com:443?security=tls&type=ws#Edge', 'Edge');
  var manager = new vpnLib.VpnManager({
    edition: { core: 'xray', id: 'xray' },
    store: store,
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    lock: new lockLib.TunnelLock({ edition: 'xray', lockFile: path.join(dir, 'tunnel.lock') }),
    coreIntegrity: { prepare: function (a, b) { return b; }, verifyForLaunch: function () {} },
    dataPlaneProbe: function (callback) { callback(null, '203.0.113.88'); },
    paths: {
      appDir: dir, dataDir: dir, configFile: path.join(dir, 'config.json'),
      routeState: path.join(dir, 'route.state'), tunnelLog: path.join(dir, 'tunnel.log')
    }
  });
  var state = { original: { device: 'wlan0' }, serverAddresses: ['93.184.216.34'] };
  var metrics = { config: 0, routes: 0, rollback: 0, save: 0, spawn: 0, callbacks: 0, cancels: 0, socks: 0 };
  var resolvers = [];
  var bootstrap = { entries: [{ host: 'edge.example.com', literal: false, addresses: ['93.184.216.34'], targets: [{ port: 443, network: 'tcp' }] }], addresses: ['93.184.216.34'], map: { 'edge.example.com': ['93.184.216.34'] } };
  manager.checkHealth = function () { return null; };
  manager.resolveCores = function () { return { xray: '/fake/xray', tun2socks: '/fake/tun2socks' }; };
  manager.resolveEndpoints = function (profile, callback) {
    resolvers.push(callback);
    return { cancel: function () { metrics.cancels++; } };
  };
  manager.routes.saveState = function () { metrics.save++; this.state = state; return state; };
  manager.routes.loadState = function () { return this.state || state; };
  manager.routes.applyTunRoutes = function () { metrics.routes++; };
  manager.routes.routeActive = function () { return true; };
  manager.routes.directRoutesActive = function () { return true; };
  manager.routes.tunExists = function () { return true; };
  manager.routes.rollback = function () { metrics.rollback++; this.state = null; };
  manager.routes.diagnostics = function () { return {}; };
  manager.writeConfig = function () { metrics.config++; };
  manager.spawnLogged = function (name) {
    var entry = { name: name, generation: ++metrics.spawn, pid: 8000 + metrics.spawn, exited: false };
    if (name === 'xray' && options.failFirstXray && !metrics.failedFirstXray) {
      metrics.failedFirstXray = true;
      entry.exited = true;
      entry.exitSignal = 'SIGABRT';
    }
    this.supervisor.children[name] = entry;
    return entry;
  };
  manager.supervisor.stopAll = function (callback) {
    var name;
    for (name in this.children) if (Object.prototype.hasOwnProperty.call(this.children, name)) this.children[name].exited = true;
    this.children = {};
    setImmediate(callback);
  };
  manager.supervisor.status = function () { return {}; };
  manager.socksReady = function () { metrics.socks++; return options.socksReady !== false; };
  if (!options.realReadiness) {
    manager.startCores = function (cores, operation, callback) {
      var xray = manager.spawnLogged('xray');
      var tun = manager.spawnLogged('tun2socks');
      operation.entries.xray = xray;
      operation.entries.tun2socks = tun;
      operation.childStarted = true;
      callback(null);
    };
  }
  return {
    manager: manager, metrics: metrics, resolvers: resolvers, bootstrap: bootstrap,
    resolve: function (index) { resolvers[index || 0](null, bootstrap); }
  };
}

async function managerRaceTests() {
  var ctx = makeManager();
  var connectCalls = 0, disconnectCalls = 0;
  ctx.manager.connect(function (error) { connectCalls++; check('disconnect during endpoint resolution cancels connect', !!error && error.code === 'CANCELLED'); });
  var disconnectPromise = new Promise(function (resolve) {
    ctx.manager.disconnect(function (error) { disconnectCalls++; check('disconnect during endpoint resolution completes', !error); resolve(); });
  });
  await disconnectPromise;
  ctx.resolve(0);
  await later(10);
  check('endpoint cancellation leaves no config, routes, spawn or active operation',
    ctx.metrics.config === 0 && ctx.metrics.save === 0 && ctx.metrics.routes === 0 &&
    ctx.metrics.spawn === 0 && ctx.manager.activeOperation === null && ctx.manager.state === 'idle');

  ctx = makeManager({ realReadiness: true, socksReady: false });
  var readinessCalls = 0, disconnected = false;
  ctx.manager.connect(function (error) { readinessCalls++; check('disconnect during readiness cancels connect once', !!error && error.code === 'CANCELLED'); });
  ctx.resolve(0);
  await later(20);
  await new Promise(function (resolve) {
    ctx.manager.disconnect(function (error) { disconnected = !error; resolve(); });
  });
  await later(300);
  check('readiness cancellation has no stale waiter callback or supervisor entries',
    disconnected && readinessCalls === 1 && ctx.manager.activeOperation === null && ctx.manager.supervisor.count() === 0);

  ctx = makeManager({ realReadiness: true, failFirstXray: true });
  var retryError = await new Promise(function (resolve) {
    ctx.manager.connect(function (error) { resolve(error); });
    ctx.resolve(0);
  });
  check('one transient pre-readiness XRay exit is recovered without duplicate cores',
    !retryError && ctx.manager.status().connected && ctx.metrics.spawn === 3 &&
    ctx.manager.supervisor.count() === 2);
  await new Promise(function (resolve) { ctx.manager.disconnect(function () { resolve(); }); });

  ctx = makeManager();
  var oldCallbackCount = 0, newCallbackCount = 0;
  ctx.manager.connect(function () { oldCallbackCount++; });
  await new Promise(function (resolve) { ctx.manager.disconnect(function () { resolve(); }); });
  ctx.manager.connect(function (error) { newCallbackCount++; check('new connect remains independent of stale callback', !error); });
  ctx.resolvers[0](null, ctx.bootstrap);
  ctx.resolve(1);
  await later(10);
  check('stale endpoint callback cannot start a new generation', oldCallbackCount === 1 && newCallbackCount === 1 && ctx.metrics.spawn === 2);

  ctx = makeManager();
  var aliveCalls = 0, finalCalls = 0;
  ctx.manager.coresAlive = function () { aliveCalls++; return aliveCalls < 4; };
  ctx.manager.connect(function (error) { finalCalls++; check('child exit during final connected transition fails startup', !!error && error.code === 'CORE_START_FAILED'); });
  ctx.resolve(0);
  await later(20);
  check('final transition never reports connected with dead core', finalCalls === 1 && ctx.manager.state === 'idle');
  check('route rollback and lock release occur once on final transition failure', ctx.metrics.rollback === 1 && !ctx.manager.lock.status().held);

  var source = fs.readFileSync(path.join(__dirname, '..', 'app', 'service', 'lib', 'vpn', 'manager.js'), 'utf8');
  check('post-route investigative probes are absent from production manager',
    source.indexOf('probeEndpoints') < 0 && source.indexOf('probeCoreBootstrap') < 0 && source.indexOf('coreUsesEndpoint') < 0);
}

function readinessParsingTest() {
  var manager = makeManager().manager;
  var originalRead = fs.readFileSync;
  var good = 'sl  local_address rem_address   st\n' +
    '0: 0100007F:2A31 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 0 10 0\n';
  var decoy = 'sl  local_address rem_address   st\n' +
    '0: 0100007F:2A31 00000000:0000 01 00000000:00000000 00:00000000 00000000 0 0 0 10 0\n' +
    '1: 0100007F:1234 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 0 10 0\n';
  fs.readFileSync = function (file, encoding) {
    if (file === '/proc/net/tcp') return readinessParsingTest.value;
    if (file === '/proc/net/tcp6') return 'sl local_address rem_address st\n';
    return originalRead.call(fs, file, encoding);
  };
  try {
    readinessParsingTest.value = good;
    check('SOCKS readiness accepts one row with loopback, port and LISTEN state', vpnLib.VpnManager.prototype.socksReady.call(manager));
    readinessParsingTest.value = decoy;
    check('SOCKS readiness rejects split-row port/state decoys', !vpnLib.VpnManager.prototype.socksReady.call(manager));
  } finally {
    fs.readFileSync = originalRead;
  }
}

function coreEnvironmentTest() {
  var manager = makeManager().manager;
  var captured = null;
  manager.supervisor.start = function (name, executable, args, options) {
    captured = options;
    return { name: name, generation: 1, pid: 9001, exited: false };
  };
  vpnLib.VpnManager.prototype.spawnLogged.call(manager, 'sing-box', '/fake/sing-box', ['run', '-c', '/fake/config'], {
    captureOutput: false,
    env: {
      PATH: '/custom/path',
      LD_PRELOAD: '/usr/lib/libsystrim.so.3',
      QT_QPA_PLATFORM: 'wayland',
      LS_SERVICE_NAMES: 'com.webos.service;',
      EXTRA: 'kept'
    }
  });
  check('native core launch clears inherited webOS preload',
    !!captured && captured.env.LD_PRELOAD === '' && captured.env.PATH === '/custom/path' &&
    captured.env.EXTRA === 'kept', JSON.stringify(captured));
  check('native core launch clears inherited webOS platform context',
    !!captured && captured.env.QT_QPA_PLATFORM === '' && captured.env.LS_SERVICE_NAMES === '', JSON.stringify(captured));
  check('sing-box launch avoids Node stream attachment on affected webOS runtime',
    !!captured && captured.stdio === 'ignore', JSON.stringify(captured));
}

function diagnosticBoundTest() {
  var logged = [];
  var result = diagnostics.report({ warn: function (label, meta) { logged.push([label, meta]); } }, {
    pid: 4242, exitCode: 23, exitSignal: 'SIGABRT', spawnErrorCode: 'EIO',
    failureStage: 'core-readiness',
    coreOutputText: 'secret.example.com 203.0.113.45 vless://uuid:password@host.example/'
  });
  var serialized = JSON.stringify(logged);
  check('production diagnostics retain bounded facts and failure stage',
    result.stage === 'core-readiness' && serialized.indexOf('4242') >= 0 &&
    serialized.indexOf('23') >= 0 && serialized.indexOf('SIGABRT') >= 0 &&
    serialized.indexOf('core-readiness') >= 0);
  check('production diagnostics redact endpoint, address and URI data',
    serialized.indexOf('secret.example.com') < 0 && serialized.indexOf('203.0.113.45') < 0 &&
    serialized.indexOf('vless://') < 0);
}

Promise.resolve().then(supervisorIdentityTests).then(managerRaceTests).then(function () {
  readinessParsingTest();
  coreEnvironmentTest();
  diagnosticBoundTest();
  console.log('\n' + passed + ' focused lifecycle checks passed');
}).catch(function (error) {
  console.error('FAIL - ' + (error && error.stack || error));
  process.exit(1);
});
