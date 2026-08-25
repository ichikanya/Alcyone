"use strict";
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var watchdogLib = require("../app/service/lib/vpn/watchdog");

/* Functional liveness contract (stage 4 + grace refinement):
   - bidirectional TUN growth suppresses the active probe only while the
     last successful probe is fresh;
   - one-way traffic never suppresses the probe;
   - three consecutive failed probes escalate to LIVENESS_FAILED;
   - sustained critical FD pressure escalates to FD_EXHAUSTION_RISK;
   - everything inside the 90s post-connect grace window degrades to a
     visible *_GRACE warning instead of disconnecting;
   - single failures and low memory stay non-disconnecting. */

var temp = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-watchdog-"));
function setCounters(rx, tx) {
  fs.writeFileSync(path.join(temp, "rx_bytes"), rx + "\n");
  fs.writeFileSync(path.join(temp, "tx_bytes"), tx + "\n");
}

var now = 1000000; /* single monotonic clock for the whole file */
var probes = 0;
var incidents = [];

function makeWatchdog(probeImpl, metricsImpl) {
  probes = 0;
  incidents = [];
  var wd = new watchdogLib.Watchdog({
    supervisor: {
      status: function () { return {}; },
    },
    routes: {},
    tunStatsDir: temp,
    now: function () { return now; },
    physicalAvailable: function () { return true; },
    probe: { run: function (cb) { probes++; probeImpl(cb); } },
    onIncident: function (code, detail) { incidents.push(code); },
    setInterval: function () { return { unref: function () {} }; },
    clearInterval: function () {},
  });
  if (metricsImpl) wd.processMetrics = metricsImpl;
  wd.start();
  return wd;
}
function step(ms) { now += ms; }
var GRACE = 90000;

/* --- healthy bidirectional flow keeps probes quiet while evidence is fresh --- */
setCounters(100, 100);
var healthy = makeWatchdog(function (cb) { cb(null, true); });
step(15000); setCounters(120, 130); healthy.tick();
assert.strictEqual(probes, 1, "first tick probes once for baseline evidence");
step(5000); setCounters(140, 160); healthy.tick();
assert.strictEqual(probes, 1, "fresh ok-probe plus bidirectional growth suppresses probing");
healthy.stop();

/* --- one-way flood must NOT suppress the probe --- */
setCounters(100, 100);
var oneway = makeWatchdog(function (cb) { cb(null, false); });
step(15000); setCounters(500, 100); oneway.tick();
assert.strictEqual(probes, 1, "one-way UDP growth must not suppress the functional probe");
oneway.stop();

/* --- inside grace: repeated failures warn, never disconnect --- */
setCounters(10, 10);
var graced = makeWatchdog(function (cb) { cb(null, false); });
step(15000); graced.tick();
step(1000); graced.tick();
step(1000); graced.tick();
assert.ok(now - (now - 3 * 1000) <= GRACE + 2 * 1000, "still within grace");
assert.strictEqual(incidents.length, 0, "no incident inside the grace window");
assert.ok(
  String(graced.status().warning).indexOf("LIVENESS_FAILED_GRACE") === 0,
  "suppressed code surfaces as *_GRACE warning: " + graced.status().warning,
);
graced.stop();

/* --- past grace: third strike escalates exactly once --- */
setCounters(10, 10);
var failing = makeWatchdog(function (cb) { cb(null, false); });
step(GRACE + 1000); /* leave grace */
failing.tick();            /* strike 1 */
step(1000); failing.tick();/* strike 2 */
step(1000); failing.tick();/* strike 3 */
assert.strictEqual(probes, 3, "idle probing continues every tick");
assert.strictEqual(failing.status().warning, "LIVENESS_PROBE_FAILED");
assert.deepStrictEqual(incidents, ["LIVENESS_FAILED"], "three consecutive failures open one incident");
var before = probes;
step(1000); failing.tick();
assert.strictEqual(probes, before, "an open incident stops further probing");
failing.stop();
assert.ok(3 * watchdogLib.TICK_MS <= 60000, "detection budget holds");

/* --- FD escalation past grace --- */
var fdWatchdog = makeWatchdog(function (cb) { cb(null, true); }, function () {
  return [{ running: true, pid: 1, rssKb: 1, fdCount: 96, fdLimit: 100, fdRatio: 0.96 }];
});
step(GRACE + 2000);
fdWatchdog.tick();          /* sample 1 */
assert.deepStrictEqual(incidents, [], "one FD pressure sample must not disconnect");
step(15000);
fdWatchdog.tick();          /* sample 2 -> escalate */
assert.deepStrictEqual(incidents, ["FD_EXHAUSTION_RISK"], "sustained near-limit FD escalates");
fdWatchdog.stop();

/* --- moderate FD pressure alone never escalates --- */
var fdModerate = makeWatchdog(function (cb) { cb(null, true); }, function () {
  return [{ running: true, pid: 1, rssKb: 1, fdCount: 88, fdLimit: 100, fdRatio: 0.88 }];
});
step(GRACE + 3000);
fdModerate.tick(); step(15000); fdModerate.tick(); step(15000); fdModerate.tick();
assert.deepStrictEqual(incidents, [], "88% FD is warning territory only");
fdModerate.stop();

/* --- memory contract unchanged --- */
assert.strictEqual(watchdogLib.memoryPressure({
  baselineRssKb: 120000, growthKb: 0, monotonicRatio: 1, lowMemorySamples: 20,
}), false, "low memory with stable core RSS must not reset VPN");
assert.strictEqual(watchdogLib.memoryPressure({
  baselineRssKb: 100000, growthKb: 70000, monotonicRatio: 0.9, lowMemorySamples: 6,
}), true, "sustained low memory plus monotonic core RSS growth must trip");

console.log("watchdog functional liveness and escalation tests passed");
