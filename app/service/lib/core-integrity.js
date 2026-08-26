"use strict";
var crypto = require("crypto"),
  fs = require("fs"),
  path = require("path"),
  atomic = require("./atomic"),
  supervisorLib = require("./supervisor"),
  errors = require("./errors"),
  err = errors.err,
  PINNED_SHA256 = {
    "alcyone-exec":
      "14439016ddbfd9872fedff65a179993a03ccd0edeabae3c6771cea40d6a05068",
    "alcyone-netguard":
      "765d24c6645706dd6d2b5df6fedfe3e886e4fc6605916da3bb3fe6227e9ba08f",
    xray: "451bfccf7c86f08860296903479d8b92edccc507312b3eb338de33a7cb3dabfb",
    tun2socks:
      "b2bbe63f8144ce67a9f8839541428999302b68cd54fbf14f403c73be75cd719a",
    "sing-box":
      "e1db083cfc4fd9c6c93ce75eaeab9f6b59b490fe8258cd28e970ede28412f8e6",
  },
  COPY_BUFFER_BYTES = 65536,
  EXECUTABLE_MODE = 493;
function expectedFor(e) {
  var r = PINNED_SHA256[e];
  if (!r || !/^[0-9a-f]{64}$/.test(r))
    throw err(
      "CORE_INTEGRITY_FAILED",
      String(e || "core") + " has no pinned checksum",
    );
  return r;
}
function sha256File(e) {
  var r,
    c = crypto.createHash("sha256"),
    t =
      "function" == typeof Buffer.alloc
        ? Buffer.alloc(COPY_BUFFER_BYTES)
        : new Buffer(COPY_BUFFER_BYTES),
    i = null,
    a = 0;
  try {
    i = fs.openSync(e, "r");
    do {
      (r = fs.readSync(i, t, 0, t.length, a)) > 0 &&
        (c.update(r === t.length ? t : t.slice(0, r)), (a += r));
    } while (r > 0);
  } finally {
    if (null !== i)
      try {
        fs.closeSync(i);
      } catch (e) {}
  }
  return c.digest("hex");
}
function regularFile(e) {
  var r;
  try {
    return (r = fs.statSync(e)).isFile() ? r : null;
  } catch (e) {
    return null;
  }
}
function matches(e, r) {
  if (!regularFile(e)) return !1;
  try {
    return sha256File(e) === r;
  } catch (e) {
    return !1;
  }
}
function verifyPackaged(e, r) {
  var c = expectedFor(r);
  if (!regularFile(e))
    throw err("CORE_MISSING", r + " packaged binary missing");
  if (!matches(e, c))
    throw err("CORE_INTEGRITY_FAILED", r + " packaged checksum mismatch");
  return c;
}
function copyFileAtomic(e, r) {
  var c,
    t = r + ".integrity-" + String(process.pid || 0) + ".tmp",
    i = null,
    a = null,
    n =
      "function" == typeof Buffer.alloc
        ? Buffer.alloc(COPY_BUFFER_BYTES)
        : new Buffer(COPY_BUFFER_BYTES),
    f = 0;
  atomic.ensureOwnedDir(path.dirname(r));
  try {
    fs.unlinkSync(t);
  } catch (e) {}
  try {
    ((i = fs.openSync(e, "r")), (a = fs.openSync(t, "w", EXECUTABLE_MODE)));
    do {
      (c = fs.readSync(i, n, 0, n.length, f)) > 0 &&
        (fs.writeSync(a, n, 0, c, null), (f += c));
    } while (c > 0);
    try {
      fs.fsyncSync(a);
    } catch (e) {}
  } finally {
    if (null !== i)
      try {
        fs.closeSync(i);
      } catch (e) {}
    if (null !== a)
      try {
        fs.closeSync(a);
      } catch (e) {}
  }
  try {
    fs.chmodSync(t, EXECUTABLE_MODE);
  } catch (e) {}
  fs.renameSync(t, r);
}
function prepare(e, r, c) {
  var t = verifyPackaged(e, c);
  if (!matches(r, t))
    try {
      copyFileAtomic(e, r);
    } catch (e) {
      try {
        fs.unlinkSync(r + ".integrity-" + String(process.pid || 0) + ".tmp");
      } catch (e) {}
      throw err("CORE_INTEGRITY_FAILED", c + " staged restore failed");
    }
  if (!matches(r, t))
    throw err("CORE_INTEGRITY_FAILED", c + " staged checksum mismatch");
  try {
    fs.chmodSync(r, EXECUTABLE_MODE);
  } catch (e) {}
  if (!supervisorLib.isExecutableFile(r).executable)
    throw err("CORE_INTEGRITY_FAILED", c + " staged binary is not executable");
  return r;
}
function verifyForLaunch(e, r) {
  if (!matches(e, expectedFor(r)))
    throw err("CORE_INTEGRITY_FAILED", r + " launch checksum mismatch");
  if (!supervisorLib.isExecutableFile(e).executable)
    throw err("CORE_INTEGRITY_FAILED", r + " launch binary is not executable");
  return e;
}
module.exports = {
  PINNED_SHA256: PINNED_SHA256,
  expectedFor: expectedFor,
  sha256File: sha256File,
  matches: matches,
  verifyPackaged: verifyPackaged,
  copyFileAtomic: copyFileAtomic,
  prepare: prepare,
  verifyForLaunch: verifyForLaunch,
};
