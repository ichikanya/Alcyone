"use strict";

/* Netguard stage: route transaction journal, guardian client contract,
   and RouteManager arming rules. All network-touching parts are faked so
   the suite runs on any host OS. */

var os = require("os");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var transactionLib = require(
  path.join(ROOT, "app", "service", "lib", "net", "route-transaction.js"),
);
var guardianLib = require(
  path.join(ROOT, "app", "service", "lib", "net", "guardian-client.js"),
);
var routesLib = require(path.join(ROOT, "app", "service", "lib", "net", "routes.js"));

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}
var quiet = { info: function () {}, warn: function () {}, error: function () {} };
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-guard-"));
}
function after(ms, fn) {
  setTimeout(fn, ms);
}

/* --- lease serialization --- */
(function () {
  var text = guardianLib.serializeLease({
    edition: "xray",
    tunIf: "tun0",
    rulePref: 110,
    ruleTable: 42761,
    v6Rule: !0,
    splitV4: [],
    v6Block: ["::/1", "8000::/1"],
    heartbeatFile: "/var/lib/x/netguard.lease.beat",
  });
  record(
    "lease carries edition, tun and rule identity",
    text.indexOf("TUN_IF='tun0'") >= 0 &&
      text.indexOf("RULE_PREF='110'") >= 0 &&
      text.indexOf("RULE_TABLE='42761'") >= 0 &&
      text.indexOf("V6_RULE=1") >= 0,
  );
  record(
    "lease keeps the legacy KEY='VALUE' line format",
    /^#[^\n]*\nVERSION='1'\n/.test(text) && /HEARTBEAT='[^']+'\n/.test(text),
  );
})();

/* --- route transaction lifecycle --- */
(function () {
  var dir = tempDir();
  var file = path.join(dir, transactionLib.FILE_NAME);
  var txm = new transactionLib.RouteTransactionManager({ file: file });
  var token = "";
  var rec = txm.create({
    edition: "xray",
    planned: { tunIf: "tun0" },
  });
  token = rec.token;
  record(
    "a fresh journal starts in PREPARED with an owner token",
    rec.state === "PREPARED" && /^tx[0-9a-z]+-[0-9a-f]{16}$/.test(rec.token),
  );
  txm.mark("APPLYING", token);
  txm.mark("ACTIVE", token, { rules: [{ pref: 110 }] });
  var loaded = txm.load();
  record(
    "ACTIVE records the applied object set",
    loaded.state === "ACTIVE" && loaded.applied.rules.length === 1,
  );
  var tampered = JSON.parse(fs.readFileSync(file, "utf8"));
  tampered.planned.tunIf = "tun9";
  fs.writeFileSync(file, JSON.stringify(tampered));
  record(
    "a tampered journal is rejected by its checksum",
    txm.load() === null,
  );
  var thrown = null;
  try {
    txm.mark("ROLLING_BACK", token);
  } catch (e) {
    thrown = e;
  }
  /* load() returned null because of the tamper above -> ILLEGAL_STATE */
  record(
    "marking against a rejected journal fails safely",
    !!thrown && thrown.code === "ILLEGAL_STATE",
  );

  var dir2 = tempDir();
  var file2 = path.join(dir2, transactionLib.FILE_NAME);
  var txm2 = new transactionLib.RouteTransactionManager({ file: file2 });
  var t2 = txm2.create({ edition: "sing-box" }).token;
  txm2.mark("APPLYING", t2);
  thrown = null;
  try {
    txm2.mark("RESTORED", t2);
  } catch (e) {
    thrown = e;
  }
  record(
    "skipping states is rejected (APPLYING -> RESTORED)",
    !!thrown && thrown.code === "ILLEGAL_STATE",
  );
  txm2.mark("ACTIVE", t2);
  txm2.mark("ROLLING_BACK", t2);
  txm2.mark("RESTORED", t2);
  record(
    "RESTORED closes the journal file",
    !fs.existsSync(file2),
  );
  var t3 = new transactionLib.RouteTransactionManager({
    file: file2,
  }).create({ edition: "sing-box" }).token;
  record("a closed journal allows a fresh transaction", !!t3);
})();

/* --- concurrent transaction protection --- */
(function () {
  var dir = tempDir();
  var file = path.join(dir, transactionLib.FILE_NAME);
  var txm = new transactionLib.RouteTransactionManager({ file: file });
  var first = txm.create({ edition: "xray" });
  txm.mark("APPLYING", first.token);
  var thrown = null;
  try {
    txm.create({ edition: "xray" });
  } catch (e) {
    thrown = e;
  }
  record(
    "a second transaction cannot be created while one is ACTIVE/APPLYING",
    !!thrown && thrown.code === "ILLEGAL_STATE",
  );
})();

/* --- guardian client arm/disarm with a fake detached process --- */
(function () {
  var dir = tempDir();
  var leaseFile = path.join(dir, "netguard-xray.lease");
  var signals = [];
  function fakeSpawn(leasePath) {
    /* Real guardian rewrites the heartbeat with its PID after parsing. */
    var beat = leasePath + ".beat";
    fs.writeFileSync(beat, "4242\n");
    var now = Date.now();
    fs.utimesSync(beat, new Date(now), new Date(now));
    return {
      pid: 4242,
      killed: false,
      kill: function (sig) {
        signals.push(sig);
        this.killed = true;
        return true;
      },
      unref: function () {},
    };
  }
  var client = new guardianLib.GuardianClient({
    logger: quiet,
    leaseFile: leaseFile,
    enabled: true,
    spawnImpl: fakeSpawn,
    intervalMs: 20,
    ackTimeoutMs: 900,
  });
  client.arm({
    edition: "xray",
    tunIf: "tun0",
    splitV4: ["0.0.0.0/1"],
    v6Block: ["::/1"],
  });
  record(
    "arming spawns the guardian and reports it as armed",
    client.status().armed && client.status().pid === 4242,
  );
  record(
    "the lease file exists next to the heartbeat",
    fs.existsSync(leaseFile) && fs.existsSync(leaseFile + ".beat"),
  );
  var beatAtArm = fs.statSync(leaseFile + ".beat").mtime.getTime();
  after(90, function () {
    var beatLater = fs.statSync(leaseFile + ".beat").mtime.getTime();
    record(
      "heartbeats keep refreshing while armed",
      beatLater > beatAtArm,
    );
    client.disarm();
    record(
      "disarm stops the heartbeat and terminates the guardian",
      !client.status().armed &&
        signals.indexOf("SIGTERM") >= 0 &&
        !fs.existsSync(leaseFile),
    );
    client.disarm();
    record("disarm is idempotent", signals.length === 1);

    /* failure path: guardian never acks */
    var dirF = tempDir();
    var failing = new guardianLib.GuardianClient({
      logger: quiet,
      leaseFile: path.join(dirF, "netguard-xray.lease"),
      enabled: true,
      spawnImpl: function () {
        return {
          pid: 5,
          killed: false,
          kill: function () {
            this.killed = true;
            return true;
          },
          unref: function () {},
        };
      },
      intervalMs: 20,
      ackTimeoutMs: 120,
    });
    var thrown = null;
    try {
      failing.arm({ edition: "xray", tunIf: "tun0" });
    } catch (e) {
      thrown = e;
    }
    record(
      "an unacked guardian aborts with GUARDIAN_UNAVAILABLE and cleans up",
      !!thrown &&
        thrown.code === "GUARDIAN_UNAVAILABLE" &&
        !fs.existsSync(path.join(dirF, "netguard-xray.lease")),
    );

    /* disabled client refuses to arm */
    var off = new guardianLib.GuardianClient({
      logger: quiet,
      leaseFile: path.join(tempDir(), "l"),
      enabled: false,
    });
    thrown = null;
    try {
      off.arm({});
    } catch (e) {
      thrown = e;
    }
    record(
      "with the feature disabled, arming fails closed",
      !!thrown && thrown.code === "GUARDIAN_UNAVAILABLE",
    );
    finishRouteManagerChecks();
  });

  /* --- RouteManager arming rules --- */
  function finishRouteManagerChecks() {
    function makeRm(guardian) {
      return new routesLib.RouteManager({
        core: "xray",
        stateFile: path.join(tempDir(), "route.state"),
        ipBinary: "",
        guardian: guardian,
        logger: quiet,
      });
    }
    var events = [];
    var fake = {
      enabled: true,
      arm: function (spec) {
        events.push(["arm", spec]);
      },
      disarm: function () {
        events.push(["disarm"]);
      },
      status: function () {
        for (var i = 0; i < events.length; i++)
          if (events[i][0] === "arm") return { armed: true };
        return { armed: false };
      },
    };
    var rm = makeRm(fake);
    rm.armGuardian({
      routingBackend: "policy",
      policy: { table: 42761, tunnelPriority: 112, ipv6RuleApplied: true },
    });
    record(
      "policy backend leases the activation rule instead of split routes",
      events.length === 1 &&
        events[0][1].rulePref === 112 &&
        events[0][1].ruleTable === 42761 &&
        events[0][1].v6Rule === true &&
        events[0][1].splitV4.length === 0,
    );
    rm.armGuardian({ routingBackend: "legacy" });
    record(
      "backend fallback rearms with both owned split routes",
      events.length === 3 &&
        events[2][0] === "arm" &&
        events[2][1].splitV4.join(",") ===
          routesLib.SPLIT_ROUTES.join(","), // disarm+arm pair
    );
    var strict = makeRm({
      enabled: true,
      arm: function () {
        throw new Error("no binary");
      },
      disarm: function () {},
      status: function () {
        return { armed: false };
      },
    });
    var thrown = null;
    try {
      strict.applyGuardianProbe = null;
      strict.guardian.enabled = true;
      strict.armGuardian({ routingBackend: "legacy" });
    } catch (e) {
      thrown = e;
    }
    record(
      "an arm failure surfaces as GUARDIAN_UNAVAILABLE",
      !!thrown && thrown.code === "GUARDIAN_UNAVAILABLE",
    );
    var passthrough = makeRm({ enabled: false });
    record(
      "with netguard disabled the legacy flow is untouched",
      passthrough.armGuardian(null) === true && events.length === 3,
    );

    var passed = results.filter(Boolean).length;
    console.log("\n" + passed + "/" + results.length + " checks passed");
    if (passed !== results.length) process.exit(1);
  }
})();
