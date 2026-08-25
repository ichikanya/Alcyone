"use strict";

/* Client side of the independent network guardian (alcyone-netguard).

   The service writes a root-only lease describing the EXACT objects it is
   about to create (activation rule / table, split routes, TUN interface),
   then starts the guardian detached BEFORE the takeover. While connected
   it refreshes a heartbeat file every few seconds. If heartbeats stop -
   service crash, SIGSTOP or hang - the guardian removes only the leased
   objects and ordinary internet returns without any Node code running.

   The lease uses the legacy KEY='VALUE' line format: trivial to write
   from ES5 and to parse from C with no shell and no JSON library. */

var childProcess = require("child_process"),
  fs = require("fs"),
  path = require("path"),
  atomic = require("../atomic"),
  errors = require("../errors"),
  err = errors.err;

var LEASE_VERSION = 1,
  HEARTBEAT_INTERVAL_MS = 5000,
  LEASE_MS = 30000,
  ACK_TIMEOUT_MS = 2500,
  DISARM_EXIT_MS = 2000,
  GUARDIAN_CANDIDATES = [
    "/usr/bin/alcyone-netguard",
    "/usr/local/bin/alcyone-netguard",
  ];

function shQuote(r) {
  return "'" + String(r).replace(/'/g, "'\\''") + "'";
}
function serializeLease(r) {
  var e = [];
  e.push("# alcyone-netguard lease v" + LEASE_VERSION);
  e.push("VERSION='" + LEASE_VERSION + "'");
  e.push("EDITION=" + shQuote(r.edition || ""));
  e.push("TUN_IF=" + shQuote(r.tunIf || ""));
  e.push(
    "RULE_PREF=" + shQuote(null == r.rulePref ? "" : String(r.rulePref)),
  );
  e.push(
    "RULE_TABLE=" + shQuote(null == r.ruleTable ? "" : String(r.ruleTable)),
  );
  e.push("V6_RULE=" + (r.v6Rule ? "1" : "0"));
  e.push("SPLIT_V4=" + shQuote((r.splitV4 || []).join(",")));
  e.push("V6_BLOCK=" + shQuote((r.v6Block || []).join(",")));
  e.push("LEASE_MS=" + shQuote(String(r.leaseMs || LEASE_MS)));
  e.push("HEARTBEAT=" + shQuote(r.heartbeatFile || ""));
  e.push("SERVICE_PID=" + shQuote(String(r.servicePid || process.pid)));
  e.push("CREATED_AT='" + new Date().toISOString() + "'");
  return e.join("\n") + "\n";
}
function findBinary(r) {
  var e, t;
  for (e = 0; e < r.length; e++)
    try {
      if ((t = fs.statSync(r[e])).isFile() && 0 != (73 & t.mode)) return r[e];
    } catch (r) {}
  return "";
}

function GuardianClient(r) {
  r = r || {};
  this.logger = r.logger || null;
  this.leaseFile = r.leaseFile;
  this.heartbeatFile =
    r.heartbeatFile || (this.leaseFile ? this.leaseFile + ".beat" : "");
  this.firedFile = this.leaseFile ? this.leaseFile + ".fired" : "";
  this.binaryPath = r.binaryPath || "";
  if (!this.binaryPath && !r.spawnImpl)
    this.binaryPath = findBinary(
      GUARDIAN_CANDIDATES.concat(
        r.searchDirs
          ? r.searchDirs.map(function (e) {
              return path.join(e, "alcyone-netguard");
            })
          : [],
      ),
    );
  this.enabled = void 0 !== r.enabled
    ? !!r.enabled
    : "1" === process.env.ALCYONE_NETGUARD;
  this.intervalMs = r.intervalMs || HEARTBEAT_INTERVAL_MS;
  this.leaseMs = r.leaseMs || LEASE_MS;
  this.ackTimeoutMs = r.ackTimeoutMs || ACK_TIMEOUT_MS;
  this._spawnImpl = r.spawnImpl || null;
  this._now = r.nowImpl || Date.now;
  this._child = null;
  this._timer = null;
}
(GuardianClient.prototype._spawnGuardian = function () {
  if (this._spawnImpl) return this._spawnImpl(this.leaseFile);
  if (!this.binaryPath)
    throw err("GUARDIAN_UNAVAILABLE", "alcyone-netguard binary not found");
  var r = childProcess.spawn(
    this.binaryPath,
    ["--lease", this.leaseFile],
    { detached: !0, stdio: "ignore" },
  );
  return (r.unref(), r);
}),
  (GuardianClient.prototype._touchHeartbeat = function (r) {
    /* Create-then-touch: the heartbeat must exist from the moment the
       lease window opens, before the guardian process is even spawned. */
    try {
      fs.writeFileSync(this.heartbeatFile, "");
      fs.utimesSync(this.heartbeatFile, r, r);
    } catch (r2) {}
  }),
  /* A live child has no numeric exitCode yet; fakes without the field
     count as alive until they are kill()ed themselves. */
  (GuardianClient.prototype._childAlive = function () {
    var r = this._child;
    return !!r && "number" != typeof r.exitCode;
  }),
  /* Acknowledgement contract: the guardian rewrites the heartbeat with
     its own PID after parsing the lease. Empty content = not yet acked,
     independent of filesystem timestamp granularity. */
  (GuardianClient.prototype._ackSeen = function () {
    var r;
    try {
      r = fs.readFileSync(this.heartbeatFile, "utf8");
    } catch (e) {
      return !1;
    }
    return /^[1-9][0-9]{0,9}/.test(r);
  }),
  (GuardianClient.prototype.arm = function (r) {
    var e, t, o;
    if (!this.enabled)
      throw err("GUARDIAN_UNAVAILABLE", "netguard feature is disabled");
    if (!this.leaseFile) throw err("GUARDIAN_UNAVAILABLE", "no lease path");
    if (this._child)
      throw err("GUARDIAN_UNAVAILABLE", "guardian already armed");
    atomic.ensureOwnedDir(path.dirname(this.leaseFile));
    t = this._now();
    /* Heartbeat window opens now: the lease must be fresh even if the
       service dies between spawn and its first heartbeat. */
    this._touchHeartbeat(new Date(t));
    atomic.writeFileAtomic(this.leaseFile, serializeLease({
      edition: r.edition,
      tunIf: r.tunIf,
      rulePref: r.rulePref,
      ruleTable: r.ruleTable,
      v6Rule: r.v6Rule,
      splitV4: r.splitV4,
      v6Block: r.v6Block,
      leaseMs: r.leaseMs || this.leaseMs,
      heartbeatFile: this.heartbeatFile,
      servicePid: process.pid,
    }));
    o = this._spawnGuardian();
    this._child = o;
    for (
      t = this._now();
      this._now() - t < this.ackTimeoutMs &&
      !(this._ackSeen() && this._childAlive());

    )
      /* busy wait bounded by ACK_TIMEOUT_MS; failure path only on real
         misconfiguration, success acks within one scheduler slice */
      ;
    if (!(this._ackSeen() && this._childAlive())) {
      this._killChild();
      this._removeFiles();
      this._child = null;
      this.logger && this.logger.error("guardian failed to arm", { pid: o.pid });
      throw err("GUARDIAN_UNAVAILABLE", "guardian did not acknowledge the lease");
    }
    this._startHeartbeat();
    return (
      this.logger &&
        this.logger.info("netguard armed", { pid: o.pid }),
      { pid: o.pid }
    );
  }),
  (GuardianClient.prototype._startHeartbeat = function () {
    var r = this;
    this.stopHeartbeat();
    this._timer = setInterval(function () {
      r._touchHeartbeat(new Date(r._now()));
    }, this.intervalMs);
    this._timer.unref && this._timer.unref();
  }),
  (GuardianClient.prototype.stopHeartbeat = function () {
    this._timer && (clearInterval(this._timer), (this._timer = null));
  }),
  (GuardianClient.prototype._killChild = function () {
    var r = this._child;
    if (r)
      try {
        r.kill("SIGTERM");
      } catch (r) {}
  }),
  (GuardianClient.prototype._removeFiles = function () {
    atomic.removeQuiet(this.leaseFile);
    atomic.removeQuiet(this.heartbeatFile);
  }),
  (GuardianClient.prototype.disarm = function () {
    var r, e;
    if (
      (this.stopHeartbeat(),
      this._removeFiles(),
      (r = this._child),
      (this._child = null),
      !r)
    )
      return !0;
    try {
      r.kill("SIGTERM");
    } catch (r) {}
    for (e = this._now(); this._now() - e < DISARM_EXIT_MS && !r.killed; );
    if (!r.killed)
      try {
        r.kill("SIGKILL");
      } catch (r) {}
    return (
      this.logger && this.logger.info("netguard disarmed"), !0
    );
  }),
  (GuardianClient.prototype.status = function () {
    var r;
    try {
      r = fs.statSync(this.firedFile).isFile();
    } catch (e) {
      r = !1;
    }
    return {
      enabled: this.enabled,
      armed: !!this._child,
      binaryFound: !!this.binaryPath || !!this._spawnImpl,
      pid: this._child ? this._child.pid : 0,
      failOpenFired: r,
    };
  }),
  (module.exports = {
    LEASE_VERSION: LEASE_VERSION,
    HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL_MS,
    LEASE_MS: LEASE_MS,
    serializeLease: serializeLease,
    findBinary: findBinary,
    GuardianClient: GuardianClient,
  });
