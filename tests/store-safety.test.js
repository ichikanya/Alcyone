"use strict";

/* Store upgrade safety: an update must never destroy user profiles.

   Proves the four guarantees of the transactional store layer:
     - raw bytes are backed up before every migration transform;
     - a corrupt store blocks the upgrade (STORE_UNRECOVERABLE) instead of
       being silently replaced by an empty default store;
     - an interrupted write is recovered from the .tmp sibling;
     - sing-box-incompatible profiles are MARKED, never deleted. */

var os = require("os");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var storeLib = require(
  path.join(ROOT, "app", "service", "lib", "store", "profiles.js"),
);
var atomicLib = require(path.join(ROOT, "app", "service", "lib", "atomic.js"));
var errorsLib = require(path.join(ROOT, "app", "service", "lib", "errors.js"));
var migrateLib = require(
  path.join(ROOT, "app", "service", "lib", "migrate.js"),
);

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

var quiet = {
  info: function () {},
  warn: function () {},
  error: function () {},
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-storesafe-"));
}

function makePaths(dir) {
  return {
    appDir: path.join(dir, "app"),
    dataDir: dir,
    storeFile: path.join(dir, "profiles.json"),
    configFile: path.join(dir, "core-config.json"),
    routeState: path.join(dir, "route.state"),
    stateFile: path.join(dir, "service-state.json"),
    serviceLog: path.join(dir, "service.log"),
    tunnelLog: path.join(dir, "tunnel.log"),
  };
}

function makeMigrator(paths, core) {
  return new migrateLib.Migrator({
    paths: paths,
    edition: { id: "ed-" + (core || "xray"), core: core || "xray" },
    logger: quiet,
  });
}

function backupFiles(paths) {
  var dir = path.join(paths.dataDir, "backups");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(function (f) {
      return /^profiles-.+\.json$/.test(f);
    })
    .sort();
}

var VALID_STORE = {
  profiles: [
    {
      id: "pold1",
      protocol: "vless",
      name: "NL Reality",
      link:
        "vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=reality&pbk=K#NL",
      sourceType: "single",
      addedAt: 1700000000000,
      updatedAt: 1700000000000,
    },
  ],
  subscriptions: [],
  activeId: "pold1",
  lang: "ru",
  updatedAt: 1700000000000,
};

/* --- 1: a healthy migration snapshots the raw store first --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  var raw = JSON.stringify(VALID_STORE, null, 2);
  fs.writeFileSync(paths.storeFile, raw);
  makeMigrator(paths).run();
  var backups = backupFiles(paths);
  record(
    "a healthy migration creates a raw backup",
    backups.length >= 1,
    String(backups.length),
  );
  record(
    "the raw backup is byte-identical to the pre-migration store",
    backups.some(function (f) {
      return (
        fs
          .readFileSync(path.join(paths.dataDir, "backups", f))
          .toString("utf8") === raw
      );
    }),
  );
})();

/* --- 2: both copies corrupt -> upgrade blocked, evidence preserved --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  var corrupt = "{ this is not json";
  fs.writeFileSync(paths.storeFile, corrupt);
  fs.writeFileSync(paths.storeFile + ".tmp", "]]] also broken");
  var thrown = null;
  try {
    makeMigrator(paths).run();
  } catch (e) {
    thrown = e;
  }
  record(
    "an unrecoverable store aborts migration with STORE_UNRECOVERABLE",
    !!thrown && thrown.code === "STORE_UNRECOVERABLE",
    thrown ? String(thrown.code) : "no throw",
  );
  record(
    "the corrupt store is never overwritten by migration",
    fs.readFileSync(paths.storeFile, "utf8") === corrupt,
  );
  record(
    "migration state is not recorded when the upgrade is blocked",
    !fs.existsSync(paths.stateFile),
  );
  record(
    "corrupt raw bytes are still preserved as backup evidence",
    backupFiles(paths).some(function (f) {
      return (
        fs
          .readFileSync(path.join(paths.dataDir, "backups", f))
          .toString("utf8") === corrupt
      );
    }),
  );
})();

/* --- 3: interrupted write recovered from the .tmp sibling --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  fs.writeFileSync(paths.storeFile, "{ interrupted");
  fs.writeFileSync(paths.storeFile + ".tmp", JSON.stringify(VALID_STORE));
  makeMigrator(paths).run();
  var after = JSON.parse(fs.readFileSync(paths.storeFile, "utf8"));
  record(
    "an interrupted write restores the canonical store from .tmp",
    after.profiles.length === 1 && after.profiles[0].id === "pold1",
  );

  /* second run: nothing changes, no throw */
  var snapshot = fs.readFileSync(paths.storeFile, "utf8");
  var again = null;
  try {
    makeMigrator(paths).run();
  } catch (e) {
    again = e;
  }
  record(
    "re-running migration after recovery is safe and idempotent",
    !again && fs.readFileSync(paths.storeFile, "utf8") === snapshot,
    again ? String(again.code) : "",
  );
})();

/* --- 4: sing-box incompatible profiles are marked, never deleted --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  var sbStore = {
    profiles: [
      {
        id: "pok1",
        protocol: "vless",
        name: "OK Reality",
        link:
          "vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=reality&pbk=K#OK",
        sourceType: "subscription",
        subscriptionId: "s1",
        subscriptionName: "Sub",
        addedAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      {
        id: "pxhttp",
        protocol: "vless",
        name: "Full XHTTP",
        link:
          "vless://11111111-2222-3333-4444-555555555555@c.example.com:443?type=xhttp#Full",
        sourceType: "subscription",
        subscriptionId: "s1",
        subscriptionName: "Sub",
        addedAt: 1700000000000,
        updatedAt: 1700000000000,
        fullConfig: {
          inbounds: [{ port: 1, protocol: "socks" }],
          outbounds: [
            {
              protocol: "vless",
              tag: "proxy",
              settings: {
                vnext: [
                  { address: "c.example.com", port: 443, users: [{ id: "u" }] },
                ],
              },
              streamSettings: { network: "xhttp" },
            },
          ],
        },
      },
    ],
    subscriptions: [
      {
        id: "s1",
        url: "https://panel.example.com/sub/TOKEN",
        name: "Sub",
        count: 2,
        lastUpdate: 1700000000000,
      },
    ],
    activeId: "pxhttp",
    autostartProfileId: "pxhttp",
    updatedAt: 1700000000000,
  };
  fs.writeFileSync(paths.storeFile, JSON.stringify(sbStore));
  makeMigrator(paths, "sing-box").run();
  var after = new storeLib.ProfileStore({ file: paths.storeFile }).read();
  var marked = null;
  var kept = null;
  after.profiles.forEach(function (p) {
    if (p.id === "pxhttp") marked = p;
    if (p.id === "pok1") kept = p;
  });
  record(
    "an unsupported profile survives the sing-box migration",
    !!marked,
  );
  record(
    "the unsupported profile carries a compatUnsupported marker",
    !!marked && marked.compatUnsupported === true,
  );
  record(
    "supported profiles are left unmarked",
    !!kept && kept.compatUnsupported !== true,
  );
  record(
    "subscription counts exclude only unsupported profiles",
    after.subscriptions[0].count === 1 &&
      after.subscriptions[0].skippedCount === 1,
    "count=" +
      after.subscriptions[0].count +
      " skipped=" +
      after.subscriptions[0].skippedCount,
  );
  record(
    "active selection moves off an unsupported profile",
    after.activeId === "pok1",
  );
  record(
    "autostart pointing at an unsupported profile is cleared",
    after.autostartProfileId !== "pxhttp",
  );
  /* re-run with the marker already present must stay stable */
  var snap = fs.readFileSync(paths.storeFile, "utf8");
  makeMigrator(paths, "sing-box").run();
  record(
    "compat marking is idempotent across repeated migrations",
    fs.readFileSync(paths.storeFile, "utf8") === snap,
  );
})();

/* --- 5: runtime reads refuse to fake an empty store --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  var corrupt = "{ hopeless";
  fs.writeFileSync(paths.storeFile, corrupt);
  var store = new storeLib.ProfileStore({ file: paths.storeFile });
  var thrown = null;
  try {
    store.read();
  } catch (e) {
    thrown = e;
  }
  record(
    "reading a doubly-corrupt store raises STORE_CORRUPT",
    !!thrown && thrown.code === "STORE_CORRUPT",
    thrown ? String(thrown.code) : "no throw",
  );
  thrown = null;
  try {
    store.upsertManualProfile(
      "vless://11111111-2222-3333-4444-555555555555@n.example.com:443#N",
      "N",
    );
  } catch (e) {
    thrown = e;
  }
  record(
    "writes against a corrupt store fail before touching the file",
    !!thrown &&
      thrown.code === "STORE_CORRUPT" &&
      fs.readFileSync(paths.storeFile, "utf8") === corrupt,
  );
  thrown = null;
  try {
    store.reconcileAutostartProfile();
  } catch (e) {
    thrown = e;
  }
  record(
    "autostart reconciliation refuses to reset a corrupt store",
    !!thrown && thrown.code === "STORE_CORRUPT",
  );
})();

/* --- 6: runtime reads auto-heal from .tmp without migration --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  fs.writeFileSync(paths.storeFile, "{ broken");
  fs.writeFileSync(paths.storeFile + ".tmp", JSON.stringify(VALID_STORE));
  var store = new storeLib.ProfileStore({ file: paths.storeFile });
  var read = store.read();
  record(
    "runtime reads serve the recoverable .tmp content",
    read.profiles.length === 1 && read.activeId === "pold1",
  );
})();

/* --- 7: backup retention is bounded --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
  var i;
  for (i = 0; i < 9; i++) {
    fs.writeFileSync(
      path.join(dir, "backups", "profiles-0000000000000" + i + "-pre-migration.json"),
      "{}",
    );
  }
  fs.writeFileSync(paths.storeFile, JSON.stringify(VALID_STORE));
  makeMigrator(paths).run();
  var backups = backupFiles(paths);
  record(
    "store backups are pruned to a bounded retention window",
    backups.length <= 8 && backups.length >= 1,
    String(backups.length),
  );
})();

/* --- 8: strict reader rejects JSON literals that are not stores --- */
(function () {
  var dir = tempDir();
  var paths = makePaths(dir);
  fs.mkdirSync(paths.appDir, { recursive: true });
  fs.writeFileSync(paths.storeFile, "null");
  var thrown = null;
  try {
    new storeLib.ProfileStore({ file: paths.storeFile }).read();
  } catch (e) {
    thrown = e;
  }
  record(
    "a JSON null store is treated as corruption, not as an empty list",
    !!thrown && thrown.code === "STORE_CORRUPT",
  );
  var parsed = atomicLib.readJsonStrict(paths.storeFile);
  record(
    "readJsonStrict reports ok:false for non-object payloads",
    !parsed.ok,
  );
  fs.writeFileSync(paths.storeFile + ".tmp", JSON.stringify(VALID_STORE));
  parsed = atomicLib.readJsonStrict(paths.storeFile);
  record(
    "readJsonStrict reports the tmp sibling as its source",
    parsed.ok && parsed.source === "tmp",
  );
  record(
    "error codes are registered for Luna results",
    errorsLib.CODES.STORE_CORRUPT === "STORE_CORRUPT" &&
      errorsLib.CODES.STORE_UNRECOVERABLE === "STORE_UNRECOVERABLE",
  );
})();

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
