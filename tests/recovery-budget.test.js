"use strict";

/* Recovery budget contract (stage 4): max three automatic reconnects per
   rolling 30 minutes with 0/60s/5m step delays, a 30 minute breaker
   afterwards, persistence across restarts, and forgiveness after ten
   minutes of healthy connected time. */

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var budgetLib = require("../app/service/lib/vpn/recovery-budget");
var managerLib = require("../app/service/lib/vpn/manager");

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-budget-"));
var file = path.join(dir, "recovery-budget.json");
var now = 1000000;
function makeBudget() {
  return new budgetLib.RecoveryBudget({
    file: file,
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    now: function () { return now; },
  });
}

/* first automatic attempt is immediate */
var budget = makeBudget();
var plan1 = budget.plan();
assert.strictEqual(plan1.allowed, true, "a clean budget must allow the first attempt");
assert.strictEqual(plan1.readyAt, now, "the first attempt needs no delay");

/* second attempt waits >=60s after the first */
budget.commitAttempt();
var plan2 = budget.plan();
assert.strictEqual(plan2.allowed, true);
assert.strictEqual(plan2.attemptNo, 2);
assert.strictEqual(plan2.readyAt, now + 60000, "attempt 2 must wait 60s");

/* third attempt waits >=5 minutes */
now += 60000;
budget.commitAttempt();
var plan3 = budget.plan();
assert.strictEqual(plan3.allowed, true);
assert.strictEqual(plan3.attemptNo, 3);
assert.strictEqual(plan3.readyAt, now + 300000, "attempt 3 must wait 5 minutes");

/* spending the whole budget opens the breaker for 30 minutes */
now += 300000;
budget.commitAttempt();
var plan4 = budget.plan();
assert.strictEqual(plan4.allowed, false, "fourth attempt must be denied");
assert.strictEqual(plan4.reason, "BUDGET_EXHAUSTED");
assert.strictEqual(plan4.remainingMs, budgetLib.BREAKER_MS);

/* the breaker persists across service restarts (same file, new instance) */
now += 60000;
var restarted = makeBudget();
var plan5 = restarted.plan();
assert.strictEqual(plan5.allowed, false);
assert.strictEqual(plan5.reason, "BREAKER_OPEN", "restart must not reset the breaker");

/* after the breaker expires the window is empty again */
now += budgetLib.BREAKER_MS;
var plan6 = restarted.plan();
assert.strictEqual(plan6.allowed, true, "after breaker expiry a fresh cycle begins");
assert.strictEqual(plan6.readyAt, now, "fresh cycle starts immediately");

/* forgiveness removes the oldest spent attempt */
now = 5000000;
var b2 = makeBudget();
b2.commitAttempt(); /* #1 at t */
now += 70000;
b2.commitAttempt(); /* #2 */
var beforeForgive = b2.plan();
/* attempt #3 is gated by the 5-minute step after attempt #2 at 5070000 */
assert.strictEqual(beforeForgive.readyAt, 5070000 + 300000, "sanity: attempt 3 gated by 5m step");
assert.ok(b2.forgiveOldest(), "forgiveness consumes one attempt");
var afterForgive = b2.plan();
assert.strictEqual(afterForgive.attemptNo, 2, "after forgiving, next attempt number drops back to 2");

/* waiting never spends the budget: only commitAttempt does */
var fileB3 = path.join(dir, "recovery-budget-b3.json");
var b3 = new budgetLib.RecoveryBudget({
  file: fileB3,
  logger: { info: function () {}, warn: function () {}, error: function () {} },
  now: function () { return now; },
});
for (var i = 0; i < 25; i++) {
  var p = b3.plan();
  assert.strictEqual(p.allowed, true, "planning alone must never exhaust the budget");
}
assert.strictEqual(b3.status().windowAttempts, 0);

/* corrupt state starts clean instead of blocking or unlocking silently */
fs.writeFileSync(file, "{broken json");
var b4 = makeBudget();
var p4 = b4.plan();
assert.strictEqual(p4.allowed, true, "corrupt budget degrades to a clean slate");
assert.strictEqual(b4.status().windowAttempts, 0);

/* status reflects the window honestly */
fs.writeFileSync(file, JSON.stringify({ version: 1, attempts: [now - 1000, now - 500], breakerUntil: 0 }));
var b5 = makeBudget();
var st = b5.status();
assert.strictEqual(st.windowAttempts, 2 && st.maxAttempts === 3 ? 2 : -1, "status reports attempts in window");

/* The persistent budget is the sole restart-storm authority. A second
   incident must still reach it instead of being stranded by an extra
   in-memory 30-minute breaker in VpnManager. */
var manager = Object.create(managerLib.VpnManager.prototype);
var planned = 0;
var committed = 0;
manager.state = managerLib.STATE.CONNECTED;
manager.cleanupInProgress = null;
manager.breakerOpen = false;
manager.lastWatchdogIncidentAt = 0;
manager.logger = { info: function () {}, warn: function () {}, error: function () {} };
manager.routes = { physicalRestored: function () { return true; } };
manager.recoveryBudget = {
  plan: function () { planned++; return { allowed: true, readyAt: Date.now() }; },
  commitAttempt: function () { committed++; },
};
manager.cleanup = function (callback) { manager.state = managerLib.STATE.IDLE; callback(null); };
manager.connect = function (callback) { manager.state = managerLib.STATE.CONNECTED; callback(null); };
manager.setTimeout = function (callback) {
  callback();
  return { unref: function () {} };
};
manager.failSafe("LIVENESS_FAILED", "first");
manager.failSafe("LIVENESS_FAILED", "second");
assert.strictEqual(planned, 2, "repeated incidents are both planned by the persistent budget");
assert.strictEqual(committed, 2, "each reconnect spends exactly one budget attempt");
assert.strictEqual(manager.breakerOpen, false, "a second incident does not create an unbounded off state");
console.log("recovery budget tests passed");
