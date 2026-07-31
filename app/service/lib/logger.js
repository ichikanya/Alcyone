'use strict';

/* Bounded diagnostic logging.

   Logs are read from the TV UI and may be photographed for support, so they
   must never contain secrets: no links, UUIDs, passwords, subscription URLs or
   pairing tokens. Callers pass a short English message plus a small metadata
   object whose values are scrubbed here.

   The file is size-capped in place. When it grows past the limit we keep only
   the tail, so a long-running tunnel cannot fill the TV's storage. */

var fs = require('fs');
var crypto = require('crypto');
var atomic = require('./atomic');

var MAX_BYTES = 256 * 1024;
var KEEP_BYTES = 64 * 1024;
var MAX_DETAIL = 200;

/* Keys whose values are always secret, whatever the caller intended. */
var SECRET_KEYS = /(pass|password|token|secret|uuid|key|auth|cred|link|url|cookie|session|pairing|hwid|deviceid)/i;

function newRunId() {
  try {
    return crypto.randomBytes(6).toString('hex');
  } catch (e) {
    return (String(Date.now().toString(16)) + String(process.pid || 0).toString(16)).slice(-12);
  }
}


function scrubValue(value) {
  var text;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  text = String(value);
  /* Defence in depth: strip anything that looks like a credential-bearing URI. */
  text = text.replace(/[a-z0-9+.-]+:\/\/\S*/gi, '[uri]');
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]');
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return text.slice(0, MAX_DETAIL);
}

function formatMeta(meta) {
  var parts = [], key, value;
  if (!meta || typeof meta !== 'object') return '';
  for (key in meta) {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
    value = SECRET_KEYS.test(key) ? '[redacted]' : scrubValue(meta[key]);
    if (value === '') continue;
    parts.push(key + '=' + value);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function Logger(options) {
  options = options || {};
  this.file = options.file || '';
  this.maxBytes = options.maxBytes || MAX_BYTES;
  this.keepBytes = options.keepBytes || KEEP_BYTES;
  this.echo = !!options.echo;
  /* One ephemeral identifier is shared by the service and core-log views for
     this process lifetime, so retained lines remain distinguishable after a
     restart without persisting device or profile identity. */
  this.runId = /^[0-9a-f]{8,32}$/i.test(String(options.runId || '')) ?
    String(options.runId).toLowerCase() : newRunId();
  this.source = options.source || 'service';
  /* Keep startup failures readable even when the service has not yet gained
     permission to create its persistent data directory. */
  this.memory = [];
  this.memoryLimit = options.memoryLimit || 500;
}

/* Rewrite `file` in place, preserving the inode.

   The tunnel log is held open by the core processes, which were spawned with
   an appending descriptor. Replacing the file via temp-and-rename would leave
   those children writing into an unlinked inode, silently killing tunnel
   logging until the next reconnect. Truncating through the same inode keeps
   their descriptor valid: O_APPEND writes simply resume at the new end. */
function rewriteInPlace(file, text) {
  var fd = fs.openSync(file, 'r+');
  var buffer = new Buffer(text, 'utf8');
  try {
    if (buffer.length) fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.ftruncateSync(fd, buffer.length);
    try { fs.fsyncSync(fd); } catch (eSync) {}
  } finally {
    fs.closeSync(fd);
  }
}

function capFile(file, maxBytes, keepBytes) {
  var size, fd, buffer, text, cut;
  maxBytes = maxBytes || MAX_BYTES;
  keepBytes = keepBytes || KEEP_BYTES;
  if (!file) return false;
  try {
    size = fs.statSync(file).size;
    if (size <= maxBytes) return false;
    fd = fs.openSync(file, 'r');
    buffer = new Buffer(Math.min(keepBytes, size));
    try {
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
    } finally {
      fs.closeSync(fd);
    }
    text = buffer.toString('utf8');
    cut = text.indexOf('\n');
    if (cut >= 0) text = text.slice(cut + 1);
    rewriteInPlace(file, text);
    return true;
  } catch (e) {
    return false;
  }
}

Logger.prototype.write = function (level, message, meta) {
  var line = new Date().toISOString() + ' ' + level + ' run=' + this.runId +
    ' source=' + scrubValue(this.source) + ' ' + scrubValue(message) + formatMeta(meta) + '\n';
  var persisted = false;
  if (this.echo) process.stdout.write(line);
  if (this.file) {
    try {
      atomic.ensureDir(require('path').dirname(this.file));
      fs.appendFileSync(this.file, line, { mode: atomic.FILE_MODE });
      this.capIfNeeded();
      persisted = true;
    } catch (e) {}
  }
  this.memory.push({ line: line, persisted: persisted });
  if (this.memory.length > this.memoryLimit) {
    this.memory.splice(0, this.memory.length - this.memoryLimit);
  }
  return line;
};

Logger.prototype.info = function (message, meta) { return this.write('INFO', message, meta); };
Logger.prototype.warn = function (message, meta) { return this.write('WARN', message, meta); };
Logger.prototype.error = function (message, meta) { return this.write('ERROR', message, meta); };

/* Trim in place so the log file has a hard upper bound on disk. */
Logger.prototype.capIfNeeded = function () {
  return capFile(this.file, this.maxBytes, this.keepBytes);
};

Logger.prototype.tail = function (maxLines) {
  var text = atomic.readTextSafe(this.file, '');
  var pending = [], i;
  for (i = 0; i < this.memory.length; i++) {
    if (!this.memory[i].persisted) pending.push(this.memory[i].line);
  }
  if (pending.length) text += (text && text.charAt(text.length - 1) !== '\n' ? '\n' : '') + pending.join('');
  var lines = text.split('\n');
  var limit = maxLines || 200;
  if (lines.length > limit) lines = lines.slice(lines.length - limit);
  return lines.join('\n').replace(/^\n+/, '');
};

/* Empty the log without replacing it: see rewriteInPlace. Clearing while the
   tunnel is up must not detach the core's descriptor, or the user would clear
   the log once and never see core output again. */
Logger.prototype.clear = function () {
  this.memory = [];
  if (!this.file) return true;
  try {
    if (!fs.existsSync(this.file)) return true;
    rewriteInPlace(this.file, '');
    return true;
  } catch (e) {
    return false;
  }
};

module.exports = {
  MAX_BYTES: MAX_BYTES,
  KEEP_BYTES: KEEP_BYTES,
  Logger: Logger,
  capFile: capFile,
  rewriteInPlace: rewriteInPlace,
  scrubValue: scrubValue,
  formatMeta: formatMeta,
  newRunId: newRunId
};
