'use strict';

/* Child process supervision for the VPN cores.

   Every process here is launched with `child_process.spawn` using an absolute
   executable path resolved from a fixed allow-list and an argument *array*.
   `shell` is never enabled, so no argument can be reinterpreted as a command.
   User-controlled text never becomes an argument: profile data reaches the
   cores exclusively through a JSON config file written by the store.

   The supervisor owns start, readiness waiting, crash notification and
   shutdown. It deliberately does not know about routes: the routing manager
   subscribes to the exit callback so a crashed core triggers route rollback. */

var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var errors = require('./errors');
var err = errors.err;

var MAX_PROCESSES = 4;
var STOP_GRACE_MS = 2500;

/* uid 0 is the only state in which chmod on a packaged binary can succeed, and
   `null` (unknown runtime) is deliberately not treated as root. */
function runningAsRoot() {
  if (typeof process.getuid !== 'function') return null;
  try {
    return process.getuid() === 0;
  } catch (e) {
    return null;
  }
}

/* A permission denial is not a missing file.

   On the target TV `/var/lib/alcyone` is `drwx------ root root`. A jailed
   service (uid 5033) cannot traverse it, so `statSync` on a core inside it
   raises EACCES. The previous boolean form collapsed that into the same
   `false` a genuinely absent binary produces, `resolveExecutable()` returned
   '', and `connect()` reported CORE_MISSING for what was really a reset
   elevation. Reporting the reason separately is what makes the two
   distinguishable — it does not make a genuinely missing or non-executable
   file pass. */
function isExecutableFile(file) {
  var result = { exists: false, executable: false, reason: '' };
  var stat, reStat, xMode;

  if (!file) {
    result.reason = 'ENOENT';
    return result;
  }
  try {
    stat = fs.statSync(file);
  } catch (e) {
    result.reason = (e && e.code) ? String(e.code) : 'ESTAT';
    return result;
  }
  if (!stat.isFile()) {
    result.reason = 'ENOTFILE';
    return result;
  }
  result.exists = true;

  /* Only root can repair a packaged mode bit. A jailed service attempting it
     raises EPERM every time and the failure says nothing useful, so it is not
     attempted at all. */
  if (runningAsRoot() === true && (stat.mode & 73) === 0) {
    try { fs.chmodSync(file, 511); } catch (eChmod) {}
  }

  xMode = (fs.constants && fs.constants.X_OK !== undefined) ? fs.constants.X_OK : fs.X_OK;
  if (typeof fs.accessSync === 'function' && xMode !== undefined) {
    try {
      fs.accessSync(file, xMode);
      result.executable = true;
      return result;
    } catch (eAccess) {
      result.reason = (eAccess && eAccess.code) ? String(eAccess.code) : 'EACCES';
    }
  }

  try {
    reStat = fs.statSync(file);
    if ((reStat.mode & 73) !== 0 || runningAsRoot() === true) {
      result.executable = true;
      result.reason = '';
    } else if (!result.reason) {
      result.reason = 'ENOEXEC';
    }
  } catch (eReStat) {
    if (!result.reason) result.reason = (eReStat && eReStat.code) ? String(eReStat.code) : 'ESTAT';
  }
  return result;
}

/* True when the answer was "not permitted to look", which must never be
   reported as "not there". */
function isPermissionDenied(inspection) {
  return !!inspection && (inspection.reason === 'EACCES' || inspection.reason === 'EPERM');
}

/* Resolve a core binary from a fixed candidate list. Nothing outside this
   app's own directories or its data directory is ever considered, and the
   result is always an absolute path we verified is executable. */
function resolveExecutable(candidates) {
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (candidates[i] && isExecutableFile(candidates[i]).executable) return candidates[i];
  }
  return '';
}

/* Why the whole candidate list failed, so a caller can tell a jail from a
   genuinely incomplete package. Returns '' when something did resolve. */
function resolveFailureReason(candidates) {
  var i, inspection, denied = false;
  for (i = 0; i < candidates.length; i++) {
    if (!candidates[i]) continue;
    inspection = isExecutableFile(candidates[i]);
    if (inspection.executable) return '';
    if (isPermissionDenied(inspection)) denied = true;
    else if (inspection.exists) return 'ENOEXEC';
  }
  return denied ? 'EACCES' : 'ENOENT';
}

function Supervisor(options) {
  options = options || {};
  this.logger = options.logger;
  this.children = {};
  this.onExit = options.onExit || null;
  this.maxProcesses = options.maxProcesses || MAX_PROCESSES;
  this.stopGraceMs = options.stopGraceMs || STOP_GRACE_MS;
  this.generation = 0;
}

Supervisor.prototype.count = function () {
  return Object.keys(this.children).length;
};

Supervisor.prototype.isRunning = function (name) {
  var entry = this.children[name];
  return !!entry && !entry.exited;
};

/* Identity is deliberately object-based. A process name is a stable label, not
   a lifetime identity: a late event from generation A must never describe or
   stop generation B. */
Supervisor.prototype.isEntryRunning = function (entry) {
  return !!entry && this.children[entry.name] === entry && !entry.exited;
};

/* Spawn a supervised core. `args` must be an array of plain strings. */
Supervisor.prototype.start = function (name, executable, args, spawnOptions) {
  var self = this;
  var child, i, entry;

  if (this.isRunning(name)) throw err('ALREADY_RUNNING', name);
  if (this.children[name] && this.children[name].exited) delete this.children[name];
  if (this.count() >= this.maxProcesses) throw err('BUSY', 'process limit reached');
  /* Shape of argv is checked before touching the filesystem so the contract
     "argument arrays only, never a command string" is enforced everywhere. */
  if (Object.prototype.toString.call(args) !== '[object Array]') {
    throw err('INVALID_PARAMS', 'args must be an array');
  }
  for (i = 0; i < args.length; i++) {
    if (typeof args[i] !== 'string') throw err('INVALID_PARAMS', 'args must be strings');
  }
  if (!executable || !path.isAbsolute(executable)) throw err('CORE_MISSING', name);
  /* The health gate runs long before this, so reaching here with an unusable
     path is defensive. Still classify honestly: a jail must not masquerade as
     a missing binary even on the backstop path. */
  var inspection = isExecutableFile(executable);
  if (!inspection.executable) {
    if (isPermissionDenied(inspection)) throw err('ELEVATION_REQUIRED', name);
    if (inspection.exists) throw err('CORE_INTEGRITY_FAILED', name);
    throw err('CORE_MISSING', name);
  }

  spawnOptions = spawnOptions || {};
  /* webOS Node 0.12/8 has a native-core quirk: sing-box aborts when its
     ignored streams are expanded to an equivalent-looking three-element
     array. Preserve the explicit single 'ignore' mode; numeric descriptors
     continue through the controlled stdout/stderr array below. */
  var childStdio = spawnOptions.stdio === 'ignore'
    ? 'ignore'
    : ['ignore', spawnOptions.stdio || 'ignore', spawnOptions.stdio || 'ignore'];
  child = childProcess.spawn(executable, args, {
    /* No shell, ever: argv is passed straight to execve. */
    shell: false,
    detached: false,
    stdio: childStdio,
    env: spawnOptions.env || { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' },
    cwd: spawnOptions.cwd || '/'
  });

  /* The termination facts are kept on the entry, not just logged, so a failure
     path can report exactly how the child died instead of inferring it. */
  entry = {
    name: name,
    generation: ++this.generation,
    child: child,
    pid: child.pid,
    exited: false,
    exitCode: null,
    exitSignal: '',
    spawnErrorCode: '',
    startedAt: Date.now()
  };
  this.children[name] = entry;

  child.on('error', function (spawnError) {
    if (self.children[name] !== entry) return;
    entry.exited = true;
    entry.spawnError = true;
    entry.spawnErrorCode = (spawnError && spawnError.code) ? String(spawnError.code) : 'spawn error';
    if (self.logger) self.logger.error('core spawn failed', { core: name, detail: entry.spawnErrorCode });
    self.handleExit(entry, null, 'spawn-error');
  });
  child.on('exit', function (code, signal) {
    if (self.children[name] !== entry || entry.exited) return;
    entry.exited = true;
    entry.exitCode = code;
    entry.exitSignal = signal ? String(signal) : '';
    if (self.logger) self.logger.warn('core exited', { core: name, code: code, signal: entry.exitSignal });
    self.handleExit(entry, code, signal);
  });

  if (this.logger) this.logger.info('core started', { core: name, pid: child.pid });
  return entry;
};

/* Read-only view of a child's bookkeeping, including one that has already
   exited. A failure path must be able to read the exit facts before cleanup
   removes the entry. */
Supervisor.prototype.entryFor = function (name) {
  return Object.prototype.hasOwnProperty.call(this.children, name) ? this.children[name] : null;
};

Supervisor.prototype.handleExit = function (entry, code, signal) {
  if (!entry || this.children[entry.name] !== entry) return;
  if (this.onExit) {
    try { this.onExit(entry.name, code, signal, entry); } catch (e) {}
  }
};

/* Terminate one child, escalating to SIGKILL after a grace period. */
Supervisor.prototype.stop = function (name, callback) {
  var entry = this.children[name];
  var self = this;
  var timer;
  var finished = false;

  callback = callback || function () {};
  if (!entry) return callback();
  if (entry.exited) { delete this.children[name]; return callback(); }

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (self.children[name] === entry) delete self.children[name];
    callback();
  }

  entry.child.once('exit', finish);
  try { entry.child.kill('SIGTERM'); } catch (e) {}
  timer = setTimeout(function () {
    try { entry.child.kill('SIGKILL'); } catch (e2) {}
    finish();
  }, this.stopGraceMs);
};

/* Stop everything we own. Used by disconnect, failed startup cleanup and
   service shutdown, so partial state never survives. */
Supervisor.prototype.stopAll = function (callback) {
  var names = Object.keys(this.children);
  var pending = names.length;
  var self = this;
  var i;

  callback = callback || function () {};
  if (!pending) return callback();
  for (i = 0; i < names.length; i++) {
    this.stop(names[i], function () {
      pending--;
      if (pending <= 0) callback();
    });
  }
  void self;
};

Supervisor.prototype.status = function () {
  var out = {}, name, entry;
  for (name in this.children) {
    if (!Object.prototype.hasOwnProperty.call(this.children, name)) continue;
    entry = this.children[name];
    out[name] = { pid: entry.pid, running: !entry.exited, startedAt: entry.startedAt };
  }
  return out;
};

/* Poll a predicate until it succeeds, the child dies, or we time out. */
function waitFor(check, options, callback) {
  var interval = (options && options.interval) || 250;
  var timeout = (options && options.timeout) || 12000;
  var isAlive = (options && options.isAlive) || function () { return true; };
  var waited = 0;
  var timer = null;
  var settled = false;

  function cancel() {
    if (settled) return;
    settled = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function attempt() {
    if (settled) return;
    if (options && options.isCurrent && !options.isCurrent()) return cancel();
    if (!isAlive()) {
      settled = true;
      return callback(err('CORE_START_FAILED', 'core exited during startup'));
    }
    var done = false;
    try { done = !!check(); } catch (e) { done = false; }
    if (done) {
      settled = true;
      return callback(null);
    }
    waited += interval;
    if (waited >= timeout) {
      settled = true;
      return callback(err('TUN_NOT_READY', 'timeout'));
    }
    timer = setTimeout(attempt, interval);
  }
  timer = setTimeout(attempt, interval);
  return { cancel: cancel };
}

module.exports = {
  MAX_PROCESSES: MAX_PROCESSES,
  STOP_GRACE_MS: STOP_GRACE_MS,
  Supervisor: Supervisor,
  isExecutableFile: isExecutableFile,
  isPermissionDenied: isPermissionDenied,
  resolveExecutable: resolveExecutable,
  resolveFailureReason: resolveFailureReason,
  waitFor: waitFor
};
