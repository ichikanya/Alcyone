"use strict";
var fs = require("fs"),
  CACHE_MS = 2e3,
  cached = null,
  cachedAt = 0,
  cachedKey = "";
function readRoot() {
  if ("function" != typeof process.getuid) return null;
  try {
    return 0 === process.getuid();
  } catch (e) {
    return null;
  }
}
function readUid() {
  if ("function" != typeof process.getuid) return -1;
  try {
    return process.getuid();
  } catch (e) {
    return -1;
  }
}
function accessMode(e, a) {
  return fs.constants && void 0 !== fs.constants[e]
    ? fs.constants[e]
    : void 0 !== fs[e]
      ? fs[e]
      : a;
}
function canAccess(e, a) {
  if (!e) return null;
  if ("function" != typeof fs.accessSync || void 0 === a) return null;
  try {
    return (fs.accessSync(e, a), !0);
  } catch (e) {
    return (
      (!e ||
        ("ENOENT" !== e.code && "EACCES" !== e.code && "EPERM" !== e.code)) &&
      null
    );
  }
}
function readAppPayloadReadable(e) {
  var a = e && e.appDir;
  if (!a) return null;
  var c = accessMode("R_OK", 4),
    r = accessMode("X_OK", 1);
  return void 0 === c || void 0 === r ? null : canAccess(a + "/bin", c | r);
}
function readDataDirWritable(e) {
  var a = e && e.dataDir;
  if (!a) return null;
  var c = accessMode("W_OK", 2),
    r = accessMode("X_OK", 1);
  return void 0 === c || void 0 === r ? null : canAccess(a, c | r);
}
function readTunVisible() {
  var e = accessMode("R_OK", 4);
  return void 0 === e ? null : canAccess("/dev/net/tun", e);
}
function copy(e) {
  return {
    uid: e.uid,
    root: e.root,
    pid: e.pid,
    appPayloadReadable: e.appPayloadReadable,
    dataDirWritable: e.dataDirWritable,
    tunVisible: e.tunVisible,
  };
}
function cacheKey(e) {
  return e ? String(e.appDir || "") + " " + String(e.dataDir || "") : "-";
}
function probe(e, a) {
  var c = Date.now(),
    r = cacheKey(e);
  return (
    (!a && cached && r === cachedKey && c - cachedAt < CACHE_MS) ||
      ((cached = {
        uid: readUid(),
        root: readRoot(),
        pid: "number" == typeof process.pid ? process.pid : -1,
        appPayloadReadable: readAppPayloadReadable(e),
        dataDirWritable: readDataDirWritable(e),
        tunVisible: readTunVisible(),
      }),
      (cachedAt = c),
      (cachedKey = r)),
    copy(cached)
  );
}
function invalidate() {
  ((cached = null), (cachedAt = 0), (cachedKey = ""));
}
module.exports = { CACHE_MS: CACHE_MS, probe: probe, invalidate: invalidate };
