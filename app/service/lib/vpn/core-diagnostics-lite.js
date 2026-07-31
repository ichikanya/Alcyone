'use strict';

/* Small production failure record. It never spawns, reads /proc, validates a
   second config, or performs a network/socket probe. */

var fs = require('fs');
var STREAM_KEEP_BYTES = 2048;
var FIELD_MAX = 180;

function scrub(value) {
  var text = String(value === null || value === undefined ? '' : value);
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  text = text.replace(/[a-z0-9+.-]+:\/\/\S*/gi, '[uri]');
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]');
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address]');
  text = text.replace(/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/gi, '[hostname]');
  return text;
}

function boundStream(value) {
  var raw = String(value === null || value === undefined ? '' : value);
  var bytes = raw.length;
  if (bytes > STREAM_KEEP_BYTES) raw = raw.slice(bytes - STREAM_KEEP_BYTES);
  raw = scrub(raw).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (raw.length > FIELD_MAX) raw = raw.slice(0, FIELD_MAX) + '<clipped>';
  return { text: raw || '<empty>', bytes: bytes, truncated: bytes > STREAM_KEEP_BYTES };
}

function readSince(file, offset, maxBytes) {
  var start = typeof offset === 'number' && offset >= 0 ? offset : 0;
  var limit = maxBytes || STREAM_KEEP_BYTES;
  var fd = null, size, length, buffer, read;
  if (!file) return '';
  try {
    size = fs.statSync(file).size;
    if (size <= start) return '';
    length = Math.min(size - start, limit);
    start = size - length;
    buffer = typeof Buffer.alloc === 'function' ? Buffer.alloc(length) : new Buffer(length);
    fd = fs.openSync(file, 'r');
    read = fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8', 0, read > 0 ? read : 0);
  } catch (e) {
    return '';
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (closeError) {} }
  }
}

function report(logger, options) {
  options = options || {};
  var output = boundStream(options.coreOutputText);
  var records = [
    ['core diagnostics: launch', {
      pid: options.pid === null || options.pid === undefined ? '' : options.pid,
      exitCode: options.exitCode === null || options.exitCode === undefined ? '' : options.exitCode,
      signal: scrub(options.exitSignal || ''),
      spawnError: scrub(options.spawnErrorCode || '')
    }],
    ['core diagnostics: output', {
      stream: 'stdout-stderr', bytes: output.bytes,
      truncated: output.truncated, text: output.text
    }],
    ['core diagnostics: stage', { failureStage: scrub(options.failureStage || 'startup') }]
  ];
  var i;
  try {
    if (logger) for (i = 0; i < records.length; i++) logger.warn(records[i][0], records[i][1]);
  } catch (e) {}
  return { records: records, stage: options.failureStage || 'startup' };
}

module.exports = {
  STREAM_KEEP_BYTES: STREAM_KEEP_BYTES,
  FIELD_MAX: FIELD_MAX,
  scrub: scrub,
  boundStream: boundStream,
  readSince: readSince,
  report: report
};
