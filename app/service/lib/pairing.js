'use strict';

/* Pairing and session management for the LAN importer.

   Threat model: anyone on the same home network (or a guest Wi-Fi, or a
   compromised IoT device) can reach the TV's HTTP port. Plain HTTP cannot
   protect content in transit, so the design goal is to keep the window small,
   require a secret shown only on the TV screen, and never serve stored secrets
   back over the network.

   Rules enforced here:
   - LAN access is off by default; the user must enable it on the TV;
   - enabling mints a high-entropy pairing code and starts a bounded window;
   - a code may be redeemed once, converting it into a session cookie;
   - sessions expire on idle timeout and on an absolute total timeout;
   - all comparisons of secrets are constant time;
   - state-changing requests need a CSRF token bound to the session;
   - failed attempts are rate limited per client address. */

var crypto = require('crypto');
var errors = require('./errors');
var err = errors.err;

/* Bounded windows. Short by design: the importer is used interactively. */
var PAIRING_TTL_MS = 5 * 60 * 1000;
var SESSION_IDLE_MS = 10 * 60 * 1000;
var SESSION_TOTAL_MS = 30 * 60 * 1000;
var MAX_SESSIONS = 4;

/* Rate limiting for authentication attempts. */
var MAX_ATTEMPTS = 5;
var ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
var LOCKOUT_MS = 15 * 60 * 1000;

/* Unambiguous alphabet: no O/0, I/1 confusion when read off a TV screen. */
var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var CODE_LENGTH = 8;

/* Rejection-sampled so every character is uniformly distributed. */
function generateCode(randomBytes) {
  var out = '', buffer, i, value;
  var limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < CODE_LENGTH) {
    buffer = randomBytes(CODE_LENGTH);
    for (i = 0; i < buffer.length && out.length < CODE_LENGTH; i++) {
      value = buffer[i];
      if (value >= limit) continue;
      out += CODE_ALPHABET.charAt(value % CODE_ALPHABET.length);
    }
  }
  return out;
}

function generateToken(randomBytes) {
  return randomBytes(32).toString('hex');
}

/* Constant-time comparison that does not leak length through early exit. */
function safeEqual(a, b) {
  var left, right;
  a = String(a === undefined || a === null ? '' : a);
  b = String(b === undefined || b === null ? '' : b);
  left = new Buffer(crypto.createHash('sha256').update(a, 'utf8').digest());
  right = new Buffer(crypto.createHash('sha256').update(b, 'utf8').digest());
  if (typeof crypto.timingSafeEqual === 'function') return crypto.timingSafeEqual(left, right);
  /* Fallback: fixed-length XOR accumulation over the digests. */
  var diff = 0, i;
  for (i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function PairingManager(options) {
  options = options || {};
  this.randomBytes = options.randomBytes || crypto.randomBytes;
  this.now = options.now || function () { return Date.now(); };
  this.logger = options.logger || null;
  this.pairing = null;
  this.sessions = {};
  this.attempts = {};
}

/* --- pairing window --- */

/* Open or reuse a pairing window. Mint a fresh code if none is active or forceNew is true. */
PairingManager.prototype.enable = function (ttlMs, forceNew) {
  var now = this.now();
  if (!forceNew && this.pairingActive()) {
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt };
  }
  this.sessions = {};
  this.pairing = {
    code: generateCode(this.randomBytes),
    createdAt: now,
    expiresAt: now + (ttlMs || PAIRING_TTL_MS),
    redeemed: false
  };
  if (this.logger) this.logger.info('lan pairing enabled');
  return { code: this.pairing.code, expiresAt: this.pairing.expiresAt };
};

PairingManager.prototype.disable = function () {
  this.pairing = null;
  this.sessions = {};
  if (this.logger) this.logger.info('lan pairing disabled');
  return true;
};

PairingManager.prototype.pairingActive = function () {
  if (!this.pairing) return false;
  if (this.now() >= this.pairing.expiresAt) return false;
  return !this.pairing.redeemed;
};

/* True while any access should be served: an open window or a live session. */
PairingManager.prototype.accessActive = function () {
  return this.pairingActive() || this.activeSessionCount() > 0;
};

PairingManager.prototype.status = function () {
  var pairing = this.pairing;
  var active = this.pairingActive();
  return {
    pairingActive: active,
    /* The code itself is returned only to the TV UI, never to the LAN API. */
    expiresAt: active ? pairing.expiresAt : 0,
    secondsRemaining: active ? Math.max(0, Math.round((pairing.expiresAt - this.now()) / 1000)) : 0,
    sessions: this.activeSessionCount()
  };
};

/* --- rate limiting --- */

PairingManager.prototype.attemptState = function (clientKey) {
  var entry = this.attempts[clientKey];
  var now = this.now();
  if (!entry) return null;
  if (entry.lockedUntil && now < entry.lockedUntil) return entry;
  if (entry.lockedUntil && now >= entry.lockedUntil) { delete this.attempts[clientKey]; return null; }
  if (now - entry.firstAt > ATTEMPT_WINDOW_MS) { delete this.attempts[clientKey]; return null; }
  return entry;
};

PairingManager.prototype.isRateLimited = function (clientKey) {
  var entry = this.attemptState(clientKey);
  return !!(entry && entry.lockedUntil && this.now() < entry.lockedUntil);
};

PairingManager.prototype.recordFailure = function (clientKey) {
  var now = this.now();
  var entry = this.attemptState(clientKey);
  if (!entry) {
    entry = { count: 0, firstAt: now, lockedUntil: 0 };
    this.attempts[clientKey] = entry;
  }
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
    if (this.logger) this.logger.warn('lan auth rate limit engaged');
  }
  return entry;
};

PairingManager.prototype.clearFailures = function (clientKey) {
  delete this.attempts[clientKey];
};

/* --- sessions --- */

PairingManager.prototype.pruneSessions = function () {
  var now = this.now(), id, session;
  for (id in this.sessions) {
    if (!Object.prototype.hasOwnProperty.call(this.sessions, id)) continue;
    session = this.sessions[id];
    if (now >= session.expiresAt || now - session.lastSeen >= SESSION_IDLE_MS) delete this.sessions[id];
  }
};

PairingManager.prototype.activeSessionCount = function () {
  this.pruneSessions();
  return Object.keys(this.sessions).length;
};

/* Exchange a pairing code for a session. The code is single use: redeeming it
   closes the window so a shoulder-surfer cannot reuse it afterwards. */
PairingManager.prototype.redeem = function (submittedCode, clientKey) {
  var now = this.now(), session;

  if (this.isRateLimited(clientKey)) throw err('RATE_LIMITED', 'too many attempts');
  if (!this.pairing || now >= this.pairing.expiresAt) {
    this.recordFailure(clientKey);
    throw err('PAIRING_DISABLED', 'no active pairing window');
  }
  if (this.pairing.redeemed) {
    this.recordFailure(clientKey);
    throw err('PAIRING_DISABLED', 'code already used');
  }
  if (!safeEqual(String(submittedCode || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), this.pairing.code)) {
    this.recordFailure(clientKey);
    throw err('UNAUTHORIZED', 'invalid code');
  }

  this.clearFailures(clientKey);
  this.pairing.redeemed = true;
  this.pruneSessions();
  if (Object.keys(this.sessions).length >= MAX_SESSIONS) throw err('BUSY', 'session limit reached');

  session = {
    id: generateToken(this.randomBytes),
    csrf: generateToken(this.randomBytes),
    createdAt: now,
    lastSeen: now,
    expiresAt: now + SESSION_TOTAL_MS
  };
  this.sessions[session.id] = session;
  if (this.logger) this.logger.info('lan session established');
  return session;
};

/* Validate a session cookie and refresh its idle timer. */
PairingManager.prototype.validateSession = function (sessionId) {
  var now = this.now(), session;
  this.pruneSessions();
  if (!sessionId) throw err('UNAUTHORIZED', 'no session');
  session = this.sessions[String(sessionId)];
  if (!session) throw err('SESSION_EXPIRED', 'unknown session');
  if (now >= session.expiresAt) { delete this.sessions[session.id]; throw err('SESSION_EXPIRED', 'session expired'); }
  if (now - session.lastSeen >= SESSION_IDLE_MS) { delete this.sessions[session.id]; throw err('SESSION_EXPIRED', 'idle timeout'); }
  session.lastSeen = now;
  return session;
};

/* State-changing requests must present the session's CSRF token. */
PairingManager.prototype.assertCsrf = function (session, token) {
  if (!session) throw err('UNAUTHORIZED', 'no session');
  if (!safeEqual(token, session.csrf)) throw err('CSRF_FAILED', 'invalid csrf token');
  return true;
};

PairingManager.prototype.destroySession = function (sessionId) {
  if (sessionId && this.sessions[sessionId]) { delete this.sessions[sessionId]; return true; }
  return false;
};

module.exports = {
  PAIRING_TTL_MS: PAIRING_TTL_MS,
  SESSION_IDLE_MS: SESSION_IDLE_MS,
  SESSION_TOTAL_MS: SESSION_TOTAL_MS,
  MAX_ATTEMPTS: MAX_ATTEMPTS,
  ATTEMPT_WINDOW_MS: ATTEMPT_WINDOW_MS,
  LOCKOUT_MS: LOCKOUT_MS,
  CODE_ALPHABET: CODE_ALPHABET,
  CODE_LENGTH: CODE_LENGTH,
  PairingManager: PairingManager,
  generateCode: generateCode,
  generateToken: generateToken,
  safeEqual: safeEqual
};
