"use strict";
var fs = require("fs"),
  errors = require("./errors"),
  err = errors.err,
  VULNERABLE_MODE = 448,
  SAFE_MODE = 493,
  MODE_MASK = 4095,
  REPAIR_VERSION = 1,
  TARGETS = ["/var/lib", "/var/lib/webosbrew", "/var/lib/webosbrew/init.d"];
function directoryIsSafe(r) {
  return (
    !!r &&
    r.isDirectory &&
    r.isDirectory() &&
    !(r.isSymbolicLink && r.isSymbolicLink())
  );
}
function repairError() {
  return err(
    "SHARED_DIRECTORY_REPAIR_FAILED",
    "shared directory permissions could not be repaired",
  );
}
function repair(r) {
  var e,
    E,
    i,
    o,
    t = (r = r || {}).fs || fs,
    s = TARGETS,
    c = [];
  for (e = 0; e < s.length; e++) {
    E = s[e];
    try {
      i = t.lstatSync(E);
    } catch (r) {
      if (r && "ENOENT" === r.code) continue;
      throw repairError();
    }
    if (!directoryIsSafe(i)) throw repairError();
    if ((i.mode & MODE_MASK) === VULNERABLE_MODE) {
      try {
        (t.chmodSync(E, SAFE_MODE), (o = t.lstatSync(E)));
      } catch (r) {
        throw repairError();
      }
      if (!directoryIsSafe(o) || (o.mode & MODE_MASK) !== SAFE_MODE)
        throw repairError();
      c.push(E);
    }
  }
  return { version: REPAIR_VERSION, repaired: c, checked: s.length };
}
module.exports = {
  TARGETS: TARGETS.slice(0),
  VULNERABLE_MODE: VULNERABLE_MODE,
  SAFE_MODE: SAFE_MODE,
  REPAIR_VERSION: REPAIR_VERSION,
  repair: repair,
};
