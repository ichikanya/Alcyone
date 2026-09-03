"use strict";
var fs = require("fs"),
  path = require("path"),
  atomic = require("./atomic"),
  errors = require("./errors"),
  err = errors.err,
  LOCK_DIR = "/var/lib/alcyone-shared",
  LOCK_FILE = LOCK_DIR + "/tunnel.lock";
function processAlive(e) {
  if (!e || "number" != typeof e) return !1;
  try {
    return (process.kill(e, 0), !0);
  } catch (e) {
    return "EPERM" === e.code;
  }
}
function readLock(e) {
  var i = atomic.readJson(e || LOCK_FILE, null);
  return i && "object" == typeof i && i.edition && i.pid ? i : null;
}
function TunnelLock(e) {
  ((e = e || {}),
    (this.edition = String(e.edition || "xray")),
    (this.serviceId = String(e.serviceId || "")),
    (this.lockFile = String(e.lockFile || LOCK_FILE)),
    (this.logger = e.logger || null),
    (this.errorCode = e.errorCode || "TUNNEL_OWNED_BY_OTHER_EDITION"));
}
function currentMode(e) {
  return e && e.mode ? String(e.mode) : "tun";
}
((TunnelLock.prototype.heldByOther = function () {
  var e = readLock(this.lockFile);
  return e
    ? e.edition === this.edition
      ? null
      : processAlive(e.pid)
        ? e
        : null
    : null;
}),
  (TunnelLock.prototype.acquire = function (e) {
    var i,
      o = this.heldByOther();
    if (o)
      throw err(this.errorCode, o.edition, {
        edition: o.edition,
        mode: currentMode(o),
        requestedMode: e || "tun",
      });
    return (
      (i = readLock(this.lockFile)) &&
        i.edition !== this.edition &&
        this.logger &&
        this.logger.info("tunnel lock reclaimed from stale owner", {
          previous: i.edition,
        }),
      atomic.ensureOwnedDir(path.dirname(this.lockFile)),
      atomic.writeJsonAtomic(this.lockFile, {
        edition: this.edition,
        serviceId: this.serviceId,
        pid: process.pid,
        mode: e || "tun",
        acquiredAt: Date.now(),
      }),
      !0
    );
  }),
  (TunnelLock.prototype.release = function () {
    var e = readLock(this.lockFile);
    return (
      !!e &&
      e.edition === this.edition &&
      (e.pid === process.pid || !processAlive(e.pid)) &&
      atomic.removeQuiet(this.lockFile)
    );
  }),
  (TunnelLock.prototype.ownedByUs = function () {
    var e = readLock(this.lockFile);
    return !!e && e.edition === this.edition && e.pid === process.pid;
  }),
  (TunnelLock.prototype.status = function () {
    var e = readLock(this.lockFile);
    return e
      ? {
          held: !0,
          edition: e.edition,
          mode: currentMode(e),
          live: processAlive(e.pid),
          mine: e.edition === this.edition && e.pid === process.pid,
        }
      : { held: !1 };
  }),
  (module.exports = {
    LOCK_DIR: LOCK_DIR,
    LOCK_FILE: LOCK_FILE,
    TunnelLock: TunnelLock,
    processAlive: processAlive,
  }));
