"use strict";
var fs = require("fs"),
  path = require("path"),
  atomic = require("./atomic"),
  errors = require("./errors"),
  sharedPermissions = require("./shared-permissions"),
  storeLib = require("./store/profiles"),
  subscriptionCompat = require("./subscription-compat"),
  xrayAssets = require("./xray-assets"),
  MIGRATION_VERSION = 11,
  STORE_BACKUP_KEEP = 7;
function fileExists(t) {
  try {
    return fs.statSync(t).isFile();
  } catch (t) {
    return !1;
  }
}
function procExecutablePath(t) {
  return String(t || "").replace(/ \(deleted\)$/, "");
}
/* Best-effort raw byte copy used for pre-migration evidence. The backup is
   a safety net for manual recovery, never an automatic restore source, so
   a partial copy only costs information, never correctness. */
function copyRawToFile(t, e) {
  var r;
  try {
    r = fs.readFileSync(t);
  } catch (t) {
    return !1;
  }
  try {
    fs.writeFileSync(e, r, { mode: atomic.FILE_MODE });
  } catch (t) {
    return !1;
  }
  try {
    fs.chmodSync(e, atomic.FILE_MODE);
  } catch (t) {}
  return !0;
}
function Migrator(t) {
  ((t = t || {}),
    (this.paths = t.paths),
    (this.edition = t.edition),
    (this.logger = t.logger),
    (this.procRoot = t.procRoot || "/proc"),
    (this.procReadlink = t.procReadlink || fs.readlinkSync),
    (this.kill = t.kill || process.kill),
    (this.setTimeout = t.setTimeout || setTimeout),
    (this.sharedPermissions = t.sharedPermissions || sharedPermissions));
}
function readPid(t) {
  var e;
  try {
    e = String(fs.readFileSync(t, "utf8")).trim();
  } catch (t) {
    return 0;
  }
  return /^[1-9]\d{0,9}$/.test(e) && (e = parseInt(e, 10)) > 1 ? e : 0;
}
((Migrator.prototype.ensureLayout = function () {
  var t = this.paths.dataDir;
  return (
    atomic.ensureOwnedDir(t),
    atomic.ensureOwnedDir(path.join(t, "bin")),
    atomic.ensureOwnedDir(path.dirname(this.paths.stateFile)),
    !0
  );
}),
  (Migrator.prototype.repairSharedDirectoryModes = function () {
    var t = this.sharedPermissions.repair();
    return (
      t.repaired &&
        t.repaired.length &&
        this.logger.warn("shared directory permissions repaired", {
          count: t.repaired.length,
        }),
      t
    );
  }),
  (Migrator.prototype.installBundledCores = function () {
    var t,
      e,
      i,
      r,
      s,
      o,
      n,
      a = path.join(this.paths.appDir, "bin"),
      p = path.join(this.paths.dataDir, "bin"),
      l =
        "sing-box" === this.edition.core ? ["sing-box"] : ["xray", "tun2socks", "alcyone-netguard"],
      c = [];
    for (t = 0; t < l.length; t++)
      if (
        ((e = path.join(a, l[t])),
        (r = (i = path.join(p, l[t])) + ".new"),
        fileExists(e))
      ) {
        if (((n = !0), fileExists(i)))
          try {
            ((s = fs.statSync(e)),
              (o = fs.statSync(i)),
              (n = s.size !== o.size || s.mtime.getTime() > o.mtime.getTime()));
          } catch (t) {
            n = !0;
          }
        if (n)
          try {
            try {
              fs.unlinkSync(r);
            } catch (t) {}
            (fs.writeFileSync(r, fs.readFileSync(e), { mode: 493 }),
              fs.renameSync(r, i));
            try {
              fs.chmodSync(i, 493);
            } catch (t) {}
            c.push(l[t]);
          } catch (e) {
            try {
              fs.unlinkSync(r);
            } catch (t) {}
            this.logger.warn("core install failed", { core: l[t] });
          }
      }
    return (
      c.length &&
        this.logger.info("bundled cores installed", { cores: c.join(",") }),
      c
    );
  }),
  (Migrator.prototype.installBundledXrayAssets = function () {
    var t, e, i, r, s, o, n, a, p;
    if ("xray" !== this.edition.core) return [];
    for (
      t = path.join(this.paths.appDir, "bin"),
        e = path.join(this.paths.dataDir, "bin"),
        i = Object.keys(xrayAssets.ASSETS).sort(),
        r = [],
        s = 0;
      s < i.length;
      s++
    )
      if (
        ((o = i[s]),
        (n = path.join(t, o)),
        (a = path.join(e, o)),
        (p = xrayAssets.checkFile(n, o)))
      )
        this.logger.warn("packaged Xray asset invalid", {
          asset: o,
          code: p.code,
        });
      else if (xrayAssets.checkFile(a, o))
        try {
          (fs.writeFileSync(a + ".new", fs.readFileSync(n), { mode: 420 }),
            fs.renameSync(a + ".new", a));
          try {
            fs.chmodSync(a, 420);
          } catch (t) {}
          if ((p = xrayAssets.checkFile(a, o))) throw p;
          r.push(o);
        } catch (t) {
          try {
            fs.unlinkSync(a + ".new");
          } catch (t) {}
          this.logger.warn("Xray asset install failed", { asset: o });
        }
    return (
      r.length &&
        this.logger.info("bundled Xray assets installed", {
          assets: r.join(","),
        }),
      r
    );
  }),
  (Migrator.prototype.backupRawStore = function (t) {
    var e,
      i,
      r,
      s = path.join(this.paths.dataDir, "backups"),
      o = String(Date.now()),
      n = [];
    atomic.ensureOwnedDir(s);
    copyRawToFile(
      this.paths.storeFile,
      path.join(s, "profiles-" + o + "-" + t + ".json"),
    ) && n.push("profiles");
    copyRawToFile(
      this.paths.storeFile + ".tmp",
      path.join(s, "profiles-" + o + "-tmp-" + t + ".json"),
    ) && n.push("tmp");
    try {
      i = fs.readdirSync(s);
    } catch (t) {
      i = [];
    }
    for (
      r = i.filter(function (t) {
          return /^profiles-.+\.json$/.test(t);
        }).sort(),
        e = 0;
      e < r.length - STORE_BACKUP_KEEP;
      e++
    )
      atomic.removeQuiet(path.join(s, r[e]));
    return n;
  }),
  (Migrator.prototype.migrateStore = function () {
    var t,
      e,
      i = new storeLib.ProfileStore({
        file: this.paths.storeFile,
        logger: this.logger,
      });
    if (!fileExists(this.paths.storeFile)) return { migrated: !1, profiles: 0 };
    /* Evidence first: raw canonical and temp bytes are preserved before any
       transformation, so no migration step can make user data unrecoverable. */
    this.backupRawStore("pre-migration");
    if (((t = atomic.readJsonStrict(this.paths.storeFile)), !t.ok))
      throw errors.err(
        "STORE_UNRECOVERABLE",
        "profile store is corrupt; upgrade blocked, raw file preserved",
      );
    if ("tmp" === t.source)
      try {
        atomic.writeFileAtomic(
          this.paths.storeFile,
          JSON.stringify(t.value, null, 2),
        );
        this.logger.warn("profile store restored from interrupted write");
      } catch (t) {
        throw errors.err("STORE_WRITE_FAILED", "cannot restore store from tmp");
      }
    return (
      (e = i.read()),
      JSON.stringify(t.value) !== JSON.stringify(e)
        ? (i.write(e),
          this.logger.info("profile store normalized", {
            profiles: e.profiles.length,
          }),
          { migrated: !0, profiles: e.profiles.length })
        : { migrated: !1, profiles: e.profiles.length }
    );
  }),
  (Migrator.prototype.removeUnsupportedSingboxProfiles = function () {
    var t,
      e,
      i,
      r,
      s,
      o,
      n,
      a,
      p = [],
      l = {},
      c = !1,
      h = 0;
    if (!this.edition || "sing-box" !== this.edition.core)
      return { marked: 0, profiles: 0 };
    if (!fileExists(this.paths.storeFile)) return { marked: 0, profiles: 0 };
    /* Profiles this edition cannot dial are MARKED, never deleted: the raw
       links and full configs stay in the store so switching editions (or
       rolling back the package) cannot lose user subscriptions. */
    this.backupRawStore("pre-compat-mark");
    for (
      e = (t = new storeLib.ProfileStore({
        file: this.paths.storeFile,
        logger: this.logger,
      })).read(),
        i = 0;
      i < e.profiles.length;
      i++
    ) {
      s = e.profiles[i];
      try {
        subscriptionCompat.assertManualSupported(this.edition, s);
        s.compatUnsupported &&
          ((c = !0), delete s.compatUnsupported, delete s.compatReason);
        p.push(s);
      } catch (t) {
        if (!subscriptionCompat.xhttpSkip(t)) {
          p.push(s);
          continue;
        }
        ((n =
          t.meta && "object" == typeof t.meta
            ? { code: t.code, transport: String(t.meta.transport || "") }
            : { code: t.code, transport: "" }),
          (!s.compatUnsupported ||
            JSON.stringify(s.compatReason || {}) !== JSON.stringify(n)) &&
            (c = !0),
          (s.compatUnsupported = !0),
          (s.compatReason = n),
          h++,
          s.subscriptionId &&
            (l[s.subscriptionId] = (l[s.subscriptionId] || 0) + 1));
      }
    }
    for (i = 0; i < e.subscriptions.length; i++) {
      for (o = e.subscriptions[i], n = 0, r = 0; r < e.profiles.length; r++)
        e.profiles[r].subscriptionId === o.id &&
          !e.profiles[r].compatUnsupported &&
          n++;
      ((parseInt(o.count, 10) || 0) !== n && (c = !0),
        (o.count = n),
        l[o.id] &&
          ((o.skippedReasons = subscriptionCompat.summarizeSkipped(l[o.id])),
          (o.skippedCount = l[o.id])));
    }
    function firstSupportedId() {
      var t;
      for (t = 0; t < p.length; t++)
        if (!p[t].compatUnsupported) return p[t].id;
      return null;
    }
    for (a = !1, i = 0; i < e.profiles.length; i++)
      e.profiles[i].id === e.activeId &&
        !e.profiles[i].compatUnsupported &&
        (a = !0);
    a || ((e.activeId = firstSupportedId()), (c = !0));
    if (e.autostartProfileId) {
      for (
        n = !1, i = 0;
        i < e.profiles.length;
        i++
      )
        e.profiles[i].id === e.autostartProfileId &&
          (n = !e.profiles[i].compatUnsupported);
      n || ((e.autostartProfileId = null), (c = !0));
    }
    return (
      c
        ? (t.write(e),
          this.logger.info("unsupported sing-box profiles marked", {
            count: h,
          }))
        : this.logger.info &&
          this.logger.info("unsupported sing-box profiles checked", {
            count: h,
          }),
      { marked: h, profiles: e.profiles.length }
    );
  }),
  (Migrator.prototype.stopLegacyProcesses = function () {
    var t,
      e,
      i,
      r = [
        { file: "alcyone-web.pid" },
        { file: "xray.pid" },
        { file: "sing-box.pid" },
        { file: "tun2socks.pid" },
        { file: "log-guard.pid" },
      ],
      s = [],
      o = String(this.paths.dataDir || ""),
      n = String(this.paths.appDir || "");
    for (t = 0; t < r.length; t++)
      if ((e = readPid(path.join(o, r[t].file)))) {
        try {
          i = fs
            .readFileSync("/proc/" + e + "/cmdline", "utf8")
            .replace(/\u0000/g, " ");
        } catch (t) {
          continue;
        }
        if (i.indexOf(o) >= 0 || i.indexOf(n) >= 0)
          try {
            (process.kill(e, "SIGTERM"),
              s.push(e),
              (function (t) {
                setTimeout(function () {
                  try {
                    (process.kill(t, 0), process.kill(t, "SIGKILL"));
                  } catch (t) {}
                }, 500);
              })(e));
          } catch (t) {}
        else
          this.logger.warn("ignored untrusted legacy pid", { file: r[t].file });
      }
    return (
      s.length &&
        this.logger.info("legacy processes stopped", { count: s.length }),
      s
    );
  }),
  (Migrator.prototype.stopOwnedCoreOrphans = function () {
    var t,
      e,
      i,
      r,
      s =
        "sing-box" === this.edition.core ? ["sing-box"] : ["xray", "tun2socks", "alcyone-netguard"],
      o = {},
      n = [];
    for (e = 0; e < s.length; e++)
      o[path.join(this.paths.dataDir, "bin", s[e])] = !0;
    try {
      t = fs.readdirSync(this.procRoot);
    } catch (t) {
      return n;
    }
    for (e = 0; e < t.length; e++)
      if (
        /^[1-9]\d*$/.test(t[e]) &&
        (i = parseInt(t[e], 10)) &&
        i !== process.pid
      ) {
        try {
          r = this.procReadlink(path.join(this.procRoot, t[e], "exe"));
        } catch (t) {
          continue;
        }
        if (o[procExecutablePath(r)])
          try {
            (this.kill(i, "SIGTERM"),
              n.push(i),
              (function (t, e, i) {
                var r = t.setTimeout(function () {
                  var r;
                  try {
                    r = t.procReadlink(
                      path.join(t.procRoot, String(e), "exe"),
                    );
                  } catch (t) {
                    return;
                  }
                  if (procExecutablePath(r) !== i) return;
                  try {
                    t.kill(e, "SIGKILL");
                  } catch (t) {}
                }, 500);
                r && r.unref && r.unref();
              })(this, i, procExecutablePath(r)));
          } catch (t) {}
      }
    return (
      n.length &&
        this.logger.info("owned core orphans stopped", { count: n.length }),
      n
    );
  }),
  (Migrator.prototype.migrateLegacyRouteState = function () {
    var t,
      e,
      i,
      r,
      s,
      o,
      n = this.paths.routeState,
      a = {};
    if (!fileExists(n)) return !1;
    if ((e = atomic.readJson(n, null)) && e.original) return !1;
    try {
      t = fs.readFileSync(n, "utf8");
    } catch (t) {
      return !1;
    }
    for (i = t.split(/\r?\n/), r = 0; r < i.length; r++)
      (s = /^([A-Z_]+)='([^']*)'$/.exec(i[r].trim())) && (a[s[1]] = s[2]);
    return /^[A-Za-z0-9_.:-]+$/.test(a.ORIG_DEV || "")
      ? a.ORIG_GW && !/^[0-9a-fA-F:.]+$/.test(a.ORIG_GW)
        ? (atomic.removeQuiet(n), !1)
        : ((o = String(a.SERVER_IPS || a.SERVER_IP || "")
            .split(/\s+/)
            .filter(function (t) {
              return /^[0-9a-fA-F:.]+$/.test(t);
            })),
          atomic.writeJsonAtomic(n, {
            original: { gateway: a.ORIG_GW || "", device: a.ORIG_DEV, raw: "" },
            serverAddresses: o,
            serverRoutes: {},
            core: this.edition.core,
            savedAt: Date.now(),
            migratedLegacy: !0,
          }),
          this.logger.info("legacy route state converted for rollback"),
          !0)
      : (atomic.removeQuiet(n), !1);
  }),
  (Migrator.prototype.cleanupLegacyArtifacts = function () {
    var t,
      e = this.paths.dataDir,
      i = [
        "alcyone-web.pid",
        "xray.pid",
        "sing-box.pid",
        "tun2socks.pid",
        "log-guard.pid",
        "route.env",
        "core-install.log",
      ],
      r = [];
    for (t = 0; t < i.length; t++)
      atomic.removeQuiet(path.join(e, i[t])) && r.push(i[t]);
    return (
      r.length &&
        this.logger.info("legacy runtime files removed", { count: r.length }),
      r
    );
  }),
  (Migrator.prototype.readState = function () {
    return atomic.readJson(this.paths.stateFile, { migrationVersion: 0 });
  }),
  (Migrator.prototype.writeState = function (t) {
    atomic.writeJsonAtomic(this.paths.stateFile, t);
  }),
  (Migrator.prototype.run = function () {
    var t,
      e = this.repairSharedDirectoryModes(),
      i = this.readState();
    return (
      this.ensureLayout(),
      this.stopLegacyProcesses(),
      this.stopOwnedCoreOrphans(),
      this.migrateLegacyRouteState(),
      this.installBundledCores(),
      this.installBundledXrayAssets(),
      (t = this.migrateStore()),
      "sing-box" === this.edition.core &&
        i.migrationVersion !== MIGRATION_VERSION &&
        (t = this.removeUnsupportedSingboxProfiles()),
      this.cleanupLegacyArtifacts(),
      i.migrationVersion !== MIGRATION_VERSION &&
        this.logger.info("migration applied", {
          from: i.migrationVersion || 0,
          to: MIGRATION_VERSION,
        }),
      (i.migrationVersion = MIGRATION_VERSION),
      (i.sharedPermissionsRepairVersion = e.version),
      e.repaired &&
        e.repaired.length &&
        (i.lastSharedPermissionsRepair = Date.now()),
      (i.lastStart = Date.now()),
      (i.edition = this.edition.id),
      this.writeState(i),
      { migrationVersion: MIGRATION_VERSION, profiles: t.profiles }
    );
  }),
  (module.exports = {
    MIGRATION_VERSION: MIGRATION_VERSION,
    Migrator: Migrator,
  }));
