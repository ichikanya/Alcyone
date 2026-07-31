'use strict';

/* Runtime integrity for native VPN cores.

   The hashes below are release pins, not values learned from the filesystem.
   build_ipk.py verifies the same values against cores/provenance.json before a
   package can be produced. Runtime staging follows a fail-closed sequence:

     1. hash the packaged executable;
     2. hash the staged executable, if present;
     3. atomically replace a missing or invalid stage only from the verified
        packaged executable;
     4. hash the staged result again;
     5. hash it once more immediately before spawn (owned by VpnManager).

   Nothing in getState calls this module. Large cores are therefore not hashed
   during health polling, while every staging and launch path still receives a
   cryptographic verdict. Written for Node.js 0.12 / ES5. */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var atomic = require('./atomic');
var supervisorLib = require('./supervisor');
var errors = require('./errors');
var err = errors.err;

var PINNED_SHA256 = {
  xray: '2b861a00e052ca2faad8d50d62934e3706e2e059f1c2efb1f24a9e44659885ff',
  tun2socks: 'b2bbe63f8144ce67a9f8839541428999302b68cd54fbf14f403c73be75cd719a',
  'sing-box': 'e1db083cfc4fd9c6c93ce75eaeab9f6b59b490fe8258cd28e970ede28412f8e6'
};

var COPY_BUFFER_BYTES = 64 * 1024;
var EXECUTABLE_MODE = 493; /* 0755 */

function expectedFor(name) {
  var expected = PINNED_SHA256[name];
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw err('CORE_INTEGRITY_FAILED', String(name || 'core') + ' has no pinned checksum');
  }
  return expected;
}

function sha256File(file) {
  var digest = crypto.createHash('sha256');
  var buffer = typeof Buffer.alloc === 'function'
    ? Buffer.alloc(COPY_BUFFER_BYTES)
    : new Buffer(COPY_BUFFER_BYTES);
  var fd = null;
  var offset = 0;
  var read;
  try {
    fd = fs.openSync(file, 'r');
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (read > 0) {
        digest.update(read === buffer.length ? buffer : buffer.slice(0, read));
        offset += read;
      }
    } while (read > 0);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (closeError) {}
    }
  }
  return digest.digest('hex');
}

function regularFile(file) {
  var stat;
  try {
    stat = fs.statSync(file);
    return stat.isFile() ? stat : null;
  } catch (e) {
    return null;
  }
}

function matches(file, expected) {
  if (!regularFile(file)) return false;
  try {
    return sha256File(file) === expected;
  } catch (e) {
    return false;
  }
}

function verifyPackaged(file, name) {
  var expected = expectedFor(name);
  if (!regularFile(file)) throw err('CORE_MISSING', name + ' packaged binary missing');
  if (!matches(file, expected)) throw err('CORE_INTEGRITY_FAILED', name + ' packaged checksum mismatch');
  return expected;
}

function copyFileAtomic(source, target) {
  var temporary = target + '.integrity-' + String(process.pid || 0) + '.tmp';
  var sourceFd = null;
  var targetFd = null;
  var buffer = typeof Buffer.alloc === 'function'
    ? Buffer.alloc(COPY_BUFFER_BYTES)
    : new Buffer(COPY_BUFFER_BYTES);
  var offset = 0;
  var read;

  atomic.ensureDir(path.dirname(target));
  try { fs.unlinkSync(temporary); } catch (removeError) {}

  try {
    sourceFd = fs.openSync(source, 'r');
    targetFd = fs.openSync(temporary, 'w', EXECUTABLE_MODE);
    do {
      read = fs.readSync(sourceFd, buffer, 0, buffer.length, offset);
      if (read > 0) {
        fs.writeSync(targetFd, buffer, 0, read, null);
        offset += read;
      }
    } while (read > 0);
    try { fs.fsyncSync(targetFd); } catch (syncError) {}
  } finally {
    if (sourceFd !== null) {
      try { fs.closeSync(sourceFd); } catch (sourceCloseError) {}
    }
    if (targetFd !== null) {
      try { fs.closeSync(targetFd); } catch (targetCloseError) {}
    }
  }

  try { fs.chmodSync(temporary, EXECUTABLE_MODE); } catch (modeError) {}
  fs.renameSync(temporary, target);
}

function prepare(packaged, staged, name) {
  var expected = verifyPackaged(packaged, name);

  if (!matches(staged, expected)) {
    try {
      copyFileAtomic(packaged, staged);
    } catch (copyError) {
      try { fs.unlinkSync(staged + '.integrity-' + String(process.pid || 0) + '.tmp'); } catch (removeError) {}
      throw err('CORE_INTEGRITY_FAILED', name + ' staged restore failed');
    }
  }

  /* This second hash covers both an existing stage and the atomic restore. */
  if (!matches(staged, expected)) {
    throw err('CORE_INTEGRITY_FAILED', name + ' staged checksum mismatch');
  }
  try { fs.chmodSync(staged, EXECUTABLE_MODE); } catch (modeError) {}
  if (!supervisorLib.isExecutableFile(staged).executable) {
    throw err('CORE_INTEGRITY_FAILED', name + ' staged binary is not executable');
  }
  return staged;
}

/* Must be called in the final synchronous step before child_process.spawn. */
function verifyForLaunch(file, name) {
  var expected = expectedFor(name);
  if (!matches(file, expected)) {
    throw err('CORE_INTEGRITY_FAILED', name + ' launch checksum mismatch');
  }
  if (!supervisorLib.isExecutableFile(file).executable) {
    throw err('CORE_INTEGRITY_FAILED', name + ' launch binary is not executable');
  }
  return file;
}

module.exports = {
  PINNED_SHA256: PINNED_SHA256,
  expectedFor: expectedFor,
  sha256File: sha256File,
  matches: matches,
  verifyPackaged: verifyPackaged,
  copyFileAtomic: copyFileAtomic,
  prepare: prepare,
  verifyForLaunch: verifyForLaunch
};
