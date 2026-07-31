'use strict';

/* Runtime privilege facts.

   Root is granted by Homebrew Channel's elevate-service mechanism, never by
   anything this service does. This module only *observes* the result.

   Why it exists: a jailed service and a package with missing cores look
   identical to the core resolver. `supervisor.isExecutableFile()` used to treat
   an EACCES from the jail exactly like a missing file, so `connect()` reported
   CORE_MISSING when the real problem is that elevation was reset by the last
   package install. Observing the process identity separates the two.

   Observation only: no shell, no spawn, no writes, no directory creation. The
   filesystem facts below are read-only access probes — `fs.accessSync` asks the
   kernel a question, it does not touch, create or modify anything under the
   data directory.

   Separation of facts is deliberate. `uid === 0` is the *authoritative* Alcyone
   elevation condition. `appPayloadReadable`, `dataDirWritable` and `tunVisible`
   are independent diagnostics that are frequently *consequences* of the jail,
   never substitutes for it: a genuinely elevated service with a damaged data
   directory must not be misreported as un-elevated, and a jailed service that
   happens to see /dev/net/tun must not be reported as elevated.

   Written to ES5 for the Node runtime on webOS 4. */

var fs = require('fs');

var CACHE_MS = 2000;

var cached = null;
var cachedAt = 0;
var cachedKey = '';

/* uid === 0 is the authoritative elevation condition on the target platform.

   When the runtime does not expose getuid (workstation tests on a platform
   without POSIX ids) the honest answer is `null` — unknown — not `false`.
   Reporting false there would invent an elevation failure that no caller can
   verify, and callers are expected to treat null as "do not conclude". */
function readRoot() {
  if (typeof process.getuid !== 'function') return null;
  try {
    return process.getuid() === 0;
  } catch (e) {
    return null;
  }
}

function readUid() {
  if (typeof process.getuid !== 'function') return -1;
  try {
    return process.getuid();
  } catch (e) {
    return -1;
  }
}

function accessMode(name, fallback) {
  if (fs.constants && fs.constants[name] !== undefined) return fs.constants[name];
  if (fs[name] !== undefined) return fs[name];
  return fallback;
}

/* Read-only access probe. `null` means "could not determine", which is not the
   same as `false` and must never be treated as one. */
function canAccess(target, mode) {
  if (!target) return null;
  if (typeof fs.accessSync !== 'function' || mode === undefined) return null;
  try {
    fs.accessSync(target, mode);
    return true;
  } catch (e) {
    /* ENOENT is a genuine "not there"; EACCES is a genuine "not permitted".
       Both are legitimate `false` answers to the question asked. Anything else
       is an unknown and stays null so no caller concludes from noise. */
    if (e && (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'EPERM')) return false;
    return null;
  }
}

/* Does this process see the packaged application payload?

   A jailed service can usually still read the application tree, so this being
   true says nothing about elevation. It is recorded because a *false* value
   distinguishes a broken or partial installation from a jail. */
function readAppPayloadReadable(paths) {
  var appDir = paths && paths.appDir;
  if (!appDir) return null;
  var r = accessMode('R_OK', 4);
  var x = accessMode('X_OK', 1);
  if (r === undefined || x === undefined) return null;
  return canAccess(appDir + '/bin', r | x);
}

/* Can this process write its own data directory?

   On the target TV `/var/lib/alcyone` is `drwx------ root root`, so a jailed
   uid 5033 service answers false. That is a *symptom* of the jail and is
   reported as its own fact — it is never folded into the elevation decision. */
function readDataDirWritable(paths) {
  var dataDir = paths && paths.dataDir;
  if (!dataDir) return null;
  var w = accessMode('W_OK', 2);
  var x = accessMode('X_OK', 1);
  if (w === undefined || x === undefined) return null;
  return canAccess(dataDir, w | x);
}

/* Is the TUN device node visible?

   Purely diagnostic: it tells a support reader whether the kernel exposes
   /dev/net/tun at all, which is a different failure from being un-elevated. */
function readTunVisible() {
  var r = accessMode('R_OK', 4);
  if (r === undefined) return null;
  return canAccess('/dev/net/tun', r);
}

/* A fresh object every call: the cache must never hand out a reference a
   caller could mutate. */
function copy(source) {
  return {
    uid: source.uid,
    root: source.root,
    pid: source.pid,
    appPayloadReadable: source.appPayloadReadable,
    dataDirWritable: source.dataDirWritable,
    tunVisible: source.tunVisible
  };
}

function cacheKey(paths) {
  if (!paths) return '-';
  return String(paths.appDir || '') + ' ' + String(paths.dataDir || '');
}

/* `paths` is optional. Without it the filesystem facts stay null (unknown)
   rather than guessing at a location, and only the process identity is
   reported. */
function probe(paths, force) {
  var now = Date.now();
  var key = cacheKey(paths);
  if (!force && cached && key === cachedKey && (now - cachedAt) < CACHE_MS) return copy(cached);
  cached = {
    uid: readUid(),
    root: readRoot(),
    pid: typeof process.pid === 'number' ? process.pid : -1,
    appPayloadReadable: readAppPayloadReadable(paths),
    dataDirWritable: readDataDirWritable(paths),
    tunVisible: readTunVisible()
  };
  cachedAt = now;
  cachedKey = key;
  return copy(cached);
}

/* Called after anything that could change the process identity, so the next
   read crosses the cache window. */
function invalidate() {
  cached = null;
  cachedAt = 0;
  cachedKey = '';
}

module.exports = {
  CACHE_MS: CACHE_MS,
  probe: probe,
  invalidate: invalidate
};
