'use strict';

/* Atomic, restrictive-permission persistence.

   Profile stores hold proxy credentials, so every file this module writes is
   created 0600 inside a 0700 directory. Writes go to a temporary file which is
   fsynced and then renamed, so an interrupted write can never leave a
   truncated store behind. On read we transparently recover from a leftover
   temporary file if the main file is missing or corrupt. */

var fs = require('fs');
var path = require('path');

var DIR_MODE = 448;  /* 0700 */
var FILE_MODE = 384; /* 0600 */

function ensureDir(dir) {
  var parent;
  if (!dir || dir === path.sep) return;
  if (fs.existsSync(dir)) {
    try { fs.chmodSync(dir, DIR_MODE); } catch (e) {}
    return;
  }
  parent = path.dirname(dir);
  if (parent && parent !== dir) ensureDir(parent);
  try { fs.mkdirSync(dir, DIR_MODE); } catch (e) {
    if (!fs.existsSync(dir)) throw e;
  }
  try { fs.chmodSync(dir, DIR_MODE); } catch (e2) {}
}

/* Write durably: temp file -> fsync -> rename. Rename is atomic on the same
   filesystem, so readers observe either the old or the new content. */
function writeFileAtomic(file, data, mode) {
  var tmp = file + '.tmp';
  var fd;
  ensureDir(path.dirname(file));
  fd = fs.openSync(tmp, 'w', mode || FILE_MODE);
  try {
    fs.writeSync(fd, data, 0, Buffer.byteLength(data, 'utf8'), null);
    try { fs.fsyncSync(fd); } catch (eSync) {}
  } finally {
    fs.closeSync(fd);
  }
  try { fs.chmodSync(tmp, mode || FILE_MODE); } catch (eMode) {}
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, value, mode) {
  writeFileAtomic(file, JSON.stringify(value, null, 2), mode);
}

/* Read JSON, falling back to a recoverable temp file from an interrupted
   write. Returns `fallback` when nothing usable exists. */
function readJson(file, fallback) {
  var raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    try {
      raw = fs.readFileSync(file + '.tmp', 'utf8');
      return JSON.parse(raw);
    } catch (e2) {
      return fallback;
    }
  }
}

function readTextSafe(file, fallback) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return fallback === undefined ? '' : fallback; }
}

function removeQuiet(file) {
  try { fs.unlinkSync(file); return true; } catch (e) { return false; }
}

function fileRevision(file) {
  try {
    var stat = fs.statSync(file);
    return String(stat.size) + '-' + String(stat.mtime.getTime());
  } catch (e) {
    return 'missing';
  }
}

module.exports = {
  DIR_MODE: DIR_MODE,
  FILE_MODE: FILE_MODE,
  ensureDir: ensureDir,
  writeFileAtomic: writeFileAtomic,
  writeJsonAtomic: writeJsonAtomic,
  readJson: readJson,
  readTextSafe: readTextSafe,
  removeQuiet: removeQuiet,
  fileRevision: fileRevision
};
