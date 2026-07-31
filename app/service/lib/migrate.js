'use strict';

/* First-run initialization and data migration.

   This replaces the package maintainer scripts (preinst/postinst/prerm), which
   webOS does not run. Everything here is idempotent: it may run on every
   service start, twice concurrently, or after a partial failure, without
   corrupting or duplicating user data.

   Scope is strictly this edition's own directories. No other application's
   files or binaries are read, copied, moved or deleted. */

var fs = require('fs');
var path = require('path');
var atomic = require('./atomic');
var storeLib = require('./store/profiles');
var xrayAssets = require('./xray-assets');

var MIGRATION_VERSION = 6;

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch (e) { return false; }
}

function Migrator(options) {
  options = options || {};
  this.paths = options.paths;
  this.edition = options.edition;
  this.logger = options.logger;
  this.procRoot = options.procRoot || '/proc';
  this.procReadlink = options.procReadlink || fs.readlinkSync;
  this.kill = options.kill || process.kill;
}

/* Create this edition's directory tree with restrictive permissions. */
Migrator.prototype.ensureLayout = function () {
  var dataDir = this.paths.dataDir;
  atomic.ensureDir(dataDir);
  atomic.ensureDir(path.join(dataDir, 'bin'));
  atomic.ensureDir(path.dirname(this.paths.stateFile));
  return true;
};

/* Copy the packaged cores into the writable data directory when they are
   missing or the packaged copy is newer. Never downloads anything. */
Migrator.prototype.installBundledCores = function () {
  var appBin = path.join(this.paths.appDir, 'bin');
  var dataBin = path.join(this.paths.dataDir, 'bin');
  var names = this.edition.core === 'sing-box' ? ['sing-box'] : ['xray', 'tun2socks'];
  var installed = [];
  var i, source, target, sourceStat, targetStat, needsCopy;

  for (i = 0; i < names.length; i++) {
    source = path.join(appBin, names[i]);
    target = path.join(dataBin, names[i]);
    if (!fileExists(source)) continue;
    needsCopy = true;
    if (fileExists(target)) {
      try {
        sourceStat = fs.statSync(source);
        targetStat = fs.statSync(target);
        needsCopy = sourceStat.size !== targetStat.size || sourceStat.mtime.getTime() > targetStat.mtime.getTime();
      } catch (e) {
        needsCopy = true;
      }
    }
    if (!needsCopy) continue;
    try {
      /* Write to a temp name then rename, so a running core is never replaced
         underneath itself mid-write. */
      fs.writeFileSync(target + '.new', fs.readFileSync(source), { mode: 493 });
      fs.renameSync(target + '.new', target);
      try { fs.chmodSync(target, 493); } catch (eMode) {}
      installed.push(names[i]);
    } catch (copyError) {
      this.logger.warn('core install failed', { core: names[i] });
    }
  }
  if (installed.length) this.logger.info('bundled cores installed', { cores: installed.join(',') });
  return installed;
};

/* Install the checksum-pinned official routing databases beside the persisted
   Xray binary. A valid existing copy is retained; a corrupt copy is replaced
   only from a valid packaged source. */
Migrator.prototype.installBundledXrayAssets = function () {
  var appBin, dataBin, names, installed, i, name, source, target, problem;
  if (this.edition.core !== 'xray') return [];
  appBin = path.join(this.paths.appDir, 'bin');
  dataBin = path.join(this.paths.dataDir, 'bin');
  names = Object.keys(xrayAssets.ASSETS).sort();
  installed = [];

  for (i = 0; i < names.length; i++) {
    name = names[i];
    source = path.join(appBin, name);
    target = path.join(dataBin, name);
    problem = xrayAssets.checkFile(source, name);
    if (problem) {
      this.logger.warn('packaged Xray asset invalid', { asset: name, code: problem.code });
      continue;
    }
    if (!xrayAssets.checkFile(target, name)) continue;
    try {
      fs.writeFileSync(target + '.new', fs.readFileSync(source), { mode: 420 });
      fs.renameSync(target + '.new', target);
      try { fs.chmodSync(target, 420); } catch (eMode) {}
      problem = xrayAssets.checkFile(target, name);
      if (problem) throw problem;
      installed.push(name);
    } catch (copyError) {
      try { fs.unlinkSync(target + '.new'); } catch (eClean) {}
      this.logger.warn('Xray asset install failed', { asset: name });
    }
  }
  if (installed.length) this.logger.info('bundled Xray assets installed', { assets: installed.join(',') });
  return installed;
};

/* Normalize an existing store in place. Reading and rewriting through the
   store applies the current schema without losing any profile. */
Migrator.prototype.migrateStore = function () {
  var store = new storeLib.ProfileStore({ file: this.paths.storeFile, logger: this.logger });
  var before, after;
  if (!fileExists(this.paths.storeFile)) return { migrated: false, profiles: 0 };
  before = atomic.readJson(this.paths.storeFile, null);
  after = store.read();
  /* Only rewrite when normalization actually changed something, so upgrades
     do not churn the file needlessly. */
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    store.write(after);
    this.logger.info('profile store normalized', { profiles: after.profiles.length });
    return { migrated: true, profiles: after.profiles.length };
  }
  return { migrated: false, profiles: after.profiles.length };
};

function readPid(file) {
  var value;
  try { value = String(fs.readFileSync(file, 'utf8')).trim(); } catch (e) { return 0; }
  if (!/^[1-9]\d{0,9}$/.test(value)) return 0;
  value = parseInt(value, 10);
  return value > 1 ? value : 0;
}

/* Stop only processes proven to belong to this edition. A stale or malicious
   PID file can never be used to signal an unrelated system process. */
Migrator.prototype.stopLegacyProcesses = function () {
  var entries = [
    { file: 'alcyone-web.pid' },
    { file: 'xray.pid' },
    { file: 'sing-box.pid' },
    { file: 'tun2socks.pid' },
    { file: 'log-guard.pid' }
  ];
  var stopped = [], i, pid, command, matches;
  var dataDir = String(this.paths.dataDir || '');
  var appDir = String(this.paths.appDir || '');

  for (i = 0; i < entries.length; i++) {
    pid = readPid(path.join(dataDir, entries[i].file));
    if (!pid) continue;
    try {
      command = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\u0000/g, ' ');
    } catch (eRead) {
      continue;
    }
    matches = command.indexOf(dataDir) >= 0 || command.indexOf(appDir) >= 0;
    if (!matches) {
      this.logger.warn('ignored untrusted legacy pid', { file: entries[i].file });
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      stopped.push(pid);
      (function (legacyPid) {
        setTimeout(function () {
          try { process.kill(legacyPid, 0); process.kill(legacyPid, 'SIGKILL'); } catch (eGone) {}
        }, 500);
      })(pid);
    } catch (eKill) {}
  }
  if (stopped.length) this.logger.info('legacy processes stopped', { count: stopped.length });
  return stopped;
};

/* A service restart loses Supervisor's in-memory child table. Recover only
   processes whose kernel-owned executable link is exactly one of this
   edition's staged core files; command names, PID files and arguments alone
   are never sufficient to signal a process. This runs before staged binaries
   can be refreshed during an upgrade. */
Migrator.prototype.stopOwnedCoreOrphans = function () {
  var names = this.edition.core === 'sing-box' ? ['sing-box'] : ['xray', 'tun2socks'];
  var expected = {};
  var entries, stopped = [], i, pid, executable;
  for (i = 0; i < names.length; i++) {
    expected[path.join(this.paths.dataDir, 'bin', names[i])] = true;
  }
  try {
    entries = fs.readdirSync(this.procRoot);
  } catch (readError) {
    return stopped;
  }
  for (i = 0; i < entries.length; i++) {
    if (!/^[1-9]\d*$/.test(entries[i])) continue;
    pid = parseInt(entries[i], 10);
    if (!pid || pid === process.pid) continue;
    try {
      executable = this.procReadlink(path.join(this.procRoot, entries[i], 'exe'));
    } catch (linkError) {
      continue;
    }
    if (!expected[executable]) continue;
    try {
      this.kill(pid, 'SIGTERM');
      stopped.push(pid);
    } catch (killError) {}
  }
  if (stopped.length) this.logger.info('owned core orphans stopped', { count: stopped.length });
  return stopped;
};

/* Convert the retired shell route.state into the JSON shape understood by the
   new RouteManager. It is then rolled back by VpnManager.recover(). */
Migrator.prototype.migrateLegacyRouteState = function () {
  var file = this.paths.routeState;
  var raw, parsed, values = {}, lines, i, match, addresses;
  if (!fileExists(file)) return false;
  parsed = atomic.readJson(file, null);
  if (parsed && parsed.original) return false;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return false; }
  lines = raw.split(/\r?\n/);
  for (i = 0; i < lines.length; i++) {
    match = /^([A-Z_]+)='([^']*)'$/.exec(lines[i].trim());
    if (match) values[match[1]] = match[2];
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(values.ORIG_DEV || '')) {
    atomic.removeQuiet(file);
    return false;
  }
  if (values.ORIG_GW && !/^[0-9a-fA-F:.]+$/.test(values.ORIG_GW)) {
    atomic.removeQuiet(file);
    return false;
  }
  addresses = String(values.SERVER_IPS || values.SERVER_IP || '')
    .split(/\s+/).filter(function (address) { return /^[0-9a-fA-F:.]+$/.test(address); });
  atomic.writeJsonAtomic(file, {
    original: {
      gateway: values.ORIG_GW || '',
      device: values.ORIG_DEV,
      raw: ''
    },
    serverAddresses: addresses,
    serverRoutes: {},
    core: this.edition.core,
    savedAt: Date.now(),
    migratedLegacy: true
  });
  this.logger.info('legacy route state converted for rollback');
  return true;
};

/* Remove artefacts of the retired shell-based implementation. Only files
   inside this edition's own data directory are touched. */
Migrator.prototype.cleanupLegacyArtifacts = function () {
  var dataDir = this.paths.dataDir;
  var stale = [
    'alcyone-web.pid', 'xray.pid', 'sing-box.pid', 'tun2socks.pid',
    'log-guard.pid', 'route.env', 'core-install.log'
  ];
  var removed = [], i;
  for (i = 0; i < stale.length; i++) {
    if (atomic.removeQuiet(path.join(dataDir, stale[i]))) removed.push(stale[i]);
  }
  if (removed.length) this.logger.info('legacy runtime files removed', { count: removed.length });
  return removed;
};

Migrator.prototype.readState = function () {
  return atomic.readJson(this.paths.stateFile, { migrationVersion: 0 });
};

Migrator.prototype.writeState = function (state) {
  atomic.writeJsonAtomic(this.paths.stateFile, state);
};

/* Run every initialization step. Safe to call on each service start. */
Migrator.prototype.run = function () {
  var state = this.readState();
  var summary;

  this.ensureLayout();
  this.stopLegacyProcesses();
  this.stopOwnedCoreOrphans();
  this.migrateLegacyRouteState();
  this.installBundledCores();
  this.installBundledXrayAssets();
  summary = this.migrateStore();
  this.cleanupLegacyArtifacts();

  if (state.migrationVersion !== MIGRATION_VERSION) {
    this.logger.info('migration applied', { from: state.migrationVersion || 0, to: MIGRATION_VERSION });
  }
  state.migrationVersion = MIGRATION_VERSION;
  state.lastStart = Date.now();
  state.edition = this.edition.id;
  this.writeState(state);
  return { migrationVersion: MIGRATION_VERSION, profiles: summary.profiles };
};

module.exports = {
  MIGRATION_VERSION: MIGRATION_VERSION,
  Migrator: Migrator
};
