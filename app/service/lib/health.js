'use strict';

/* The ordered installation health gate.

   One gate, checked in a fixed order, first failure wins, later checks are not
   attempted. The ordering is the whole point of this module and is not an
   implementation detail:

     1  supported Homebrew root environment   HOMEBREW_REQUIRED
     2  Alcyone service elevation             ELEVATION_REQUIRED
     3  package payload                       PACKAGE_INCOMPLETE
     4  core presence                         CORE_MISSING
     5  core integrity                        CORE_INTEGRITY_FAILED
     6  asset presence                        ASSET_MISSING
     7  asset integrity                       ASSET_INTEGRITY_FAILED

   Why the order matters. On the target TV `/var/lib/alcyone` is
   `drwx------ root root`, so a jailed service cannot traverse it and every
   filesystem check below gate 2 answers EACCES. Running those checks first is
   exactly how a reset elevation came to be reported as "the VPN core is
   missing from the package" — a message that sends the user looking for a
   broken download when the package is fine and only the LS2 configuration was
   reset by the last install. Gate 2 therefore always precedes gates 3-7, and
   gate 1 always precedes gate 2 because a TV without a rooted Homebrew Channel
   has no in-app remedy at all and must not be offered one.

   Cost. Gates 1 and 2 are free. Gates 3, 4 and 6 are a handful of stat calls.
   Gate 5 reads 20 bytes. Only gate 7 is expensive — sha256 over ~30 MB of
   routing data — so its result is cached against a cheap size+mtime signature
   and recomputed only when that signature changes. Elevation polling calls
   getState about once a second; nothing here may turn that into a repeated
   30 MB scan.

   Written to ES5 for the Node runtime on webOS 4. */

var fs = require('fs');
var path = require('path');
var errors = require('./errors');
var err = errors.err;
var xrayAssets = require('./xray-assets');

/* Assets each edition must be able to prove are intact. sing-box carries its
   routing data inside the core binary and has none. */
var REQUIRED_ASSETS = {
  xray: ['geosite.dat', 'geoip.dat'],
  'sing-box': []
};

var CORE_NAMES = {
  xray: ['xray', 'tun2socks'],
  'sing-box': ['sing-box']
};

/* ELF e_machine per Node architecture, used only to catch a package built for
   the wrong CPU. */
var ARCH_MACHINES = {
  arm: 40,
  /* A 64-bit ARM Linux userspace normally retains the kernel's AArch32
     compatibility layer. Alcyone deliberately ships ARMv7 cores, so accepting
     e_machine 40 here prevents a false "wrong architecture" health failure on
     an otherwise compatible ARM64 webOS device. */
  arm64: [183, 40],
  ia32: 3,
  x64: 62
};

function machineMatchesRuntime(machine, platform, architecture) {
  var expected = ARCH_MACHINES[architecture];
  if (platform !== 'linux' || expected === undefined) return true;
  if (Object.prototype.toString.call(expected) === '[object Array]') {
    return expected.indexOf(machine) >= 0;
  }
  return machine === expected;
}

function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch (e) {
    return null;
  }
}

/* A permission denial is never evidence of absence. Anything that cannot see
   the filesystem must fall through rather than accuse the package. */
function statDenied(target) {
  try {
    fs.statSync(target);
    return false;
  } catch (e) {
    return !!e && (e.code === 'EACCES' || e.code === 'EPERM');
  }
}

function HealthGate(options) {
  options = options || {};
  this.edition = options.edition || {};
  this.paths = options.paths || {};
  this.logger = options.logger || null;
  this.serviceDir = options.serviceDir || path.join(__dirname, '..');
  this.deepCache = null;
}

/* --- gate 3: package payload ------------------------------------------- */

HealthGate.prototype.checkPackage = function () {
  var appDir = this.paths.appDir;
  var required, i, target, stat;

  if (!appDir) return null;
  required = [
    { path: appDir + '/appinfo.json', kind: 'file' },
    { path: appDir + '/bin', kind: 'dir' },
    { path: this.serviceDir + '/service.js', kind: 'file' }
  ];
  for (i = 0; i < required.length; i++) {
    target = required[i].path;
    stat = statOrNull(target);
    if (stat) {
      if (required[i].kind === 'dir' ? stat.isDirectory() : stat.isFile()) continue;
      return err('PACKAGE_INCOMPLETE', 'package component has the wrong type');
    }
    /* Cannot see it is not the same as it is not there. */
    if (statDenied(target)) continue;
    return err('PACKAGE_INCOMPLETE', 'package component missing');
  }
  return null;
};

/* --- gates 4 and 5: cores ---------------------------------------------- */

/* Candidate locations for one core. Health judges the package payload first:
   a damaged staged copy is repairable and must not prevent connect() from
   atomically restoring it from the verified package binary. */
HealthGate.prototype.coreCandidates = function (name) {
  var out = [];
  if (this.paths.appDir) out.push(this.paths.appDir + '/bin/' + name);
  out.push(path.resolve(this.serviceDir, 'bin', name));
  if (this.paths.dataDir) out.push(this.paths.dataDir + '/bin/' + name);
  return out;
};

/* First candidate that exists as a regular file, ignoring executability: gate
   4 asks "is it there", gate 5 asks "is it usable". */
HealthGate.prototype.locateCore = function (name) {
  var candidates = this.coreCandidates(name);
  var i, stat, denied = false;
  for (i = 0; i < candidates.length; i++) {
    stat = statOrNull(candidates[i]);
    if (stat && stat.isFile()) return { file: candidates[i], size: stat.size, mtime: stat.mtime ? stat.mtime.getTime() : 0 };
    if (statDenied(candidates[i])) denied = true;
  }
  return { file: '', denied: denied };
};

function elfMachine(file) {
  var fd = null;
  /* Buffer.alloc does not exist on Node 0.12; the legacy constructor does not
     exist in spirit on modern Node. Support both. */
  var buffer = typeof Buffer.alloc === 'function' ? Buffer.alloc(20) : new Buffer(20);
  var read = 0;
  try {
    fd = fs.openSync(file, 'r');
    read = fs.readSync(fd, buffer, 0, 20, 0);
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (eClose) {} }
  }
  if (read < 20) return null;
  if (buffer[0] !== 0x7f || buffer[1] !== 0x45 || buffer[2] !== 0x4c || buffer[3] !== 0x46) return null;
  /* e_machine is a 16-bit field at offset 18, endianness per EI_DATA. */
  return buffer[5] === 1 ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
}

HealthGate.prototype.checkCores = function () {
  var names = CORE_NAMES[this.edition.core] || CORE_NAMES.xray;
  var i, located, machine;

  for (i = 0; i < names.length; i++) {
    located = this.locateCore(names[i]);
    if (!located.file) {
      /* A jail cannot see the core; that is gate 2's business, not a missing
         file. Reaching here with `denied` means the ordering was bypassed, so
         report the jail rather than inventing an absent binary. */
      if (located.denied) return err('ELEVATION_REQUIRED', 'core not visible to a jailed service');
      return err('CORE_MISSING', names[i] + ' binary missing');
    }
    if (!located.size) return err('CORE_INTEGRITY_FAILED', names[i] + ' binary is empty');

    machine = elfMachine(located.file);
    if (machine === null) return err('CORE_INTEGRITY_FAILED', names[i] + ' binary is not an ELF executable');
    /* Only enforce the CPU match where the binary is actually going to be
       executed. A workstation test tree holds ARM cores on an x86 host, and
       failing there would say nothing about the shipped package. */
    if (!machineMatchesRuntime(machine, process.platform, process.arch)) {
      return err('CORE_INTEGRITY_FAILED', names[i] + ' binary targets the wrong architecture');
    }
  }
  return null;
};

/* --- gates 6 and 7: routing assets -------------------------------------- */

HealthGate.prototype.locateAsset = function (name) {
  var candidates = [];
  var i, stat, denied = false;
  if (this.paths.dataDir) candidates.push(this.paths.dataDir + '/bin/' + name);
  if (this.paths.appDir) candidates.push(this.paths.appDir + '/bin/' + name);
  for (i = 0; i < candidates.length; i++) {
    stat = statOrNull(candidates[i]);
    if (stat && stat.isFile()) return { file: candidates[i], size: stat.size, mtime: stat.mtime ? stat.mtime.getTime() : 0 };
    if (statDenied(candidates[i])) denied = true;
  }
  return { file: '', denied: denied };
};

HealthGate.prototype.checkAssetPresence = function () {
  var names = REQUIRED_ASSETS[this.edition.core] || [];
  var i, located;
  for (i = 0; i < names.length; i++) {
    located = this.locateAsset(names[i]);
    if (located.file) continue;
    if (located.denied) return err('ELEVATION_REQUIRED', 'asset not visible to a jailed service');
    return err('ASSET_MISSING', 'required routing asset missing');
  }
  return null;
};

/* Cheap identity of everything gate 7 would hash. When this string is
   unchanged, the previous verdict is still true and re-hashing 30 MB would
   produce the same answer at the cost of a visible stall on every poll. */
HealthGate.prototype.integritySignature = function () {
  var names = REQUIRED_ASSETS[this.edition.core] || [];
  var parts = [];
  var i, located;
  for (i = 0; i < names.length; i++) {
    located = this.locateAsset(names[i]);
    parts.push(names[i] + ':' + located.file + ':' + (located.size || 0) + ':' + (located.mtime || 0));
  }
  return parts.join('|');
};

/* Gate 7. Uses xray-assets.checkFile verbatim — it already owns the pinned
   sizes and hashes, and a second hasher would be a second thing to keep
   correct. Only the resulting code is remapped: ASSET_CORRUPT is the legacy
   spelling, ASSET_INTEGRITY_FAILED the current one. */
HealthGate.prototype.checkAssetIntegrity = function () {
  var names = REQUIRED_ASSETS[this.edition.core] || [];
  var signature, i, located, problem;

  if (!names.length) return null;
  signature = this.integritySignature();
  if (this.deepCache && this.deepCache.signature === signature) {
    return this.deepCache.error;
  }

  problem = null;
  for (i = 0; i < names.length; i++) {
    located = this.locateAsset(names[i]);
    if (!located.file) continue; /* gate 6 already ruled on presence */
    problem = xrayAssets.checkFile(located.file, names[i]);
    if (problem) {
      if (problem.code === 'ASSET_CORRUPT') problem = err('ASSET_INTEGRITY_FAILED', 'routing asset failed its integrity check');
      else problem = err(problem.code, 'required routing asset missing');
      break;
    }
  }

  this.deepCache = { signature: signature, error: problem };
  return problem;
};

/* Drop the cached deep verdict. Called when installation or lifecycle state
   changes underneath us; ordinary polling must never reach this. */
HealthGate.prototype.invalidate = function () {
  this.deepCache = null;
};

/* --- the gate ----------------------------------------------------------- */

/* `facts.homebrewRoot`  true | false | null
     null means "not determined yet" and must not be read as a failure — the
     prerequisite is only reported unmet when a read-only checkRoot actually
     failed to confirm root.
   `facts.privilege.root` true | false | null
     null means the runtime cannot report uid at all. Same rule: do not
     conclude. uid 0 is the authoritative elevation condition, and no
     filesystem fact substitutes for it. */
HealthGate.prototype.check = function (facts) {
  facts = facts || {};
  var privilege = facts.privilege || {};
  var problem;

  /* 1 — the hard prerequisite. Wins over everything, including a jail. */
  if (facts.homebrewRoot === false) {
    return err('HOMEBREW_REQUIRED', 'Homebrew Channel is not available as root');
  }

  /* 2 — Alcyone's own elevation. Wins over every filesystem check below. */
  if (privilege.root === false) {
    return err('ELEVATION_REQUIRED', 'the Alcyone service is not running as uid 0');
  }

  problem = this.checkPackage();
  if (problem) return problem;
  problem = this.checkCores();
  if (problem) return problem;
  problem = this.checkAssetPresence();
  if (problem) return problem;
  return this.checkAssetIntegrity();
};

/* Sanitized summary for getState.

   Deliberately a code and nothing else: no filesystem paths, no candidate
   lists, no reasons that would leak where anything lives. The frontend needs
   to know what to tell the user, not where to look. */
HealthGate.prototype.summary = function (facts) {
  var problem = this.check(facts);
  return {
    ok: !problem,
    code: problem ? problem.code : 'OK'
  };
};

module.exports = {
  REQUIRED_ASSETS: REQUIRED_ASSETS,
  CORE_NAMES: CORE_NAMES,
  ARCH_MACHINES: ARCH_MACHINES,
  machineMatchesRuntime: machineMatchesRuntime,
  HealthGate: HealthGate
};
