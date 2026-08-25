"use strict";
var fs = require("fs"),
  crypto = require("crypto"),
  atomic = require("./atomic"),
  MAX_BYTES = 262144,
  KEEP_BYTES = 65536,
  MAX_DETAIL = 200,
  SECRET_KEYS =
    /(pass|password|token|secret|uuid|key|auth|cred|link|url|cookie|session|pairing|hwid|deviceid)/i;
function newRunId() {
  try {
    return crypto.randomBytes(6).toString("hex");
  } catch (e) {
    return (
      String(Date.now().toString(16)) + String(process.pid || 0).toString(16)
    ).slice(-12);
  }
}
function scrubValue(e) {
  return null == e
    ? ""
    : "number" == typeof e || "boolean" == typeof e
      ? String(e)
      : String(e)
          .replace(/[a-z0-9+.-]+:\/\/\S*/gi, "[uri]")
          .replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            "[uuid]",
          )
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .slice(0, MAX_DETAIL);
}
function formatMeta(e) {
  var t,
    r,
    i = [];
  if (!e || "object" != typeof e) return "";
  for (t in e)
    Object.prototype.hasOwnProperty.call(e, t) &&
      "" !== (r = SECRET_KEYS.test(t) ? "[redacted]" : scrubValue(e[t])) &&
      i.push(t + "=" + r);
  return i.length ? " " + i.join(" ") : "";
}
function Logger(e) {
  ((e = e || {}),
    (this.file = e.file || ""),
    (this.maxBytes = e.maxBytes || MAX_BYTES),
    (this.keepBytes = e.keepBytes || KEEP_BYTES),
    (this.echo = !!e.echo),
    (this.runId = /^[0-9a-f]{8,32}$/i.test(String(e.runId || ""))
      ? String(e.runId).toLowerCase()
      : newRunId()),
    (this.source = e.source || "service"),
    (this.memory = []),
    (this.memoryLimit = e.memoryLimit || 500));
}
function rewriteInPlace(e, t) {
  var r = fs.openSync(e, "r+"),
    i = new Buffer(t, "utf8");
  try {
    (i.length && fs.writeSync(r, i, 0, i.length, 0),
      fs.ftruncateSync(r, i.length));
    try {
      fs.fsyncSync(r);
    } catch (e) {}
  } finally {
    fs.closeSync(r);
  }
}
function capFile(e, t, r) {
  var i, n, o, s, c;
  if (((t = t || MAX_BYTES), (r = r || KEEP_BYTES), !e)) return !1;
  try {
    if ((i = fs.statSync(e).size) <= t) return !1;
    ((n = fs.openSync(e, "r")), (o = new Buffer(Math.min(r, i))));
    try {
      fs.readSync(n, o, 0, o.length, i - o.length);
    } finally {
      fs.closeSync(n);
    }
    return (
      (c = (s = o.toString("utf8")).indexOf("\n")) >= 0 && (s = s.slice(c + 1)),
      rewriteInPlace(e, s),
      !0
    );
  } catch (e) {
    return !1;
  }
}
((Logger.prototype.write = function (e, t, r) {
  var i =
      new Date().toISOString() +
      " " +
      e +
      " run=" +
      this.runId +
      " source=" +
      scrubValue(this.source) +
      " " +
      scrubValue(t) +
      formatMeta(r) +
      "\n",
    n = !1;
  if ((this.echo && process.stdout.write(i), this.file))
    try {
      (atomic.ensureOwnedDir(require("path").dirname(this.file)),
        fs.appendFileSync(this.file, i, { mode: atomic.FILE_MODE }),
        this.capIfNeeded(),
        (n = !0));
    } catch (e) {}
  return (
    this.memory.push({ line: i, persisted: n }),
    this.memory.length > this.memoryLimit &&
      this.memory.splice(0, this.memory.length - this.memoryLimit),
    i
  );
}),
  (Logger.prototype.info = function (e, t) {
    return this.write("INFO", e, t);
  }),
  (Logger.prototype.warn = function (e, t) {
    return this.write("WARN", e, t);
  }),
  (Logger.prototype.error = function (e, t) {
    return this.write("ERROR", e, t);
  }),
  (Logger.prototype.capIfNeeded = function () {
    return capFile(this.file, this.maxBytes, this.keepBytes);
  }),
  (Logger.prototype.tail = function (e) {
    var t,
      r = atomic.readTextSafe(this.file, ""),
      i = [];
    for (t = 0; t < this.memory.length; t++)
      this.memory[t].persisted || i.push(this.memory[t].line);
    i.length &&
      (r += (r && "\n" !== r.charAt(r.length - 1) ? "\n" : "") + i.join(""));
    var n = r.split("\n"),
      o = e || 200;
    return (
      n.length > o && (n = n.slice(n.length - o)),
      n.join("\n").replace(/^\n+/, "")
    );
  }),
  (Logger.prototype.clear = function () {
    if (((this.memory = []), !this.file)) return !0;
    try {
      return !fs.existsSync(this.file) || (rewriteInPlace(this.file, ""), !0);
    } catch (e) {
      return !1;
    }
  }),
  (module.exports = {
    MAX_BYTES: MAX_BYTES,
    KEEP_BYTES: KEEP_BYTES,
    Logger: Logger,
    capFile: capFile,
    rewriteInPlace: rewriteInPlace,
    scrubValue: scrubValue,
    formatMeta: formatMeta,
    newRunId: newRunId,
  }));
