"use strict";
var crypto = require("crypto"),
  errors = require("./errors"),
  err = errors.err,
  PAIRING_TTL_MS = 3e5,
  SESSION_IDLE_MS = 6e5,
  SESSION_TOTAL_MS = 18e5,
  MAX_SESSIONS = 4,
  MAX_ATTEMPTS = 5,
  ATTEMPT_WINDOW_MS = 3e5,
  LOCKOUT_MS = 9e5,
  CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  CODE_LENGTH = 8;
function generateCode(e) {
  for (
    var t, i, r, n = "", s = 256 - (256 % CODE_ALPHABET.length);
    n.length < CODE_LENGTH;
  )
    for (t = e(CODE_LENGTH), i = 0; i < t.length && n.length < CODE_LENGTH; i++)
      (r = t[i]) >= s || (n += CODE_ALPHABET.charAt(r % CODE_ALPHABET.length));
  return n;
}
function generateToken(e) {
  return e(32).toString("hex");
}
function safeEqual(e, t) {
  var i, r;
  if (
    ((e = String(null == e ? "" : e)),
    (t = String(null == t ? "" : t)),
    (i = new Buffer(crypto.createHash("sha256").update(e, "utf8").digest())),
    (r = new Buffer(crypto.createHash("sha256").update(t, "utf8").digest())),
    "function" == typeof crypto.timingSafeEqual)
  )
    return crypto.timingSafeEqual(i, r);
  var n,
    s = 0;
  for (n = 0; n < i.length; n++) s |= i[n] ^ r[n];
  return 0 === s;
}
function PairingManager(e) {
  ((e = e || {}),
    (this.randomBytes = e.randomBytes || crypto.randomBytes),
    (this.now =
      e.now ||
      function () {
        return Date.now();
      }),
    (this.logger = e.logger || null),
    (this.pairing = null),
    (this.sessions = {}),
    (this.attempts = {}));
}
((PairingManager.prototype.enable = function (e, t) {
  var i = this.now();
  return (
    (!t && this.pairingActive()) ||
      ((this.sessions = {}),
      (this.pairing = {
        code: generateCode(this.randomBytes),
        createdAt: i,
        expiresAt: i + (e || PAIRING_TTL_MS),
        redeemed: !1,
      }),
      this.logger && this.logger.info("lan pairing enabled")),
    { code: this.pairing.code, expiresAt: this.pairing.expiresAt }
  );
}),
  (PairingManager.prototype.disable = function () {
    return (
      (this.pairing = null),
      (this.sessions = {}),
      this.logger && this.logger.info("lan pairing disabled"),
      !0
    );
  }),
  (PairingManager.prototype.pairingActive = function () {
    return (
      !!this.pairing &&
      !(this.now() >= this.pairing.expiresAt) &&
      !this.pairing.redeemed
    );
  }),
  (PairingManager.prototype.accessActive = function () {
    return this.pairingActive() || this.activeSessionCount() > 0;
  }),
  (PairingManager.prototype.status = function () {
    var e = this.pairing,
      t = this.pairingActive();
    return {
      pairingActive: t,
      expiresAt: t ? e.expiresAt : 0,
      secondsRemaining: t
        ? Math.max(0, Math.round((e.expiresAt - this.now()) / 1e3))
        : 0,
      sessions: this.activeSessionCount(),
    };
  }),
  (PairingManager.prototype.attemptState = function (e) {
    var t = this.attempts[e],
      i = this.now();
    return t
      ? t.lockedUntil && i < t.lockedUntil
        ? t
        : (t.lockedUntil && i >= t.lockedUntil) ||
            i - t.firstAt > ATTEMPT_WINDOW_MS
          ? (delete this.attempts[e], null)
          : t
      : null;
  }),
  (PairingManager.prototype.isRateLimited = function (e) {
    var t = this.attemptState(e);
    return !!(t && t.lockedUntil && this.now() < t.lockedUntil);
  }),
  (PairingManager.prototype.recordFailure = function (e) {
    var t = this.now(),
      i = this.attemptState(e);
    return (
      i ||
        ((i = { count: 0, firstAt: t, lockedUntil: 0 }),
        (this.attempts[e] = i)),
      i.count++,
      i.count >= MAX_ATTEMPTS &&
        ((i.lockedUntil = t + LOCKOUT_MS),
        this.logger && this.logger.warn("lan auth rate limit engaged")),
      i
    );
  }),
  (PairingManager.prototype.clearFailures = function (e) {
    delete this.attempts[e];
  }),
  (PairingManager.prototype.pruneSessions = function () {
    var e,
      t,
      i = this.now();
    for (e in this.sessions)
      Object.prototype.hasOwnProperty.call(this.sessions, e) &&
        (i >= (t = this.sessions[e]).expiresAt ||
          i - t.lastSeen >= SESSION_IDLE_MS) &&
        delete this.sessions[e];
  }),
  (PairingManager.prototype.activeSessionCount = function () {
    return (this.pruneSessions(), Object.keys(this.sessions).length);
  }),
  (PairingManager.prototype.redeem = function (e, t) {
    var i,
      r = this.now();
    if (this.isRateLimited(t)) throw err("RATE_LIMITED", "too many attempts");
    if (!this.pairing || r >= this.pairing.expiresAt)
      throw (
        this.recordFailure(t),
        err("PAIRING_DISABLED", "no active pairing window")
      );
    if (this.pairing.redeemed)
      throw (
        this.recordFailure(t),
        err("PAIRING_DISABLED", "code already used")
      );
    if (
      !safeEqual(
        String(e || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ""),
        this.pairing.code
      )
    )
      throw (this.recordFailure(t), err("UNAUTHORIZED", "invalid code"));
    if (
      (this.clearFailures(t),
      (this.pairing.redeemed = !0),
      this.pruneSessions(),
      Object.keys(this.sessions).length >= MAX_SESSIONS)
    )
      throw err("BUSY", "session limit reached");
    return (
      (i = {
        id: generateToken(this.randomBytes),
        csrf: generateToken(this.randomBytes),
        createdAt: r,
        lastSeen: r,
        expiresAt: r + SESSION_TOTAL_MS,
      }),
      (this.sessions[i.id] = i),
      this.logger && this.logger.info("lan session established"),
      i
    );
  }),
  (PairingManager.prototype.validateSession = function (e) {
    var t,
      i = this.now();
    if ((this.pruneSessions(), !e)) throw err("UNAUTHORIZED", "no session");
    if (!(t = this.sessions[String(e)]))
      throw err("SESSION_EXPIRED", "unknown session");
    if (i >= t.expiresAt)
      throw (
        delete this.sessions[t.id],
        err("SESSION_EXPIRED", "session expired")
      );
    if (i - t.lastSeen >= SESSION_IDLE_MS)
      throw (
        delete this.sessions[t.id],
        err("SESSION_EXPIRED", "idle timeout")
      );
    return ((t.lastSeen = i), t);
  }),
  (PairingManager.prototype.assertCsrf = function (e, t) {
    if (!e) throw err("UNAUTHORIZED", "no session");
    if (!safeEqual(t, e.csrf)) throw err("CSRF_FAILED", "invalid csrf token");
    return !0;
  }),
  (PairingManager.prototype.destroySession = function (e) {
    return !(!e || !this.sessions[e]) && (delete this.sessions[e], !0);
  }),
  (module.exports = {
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
    safeEqual: safeEqual,
  }));
