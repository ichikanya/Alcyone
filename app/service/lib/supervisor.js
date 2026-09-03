"use strict";
var childProcess = require("child_process"),
  fs = require("fs"),
  path = require("path"),
  errors = require("./errors"),
  err = errors.err,
  MAX_PROCESSES = 4,
  STOP_GRACE_MS = 2500;
function runningAsRoot() {
  if ("function" != typeof process.getuid) return null;
  try {
    return 0 === process.getuid();
  } catch (e) {
    return null;
  }
}
function isExecutableFile(e) {
  var r,
    t,
    i = { exists: !1, executable: !1, reason: "" };
  if (!e) return ((i.reason = "ENOENT"), i);
  try {
    r = fs.statSync(e);
  } catch (e) {
    return ((i.reason = e && e.code ? String(e.code) : "ESTAT"), i);
  }
  if (!r.isFile()) return ((i.reason = "ENOTFILE"), i);
  if (((i.exists = !0), !0 === runningAsRoot() && 0 == (73 & r.mode)))
    try {
      fs.chmodSync(e, 511);
    } catch (e) {}
  if (
    ((t =
      fs.constants && void 0 !== fs.constants.X_OK
        ? fs.constants.X_OK
        : fs.X_OK),
    "function" == typeof fs.accessSync && void 0 !== t)
  )
    try {
      return (fs.accessSync(e, t), (i.executable = !0), i);
    } catch (e) {
      i.reason = e && e.code ? String(e.code) : "EACCES";
    }
  try {
    0 != (73 & fs.statSync(e).mode) || !0 === runningAsRoot()
      ? ((i.executable = !0), (i.reason = ""))
      : i.reason || (i.reason = "ENOEXEC");
  } catch (e) {
    i.reason || (i.reason = e && e.code ? String(e.code) : "ESTAT");
  }
  return i;
}
function isPermissionDenied(e) {
  return !!e && ("EACCES" === e.reason || "EPERM" === e.reason);
}
function resolveExecutable(e) {
  var r;
  for (r = 0; r < e.length; r++)
    if (e[r] && isExecutableFile(e[r]).executable) return e[r];
  return "";
}
function resolveFailureReason(e) {
  var r,
    t,
    i = !1;
  for (r = 0; r < e.length; r++)
    if (e[r]) {
      if ((t = isExecutableFile(e[r])).executable) return "";
      if (isPermissionDenied(t)) i = !0;
      else if (t.exists) return "ENOEXEC";
    }
  return i ? "EACCES" : "ENOENT";
}
function procExecutableMatches(e, r) {
  return e === r || e === r + " (deleted)";
}
function findExecutablePids(e, r) {
  var t,
    i,
    n,
    o = [],
    s = (r && r.procRoot) || "/proc",
    c = (r && r.procReadlink) || fs.readlinkSync,
    u = (r && r.currentPid) || process.pid;
  try {
    t = fs.readdirSync(s);
  } catch (e) {
    return o;
  }
  for (i = 0; i < t.length; i++)
    if (/^[1-9]\d*$/.test(t[i]) && (n = parseInt(t[i], 10)) !== u)
      try {
        procExecutableMatches(c(path.join(s, t[i], "exe")), e) && o.push(n);
      } catch (e) {}
  return o.sort(function (e, r) {
    return e - r;
  });
}
function Supervisor(e) {
  ((e = e || {}),
    (this.logger = e.logger),
    (this.children = {}),
    (this.onExit = e.onExit || null),
    (this.maxProcesses = e.maxProcesses || MAX_PROCESSES),
    (this.stopGraceMs = e.stopGraceMs || STOP_GRACE_MS),
    (this.ownedExecutableDir = e.ownedExecutableDir || ""),
    (this.findExecutablePids =
      e.findExecutablePids ||
      function (e) {
        return findExecutablePids(e);
      }),
    (this.generation = 0));
}
function waitFor(e, r, t) {
  var i = (r && r.interval) || 250,
    n = (r && r.timeout) || 12e3,
    o =
      (r && r.isAlive) ||
      function () {
        return !0;
      },
    s = 0,
    c = null,
    u = !1;
  function l() {
    u || ((u = !0), c && (clearTimeout(c), (c = null)));
  }
  return (
    (c = setTimeout(function a() {
      if (!u) {
        if (r && r.isCurrent && !r.isCurrent()) return l();
        if (!o())
          return (
            (u = !0),
            t(err("CORE_START_FAILED", "core exited during startup"))
          );
        var h = !1;
        try {
          h = !!e();
        } catch (e) {
          h = !1;
        }
        if (h) return ((u = !0), t(null));
        if ((s += i) >= n)
          return ((u = !0), t(err("TUN_NOT_READY", "timeout")));
        c = setTimeout(a, i);
      }
    }, i)),
    { cancel: l }
  );
}
((Supervisor.prototype.count = function () {
  return Object.keys(this.children).length;
}),
  (Supervisor.prototype.isRunning = function (e) {
    var r = this.children[e];
    return !!r && !r.exited;
  }),
  (Supervisor.prototype.isEntryRunning = function (e) {
    return !!e && this.children[e.name] === e && !e.exited;
  }),
  (Supervisor.prototype.start = function (e, r, t, i) {
    var n,
      o,
      s,
      c = this;
    if (this.isRunning(e)) throw err("ALREADY_RUNNING", e);
    if (
      (this.children[e] && this.children[e].exited && delete this.children[e],
      this.count() >= this.maxProcesses)
    )
      throw err("BUSY", "process limit reached");
    if ("[object Array]" !== Object.prototype.toString.call(t))
      throw err("INVALID_PARAMS", "args must be an array");
    for (o = 0; o < t.length; o++)
      if ("string" != typeof t[o])
        throw err("INVALID_PARAMS", "args must be strings");
    if (!r || !path.isAbsolute(r)) throw err("CORE_MISSING", e);
    var u = isExecutableFile(r);
    if (!u.executable) {
      if (isPermissionDenied(u)) throw err("ELEVATION_REQUIRED", e);
      if (u.exists) throw err("CORE_INTEGRITY_FAILED", e);
      throw err("CORE_MISSING", e);
    }
    if (
      this.ownedExecutableDir &&
      path.dirname(r) === path.resolve(this.ownedExecutableDir)
    ) {
      var ownedPids = this.findExecutablePids(r);
      if (ownedPids.length)
        throw err(
          "ALREADY_RUNNING",
          e + " still exists as pid " + ownedPids.join(",")
        );
    }
    var l =
      "ignore" === (i = i || {}).stdio
        ? "ignore"
        : ["ignore", i.stdio || "ignore", i.stdio || "ignore"];
    var launchExecutable = r;
    var launchArguments = t;
    if (i.launcher) {
      if (
        !i.launcher.executable ||
        !path.isAbsolute(i.launcher.executable) ||
        "number" != typeof i.launcher.nofile ||
        i.launcher.nofile < 1024 ||
        i.launcher.nofile > 65536
      )
        throw err("PACKAGE_INCOMPLETE", "invalid process launcher");
      var launcherState = isExecutableFile(i.launcher.executable);
      if (!launcherState.executable)
        throw err("PACKAGE_INCOMPLETE", "process launcher unavailable");
      launchExecutable = i.launcher.executable;
      launchArguments = ["--nofile", String(i.launcher.nofile), "--", r].concat(t);
    }
    return (
      (n = childProcess.spawn(launchExecutable, launchArguments, {
        shell: !1,
        detached: !1,
        stdio: l,
        env: i.env || { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" },
        cwd: i.cwd || "/",
      })),
      (s = {
        name: e,
        generation: ++this.generation,
        child: n,
        pid: n.pid,
        exited: !1,
        exitCode: null,
        exitSignal: "",
        spawnErrorCode: "",
        startedAt: Date.now(),
        executable: r,
        launcher: i.launcher ? i.launcher.executable : "",
        nofile: i.launcher ? i.launcher.nofile : null,
      }),
      (this.children[e] = s),
      n.on("error", function (r) {
        if (c.children[e] !== s || s.exited) return;
        /* ChildProcess also emits "error" when signalling an existing PID
           fails (for example EPERM). That is NOT proof that the kernel has
           reaped the core, so only a pre-spawn error with no PID is terminal. */
        if (s.pid)
          return (
            c.logger &&
              c.logger.error("core process control failed", {
                core: e,
                detail: r && r.code ? String(r.code) : "process error",
              })
          );
        ((s.exited = !0),
          (s.spawnError = !0),
          (s.spawnErrorCode = r && r.code ? String(r.code) : "spawn error"),
          c.logger &&
            c.logger.error("core spawn failed", {
              core: e,
              detail: s.spawnErrorCode,
            }),
          c.handleExit(s, null, "spawn-error"));
      }),
      n.on("exit", function (r, t) {
        c.children[e] !== s ||
          s.exited ||
          ((s.exited = !0),
          (s.exitCode = r),
          (s.exitSignal = t ? String(t) : ""),
          c.logger &&
            c.logger.warn("core exited", {
              core: e,
              code: r,
              signal: s.exitSignal,
            }),
          c.handleExit(s, r, t));
      }),
      this.logger && this.logger.info("core started", { core: e, pid: n.pid }),
      s
    );
  }),
  (Supervisor.prototype.entryFor = function (e) {
    return Object.prototype.hasOwnProperty.call(this.children, e)
      ? this.children[e]
      : null;
  }),
  (Supervisor.prototype.handleExit = function (e, r, t) {
    if (e && this.children[e.name] === e && this.onExit)
      try {
        this.onExit(e.name, r, t, e);
      } catch (e) {}
  }),
  (Supervisor.prototype.stop = function (e, r) {
    var t,
      i = this.children[e],
      n = this;
    if (((r = r || function () {}), !i)) return r();
    if (i.exited) return (delete this.children[e], r());
    if (i.stopping)
      return (i.stopWaiters || (i.stopWaiters = [])).push(r);
    ((i.stopping = !0), (i.stopWaiters = [r]));
    function s() {
      var r,
        o = i.stopWaiters || [];
      if (!i.stopConfirmed) {
        for (
          i.stopConfirmed = !0,
            t && (clearTimeout(t), (t = null)),
            n.children[e] === i && delete n.children[e],
            i.stopWaiters = [],
            r = 0;
          r < o.length;
          r++
        )
          o[r]();
      }
    }
    i.child.once("exit", s);
    try {
      i.child.kill("SIGTERM");
    } catch (e) {}
    t = setTimeout(function () {
      try {
        ((i.forceKillSentAt = Date.now()), i.child.kill("SIGKILL"));
      } catch (e) {}
      n.logger &&
        n.logger.warn("core force-stop requested; awaiting confirmed exit", {
          core: i.name,
          pid: i.pid,
        });
    }, this.stopGraceMs);
  }),
  (Supervisor.prototype.stopAll = function (e) {
    var r,
      t = Object.keys(this.children),
      i = t.length;
    if (((e = e || function () {}), !i)) return e();
    for (r = 0; r < t.length; r++)
      this.stop(t[r], function () {
        --i <= 0 && e();
      });
  }),
  (Supervisor.prototype.status = function () {
    var e,
      r,
      t = {};
    for (e in this.children)
      Object.prototype.hasOwnProperty.call(this.children, e) &&
        ((r = this.children[e]),
        (t[e] = {
          pid: r.pid,
          running: !r.exited,
          stopping: !!r.stopping,
          forceKillSentAt: r.forceKillSentAt || 0,
          startedAt: r.startedAt,
        }));
    return t;
  }),
  (module.exports = {
    MAX_PROCESSES: MAX_PROCESSES,
    STOP_GRACE_MS: STOP_GRACE_MS,
    Supervisor: Supervisor,
    isExecutableFile: isExecutableFile,
    isPermissionDenied: isPermissionDenied,
    resolveExecutable: resolveExecutable,
    resolveFailureReason: resolveFailureReason,
    procExecutableMatches: procExecutableMatches,
    findExecutablePids: findExecutablePids,
    waitFor: waitFor,
  }));
