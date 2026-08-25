"use strict";
var crypto = require("crypto"),
  fs = require("fs"),
  path = require("path"),
  errors = require("./errors"),
  err = errors.err,
  ASSETS = {
    "geosite.dat": {
      sha256:
        "adf92de0cfc70e458b399f04c5f912bf42d115ed7e37281b30e2f1c68605e4e9",
      size: 10491954,
    },
    "geoip.dat": {
      sha256:
        "744c97b74c52bae2ac8664fef6ac481d7765cb8432a0df54f0368a88b9b4a354",
      size: 19768301,
    },
  };
function sha256File(e) {
  var r = crypto.createHash("sha256");
  return (r.update(fs.readFileSync(e)), r.digest("hex"));
}
function checkFile(e, r) {
  var t,
    i,
    s = ASSETS[r];
  if (!s) return err("ASSET_MISSING", "unsupported Xray asset: " + r);
  try {
    if (!(t = fs.statSync(e)).isFile())
      return err("ASSET_MISSING", "required Xray asset missing: " + e);
  } catch (r) {
    return err("ASSET_MISSING", "required Xray asset missing: " + e);
  }
  if (t.size !== s.size)
    return err("ASSET_CORRUPT", "Xray asset has wrong size: " + e);
  try {
    i = sha256File(e);
  } catch (r) {
    return err("ASSET_CORRUPT", "cannot verify Xray asset: " + e);
  }
  return i !== s.sha256
    ? err("ASSET_CORRUPT", "Xray asset checksum mismatch: " + e)
    : null;
}
function referenced(e) {
  var r = {};
  return (
    (function e(t) {
      var i, s;
      if ("string" == typeof t)
        return (
          t.indexOf("geosite:") >= 0 && (r["geosite.dat"] = !0),
          void (t.indexOf("geoip:") >= 0 && (r["geoip.dat"] = !0))
        );
      if (t && "object" == typeof t)
        if ("[object Array]" !== Object.prototype.toString.call(t))
          for (s in t) Object.prototype.hasOwnProperty.call(t, s) && e(t[s]);
        else for (i = 0; i < t.length; i++) e(t[i]);
    })(e),
    Object.keys(r).sort()
  );
}
function verifyReferenced(e, r) {
  var t,
    i,
    s = referenced(e);
  for (t = 0; t < s.length; t++)
    if ((i = checkFile(path.join(r, s[t]), s[t]))) return i;
  return null;
}
module.exports = {
  ASSETS: ASSETS,
  sha256File: sha256File,
  checkFile: checkFile,
  referenced: referenced,
  verifyReferenced: verifyReferenced,
};
