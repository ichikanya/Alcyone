'use strict';

/* Cross-edition tunnel ownership lock.

   Both editions manage the same `tun0` device and the same default routes, so
   only one may own the tunnel at a time. The lock lives at a fixed path shared
   by both editions (outside either edition's private data directory) and
   records the owning edition, its service id and the pid that took it.

   A lock whose pid is gone is stale and may be reclaimed: that is what makes
   recovery after a crash or an unclean shutdown safe. */

var fs = require('fs');
var path = require('path');
var atomic = require('./atomic');
var errors = require('./errors');
var err = errors.err;

/* Shared between com.alcyone.vpn and com.alcyone.vpn.singbox by design. */
var LOCK_DIR = '/var/lib/alcyone-shared';
var LOCK_FILE = LOCK_DIR + '/tunnel.lock';

function processAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readLock(lockFile) {
  var data = atomic.readJson(lockFile || LOCK_FILE, null);
  if (!data || typeof data !== 'object') return null;
  if (!data.edition || !data.pid) return null;
  return data;
}

function TunnelLock(options) {
  options = options || {};
  this.edition = String(options.edition || 'xray');
  this.serviceId = String(options.serviceId || '');
  this.lockFile = String(options.lockFile || LOCK_FILE);
  this.logger = options.logger || null;
}

/* True when the lock is held by a live process of another edition. */
TunnelLock.prototype.heldByOther = function () {
  var current = readLock(this.lockFile);
  if (!current) return null;
  if (current.edition === this.edition) return null;
  if (!processAlive(current.pid)) return null;
  return current;
};

/* Take ownership, reclaiming a stale lock. Throws when another live edition
   owns the tunnel, so the caller can surface a precise error code. */
TunnelLock.prototype.acquire = function () {
  var blocking = this.heldByOther();
  var current;
  if (blocking) {
    throw err('TUNNEL_OWNED_BY_OTHER_EDITION', blocking.edition, { edition: blocking.edition });
  }
  current = readLock(this.lockFile);
  if (current && current.edition !== this.edition && this.logger) {
    this.logger.info('tunnel lock reclaimed from stale owner', { previous: current.edition });
  }
  atomic.ensureDir(path.dirname(this.lockFile));
  atomic.writeJsonAtomic(this.lockFile, {
    edition: this.edition,
    serviceId: this.serviceId,
    pid: process.pid,
    acquiredAt: Date.now()
  });
  return true;
};

/* Release only our own lock: never clear another edition's ownership. */
TunnelLock.prototype.release = function () {
  var current = readLock(this.lockFile);
  if (!current) return false;
  if (current.edition !== this.edition) return false;
  if (current.pid !== process.pid && processAlive(current.pid)) return false;
  return atomic.removeQuiet(this.lockFile);
};

TunnelLock.prototype.ownedByUs = function () {
  var current = readLock(this.lockFile);
  return !!current && current.edition === this.edition && current.pid === process.pid;
};

TunnelLock.prototype.status = function () {
  var current = readLock(this.lockFile);
  if (!current) return { held: false };
  return {
    held: true,
    edition: current.edition,
    live: processAlive(current.pid),
    mine: current.edition === this.edition && current.pid === process.pid
  };
};

module.exports = {
  LOCK_DIR: LOCK_DIR,
  LOCK_FILE: LOCK_FILE,
  TunnelLock: TunnelLock,
  processAlive: processAlive
};
