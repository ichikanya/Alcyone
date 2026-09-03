"use strict";
var fs = require("fs"),
  path = require("path"),
  DIR_MODE = 448,
  SHARED_DIR_MODE = 493,
  FILE_MODE = 384,
  SPECIAL_MODE_MASK = 4095,
  PROTECTED_OWNED_DIRS = {
    "/": !0,
    "/var": !0,
    "/var/lib": !0,
    "/var/lib/webosbrew": !0,
    "/var/lib/webosbrew/init.d": !0,
  };
function directoryError(r, e) {
  var t = new Error(e || r);
  return ((t.code = r), t);
}
function isDirectoryStat(r) {
  return (
    !!r &&
    r.isDirectory &&
    r.isDirectory() &&
    !(r.isSymbolicLink && r.isSymbolicLink())
  );
}
function lstatDirectory(r) {
  var e = fs.lstatSync(r);
  if (!isDirectoryStat(e))
    throw directoryError(
      "UNSAFE_DIRECTORY_TARGET",
      "directory is not a real directory"
    );
  return e;
}
function requireParentDirectory(r) {
  var e = path.dirname(r);
  if (!e || e === r)
    throw directoryError(
      "UNSAFE_DIRECTORY_TARGET",
      "directory has no creatable parent"
    );
  return (lstatDirectory(e), e);
}
function normalizePosixPath(r) {
  var e,
    t,
    i = "/" === r.charAt(0),
    n = r.split("/"),
    o = [];
  for (e = 0; e < n.length; e++)
    (t = n[e]) &&
      "." !== t &&
      (".." !== t
        ? o.push(t)
        : o.length && ".." !== o[o.length - 1]
          ? o.pop()
          : i || o.push(t));
  return o.length ? (i ? "/" : "") + o.join("/") : i ? "/" : ".";
}
function ensureExactDirectory(r, e, t) {
  var i,
    n = !1,
    o = !1;
  if (!r || r === path.sep)
    throw directoryError(
      "UNSAFE_DIRECTORY_TARGET",
      "root is not an owned directory"
    );
  try {
    (lstatDirectory(r), (n = !0));
  } catch (r) {
    if ("ENOENT" !== r.code) throw r;
  }
  if (!n) {
    requireParentDirectory(r);
    try {
      (fs.mkdirSync(r, e), (o = !0));
    } catch (r) {
      if (!(i = r) || "EEXIST" !== i.code) throw i;
    }
    lstatDirectory(r);
  }
  return ((o || t) && fs.chmodSync(r, e), !0);
}
function ensureOwnedDir(r) {
  var e,
    t = String(r || "").replace(/\\/g, "/"),
    i = normalizePosixPath(t);
  if (
    ((e = path.resolve(t)),
    PROTECTED_OWNED_DIRS[i] ||
      PROTECTED_OWNED_DIRS[normalizePosixPath(String(e).replace(/\\/g, "/"))])
  )
    throw directoryError(
      "UNSAFE_DIRECTORY_TARGET",
      "shared system directory cannot be owned"
    );
  return ensureExactDirectory((r = e), DIR_MODE, !0);
}
function ensureSharedDir(r, e) {
  return ensureExactDirectory(r, e || SHARED_DIR_MODE, !1);
}
function writeAtomic(r, e, t, i) {
  var n,
    o = r + ".tmp";
  (i(path.dirname(r)), (n = fs.openSync(o, "w", t || FILE_MODE)));
  try {
    fs.writeSync(n, e, 0, Buffer.byteLength(e, "utf8"), null);
    try {
      fs.fsyncSync(n);
    } catch (r) {}
  } finally {
    fs.closeSync(n);
  }
  (fs.chmodSync(o, t || FILE_MODE), fs.renameSync(o, r));
}
function writeFileAtomic(r, e, t) {
  writeAtomic(r, e, t, ensureOwnedDir);
}
function writeSharedFileAtomic(r, e, t) {
  writeAtomic(r, e, t, function (r) {
    ensureSharedDir(r, SHARED_DIR_MODE);
  });
}
function writeJsonAtomic(r, e, t) {
  writeFileAtomic(r, JSON.stringify(e, null, 2), t);
}
function readJson(r, e) {
  var t;
  try {
    return ((t = fs.readFileSync(r, "utf8")), JSON.parse(t));
  } catch (i) {
    try {
      return ((t = fs.readFileSync(r + ".tmp", "utf8")), JSON.parse(t));
    } catch (r) {
      return e;
    }
  }
}
function pathExists(r) {
  var t;
  try {
    t = fs.statSync(r);
  } catch (e) {
    return !1;
  }
  return t.isFile();
}
function tryParseJson(r) {
  try {
    return { ok: !0, value: JSON.parse(r) };
  } catch (e) {
    return { ok: !1 };
  }
}
/* Strict reader for user data files. Reports which source parsed instead of
   silently returning a default: "file" when the canonical path parses,
   "tmp" when only the interrupted-write sibling parses, ok:!1 when neither
   does. A JSON literal that is not an object or array (null, number,
   string) counts as unparsed corruption evidence, not as an empty store. */
function readJsonStrict(r) {
  var t, e;
  try {
    t = fs.readFileSync(r, "utf8");
  } catch (i) {
    t = null;
  }
  if (
    null !== t &&
    (e = tryParseJson(t)).ok &&
    null !== e.value &&
    "object" == typeof e.value
  )
    return { ok: !0, value: e.value, source: "file" };
  try {
    t = fs.readFileSync(r + ".tmp", "utf8");
  } catch (i) {
    t = null;
  }
  if (
    null !== t &&
    (e = tryParseJson(t)).ok &&
    null !== e.value &&
    "object" == typeof e.value
  )
    return { ok: !0, value: e.value, source: "tmp" };
  return { ok: !1 };
}
function readTextSafe(r, e) {
  try {
    return fs.readFileSync(r, "utf8");
  } catch (r) {
    return void 0 === e ? "" : e;
  }
}
function removeQuiet(r) {
  try {
    return (fs.unlinkSync(r), !0);
  } catch (r) {
    return !1;
  }
}
function fileRevision(r) {
  try {
    var e = fs.statSync(r);
    return String(e.size) + "-" + String(e.mtime.getTime());
  } catch (r) {
    return "missing";
  }
}
/* Best-effort directory fsync so a rename survives power loss on Linux.
   Directory fds do not exist on some platforms; failures are ignored. */
function fsyncDir(r) {
  var t;
  try {
    t = fs.openSync(r, "r");
  } catch (e) {
    return !1;
  }
  try {
    fs.fsyncSync(t);
  } catch (e) {}
  try {
    fs.closeSync(t);
  } catch (e) {}
  return !0;
}
module.exports = {
  DIR_MODE: DIR_MODE,
  SHARED_DIR_MODE: SHARED_DIR_MODE,
  FILE_MODE: FILE_MODE,
  SPECIAL_MODE_MASK: SPECIAL_MODE_MASK,
  ensureOwnedDir: ensureOwnedDir,
  ensureSharedDir: ensureSharedDir,
  writeFileAtomic: writeFileAtomic,
  writeSharedFileAtomic: writeSharedFileAtomic,
  writeJsonAtomic: writeJsonAtomic,
  readJson: readJson,
  pathExists: pathExists,
  tryParseJson: tryParseJson,
  readJsonStrict: readJsonStrict,
  readTextSafe: readTextSafe,
  removeQuiet: removeQuiet,
  fileRevision: fileRevision,
  fsyncDir: fsyncDir,
};
