"use strict";

/* Persistent automatic-reconnect budget.

   The watchdog may now fire functional incidents, which means the
   recovery path itself needs a storm guard: at most three automatic
   reconnects per rolling 30 minutes, with growing delays between them,
   then a 30 minute breaker. The budget lives on disk so a service
   restart cannot reset it. Manual connects never touch this file.

   Steps (by number of already-spent attempts in the window):
     attempt 1: immediately after the network is stable
     attempt 2: not earlier than 60s after attempt 1
     attempt 3: not earlier than 5m after attempt 2
     afterwards: breaker for 30m
   Ten minutes of healthy connected time forgives the oldest attempt. */

var fs = require("fs"),
  atomic = require("../atomic"),
  errors = require("../errors"),
  err = errors.err;

var STATE_VERSION = 1,
  WINDOW_MS = 30 * 60 * 1000,
  MAX_ATTEMPTS = 3,
  BREAKER_MS = 30 * 60 * 1000,
  STEP_DELAYS_MS = [0, 60 * 1000, 5 * 60 * 1000],
  FORGIVE_AFTER_HEALTHY_MS = 10 * 60 * 1000;

function emptyState() {
  return { version: STATE_VERSION, attempts: [], breakerUntil: 0 };
}

function RecoveryBudget(r) {
  ((r = r || {}),
    (this.file = r.file),
    (this.logger = r.logger || null),
    (this.now = r.now || Date.now));
}
(RecoveryBudget.prototype.load = function () {
  var r, e;
  try {
    r = fs.readFileSync(this.file, "utf8");
  } catch (r) {
    return emptyState();
  }
  try {
    e = JSON.parse(r);
  } catch (r) {
    /* A corrupt budget must never unlock extra retries silently, but it
       also must not brick manual use: start clean and say so loudly. */
    this.logger &&
      this.logger.warn("recovery budget state unreadable, starting clean");
    return emptyState();
  }
  return e && "object" == typeof e && "[object Array]" === Object.prototype.toString.call(e.attempts)
    ? { version: STATE_VERSION, attempts: e.attempts.filter(function (r) { return parseInt(r, 10) > 0; }), breakerUntil: parseInt(e.breakerUntil, 10) || 0 }
    : emptyState();
}),
  (RecoveryBudget.prototype.persist = function (r) {
    if (!this.file) return;
    try {
      atomic.writeFileAtomic(this.file, JSON.stringify(r, null, 2));
    } catch (r) {
      this.logger && this.logger.warn("recovery budget persist failed");
    }
  }),
  (RecoveryBudget.prototype.purge = function (r, e) {
    for (; r.length && e - r[0] >= WINDOW_MS; ) r.shift();
  }),
  /* Decides when the next AUTOMATIC reconnect may run. The caller is
     expected to schedule on readyAt; waiting does not spend the budget
     (only commitAttempt does). */
  (RecoveryBudget.prototype.plan = function () {
    var r, e, t, o;
    return (
      (e = (r = this.load()).attempts),
      (t = this.now()),
      this.purge(e, t),
      t < r.breakerUntil
        ? { allowed: !1, reason: "BREAKER_OPEN", readyAt: r.breakerUntil, remainingMs: r.breakerUntil - t }
        : e.length >= MAX_ATTEMPTS
          ? ((r.breakerUntil = t + BREAKER_MS), this.persist(r), { allowed: !1, reason: "BUDGET_EXHAUSTED", readyAt: r.breakerUntil, remainingMs: BREAKER_MS })
          : ((o = e.length ? e[e.length - 1] + STEP_DELAYS_MS[Math.min(e.length, STEP_DELAYS_MS.length - 1)] : 0),
            { allowed: !0, attemptNo: e.length + 1, readyAt: Math.max(o, t) })
    );
  }),
  (RecoveryBudget.prototype.commitAttempt = function () {
    var r, e, t;
    return (
      (e = (r = this.load()).attempts),
      (t = this.now()),
      this.purge(e, t),
      e.push(t),
      (r.version = STATE_VERSION),
      this.persist(r),
      t
    );
  }),
  /* Sustained healthy connected time forgives the oldest spent attempt. */
  (RecoveryBudget.prototype.forgiveOldest = function () {
    var r, e;
    if (((e = (r = this.load()).attempts), e.length))
      return (e.shift(), this.persist(r), this.logger && this.logger.info("recovery budget forgave oldest attempt"), !0);
    return !1;
  }),
  (RecoveryBudget.prototype.status = function () {
    var r, e, t;
    return (
      (e = (r = this.load()).attempts),
      (t = this.now()),
      this.purge(e, t),
      {
        windowAttempts: e.length,
        maxAttempts: MAX_ATTEMPTS,
        breakerOpen: t < r.breakerUntil,
        breakerRemainingMs: t < r.breakerUntil ? r.breakerUntil - t : 0,
        forgiveAfterHealthyMs: FORGIVE_AFTER_HEALTHY_MS,
      }
    );
  }),
  (module.exports = {
    WINDOW_MS: WINDOW_MS,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    BREAKER_MS: BREAKER_MS,
    STEP_DELAYS_MS: STEP_DELAYS_MS,
    FORGIVE_AFTER_HEALTHY_MS: FORGIVE_AFTER_HEALTHY_MS,
    RecoveryBudget: RecoveryBudget,
  });
