"use strict";
var fs = require("fs"),
  path = require("path"),
  errors = require("./errors"),
  err = errors.err,
  xrayAssets = require("./xray-assets"),
  REQUIRED_ASSETS = { xray: ["geosite.dat", "geoip.dat"], "sing-box": [] },
  CORE_NAMES = { xray: ["xray", "tun2socks"], "sing-box": ["sing-box"] },
  ARCH_MACHINES = { arm: 40, arm64: [183, 40], ia32: 3, x64: 62 };
function machineMatchesRuntime(e, t, r) {
  var i = ARCH_MACHINES[r];
  return (
    "linux" !== t ||
    void 0 === i ||
    ("[object Array]" === Object.prototype.toString.call(i)
      ? i.indexOf(e) >= 0
      : e === i)
  );
}
function statOrNull(e) {
  try {
    return fs.statSync(e);
  } catch (e) {
    return null;
  }
}
function statDenied(e) {
  try {
    return (fs.statSync(e), !1);
  } catch (e) {
    return !!e && ("EACCES" === e.code || "EPERM" === e.code);
  }
}
function HealthGate(e) {
  ((e = e || {}),
    (this.edition = e.edition || {}),
    (this.paths = e.paths || {}),
    (this.logger = e.logger || null),
    (this.serviceDir = e.serviceDir || path.join(__dirname, "..")),
    (this.deepCache = null));
}
function elfMachine(e) {
  var t = null,
    r = "function" == typeof Buffer.alloc ? Buffer.alloc(20) : new Buffer(20),
    i = 0;
  try {
    ((t = fs.openSync(e, "r")), (i = fs.readSync(t, r, 0, 20, 0)));
  } catch (e) {
    return null;
  } finally {
    if (null !== t)
      try {
        fs.closeSync(t);
      } catch (e) {}
  }
  return i < 20 || 127 !== r[0] || 69 !== r[1] || 76 !== r[2] || 70 !== r[3]
    ? null
    : 1 === r[5]
      ? r.readUInt16LE(18)
      : r.readUInt16BE(18);
}
((HealthGate.prototype.checkPackage = function () {
  var e,
    t,
    r,
    i,
    n = this.paths.appDir;
  if (!n) return null;
  for (
    e = [
      { path: n + "/appinfo.json", kind: "file" },
      { path: n + "/bin", kind: "dir" },
      { path: this.serviceDir + "/service.js", kind: "file" },
    ],
      t = 0;
    t < e.length;
    t++
  ) {
    if ((i = statOrNull((r = e[t].path)))) {
      if ("dir" === e[t].kind ? i.isDirectory() : i.isFile()) continue;
      return err("PACKAGE_INCOMPLETE", "package component has the wrong type");
    }
    if (!statDenied(r))
      return err("PACKAGE_INCOMPLETE", "package component missing");
  }
  return null;
}),
  (HealthGate.prototype.coreCandidates = function (e) {
    var t = [];
    return (
      this.paths.appDir && t.push(this.paths.appDir + "/bin/" + e),
      t.push(path.resolve(this.serviceDir, "bin", e)),
      this.paths.dataDir && t.push(this.paths.dataDir + "/bin/" + e),
      t
    );
  }),
  (HealthGate.prototype.locateCore = function (e) {
    var t,
      r,
      i = this.coreCandidates(e),
      n = !1;
    for (t = 0; t < i.length; t++) {
      if ((r = statOrNull(i[t])) && r.isFile())
        return {
          file: i[t],
          size: r.size,
          mtime: r.mtime ? r.mtime.getTime() : 0,
        };
      statDenied(i[t]) && (n = !0);
    }
    return { file: "", denied: n };
  }),
  (HealthGate.prototype.checkCores = function (e) {
    var t,
      r,
      i,
      n = CORE_NAMES[this.edition.core] || CORE_NAMES.xray;
    for (
      "systemProxy" === e && "xray" === this.edition.core && (n = ["xray"]),
        t = 0;
      t < n.length;
      t++
    ) {
      if (!(r = this.locateCore(n[t])).file)
        return r.denied
          ? err("ELEVATION_REQUIRED", "core not visible to a jailed service")
          : err("CORE_MISSING", n[t] + " binary missing");
      if (!r.size)
        return err("CORE_INTEGRITY_FAILED", n[t] + " binary is empty");
      if (null === (i = elfMachine(r.file)))
        return err(
          "CORE_INTEGRITY_FAILED",
          n[t] + " binary is not an ELF executable",
        );
      if (!machineMatchesRuntime(i, process.platform, process.arch))
        return err(
          "CORE_INTEGRITY_FAILED",
          n[t] + " binary targets the wrong architecture",
        );
    }
    return null;
  }),
  (HealthGate.prototype.locateAsset = function (e) {
    var t,
      r,
      i = [],
      n = !1;
    for (
      this.paths.dataDir && i.push(this.paths.dataDir + "/bin/" + e),
        this.paths.appDir && i.push(this.paths.appDir + "/bin/" + e),
        t = 0;
      t < i.length;
      t++
    ) {
      if ((r = statOrNull(i[t])) && r.isFile())
        return {
          file: i[t],
          size: r.size,
          mtime: r.mtime ? r.mtime.getTime() : 0,
        };
      statDenied(i[t]) && (n = !0);
    }
    return { file: "", denied: n };
  }),
  (HealthGate.prototype.checkAssetPresence = function () {
    var e,
      t,
      r = REQUIRED_ASSETS[this.edition.core] || [];
    for (e = 0; e < r.length; e++)
      if (!(t = this.locateAsset(r[e])).file)
        return t.denied
          ? err("ELEVATION_REQUIRED", "asset not visible to a jailed service")
          : err("ASSET_MISSING", "required routing asset missing");
    return null;
  }),
  (HealthGate.prototype.integritySignature = function () {
    var e,
      t,
      r = REQUIRED_ASSETS[this.edition.core] || [],
      i = [];
    for (e = 0; e < r.length; e++)
      ((t = this.locateAsset(r[e])),
        i.push(
          r[e] + ":" + t.file + ":" + (t.size || 0) + ":" + (t.mtime || 0),
        ));
    return i.join("|");
  }),
  (HealthGate.prototype.checkAssetIntegrity = function () {
    var e,
      t,
      r,
      i,
      n = REQUIRED_ASSETS[this.edition.core] || [];
    if (!n.length) return null;
    if (
      ((e = this.integritySignature()),
      this.deepCache && this.deepCache.signature === e)
    )
      return this.deepCache.error;
    for (i = null, t = 0; t < n.length; t++)
      if (
        (r = this.locateAsset(n[t])).file &&
        (i = xrayAssets.checkFile(r.file, n[t]))
      ) {
        i =
          "ASSET_CORRUPT" === i.code
            ? err(
                "ASSET_INTEGRITY_FAILED",
                "routing asset failed its integrity check",
              )
            : err(i.code, "required routing asset missing");
        break;
      }
    return ((this.deepCache = { signature: e, error: i }), i);
  }),
  (HealthGate.prototype.invalidate = function () {
    this.deepCache = null;
  }),
  (HealthGate.prototype.check = function (e) {
    var t,
      r = (e = e || {}).privilege || {};
    return !1 === e.homebrewRoot
      ? err("HOMEBREW_REQUIRED", "Homebrew Channel is not available as root")
      : !1 === r.root
        ? err(
            "ELEVATION_REQUIRED",
            "the Alcyone service is not running as uid 0",
          )
        : "SHARED_DIRECTORY_REPAIR_FAILED" === e.startupSafetyError
          ? err(
              "SHARED_DIRECTORY_REPAIR_FAILED",
              "shared directory permissions could not be repaired",
            )
          : "STORE_UNRECOVERABLE" === e.startupSafetyError
            ? err(
                "STORE_UNRECOVERABLE",
                "profile store is corrupt; restore it from backups/profiles-*.json before connecting",
              )
            : (t = this.checkPackage()) || (t = this.checkCores(e.mode || "tun"))
            ? t
            : (t = this.checkAssetPresence()) || this.checkAssetIntegrity();
  }),
  (HealthGate.prototype.summary = function (e) {
    var t = this.check(e);
    return { ok: !t, code: t ? t.code : "OK" };
  }),
  (module.exports = {
    REQUIRED_ASSETS: REQUIRED_ASSETS,
    CORE_NAMES: CORE_NAMES,
    ARCH_MACHINES: ARCH_MACHINES,
    machineMatchesRuntime: machineMatchesRuntime,
    HealthGate: HealthGate,
  }));
