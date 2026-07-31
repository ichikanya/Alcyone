'use strict';

/* Lifecycle guarantees for the VPN manager.

   These checks use in-memory fakes for the supervisor, routing and lock so the
   failure paths can be driven deterministically without touching the network
   or spawning processes. The properties under test are the ones that keep a TV
   usable: a failed start, a crashed core and a disconnect must all roll the
   routes back and release the cross-edition lock. */

var os = require('os');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var vpnLib = require(path.join(ROOT, 'app', 'service', 'lib', 'vpn', 'manager.js'));
var lockLib = require(path.join(ROOT, 'app', 'service', 'lib', 'tunnel-lock.js'));
var storeLib = require(path.join(ROOT, 'app', 'service', 'lib', 'store', 'profiles.js'));

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log((ok ? 'ok   - ' : 'FAIL - ') + name + (detail ? ' (' + detail + ')' : ''));
}

var quietLogger = {
  info: function () {}, warn: function () {}, error: function () {}
};

function makeManager(options) {
  options = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-vpn-'));
  var store = new storeLib.ProfileStore({ file: path.join(dir, 'profiles.json') });
  store.upsertManualProfile('vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=tls&type=ws#Node', 'Node');

  var manager = new vpnLib.VpnManager({
    edition: { core: options.core || 'xray', id: 'xray' },
    store: store,
    logger: quietLogger,
    lock: new lockLib.TunnelLock({ edition: 'xray', lockFile: path.join(dir, 'tunnel.lock') }),
    /* Integrity has its own real-file suite. Lifecycle uses fake executable
       paths so inject only the already-verified launch boundary here. */
    coreIntegrity: {
      prepare: function (packaged, staged) { return staged; },
      verifyForLaunch: function (file) { return file; }
    },
    dataPlaneProbe: function (callback) {
      events.probed++;
      if (options.dataPlaneFails) return callback(null, '');
      callback(null, '203.0.113.77');
    },
    paths: {
      appDir: dir,
      dataDir: dir,
      configFile: path.join(dir, 'config.json'),
      routeState: path.join(dir, 'route.state'),
      tunnelLog: path.join(dir, 'tunnel.log')
    }
  });

  /* Track what the routing layer was asked to do. */
  var events = { applied: 0, rolledBack: 0, saved: 0, loaded: 0, probed: 0, spawned: {} };
  manager.routes.saveState = function (addresses) {
    events.saved++;
    this.state = { original: { device: 'wlan0', gateway: '192.168.1.1' }, serverAddresses: addresses || [] };
    return this.state;
  };
  manager.routes.loadState = function () { events.loaded++; return this.state || null; };
  manager.routes.applyTunRoutes = function () {
    events.applied++;
    if (options.routeInstallFails) throw new Error('route install failed');
    return true;
  };
  manager.routes.rollback = function () { events.rolledBack++; this.state = null; return true; };
  manager.routes.networkChanged = function () { return !!options.networkChanged; };
  manager.routes.routeActive = function () { return !options.routeInactive; };
  manager.routes.directRoutesActive = function () { return !options.directRouteInactive; };
  manager.routes.tunExists = function () { return !!manager._tunUp; };
  manager.routes.diagnostics = function () { return {}; };

  /* Cores are always "found" so the tests exercise lifecycle, not discovery. */
  manager.resolveCores = function () {
    return { xray: '/fake/xray', tun2socks: '/fake/tun2socks', singbox: '/fake/sing-box' };
  };
  /* The installation health gate is discovery too — it inspects the packaged
     payload, the cores and the routing assets — so it is stubbed for the same
     reason and by the same rule. Its own ordering and classification are
     covered by tests/elevation-and-health.test.js. */
  manager.checkHealth = function () { return null; };
  manager.resolveEndpoints = function (profile, cb) {
    cb(null, {
      entries: [{
        host: 'redacted.test',
        literal: false,
        addresses: ['93.184.216.34'],
        targets: [{ port: 443, network: 'tcp' }]
      }],
      addresses: ['93.184.216.34'],
      map: { 'redacted.test': ['93.184.216.34'] }
    });
  };
  manager.socksReady = function () { return true; };

  /* Fake supervisor: records children, can simulate a spawn failure. */
  var running = {};
  manager.supervisor.start = function (name, executable, args) {
    if (options.spawnFails) throw require(path.join(ROOT, 'app', 'service', 'lib', 'errors.js')).err('CORE_START_FAILED', 'spawn failed');
    running[name] = true;
    events.spawned[name] = (args || []).slice(0);
    manager._tunUp = !options.tunNeverReady;
    return { name: name, pid: 4242 };
  };
  manager.supervisor.isRunning = function (name) { return !!running[name]; };
  manager.supervisor.stopAll = function (cb) { running = {}; manager._tunUp = false; setImmediate(cb); };
  manager.supervisor.status = function () { return running; };

  return { manager: manager, events: events, dir: dir, running: function () { return running; } };
}

function step(fn) { return new Promise(fn); }

step(function (next) {
  var ctx = makeManager();
  ctx.manager.connect(function (error) {
    record('successful connect reaches connected state', !error && ctx.manager.state === 'connected', error ? error.code : '');
    record('successful connect installs routes', ctx.events.applied === 1);
    record('startup retains its validated route snapshot instead of rereading it',
      ctx.events.loaded === 0);
    record('successful connect verifies real traffic before reporting connected',
      ctx.events.probed === 1 && ctx.manager.status().dataPlaneVerified === true);
    record('successful connect holds the tunnel lock', ctx.manager.lock.status().mine === true);
    record('XRay uses the bundled legacy tun2socks CLI',
      ctx.events.spawned.tun2socks.indexOf('-tunName') >= 0 &&
      ctx.events.spawned.tun2socks.indexOf('-proxyServer') >= 0 &&
      ctx.events.spawned.tun2socks.indexOf('-device') < 0);
    next(ctx);
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager({ networkChanged: true });
    ctx.manager.connect(function (error) {
      var before = ctx.events.rolledBack;
      record('physical network change is detected while connected', !error && ctx.manager.checkNetworkChange());
      setTimeout(function () {
        record('network change reports a stable error and returns to idle',
          ctx.manager.state === 'idle' && ctx.manager.lastError && ctx.manager.lastError.code === 'NETWORK_CHANGED');
        record('network change rolls back the tunnel exactly once', ctx.events.rolledBack === before + 1);
        next();
      }, 30);
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager({ spawnFails: true });
    ctx.manager.connect(function (error) {
      record('core spawn failure returns an error', !!error, error ? error.code : 'none');
      record('core spawn failure rolls routes back', ctx.events.rolledBack >= 1);
      record('core spawn failure releases the lock', ctx.manager.lock.status().held === false);
      record('core spawn failure returns to idle', ctx.manager.state === 'idle');
      next();
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager({ tunNeverReady: true });
    ctx.manager.connect(function (error) {
      record('tun never appearing fails cleanly', !!error, error ? error.code : 'none');
      record('tun failure rolls routes back', ctx.events.rolledBack >= 1);
      record('tun failure releases the lock', ctx.manager.lock.status().held === false);
      next();
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager({ routeInstallFails: true });
    ctx.manager.connect(function (error) {
      record('route install failure is reported', !!error, error ? error.code : 'none');
      record('route install failure rolls back', ctx.events.rolledBack >= 1);
      record('route install failure stops children', Object.keys(ctx.running()).length === 0);
      next();
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager({ routeInactive: true });
    ctx.manager.connect(function (error) {
      record('inactive tunnel route fails the health check',
        !!error && error.code === 'HEALTH_CHECK_FAILED', error ? error.code : 'none');
      record('health check failure rolls back', ctx.events.rolledBack >= 1);
      next();
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager({ dataPlaneFails: true });
    ctx.manager.connect(function (error) {
      record('failed external traffic verification is reported accurately',
        !!error && error.code === 'HEALTH_CHECK_FAILED', error ? error.code : 'none');
      record('traffic verification failure never reports connected',
        ctx.manager.state === 'idle' && ctx.manager.status().connected === false);
      record('traffic verification failure rolls routes back and stops children',
        ctx.events.rolledBack >= 1 && Object.keys(ctx.running()).length === 0);
      next();
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager();
    ctx.manager.connect(function () {
      var before = ctx.events.rolledBack;
      /* Simulate the core dying while connected. */
      ctx.manager.onCoreExit('xray', 1, null);
      setTimeout(function () {
        record('core crash while connected rolls routes back', ctx.events.rolledBack > before);
        record('core crash releases the lock', ctx.manager.lock.status().held === false);
        record('core crash returns to idle', ctx.manager.state === 'idle');
        next();
      }, 30);
    });
  });
}).then(function () {
  return step(function (next) {
    var ctx = makeManager();
    ctx.manager.connect(function () {
      ctx.manager.disconnect(function (error) {
        record('disconnect succeeds', !error, error ? error.code : '');
        record('disconnect restores routes', ctx.events.rolledBack >= 1);
        record('disconnect releases the lock', ctx.manager.lock.status().held === false);
        next();
      });
    });
  });
}).then(function () {
  return step(function (next) {
    /* A fresh service process finding leftover state must clean it up. */
    var ctx = makeManager();
    ctx.manager.routes.state = { original: { device: 'wlan0' }, serverAddresses: [] };
    var recovered = ctx.manager.recover();
    record('service restart recovers stale tunnel state', recovered === true);
    record('restart recovery rolls routes back', ctx.events.rolledBack >= 1);
    next();
  });
}).then(function () {
  return step(function (next) {
    /* Cross-edition exclusion. */
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-lock-'));
    var lockFile = path.join(dir, 'tunnel.lock');
    var xrayLock = new lockLib.TunnelLock({ edition: 'xray', lockFile: lockFile });
    var singboxLock = new lockLib.TunnelLock({ edition: 'sing-box', lockFile: lockFile });
    xrayLock.acquire();
    var blocked = false, code = '';
    try { singboxLock.acquire(); } catch (e) { blocked = true; code = e.code; }
    record('second edition cannot take the tunnel', blocked && code === 'TUNNEL_OWNED_BY_OTHER_EDITION', code);
    record('other edition cannot release our lock', singboxLock.release() === false);
    xrayLock.release();
    var afterRelease = true;
    try { singboxLock.acquire(); } catch (e2) { afterRelease = false; }
    record('tunnel is available after the owner releases it', afterRelease);
    next();
  });
}).then(function () {
  var passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
}).catch(function (e) {
  console.error('harness error: ' + (e && e.stack || e));
  process.exit(1);
});
