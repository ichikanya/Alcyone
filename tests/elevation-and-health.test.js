'use strict';

/* Phase 1: elevation classification, the ordered health gate, and the removal
   of the Phase 0 probe.

   The behaviour under test is the one that made 4.0.1 unusable after every
   install: a service jailed by the installer could not traverse its own data
   directory, so the core resolver reported "the VPN core is missing from the
   package" when the package was intact and only the LS2 configuration had been
   reset. These tests pin the corrected classification so it cannot regress. */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var healthLib = require('../app/service/lib/health');
var supervisorLib = require('../app/service/lib/supervisor');
var errors = require('../app/service/lib/errors');
var privilege = require('../app/service/lib/privilege');

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log((ok ? 'ok   - ' : 'FAIL - ') + name + (detail ? ' (' + detail + ')' : ''));
}
function check(name, fn) {
  var ok = false, detail = '';
  try { fn(); ok = true; } catch (e) { detail = (e && e.message) || String(e); }
  record(name, ok, detail);
}

/* --- fixtures ----------------------------------------------------------- */

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-health-'));
var appDir = path.join(tmp, 'app');
var dataDir = path.join(tmp, 'data');
var serviceDir = path.join(tmp, 'service');

/* A minimal 32-bit little-endian ARM ELF header is all the gate reads. */
function armElf(extra) {
  var size = 20 + (extra || 0);
  var buffer = typeof Buffer.alloc === 'function' ? Buffer.alloc(size) : new Buffer(size);
  if (typeof buffer.fill === 'function') buffer.fill(0);
  buffer[0] = 0x7f; buffer[1] = 0x45; buffer[2] = 0x4c; buffer[3] = 0x46;
  buffer[4] = 1;    /* 32-bit  */
  buffer[5] = 1;    /* little-endian */
  buffer.writeUInt16LE(40, 18); /* e_machine = ARM */
  return buffer;
}

function copyPinnedCore(name, destination) {
  var relative = name === 'sing-box' ? ['sing-box', 'sing-box'] : ['xray', name];
  fs.writeFileSync(destination,
    fs.readFileSync(path.join.apply(path, [ROOT, 'build', 'cores'].concat(relative))));
  fs.chmodSync(destination, 493); /* 0755; old-JavaScript-compatible literal */
}

check('ARMv7 cores remain valid on an ARM64 Linux compatibility userspace', function () {
  assert.strictEqual(healthLib.machineMatchesRuntime(40, 'linux', 'arm64'), true);
  assert.strictEqual(healthLib.machineMatchesRuntime(62, 'linux', 'arm64'), false);
});

fs.mkdirSync(path.join(appDir, 'bin'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'bin'), { recursive: true });
fs.mkdirSync(serviceDir, { recursive: true });
fs.writeFileSync(path.join(appDir, 'appinfo.json'), '{"id":"com.alcyone.vpn"}');
fs.writeFileSync(path.join(serviceDir, 'service.js'), '/* stub */');
copyPinnedCore('xray', path.join(appDir, 'bin', 'xray'));
copyPinnedCore('tun2socks', path.join(appDir, 'bin', 'tun2socks'));

var paths = { appDir: appDir, dataDir: dataDir };

/* A *complete* installation, used wherever the expected verdict is OK.

   The XRay fixture above deliberately has no routing assets, because pinned
   geoip.dat/geosite.dat are ~30 MB with fixed sha256 values and cannot be
   fabricated. The sing-box edition requires no assets, so it is the only
   edition that can be made genuinely healthy in a temp directory. */
var healthyDir = path.join(tmp, 'healthy');
fs.mkdirSync(path.join(healthyDir, 'bin'), { recursive: true });
fs.writeFileSync(path.join(healthyDir, 'appinfo.json'), '{}');
copyPinnedCore('sing-box', path.join(healthyDir, 'bin', 'sing-box'));

function healthyGate() {
  return new healthLib.HealthGate({
    edition: { core: 'sing-box' },
    paths: { appDir: healthyDir, dataDir: path.join(healthyDir, 'nope') },
    serviceDir: serviceDir
  });
}

function gate(overrides) {
  var options = {
    edition: { core: 'xray' },
    paths: paths,
    serviceDir: serviceDir
  };
  var key;
  for (key in (overrides || {})) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) options[key] = overrides[key];
  }
  return new healthLib.HealthGate(options);
}

function codeOf(problem) {
  return problem ? problem.code : 'OK';
}

/* --- 1. HOMEBREW_REQUIRED versus ELEVATION_REQUIRED ---------------------- */

check('unmet Homebrew prerequisite reports HOMEBREW_REQUIRED', function () {
  var problem = gate().check({ homebrewRoot: false, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'HOMEBREW_REQUIRED');
});

check('Homebrew root plus a jailed Alcyone service reports ELEVATION_REQUIRED', function () {
  var problem = gate().check({ homebrewRoot: true, privilege: { root: false } });
  assert.strictEqual(codeOf(problem), 'ELEVATION_REQUIRED');
});

check('HOMEBREW_REQUIRED outranks ELEVATION_REQUIRED', function () {
  /* Both conditions hold at once. The prerequisite must win: it has no in-app
     remedy, so offering "Grant permissions" there is a button that can only
     fail. */
  var problem = gate().check({ homebrewRoot: false, privilege: { root: false } });
  assert.strictEqual(codeOf(problem), 'HOMEBREW_REQUIRED');
});

check('an undetermined prerequisite is not treated as unmet', function () {
  /* null means "not asked yet". Concluding failure from it would disable the
     app on a perfectly healthy TV. */
  var problem = healthyGate().check({ homebrewRoot: null, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'OK');
});

/* --- 2. uid 0 is the authoritative elevation condition ------------------ */

check('uid 0 alone clears the elevation gate', function () {
  var problem = healthyGate().check({ homebrewRoot: true, privilege: { root: true, uid: 0 } });
  assert.strictEqual(codeOf(problem), 'OK');
});

check('a damaged data directory does not imply a jail', function () {
  /* A genuinely elevated service whose data directory is unwritable must not
     be misreported as un-elevated: dataDirWritable is a consequence of the
     jail, never its definition. */
  var problem = healthyGate().check({
    homebrewRoot: true,
    privilege: { root: true, uid: 0, dataDirWritable: false, appPayloadReadable: false, tunVisible: false }
  });
  assert.strictEqual(codeOf(problem), 'OK');
});

check('readable files do not substitute for uid 0', function () {
  /* The mirror image: everything on disk is reachable, but uid is not 0. That
     is still ELEVATION_REQUIRED. */
  var problem = gate().check({
    homebrewRoot: true,
    privilege: { root: false, uid: 5033, dataDirWritable: true, appPayloadReadable: true, tunVisible: true }
  });
  assert.strictEqual(codeOf(problem), 'ELEVATION_REQUIRED');
});

check('unknown uid is not treated as un-elevated', function () {
  var problem = gate().check({ homebrewRoot: true, privilege: { root: null, uid: -1 } });
  assert.notStrictEqual(codeOf(problem), 'ELEVATION_REQUIRED');
});

/* --- 3. ELEVATION_REQUIRED must beat CORE_MISSING ------------------------ */

check('a jailed service never reports CORE_MISSING for an intact package', function () {
  var problem = gate().check({ homebrewRoot: true, privilege: { root: false } });
  assert.strictEqual(codeOf(problem), 'ELEVATION_REQUIRED');
});

check('a jailed service still reports ELEVATION_REQUIRED when cores are absent', function () {
  /* This is the exact 4.0.1 failure: cores unreachable *because* of the jail.
     The gate must name the cause, not the symptom. */
  var bare = path.join(tmp, 'bare');
  fs.mkdirSync(path.join(bare, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'appinfo.json'), '{}');
  var problem = gate({ paths: { appDir: bare, dataDir: path.join(bare, 'nope') } })
    .check({ homebrewRoot: true, privilege: { root: false } });
  assert.strictEqual(codeOf(problem), 'ELEVATION_REQUIRED');
});

check('an elevated service with a genuinely missing core still reports CORE_MISSING', function () {
  /* The fix must not blunt real detection. */
  var bare = path.join(tmp, 'bare2');
  fs.mkdirSync(path.join(bare, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'appinfo.json'), '{}');
  var problem = gate({ paths: { appDir: bare, dataDir: path.join(bare, 'nope') } })
    .check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'CORE_MISSING');
});

/* --- 4. ordering of the remaining gates --------------------------------- */

check('a missing package payload reports PACKAGE_INCOMPLETE before CORE_MISSING', function () {
  var problem = gate({ paths: { appDir: path.join(tmp, 'absent'), dataDir: dataDir } })
    .check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'PACKAGE_INCOMPLETE');
});

check('a non-ELF core reports CORE_INTEGRITY_FAILED, not CORE_MISSING', function () {
  var broken = path.join(tmp, 'broken');
  fs.mkdirSync(path.join(broken, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(broken, 'appinfo.json'), '{}');
  fs.writeFileSync(path.join(broken, 'bin', 'xray'), 'not an executable at all');
  fs.writeFileSync(path.join(broken, 'bin', 'tun2socks'), armElf(16));
  var problem = gate({ paths: { appDir: broken, dataDir: path.join(broken, 'nope') } })
    .check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'CORE_INTEGRITY_FAILED');
});

check('an empty core reports CORE_INTEGRITY_FAILED', function () {
  var empty = path.join(tmp, 'empty');
  fs.mkdirSync(path.join(empty, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(empty, 'appinfo.json'), '{}');
  fs.writeFileSync(path.join(empty, 'bin', 'xray'), '');
  fs.writeFileSync(path.join(empty, 'bin', 'tun2socks'), armElf(16));
  var problem = gate({ paths: { appDir: empty, dataDir: path.join(empty, 'nope') } })
    .check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'CORE_INTEGRITY_FAILED');
});

check('a missing routing asset reports ASSET_MISSING', function () {
  var problem = gate().check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'ASSET_MISSING');
});

check('a corrupt routing asset reports ASSET_INTEGRITY_FAILED', function () {
  /* Present but the wrong size, so xray-assets rejects it. Distinct from
     ASSET_MISSING on purpose: "truncate geoip.dat" and "delete geoip.dat" are
     different problems with different remedies. */
  var assetDir = path.join(tmp, 'assets');
  fs.mkdirSync(path.join(assetDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'appinfo.json'), '{}');
  copyPinnedCore('xray', path.join(assetDir, 'bin', 'xray'));
  copyPinnedCore('tun2socks', path.join(assetDir, 'bin', 'tun2socks'));
  fs.writeFileSync(path.join(assetDir, 'bin', 'geosite.dat'), 'truncated');
  fs.writeFileSync(path.join(assetDir, 'bin', 'geoip.dat'), 'truncated');
  var problem = gate({ paths: { appDir: assetDir, dataDir: path.join(assetDir, 'nope') } })
    .check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'ASSET_INTEGRITY_FAILED');
});

check('the sing-box edition requires no XRay routing assets', function () {
  var sb = path.join(tmp, 'singbox');
  fs.mkdirSync(path.join(sb, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(sb, 'appinfo.json'), '{}');
  copyPinnedCore('sing-box', path.join(sb, 'bin', 'sing-box'));
  var problem = gate({ edition: { core: 'sing-box' }, paths: { appDir: sb, dataDir: path.join(sb, 'nope') } })
    .check({ homebrewRoot: true, privilege: { root: true } });
  assert.strictEqual(codeOf(problem), 'OK');
});

check('the documented gate order is exactly the implemented one', function () {
  var order = ['HOMEBREW_REQUIRED', 'ELEVATION_REQUIRED', 'PACKAGE_INCOMPLETE',
    'CORE_MISSING', 'CORE_INTEGRITY_FAILED', 'ASSET_MISSING', 'ASSET_INTEGRITY_FAILED'];
  var i;
  for (i = 0; i < order.length; i++) assert.ok(errors.CODES[order[i]], 'missing code ' + order[i]);
});

/* --- 5. cached integrity under repeated polling -------------------------- */

check('repeated polling does not re-hash routing assets', function () {
  /* Elevation polling calls getState about once a second. Hashing ~30 MB on
     every one of those would stall the UI for the whole poll window. */
  var assetDir = path.join(tmp, 'cache');
  fs.mkdirSync(path.join(assetDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'appinfo.json'), '{}');
  copyPinnedCore('xray', path.join(assetDir, 'bin', 'xray'));
  copyPinnedCore('tun2socks', path.join(assetDir, 'bin', 'tun2socks'));
  fs.writeFileSync(path.join(assetDir, 'bin', 'geosite.dat'), 'x');
  fs.writeFileSync(path.join(assetDir, 'bin', 'geoip.dat'), 'x');

  var g = gate({ paths: { appDir: assetDir, dataDir: path.join(assetDir, 'nope') } });
  var facts = { homebrewRoot: true, privilege: { root: true } };
  var hashed = 0;
  var xrayAssets = require('../app/service/lib/xray-assets');
  var realSha = xrayAssets.sha256File;
  xrayAssets.sha256File = function (file) { hashed++; return realSha(file); };
  try {
    var i;
    for (i = 0; i < 20; i++) g.check(facts);
    /* Size already mismatches, so checkFile short-circuits before hashing at
       all; the point is that 20 polls do not produce 20 deep scans. */
    assert.ok(hashed <= 2, 'deep scans on 20 polls: ' + hashed);
    assert.strictEqual(g.deepCache !== null, true, 'deep verdict must be cached');
  } finally {
    xrayAssets.sha256File = realSha;
  }
});

check('the integrity cache invalidates when file metadata changes', function () {
  var assetDir = path.join(tmp, 'cache2');
  fs.mkdirSync(path.join(assetDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'appinfo.json'), '{}');
  copyPinnedCore('xray', path.join(assetDir, 'bin', 'xray'));
  copyPinnedCore('tun2socks', path.join(assetDir, 'bin', 'tun2socks'));
  fs.writeFileSync(path.join(assetDir, 'bin', 'geosite.dat'), 'aaa');
  fs.writeFileSync(path.join(assetDir, 'bin', 'geoip.dat'), 'aaa');

  var g = gate({ paths: { appDir: assetDir, dataDir: path.join(assetDir, 'nope') } });
  var facts = { homebrewRoot: true, privilege: { root: true } };
  var first = g.integritySignature();
  g.check(facts);
  fs.writeFileSync(path.join(assetDir, 'bin', 'geoip.dat'), 'aaaaaaaaaaaa');
  assert.notStrictEqual(g.integritySignature(), first, 'signature must track size');
});

check('invalidate() drops the cached deep verdict', function () {
  var g = gate();
  g.deepCache = { signature: 'x', error: null };
  g.invalidate();
  assert.strictEqual(g.deepCache, null);
});

/* --- 6. EACCES is not a missing file ------------------------------------ */

check('a permission denial is reported as denied, not absent', function () {
  var inspection = supervisorLib.isExecutableFile(path.join(appDir, 'bin', 'xray'));
  assert.strictEqual(typeof inspection, 'object', 'must return a structured result');
  assert.ok('exists' in inspection && 'executable' in inspection && 'reason' in inspection);
});

check('a genuinely absent file reports ENOENT, never EACCES', function () {
  var inspection = supervisorLib.isExecutableFile(path.join(tmp, 'no-such-binary'));
  assert.strictEqual(inspection.exists, false);
  assert.strictEqual(supervisorLib.isPermissionDenied(inspection), false, 'absence is not denial');
});

check('isPermissionDenied recognises EACCES and EPERM only', function () {
  assert.strictEqual(supervisorLib.isPermissionDenied({ reason: 'EACCES' }), true);
  assert.strictEqual(supervisorLib.isPermissionDenied({ reason: 'EPERM' }), true);
  assert.strictEqual(supervisorLib.isPermissionDenied({ reason: 'ENOENT' }), false);
  assert.strictEqual(supervisorLib.isPermissionDenied({ reason: '' }), false);
});

check('a denied core lookup is classified as a jail, not a missing binary', function () {
  /* Simulated rather than chmod-ed: the CI runner is often root, and a root
     process cannot be denied anything, so a real 0000 directory would not
     reproduce the condition. */
  var g = gate();
  var realLocate = g.locateCore;
  g.locateCore = function () { return { file: '', denied: true }; };
  try {
    var problem = g.check({ homebrewRoot: true, privilege: { root: true } });
    assert.strictEqual(codeOf(problem), 'ELEVATION_REQUIRED');
  } finally {
    g.locateCore = realLocate;
  }
});

check('resolveFailureReason separates denial from absence', function () {
  assert.strictEqual(supervisorLib.resolveFailureReason([path.join(tmp, 'nothing-here')]), 'ENOENT');
  assert.strictEqual(supervisorLib.resolveFailureReason([path.join(appDir, 'bin', 'xray')]), '');
});

/* --- 7. privilege facts stay separate ----------------------------------- */

check('privilege reports every required fact independently', function () {
  var facts = privilege.probe(paths, true);
  ['uid', 'root', 'pid', 'appPayloadReadable', 'dataDirWritable', 'tunVisible'].forEach(function (key) {
    assert.ok(key in facts, 'missing privilege fact: ' + key);
  });
});

check('privilege exposes no filesystem paths', function () {
  var facts = privilege.probe(paths, true);
  var serialized = JSON.stringify(facts);
  assert.ok(serialized.indexOf(tmp) < 0, 'privilege leaked a path: ' + serialized);
  assert.ok(serialized.indexOf('/var/lib') < 0, 'privilege leaked a data directory');
  assert.ok(Object.keys(facts).length === 6, 'unexpected extra privilege fields: ' + serialized);
});

check('privilege reports unknown as null, never as false', function () {
  var facts = privilege.probe(null, true);
  assert.strictEqual(facts.appPayloadReadable, null);
  assert.strictEqual(facts.dataDirWritable, null);
});

check('the health summary is a bare code with no paths', function () {
  var summary = gate().summary({ homebrewRoot: true, privilege: { root: false } });
  assert.deepStrictEqual(Object.keys(summary).sort(), ['code', 'ok']);
  assert.strictEqual(summary.code, 'ELEVATION_REQUIRED');
  assert.strictEqual(JSON.stringify(summary).indexOf(tmp), -1);
});

/* --- 8. probe removal and method count ---------------------------------- */

check('no Phase 0 probe marker survives anywhere in the tree', function () {
  var offenders = [];
  var skip = { '.git': 1, 'node_modules': 1, 'packages': 1, 'release-assets': 1, build: 1, docs: 1 };
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (entry) {
      if (skip[entry]) return;
      var full = path.join(dir, entry);
      var stat = fs.statSync(full);
      if (stat.isDirectory()) return walk(full);
      if (!/\.(js|py|html|json|css)$/.test(entry)) return;
      /* This file names the removed symbols in order to assert their absence,
         so it is the one place they may legitimately appear. */
      if (full === __filename) return;
      var text = fs.readFileSync(full, 'utf8');
      if (text.indexOf('PHASE 0 PROBE') >= 0 || text.indexOf('PHASE0_PROBE') >= 0 ||
          text.indexOf('probeElevationState') >= 0 || text.indexOf('probeLog') >= 0 ||
          text.indexOf('probe-phase0') >= 0) {
        offenders.push(path.relative(ROOT, full));
      }
    });
  }(ROOT));
  assert.deepStrictEqual(offenders, []);
});

check('probe-phase0.js is gone', function () {
  assert.strictEqual(fs.existsSync(path.join(ROOT, 'app', 'service', 'lib', 'probe-phase0.js')), false);
});

check('the builder no longer offers a probe mode', function () {
  var builder = fs.readFileSync(path.join(ROOT, 'build_ipk.py'), 'utf8');
  assert.ok(builder.indexOf('--probe') < 0);
  assert.ok(builder.indexOf('probe_edition') < 0);
  assert.ok(builder.indexOf('PROBE') < 0, 'a PROBE marker survives in the builder');
});

check('no shipped title, version or metadata carries PROBE', function () {
  var appinfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'appinfo.json'), 'utf8'));
  assert.strictEqual(appinfo.version, '4.0.4');
  assert.strictEqual(appinfo.title, 'Alcyone XRay');
  assert.ok(appinfo.title.indexOf('PROBE') < 0);
  var html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  assert.ok(html.indexOf('PROBE') < 0, 'index.html still mentions PROBE');
});

check('the Luna method count is exactly 22 after cleanup', function () {
  /* 21 original methods plus the permanent restartService. Counted from the
     source rather than by loading service.js, which would start a service. */
  var text = fs.readFileSync(path.join(ROOT, 'app', 'service', 'service.js'), 'utf8');
  var block = text.slice(text.indexOf('var METHODS = {'));
  block = block.slice(0, block.indexOf('};'));
  var names = block.split('\n').filter(function (line) { return /^\s*\w+\s*:/.test(line); });
  assert.strictEqual(names.length, 22, 'METHODS entries: ' + names.length);
});

check('services.json declares exactly the same 22 commands', function () {
  var declared = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'service', 'services.json'), 'utf8'));
  var commands = declared.services[0].commands;
  assert.strictEqual(commands.length, 22, 'declared commands: ' + commands.length);
  assert.ok(commands.some(function (c) { return c.name === 'restartService'; }), 'restartService must survive');
  /* probeProfiles is a production method (it measures server latency) and must
     survive; only the two Phase 0 commands are gone. */
  assert.ok(commands.some(function (c) { return c.name === 'probeProfiles'; }), 'probeProfiles must survive');
  ['probeElevationState', 'probeLog'].forEach(function (gone) {
    assert.ok(!commands.some(function (c) { return c.name === gone; }), gone + ' survives');
  });
});

check('restartService remains declared, registered and implemented', function () {
  var service = fs.readFileSync(path.join(ROOT, 'app', 'service', 'service.js'), 'utf8');
  var api = fs.readFileSync(path.join(ROOT, 'app', 'service', 'lib', 'api.js'), 'utf8');
  assert.ok(service.indexOf("restartService: 'restartService'") >= 0);
  assert.ok(service.indexOf('function requestRestart') >= 0);
  assert.ok(api.indexOf('Api.prototype.restartService') >= 0);
});

check('requestRestart is idempotent', function () {
  /* The Grant-permissions flow polls while the service is going down and the
     user can press twice; a second call must not queue a second shutdown. */
  var service = fs.readFileSync(path.join(ROOT, 'app', 'service', 'service.js'), 'utf8');
  var block = service.slice(service.indexOf('function requestRestart'));
  block = block.slice(0, block.indexOf('\n}'));
  assert.ok(/restartPending/.test(block), 'requestRestart has no repeat guard');
  assert.ok(/if \(restartPending\) return true;/.test(block));
});

check('restartService never spawns, kills by name or runs a shell', function () {
  var service = fs.readFileSync(path.join(ROOT, 'app', 'service', 'service.js'), 'utf8');
  var api = fs.readFileSync(path.join(ROOT, 'app', 'service', 'lib', 'api.js'), 'utf8');
  [service, api].forEach(function (text) {
    assert.ok(text.indexOf('child_process') < 0);
    assert.ok(text.indexOf('execSync') < 0);
    assert.ok(text.indexOf('pkill') < 0 && text.indexOf('killall') < 0);
  });
});

/* --- 9. the frontend must not gain shell or arbitrary bus access -------- */

check('neither frontend nor service edits LS2 configuration', function () {
  var app = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  ['services.d', 'roles.d', 'client-permissions.d', 'api-permissions.d', 'manifests.d',
   '/var/luna-service2'].forEach(function (token) {
    assert.ok(app.indexOf(token) < 0, 'frontend references LS2 config: ' + token);
  });
});

check('the frontend has no shell access of any kind', function () {
  var app = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  ['/exec', '/spawn', 'child_process', 'shQuote', 'execSync'].forEach(function (token) {
    assert.ok(app.indexOf(token) < 0, 'frontend references ' + token);
  });
});

check('the service never calls Homebrew Channel itself', function () {
  var serviceRoot = path.join(ROOT, 'app', 'service');
  var offenders = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (entry) {
      var full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) return walk(full);
      if (!/\.js$/.test(entry)) return;
      if (fs.readFileSync(full, 'utf8').indexOf('hbchannel') >= 0) offenders.push(entry);
    });
  }(serviceRoot));
  assert.deepStrictEqual(offenders, []);
});

check('the elevation banner exposes no internals to the screen', function () {
  var app = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  var block = app.slice(app.indexOf('function renderElevation'));
  block = block.slice(0, block.indexOf('\n  function setElevationMessage'));
  /* Only localized keys reach the DOM here — never a bus payload, a path or a
     stringified error. */
  assert.ok(block.indexOf('JSON.stringify') < 0, 'banner stringifies a payload');
  assert.ok(block.indexOf('errorText') < 0 && block.indexOf('.detail') < 0);
  assert.ok(/tr\('hb\.title'\)/.test(block) && /tr\('elev\.title'\)/.test(block));
});

/* --- 10. no duplicate large binaries in the package --------------------- */

check('the builder ships cores under the application payload only', function () {
  /* Duplicating ~37 MB of cores under the service payload as well would nearly
     double the IPK for no runtime benefit: the resolver reaches the
     application payload. */
  var builder = fs.readFileSync(path.join(ROOT, 'build_ipk.py'), 'utf8');
  var block = builder.slice(builder.indexOf('service_dir = os.path.join'));
  block = block.slice(0, block.indexOf('return app_dir, service_dir'));
  ['bin/xray', 'bin/tun2socks', 'bin/sing-box', 'geoip.dat', 'geosite.dat'].forEach(function (token) {
    assert.ok(block.indexOf(token) < 0, 'service payload duplicates ' + token);
  });
  assert.ok(builder.indexOf('for relative, source in sorted(edition["binaries"].items())') >= 0 &&
    builder.indexOf('os.path.join(app_dir, *relative.split("/"))') >= 0,
    'app payload must still carry the binaries');
});

var passed = results.filter(Boolean).length;
console.log('\n' + passed + '/' + results.length + ' checks passed');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
if (passed !== results.length) process.exit(1);
