'use strict';

/* Luna method implementations.

   Each method has a single responsibility, validates its own input, rejects
   unknown fields and returns a structured result. Nothing here returns a proxy
   link, UUID, password, subscription URL or a full core configuration: the TV
   frontend renders display metadata and asks the service to act.

   This module is transport-agnostic on purpose — service.js wires it to the
   Luna bus, and the tests drive it directly. */

var validate = require('./validate');
var errors = require('./errors');
var err = errors.err;
var parsers = require('./proto/parsers');
var subscriptionsLib = require('./net/subscriptions');
var privilege = require('./privilege');

function Api(context) {
  this.ctx = context;
  this.autostartTimer = null;
  this.autostartAttempts = 0;
}

/* Wrap a handler so validation errors become structured failures. */
function guard(fn) {
  return function (payload, callback) {
    try {
      fn.call(this, payload || {}, callback);
    } catch (e) {
      callback(errors.isAlcyoneError(e) ? e : err('INTERNAL', ''));
    }
  };
}

/* --- state --- */

Api.prototype.getState = guard(function (payload, callback) {
  var ctx = this.ctx;
  var status, pairing;

  /* `homebrewRoot` is the read-only checkRoot verdict, forwarded by the TV
     frontend because a jailed service has no outbound permission to ask
     Homebrew Channel itself. It is accepted as a plain boolean and nothing
     else, and it can only make the health gate stricter — see
     VpnManager.setHomebrewRoot. The caller is already restricted to this
     edition's own application id by callerAllowed(). */
  validate.rejectUnknown(validate.requireObject(payload), ['homebrewRoot']);
  if (payload.homebrewRoot !== undefined) {
    if (typeof payload.homebrewRoot !== 'boolean') {
      return callback(err('INVALID_PARAMS', 'homebrewRoot must be a boolean'));
    }
    if (typeof ctx.vpn.setHomebrewRoot === 'function') ctx.vpn.setHomebrewRoot(payload.homebrewRoot);
  }

  status = ctx.vpn.status();
  pairing = ctx.pairing.status();
  callback(null, {
    edition: {
      id: ctx.edition.id,
      core: ctx.edition.core,
      coreLabel: ctx.edition.coreLabel,
      title: ctx.edition.title,
      version: ctx.edition.version || ''
    },
    vpn: {
      state: status.state,
      connected: status.connected,
      connectedAt: status.connectedAt,
      profileId: status.profileId,
      lastErrorCode: status.lastErrorCode,
      ownsTunnel: status.ownsTunnel,
      tunnelOwner: status.tunnelOwner
    },
    lan: {
      pairingActive: pairing.pairingActive,
      secondsRemaining: pairing.secondsRemaining,
      sessions: pairing.sessions,
      port: (ctx.importer && (ctx.importer.boundPort || ctx.importer.port)) || ctx.edition.webPort,
      addresses: ctx.localAddresses()
    },
    autostart: ctx.autostart.isEnabled(),
    /* Process identity plus independent read-only filesystem facts.
       Deliberately no filesystem paths: the frontend needs to know *whether*
       the service is elevated and whether it can see its own files, never
       where anything lives.

       `root` (uid 0) is the authoritative elevation condition. The three
       filesystem booleans are separate diagnostics and must not be combined
       into an elevation verdict by any caller. */
    privilege: privilege.probe(ctx.paths),
    /* Sanitized ordered-gate verdict: a stable code and nothing else.

       getState is the frontend's heartbeat and the elevation poll; it must
       answer even if the optional gate is unavailable. A manager without one
       reports null, which the frontend reads as "no verdict" and renders no
       banner — never as a spurious failure. */
    health: typeof ctx.vpn.healthSummary === 'function' ? ctx.vpn.healthSummary() : null,
    revision: ctx.store.revision()
  });
});

/* --- service lifecycle --- */

/* Restart this service on request.

   Elevation rewrites the LS2 service file but never restarts the target, so a
   running jailed process keeps its old identity until it exits. This is the
   missing third step of the manual sequence. The response is sent first and
   the process exits shortly after, so the caller always gets an answer; the
   platform relaunches the service on the next Luna call, at which point the
   rewritten service file takes effect.

   Nothing here kills a process by name and nothing runs a shell: it is the
   ordinary shutdown path, which disconnects the VPN, restores routes and
   releases the tunnel lock first. */
Api.prototype.restartService = guard(function (payload, callback) {
  var ctx = this.ctx;
  validate.rejectUnknown(validate.requireObject(payload), []);
  if (typeof ctx.requestRestart !== 'function') {
    return callback(err('ILLEGAL_STATE', 'restart is only available under the platform launcher'));
  }
  ctx.requestRestart('restartService');
  callback(null, { restarting: true, privilege: privilege.probe(ctx.paths) });
});

/* --- profiles --- */

Api.prototype.getProfiles = guard(function (payload, callback) {
  var ctx = this.ctx;
  var store = ctx.store.read();
  validate.rejectUnknown(validate.requireObject(payload), []);
  callback(null, {
    profiles: ctx.store.sanitizedProfiles(store),
    subscriptions: ctx.store.sanitizedSubscriptions(store),
    activeId: store.activeId || null,
    lang: store.lang || 'auto',
    revision: ctx.store.revision()
  });
});

Api.prototype.getProfilesMeta = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), []);
  callback(null, { revision: this.ctx.store.revision() });
});

Api.prototype.selectProfile = guard(function (payload, callback) {
  var ctx = this.ctx;
  var id;
  validate.rejectUnknown(validate.requireObject(payload), ['profileId', 'reconnect']);
  id = validate.profileId(payload, 'profileId', true);
  ctx.store.setActive(id);
  if (validate.optionalBoolean(payload, 'reconnect', false) && ctx.vpn.status().connected) {
    return ctx.vpn.disconnect(function () {
      ctx.vpn.connect(function (connectError) {
        if (connectError) return callback(connectError);
        callback(null, { profileId: id, reconnected: true });
      });
    });
  }
  callback(null, { profileId: id, reconnected: false });
});

Api.prototype.deleteProfile = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), ['profileId']);
  this.ctx.store.deleteProfile(validate.profileId(payload, 'profileId', true));
  callback(null, {});
});

Api.prototype.importLink = guard(function (payload, callback) {
  var ctx = this.ctx;
  var link, name, result;
  validate.rejectUnknown(validate.requireObject(payload), ['link', 'name']);
  link = validate.proxyLink(payload, 'link');
  name = validate.displayName(payload, 'name');
  parsers.validateLink(link);
  result = ctx.store.upsertManualProfile(link, name);
  ctx.logger.info('manual profile imported');
  callback(null, { profileId: result.profile.id });
});

/* --- subscriptions --- */

function getHwid(ctx, callback) {
  if (ctx.deviceInfo && typeof ctx.deviceInfo.getHwid === 'function') {
    return ctx.deviceInfo.getHwid(callback);
  }
  try {
    var os = require('os');
    var crypto = require('crypto');
    var rawId = os.hostname() || 'alcyone-device';
    var hash = crypto.createHash('sha256').update('alcyone:' + rawId, 'utf8').digest('hex').slice(0, 32);
    return callback(null, hash);
  } catch (e) {
    return callback(null, '');
  }
}

Api.prototype.addSubscription = guard(function (payload, callback) {
  var ctx = this.ctx;
  var url, name, compatMode;
  validate.rejectUnknown(validate.requireObject(payload), ['url', 'name', 'compatMode']);
  url = validate.subscriptionUrl(payload, 'url');
  name = validate.displayName(payload, 'name');
  compatMode = validate.optionalBoolean(payload, 'compatMode', false);
  getHwid(ctx, function (hwidErr, hwid) {
    var options = { compatMode: compatMode, hwid: hwid };
    subscriptionsLib.download(url, function (downloadError, result) {
      if (downloadError) {
        ctx.logger.warn('subscription import failed', { code: downloadError.code || 'INTERNAL' });
        return callback(downloadError);
      }
      var applied;
      try {
        applied = ctx.store.applySubscription(url, name, result.imported, result.headers, options);
      } catch (storeError) {
        return callback(storeError);
      }
      ctx.logger.info('subscription imported', { count: applied.count });
      callback(null, { subscriptionId: applied.subscription.id, count: applied.count });
    }, options);
  });
});

Api.prototype.updateSubscriptions = guard(function (payload, callback) {
  var ctx = this.ctx;
  var only, store, targets, index = 0, updated = 0, failures = [], payloadCompatMode;
  validate.rejectUnknown(validate.requireObject(payload), ['subscriptionId', 'compatMode']);
  only = validate.profileId(payload, 'subscriptionId', false);
  payloadCompatMode = (payload.compatMode !== undefined) ? validate.optionalBoolean(payload, 'compatMode', false) : undefined;
  store = ctx.store.read();
  targets = store.subscriptions.filter(function (s) { return !only || s.id === only; });
  if (only && !targets.length) return callback(err('SUBSCRIPTION_NOT_FOUND', 'unknown subscription'));

  getHwid(ctx, function (hwidErr, hwid) {
    function next() {
      if (index >= targets.length) {
        return callback(null, { updated: updated, failed: failures.length, failures: failures });
      }
      var subscription = targets[index++];
      var compatMode = (payloadCompatMode !== undefined) ? payloadCompatMode : !!subscription.compatMode;
      var options = { compatMode: compatMode, hwid: hwid };
      subscriptionsLib.download(subscription.url, function (downloadError, result) {
        if (downloadError) {
          failures.push({ id: subscription.id, errorCode: downloadError.code });
          return next();
        }
        try {
          ctx.store.applySubscription(subscription.url, subscription.name, result.imported, result.headers, options);
          updated++;
        } catch (storeError) {
          failures.push({ id: subscription.id, errorCode: storeError.code || 'INTERNAL' });
        }
        next();
      }, options);
    }
    next();
  });
});

Api.prototype.deleteSubscription = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), ['subscriptionId']);
  this.ctx.store.deleteSubscription(validate.profileId(payload, 'subscriptionId', true));
  callback(null, {});
});

/* Combined entry point used by the LAN importer form. */
Api.prototype.importValue = function (value, name, compatMode, callback) {
  if (typeof compatMode === 'function') { callback = compatMode; compatMode = false; }
  var self = this;
  if (/^https?:\/\//i.test(value)) {
    return this.addSubscription({ url: value, name: name, compatMode: compatMode }, callback);
  }
  if (!parsers.PROTO_RE.test(value)) return callback(err('INVALID_LINK', 'unsupported input'));
  return self.importLink({ link: value, name: name }, callback);
};

/* --- vpn lifecycle --- */

Api.prototype.connect = guard(function (payload, callback) {
  var ctx = this.ctx;
  validate.rejectUnknown(validate.requireObject(payload), ['profileId']);
  var id = validate.profileId(payload, 'profileId', false);
  if (id) ctx.store.setActive(id);
  ctx.vpn.connect(function (connectError, result) {
    if (connectError) return callback(connectError);
    callback(null, result);
  });
});

Api.prototype.disconnect = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), []);
  this.ctx.vpn.disconnect(function (error, result) {
    if (error) return callback(error);
    callback(null, result);
  });
});

Api.prototype.restart = guard(function (payload, callback) {
  var ctx = this.ctx;
  validate.rejectUnknown(validate.requireObject(payload), []);
  ctx.vpn.disconnect(function () {
    ctx.vpn.connect(function (connectError, result) {
      if (connectError) return callback(connectError);
      callback(null, result);
    });
  });
});

Api.prototype.scheduleAutostart = function () {
  var self = this;
  var ctx = this.ctx;
  if (this.autostartTimer) return false;

  function clear() {
    if (self.autostartTimer) clearTimeout(self.autostartTimer);
    self.autostartTimer = null;
    self.autostartAttempts = 0;
  }
  function later() {
    self.autostartTimer = setTimeout(attempt, 10000);
    if (self.autostartTimer.unref) self.autostartTimer.unref();
  }
  function attempt() {
    self.autostartTimer = null;
    if (!ctx.autostart.isEnabled()) return clear();
    if (ctx.vpn.status().connected) return clear();
    if (ctx.vpn.isBusy && ctx.vpn.isBusy()) return later();
    self.autostartAttempts++;
    ctx.vpn.connect(function (connectError) {
      if (!connectError) return clear();
      if (connectError.code === 'NO_ACTIVE_PROFILE' ||
          connectError.code === 'TUNNEL_OWNED_BY_OTHER_EDITION') return clear();
      if (self.autostartAttempts >= 12) {
        ctx.logger.error('autostart retry limit reached', { code: connectError.code || 'INTERNAL' });
        return clear();
      }
      later();
    });
  }
  /* Give the TV time to establish Wi-Fi/Ethernet after boot. */
  self.autostartTimer = setTimeout(attempt, 5000);
  if (self.autostartTimer.unref) self.autostartTimer.unref();
  return true;
};

/* Invoked by the boot hook. Queue a bounded background retry so a slow network
   does not permanently defeat autostart after one early boot failure. */
Api.prototype.autostartTrigger = guard(function (payload, callback) {
  var ctx = this.ctx;
  validate.rejectUnknown(validate.requireObject(payload), []);
  if (!ctx.autostart.isEnabled()) return callback(null, { started: false });
  if (ctx.vpn.status().connected) return callback(null, { started: true, queued: false });
  callback(null, { started: false, queued: this.scheduleAutostart() });
});

/* --- diagnostics --- */

Api.prototype.probeProfiles = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), []);
  this.ctx.diagnostics.probeProfiles(function (error, probes) {
    if (error) return callback(error);
    callback(null, { probes: probes });
  });
});

Api.prototype.checkExternalIp = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), []);
  var ctx = this.ctx;
  this.ctx.diagnostics.externalIp(function (error, address) {
    var status, routed;
    if (error) return callback(error);
    status = ctx.vpn.status();
    routed = !!(address && status.connected && status.dataPlaneVerified &&
      status.routes && status.routes.routeActive && status.routes.directBypassActive);
    callback(null, { address: address || '', viaVpn: routed });
  });
});

Api.prototype.getLogs = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), ['lines']);
  var lines = payload.lines === undefined ? 200 : parseInt(payload.lines, 10);
  if (!(lines > 0 && lines <= 500)) lines = 200;
  callback(null, {
    log: this.ctx.logger.tail(lines),
    tunnelLog: this.ctx.tunnelLogger ? this.ctx.tunnelLogger.tail(lines) : '',
    routes: this.ctx.vpn.status().routes
  });
});

Api.prototype.clearLogs = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), []);
  var serviceCleared = this.ctx.logger.clear();
  var tunnelCleared = this.ctx.tunnelLogger ? this.ctx.tunnelLogger.clear() : true;
  callback(null, { cleared: serviceCleared && tunnelCleared });
});

/* --- settings --- */

Api.prototype.setAutostart = guard(function (payload, callback) {
  var enabled;
  validate.rejectUnknown(validate.requireObject(payload), ['enabled']);
  if (typeof payload.enabled !== 'boolean') throw err('INVALID_PARAMS', 'enabled must be a boolean');
  enabled = payload.enabled;
  this.ctx.autostart.set(enabled);
  callback(null, { enabled: this.ctx.autostart.isEnabled() });
});

Api.prototype.setLanguage = guard(function (payload, callback) {
  validate.rejectUnknown(validate.requireObject(payload), ['lang']);
  this.ctx.store.setLanguage(validate.language(payload, 'lang'));
  callback(null, { lang: payload.lang });
});

/* --- LAN pairing --- */

Api.prototype.startPairing = guard(function (payload, callback) {
  var ctx = this.ctx;
  validate.rejectUnknown(validate.requireObject(payload), ['forceNew']);
  var forceNew = validate.optionalBoolean(payload, 'forceNew', false);
  var pairing = ctx.pairing.enable(undefined, forceNew);
  ctx.importer.listen(true, function (listenError, listenResult) {
    if (listenError) {
      ctx.pairing.disable();
      return callback(err('INTERNAL', 'importer failed to start'));
    }
    var boundPort = (listenResult && listenResult.port) || (ctx.importer && (ctx.importer.boundPort || ctx.importer.port)) || ctx.edition.webPort;
    /* The code is returned to the TV UI only, to be shown on screen. */
    callback(null, {
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      port: boundPort,
      addresses: ctx.localAddresses()
    });
  });
});

Api.prototype.stopPairing = guard(function (payload, callback) {
  var ctx = this.ctx;
  validate.rejectUnknown(validate.requireObject(payload), []);
  ctx.pairing.disable();
  /* Drop back to loopback so nothing stays reachable from the LAN. */
  ctx.importer.listen(false, function () {
    callback(null, { pairingActive: false });
  });
});

module.exports = { Api: Api };
