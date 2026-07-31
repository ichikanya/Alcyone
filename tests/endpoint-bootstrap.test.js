'use strict';

/* Focused regression coverage for the endpoint DNS bootstrap deadlock. */

var assert = require('assert');
var events = require('events');
var fs = require('fs');
var net = require('net');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var bootstrap = require(path.join(ROOT, 'app', 'service', 'lib', 'net', 'endpoint-bootstrap.js'));
var errors = require(path.join(ROOT, 'app', 'service', 'lib', 'errors.js'));
var xray = require(path.join(ROOT, 'app', 'service', 'lib', 'config', 'xray.js'));
var singbox = require(path.join(ROOT, 'app', 'service', 'lib', 'config', 'singbox.js'));
var vpnLib = require(path.join(ROOT, 'app', 'service', 'lib', 'vpn', 'manager.js'));

var passed = 0;
var failed = 0;

function record(name, condition, detail) {
  if (condition) passed++; else failed++;
  console.log((condition ? 'ok   - ' : 'FAIL - ') + name +
    (detail ? ' (' + detail + ')' : ''));
}

function runResolve(endpoints, answers, callback, timeoutMs) {
  var calls = [];
  var fake = {
    resolveAll: function (host, done) {
      calls.push(host);
      process.nextTick(function () {
        var answer = answers[host];
        if (answer instanceof Error) return done(answer);
        done(null, answer);
        /* A broken dependency must not make the public callback fire twice. */
        if (answers.__twice) done(null, answer);
      });
    }
  };
  bootstrap.resolve(endpoints, function (error, result) {
    callback(error, result, calls);
  }, { resolver: fake, timeoutMs: timeoutMs || 100 });
}

var asyncTests = [];
function asyncTest(name, fn) {
  asyncTests.push({ name: name, fn: fn });
}

function nextAsync(index) {
  if (index >= asyncTests.length) {
    console.log('\n' + passed + '/' + (passed + failed) + ' checks passed');
    process.exit(failed ? 1 : 0);
    return;
  }
  var test = asyncTests[index];
  var settled = false;
  try {
    test.fn(function (error) {
      if (settled) return;
      settled = true;
      if (error) {
        record(test.name, false, error.stack || error.message || String(error));
      }
      nextAsync(index + 1);
    });
  } catch (error) {
    record(test.name, false, error.stack || error.message);
    nextAsync(index + 1);
  }
}

/* ---------------------------------------------------------------- host input */

record('hostname validation accepts ordinary and LAN-local DNS names',
  bootstrap.isValidHostname('edge.example.com') &&
  bootstrap.isValidHostname('vpn.lan') &&
  bootstrap.isValidHostname('vpn'));
record('hostname validation rejects controls, underscores and malformed labels',
  !bootstrap.isValidHostname('bad\u0000host.example') &&
  !bootstrap.isValidHostname('bad_name.example') &&
  !bootstrap.isValidHostname('-bad.example') &&
  !bootstrap.isValidHostname('bad-.example') &&
  !bootstrap.isValidHostname('999.999.999.999'));
record('literal detection distinguishes valid IPv4/IPv6 from colon garbage',
  bootstrap.isLiteralAddress('192.0.2.1') &&
  bootstrap.isLiteralAddress('2001:db8::1') &&
  !bootstrap.isLiteralAddress('not:a:valid:address'));

asyncTest('public system DNS endpoint resolves before bootstrap', function (done) {
  runResolve([{ host: 'edge.example.com', port: 443, network: 'tcp' }], {
    'edge.example.com': [{ address: '93.184.216.34', family: 4 }]
  }, function (error, result, calls) {
    record('domain endpoint with public system DNS succeeds',
      !error && result.addresses[0] === '93.184.216.34');
    record('domain endpoint is looked up exactly once', calls.length === 1);
    done();
  });
});

asyncTest('LAN-local DNS answers are valid proxy endpoints', function (done) {
  runResolve([{ host: 'vpn.lan', port: 8443 }], {
    'vpn.lan': [{ address: '192.168.50.20', family: 4 }]
  }, function (error, result) {
    record('domain endpoint with LAN-local DNS succeeds',
      !error && result.addresses[0] === '192.168.50.20');
    done();
  });
});

asyncTest('literal IPv4 bypasses DNS', function (done) {
  runResolve([{ host: '198.51.100.8', port: 443 }], {}, function (error, result, calls) {
    record('literal IPv4 endpoint performs no DNS',
      !error && calls.length === 0 && result.addresses[0] === '198.51.100.8');
    record('literal IPv4 does not create static hostname configuration',
      !result.hasMappings());
    done();
  });
});

asyncTest('answers and duplicate endpoints are deduplicated', function (done) {
  runResolve([
    { host: 'Edge.Example.com', port: 443 },
    { host: 'edge.example.com', port: 8443 },
    { host: 'edge.example.com', port: 443 }
  ], {
    'Edge.Example.com': [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
      { address: '93.184.216.34', family: 4 }
    ]
  }, function (error, result, calls) {
    record('multiple resolved IPv4 candidates are retained',
      !error && result.addresses.join(',') === '93.184.216.34,93.184.216.35');
    record('duplicate endpoint hostnames share one lookup and one mapping',
      calls.length === 1 && result.entries.length === 1 &&
      result.entries[0].targets.length === 2 &&
      result.map['edge.example.com'].length === 2);
    done();
  });
});

asyncTest('failed DNS is a bounded structured error', function (done) {
  runResolve([{ host: 'missing.example', port: 443 }], {
    'missing.example': new Error('resolver failed')
  }, function (error, result) {
    record('failed resolution returns ENDPOINT_RESOLUTION_FAILED',
      !!error && error.code === 'ENDPOINT_RESOLUTION_FAILED' && !result);
    done();
  });
});

asyncTest('an AAAA-only answer is rejected without leaking it', function (done) {
  runResolve([{ host: 'v6.example', port: 443 }], {
    'v6.example': [{ address: '2001:db8::10', family: 6 }]
  }, function (error) {
    record('no IPv4 result returns ENDPOINT_RESOLUTION_FAILED',
      !!error && error.code === 'ENDPOINT_RESOLUTION_FAILED' &&
      error.message.indexOf('2001:db8') < 0);
    done();
  });
});

asyncTest('invalid hostname is rejected before DNS', function (done) {
  runResolve([{ host: 'bad_name.example', port: 443 }], {}, function (error, result, calls) {
    record('invalid hostname never reaches the resolver',
      !!error && error.code === 'ENDPOINT_RESOLUTION_FAILED' &&
      !result && calls.length === 0);
    done();
  });
});

asyncTest('IPv6 literal is detected but rejected before DNS on an IPv4 tunnel', function (done) {
  runResolve([{ host: '2001:db8::10', port: 443 }], {}, function (error, result, calls) {
    record('IPv6 literal performs no DNS and fails before route takeover',
      !!error && error.code === 'ENDPOINT_RESOLUTION_FAILED' &&
      !result && calls.length === 0);
    done();
  });
});

asyncTest('resolver callback is exactly once', function (done) {
  var callbackCount = 0;
  runResolve([{ host: 'once.example', port: 443 }], {
    'once.example': [{ address: '93.184.216.34', family: 4 }],
    __twice: true
  }, function () {
    callbackCount++;
    setTimeout(function () {
      record('bootstrap callback fires exactly once', callbackCount === 1, String(callbackCount));
      done();
    }, 10);
  });
});

asyncTest('hung resolver is bounded', function (done) {
  var callbackCount = 0;
  bootstrap.resolve([{ host: 'timeout.example', port: 443 }], function (error) {
    callbackCount++;
    setTimeout(function () {
      record('resolution timeout is bounded and exactly once',
        !!error && error.code === 'ENDPOINT_RESOLUTION_FAILED' && callbackCount === 1);
      done();
    }, 10);
  }, { resolver: { resolveAll: function () {} }, timeoutMs: 15 });
});

/* -------------------------------------------------------------- core configs */

var generatedProfile = {
  id: 'generated',
  link: 'vless://11111111-2222-3333-4444-555555555555@Edge.Example.com:443' +
    '?security=reality&type=ws&host=cdn.example.com&path=%2Fws' +
    '&sni=sni.example.com&pbk=PUBLIC&sid=ab#Node'
};
var pin = {
  entries: [{ host: 'Edge.Example.com', addresses: ['93.184.216.34'], targets: [{ port: 443, network: 'tcp' }] }],
  addresses: ['93.184.216.34'],
  map: { 'edge.example.com': ['93.184.216.34'] }
};
var generatedXray = xray.build(generatedProfile, pin);
var generatedOutbound = generatedXray.outbounds[0];

record('generated XRay config uses the pinned exact full-host key form',
  generatedXray.dns.hosts['edge.example.com'][0] === '93.184.216.34' &&
  !generatedXray.dns.hosts['full:edge.example.com']);
record('generated XRay matching outbound uses sockopt UseIP',
  generatedOutbound.streamSettings.sockopt.domainStrategy === 'UseIP');
record('generated XRay outbound domain remains unchanged',
  generatedOutbound.settings.vnext[0].address === 'Edge.Example.com');
record('generated XRay preserves SNI, REALITY and WebSocket Host',
  generatedOutbound.streamSettings.realitySettings.serverName === 'sni.example.com' &&
  generatedOutbound.streamSettings.realitySettings.publicKey === 'PUBLIC' &&
  generatedOutbound.streamSettings.wsSettings.headers.Host === 'cdn.example.com' &&
  generatedOutbound.streamSettings.wsSettings.path === '/ws');

var fullSource = {
  dns: {
    servers: ['https://dns.example/dns-query'],
    queryStrategy: 'UseIPv4',
    hosts: { 'full:keep.example': ['192.0.2.2'] }
  },
  inbounds: [{ tag: 'old-in', port: 9999, protocol: 'socks' }],
  outbounds: [
    {
      protocol: 'vless',
      tag: 'grpc-proxy',
      settings: { vnext: [{ address: 'EDGE.EXAMPLE.COM', port: 443, users: [{ id: 'SECRET' }] }] },
      streamSettings: {
        network: 'grpc',
        security: 'reality',
        realitySettings: { serverName: 'reality.example', publicKey: 'KEY', shortId: '01' },
        grpcSettings: { serviceName: 'authority-service', authority: 'authority.example' },
        sockopt: { domainStrategy: 'UseIPv4', mark: 7 }
      }
    },
    {
      protocol: 'trojan',
      tag: 'ws-proxy',
      settings: { servers: [{ address: 'edge.example.com', port: 8443, password: 'SECRET' }] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: 'tls.example', allowInsecure: false },
        wsSettings: { path: '/socket', headers: { Host: 'host.example' } },
        sockopt: { domainStrategy: 'AsIs', tcpFastOpen: true }
      }
    },
    { protocol: 'freedom', tag: 'direct', streamSettings: { sockopt: { mark: 9 } } }
  ],
  routing: { domainStrategy: 'AsIs', rules: [] }
};
var sourceBefore = JSON.stringify(fullSource);
var fullBuilt = xray.buildFullConfig(fullSource, pin);

record('full imported XRay config preserves user DNS settings',
  fullBuilt.dns.servers[0] === 'https://dns.example/dns-query' &&
  fullBuilt.dns.queryStrategy === 'UseIPv4' &&
  fullBuilt.dns.hosts['full:keep.example'][0] === '192.0.2.2');
record('full imported XRay config gets the exact bootstrap mapping',
  fullBuilt.dns.hosts['edge.example.com'][0] === '93.184.216.34');
record('compatible explicit XRay domain strategy is preserved',
  fullBuilt.outbounds[0].streamSettings.sockopt.domainStrategy === 'UseIPv4');
record('AsIs is replaced only on a matching XRay outbound',
  fullBuilt.outbounds[1].streamSettings.sockopt.domainStrategy === 'UseIP' &&
  fullBuilt.outbounds[2].streamSettings.sockopt.domainStrategy === undefined);
record('XRay full-config endpoint domains remain unchanged',
  fullBuilt.outbounds[0].settings.vnext[0].address === 'EDGE.EXAMPLE.COM' &&
  fullBuilt.outbounds[1].settings.servers[0].address === 'edge.example.com');
record('XRay TLS, SNI, REALITY, gRPC and WebSocket fields remain unchanged',
  fullBuilt.outbounds[0].streamSettings.realitySettings.serverName === 'reality.example' &&
  fullBuilt.outbounds[0].streamSettings.grpcSettings.authority === 'authority.example' &&
  fullBuilt.outbounds[1].streamSettings.tlsSettings.allowInsecure === false &&
  fullBuilt.outbounds[1].streamSettings.wsSettings.headers.Host === 'host.example');
record('building a full XRay config never rewrites the stored profile object',
  JSON.stringify(fullSource) === sourceBefore);

var fullEndpoints = xray.endpoints({ fullConfig: fullSource });
record('full XRay endpoint extraction keeps duplicate hosts on distinct ports',
  fullEndpoints.length === 2 &&
  fullEndpoints[0].port === 443 && fullEndpoints[1].port === 8443);

var generatedSingbox = singbox.build(generatedProfile, pin);
record('sing-box uses the pinned 1.13 hosts-server schema',
  generatedSingbox.dns.servers[0].type === 'hosts' &&
  generatedSingbox.dns.servers[0].tag === singbox.BOOTSTRAP_TAG &&
  generatedSingbox.dns.servers[0].predefined['edge.example.com'][0] === '93.184.216.34');
record('sing-box matching outbound points its domain resolver at static hosts',
  generatedSingbox.outbounds[0].domain_resolver.server === singbox.BOOTSTRAP_TAG &&
  generatedSingbox.outbounds[0].domain_resolver.strategy === 'ipv4_only');
record('sing-box outbound domain and TLS/WebSocket semantics are preserved',
  generatedSingbox.outbounds[0].server === 'Edge.Example.com' &&
  generatedSingbox.outbounds[0].tls.server_name === 'sni.example.com' &&
  generatedSingbox.outbounds[0].tls.reality.public_key === 'PUBLIC' &&
  generatedSingbox.outbounds[0].transport.headers.Host === 'cdn.example.com');

var sbCustom = {
  dns: { servers: [{ type: 'udp', tag: singbox.BOOTSTRAP_TAG, server: '192.0.2.53' }] },
  outbounds: [{ type: 'vless', server: 'edge.example.com' }]
};
singbox.applyBootstrap(sbCustom, pin);
record('sing-box preserves user DNS and chooses a collision-free bootstrap tag',
  sbCustom.dns.servers.length === 2 &&
  sbCustom.dns.servers[1].type === 'udp' &&
  sbCustom.outbounds[0].domain_resolver.server === singbox.BOOTSTRAP_TAG + '-2');

/* ------------------------------------------------------------- VPN ordering */

function managerHarness(options) {
  options = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-bootstrap-'));
  var sequence = [];
  var routeCalls = { saved: 0, applied: 0, rolledBack: 0 };
  var lockCalls = { acquired: 0, released: 0 };
  var logText = '';
  var active = {
    id: 'profile-1',
    link: 'vless://11111111-2222-3333-4444-555555555555@secret-endpoint.example:443#Secret'
  };
  var manager = new vpnLib.VpnManager({
    edition: { core: 'xray', id: 'xray' },
    store: { activeProfile: function () { return active; } },
    logger: {
      info: function (message, data) { logText += message + JSON.stringify(data || {}); },
      warn: function (message, data) { logText += message + JSON.stringify(data || {}); },
      error: function (message, data) { logText += message + JSON.stringify(data || {}); }
    },
    lock: {
      acquire: function () { sequence.push('lock'); lockCalls.acquired++; },
      release: function () { lockCalls.released++; },
      status: function () { return { held: false, mine: false }; }
    },
    coreIntegrity: {
      prepare: function (packaged, staged) { return staged; },
      verifyForLaunch: function (file) { return file; }
    },
    dataPlaneProbe: function (callback) {
      sequence.push('probe');
      callback(null, '203.0.113.90');
    },
    paths: {
      appDir: dir,
      dataDir: dir,
      configFile: path.join(dir, 'config.json'),
      routeState: path.join(dir, 'route.state'),
      tunnelLog: path.join(dir, 'tunnel.log')
    }
  });
  var currentBootstrap = {
    entries: [{
      host: 'secret-endpoint.example',
      addresses: ['203.0.113.10'],
      targets: [{ port: 443, network: 'tcp' }]
    }],
    addresses: ['203.0.113.10'],
    map: { 'secret-endpoint.example': ['203.0.113.10'] }
  };
  manager.checkHealth = function () { return null; };
  manager.resolveCores = function () {
    return { xray: '/fake/xray', tun2socks: '/fake/tun2socks' };
  };
  manager.resolveEndpoints = function (profile, callback) {
    sequence.push('resolve');
    if (options.resolveFails) {
      return process.nextTick(function () {
        callback(errors.err('ENDPOINT_RESOLUTION_FAILED', 'endpoint lookup failed'));
      });
    }
    process.nextTick(function () { callback(null, currentBootstrap); });
  };
  manager.routes.saveState = function (addresses) {
    sequence.push('snapshot');
    routeCalls.saved++;
    this.state = { original: { device: 'wlan0' }, serverAddresses: addresses.slice(0) };
    return this.state;
  };
  manager.routes.loadState = function () { return this.state; };
  manager.routes.applyTunRoutes = function () { sequence.push('routes'); routeCalls.applied++; };
  manager.routes.rollback = function () { routeCalls.rolledBack++; this.state = null; };
  manager.routes.routeActive = function () { return true; };
  manager.routes.directRoutesActive = function () { return true; };
  manager.routes.tunExists = function () { return true; };
  manager.routes.diagnostics = function () { return {}; };
  manager.writeConfig = function () { sequence.push('config'); };
  manager.startCores = function (cores, callback) {
    sequence.push('cores');
    process.nextTick(function () { callback(null); });
  };
  manager.coresAlive = function () { return true; };
  manager.supervisor.stopAll = function (callback) { process.nextTick(callback); };
  manager.supervisor.status = function () { return {}; };

  return {
    manager: manager,
    sequence: sequence,
    routeCalls: routeCalls,
    lockCalls: lockCalls,
    logs: function () { return logText; },
    setBootstrap: function (value) { currentBootstrap = value; },
    setProfile: function (value) { active = value; }
  };
}

asyncTest('resolution precedes all startup state changes', function (done) {
  var ctx = managerHarness();
  ctx.manager.connect(function (error) {
    record('resolution occurs before lock, snapshot, core and route changes',
      !error && ctx.sequence.join(',') ===
        'resolve,lock,snapshot,config,cores,routes,probe',
      ctx.sequence.join(','));
    record('the same resolved addresses are saved for bypass routes',
      ctx.manager.routes.state.serverAddresses[0] === '203.0.113.10');
    record('manager logs never expose endpoint hostname or address',
      ctx.logs().indexOf('secret-endpoint.example') < 0 &&
      ctx.logs().indexOf('203.0.113.10') < 0);
    done();
  });
});

asyncTest('failed resolution leaves routes and lock untouched', function (done) {
  var ctx = managerHarness({ resolveFails: true });
  ctx.manager.connect(function (error) {
    record('failed resolution leaves network state untouched',
      !!error && error.code === 'ENDPOINT_RESOLUTION_FAILED' &&
      ctx.routeCalls.saved === 0 && ctx.routeCalls.applied === 0 &&
      ctx.routeCalls.rolledBack === 0 && ctx.lockCalls.acquired === 0 &&
      ctx.manager.state === 'idle');
    done();
  });
});

asyncTest('server reconnect obtains a fresh bootstrap result', function (done) {
  var ctx = managerHarness();
  ctx.manager.connect(function (firstError) {
    if (firstError) return done(firstError);
    ctx.manager.disconnect(function (disconnectError) {
      if (disconnectError) return done(disconnectError);
      ctx.setProfile({
        id: 'profile-2',
        link: 'vless://11111111-2222-3333-4444-555555555555@other-secret.example:443#Other'
      });
      ctx.setBootstrap({
        entries: [{ host: 'other-secret.example', addresses: ['203.0.113.20'], targets: [{ port: 443, network: 'tcp' }] }],
        addresses: ['203.0.113.20'],
        map: { 'other-secret.example': ['203.0.113.20'] }
      });
      ctx.manager.connect(function (secondError) {
        record('server switching performs a fresh resolution and bypass snapshot',
          !secondError &&
          ctx.sequence.filter(function (item) { return item === 'resolve'; }).length === 2 &&
          ctx.manager.routes.state.serverAddresses[0] === '203.0.113.20');
        done();
      });
    });
  });
});

nextAsync(0);
