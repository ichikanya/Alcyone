"use strict";
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var watchdogLib = require("../app/service/lib/vpn/watchdog");

/* Functional liveness contract (stage 4):
   - bidirectional TUN growth suppresses the active probe only while the
     last successful probe is fresh;
   - one-way traffic never suppresses the probe;
   - three consecutive failed probes escalate to a LIVENESS_FAILED
     incident (recovery), not a warning;
   - sustained critical FD pressure escalates to FD_EXHAUSTION_RISK;
   - single failures and low memory stay non-disconnecting. */

var temp = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-watchdog-"));
function setCounters(rx, tx) {
  fs.writeFileSync(path.join(temp, "rx_bytes"), rx + "\n");
  fs.writeFileSync(path.join(temp, "tx_bytes"), tx + "\n");
}
var now = 0;
var probes = 0;
var incidents = [];
function makeWatchdog(probeImpl) {
  probes = 0;
  incidents = [];
  var wd = new watchdogLib.Watchdog({
    supervisor: { status: function () { return {}; } },
    routes: {},
    tunStatsDir: temp,
    now: function () { return now; },
    physicalAvailable: function () { return true; },
    probe: { run: function (callback) { probes++; probeImpl(callback); } },
    onIncident: function (code, detail) { incidents.push(code + ":" + detail); },
    setInterval: function () { return { unref: function () {} }; },
    clearInterval: function () {},
  });
  wd.start();
  return wd;
}

/* healthy bidirectional flow keeps probes quiet while evidence is fresh */
setCounters(100, 100);
var healthy = makeWatchdog(function (cb) { cb(null, true); });
now = 15000;
setCounters(120, 130); healthy.tick();
assert.strictEqual(probes, 1, "first tick always probes once for baseline evidence");
now = 20000;
setCounters(140, 160); healthy.tick();
assert.strictEqual(probes, 1, "fresh successful probe plus bidirectional growth suppresses probing");
healthy.stop();

/* one-way flood must NOT suppress the active probe */
setCounters(100, 100);
var oneway = makeWatchdog(function (cb) { cb(null, false); });
now = 30000;
oneway.start();
now = 45000;
setCounters(500, 100); /* only RX grows: QUIC-style one-way */
oneway.tick();
assert.strictEqual(probes, 1, "one-way UDP/QUIC growth must not suppress the functional probe");
oneway.stop();

/* three failed probes escalate to an incident */
var failing = makeWatchdog(function (cb) { cb(null, false); });
setCounters(10, 10);
now = 60000; failing.tick();
now = 61000; failing.tick();
now = 62000; failing.tick();
assert.strictEqual(probes, 3, "idle probing continues every tick");
assert.strictEqual(failing.status().warning, "LIVENESS_PROBE_FAILED");
assert.strictEqual(incidents.length, 1, "three consecutive failures must open exactly one incident");
assert.ok(incidents[0].indexOf("LIVENESS_FAILED") === 0, "incident code is LIVENESS_FAILED, got " + incidents[0]);
var before = probes;
now = 63000; failing.tick();
assert.strictEqual(probes, before, "an open incident stops further probing");
failing.stop();

/* hang timing invariant: at a 15s tick, detection <= 60s */
assert.ok(3 * watchdogLib.TICK_MS <= 60000, "three ticks must fit the 60s detection budget");

/* a single failure stays diagnostic */
incidents = []; probes = 0;
var oneFailure = new watchdogLib.Watchdog({
  supervisor: { status: function () { return {}; } }, routes: {}, tunStatsDir: temp,
  now: function () { return now; }, physicalAvailable: function () { return true; },
  probe: { run: function (callback) { probes++; callback(null, false); } },
  onIncident: function (code) { incidents.push(code); },
  setInterval: function () { return { unref: function () {} }; }, clearInterval: function () {},
});
oneFailure.start(); now = 100000; oneFailure.tick();
assert.strictEqual(incidents.length, 0, "one probe failure must not disconnect the VPN");

/* FD escalation */
incidents = []; probes = 0;
var fdWatchdog = new watchdogLib.Watchdog({
  supervisor: { status: function () { return {}; } }, routes: {}, tunStatsDir: temp,
  now: function () { return now; }, physicalAvailable: function () { return true; },
  probe: { run: function (callback) { callback(null, true); } },
  onIncident: function (code) { incidents.push(code); },
  setInterval: function () { return { unref: function () {} }; }, clearInterval: function () {},
});
fdWatchdog.processMetrics = function () {
  return [{ running: true, pid: 1, rssKb: 1, fdCount: 96, fdLimit: 100, fdRatio: 0.96 }];
};
fdWatchdog.start();
now = 115000; fdWatchdog.tick();
assert.strictEqual(incidents.length, 0, "one FD pressure sample must not disconnect the VPN");
now = 130000; fdWatchdog.tick();
assert.deepStrictEqual(incidents, ["FD_EXHAUSTION_RISK"], "sustained near-limit FD usage escalates to an incident");
fdWatchdog.stop();

/* moderate FD pressure alone never disconnects */
incidents = [];
var fdModerate = new watchdogLib.Watchdog({
  supervisor: { status: function () { return {}; } }, routes: {}, tunStatsDir: temp,
  now: function () { return now; }, physicalAvailable: function () { return true; },
  probe: { run: function (callback) { callback(null, true); } },
  onIncident: function (code) { incidents.push(code); },
  setInterval: function () { return { unref: function () {} }; }, clearInterval: function () {},
});
fdModerate.processMetrics = function () {
  return [{ running: true, pid: 1, rssKb: 1, fdCount: 88, fdLimit: 100, fdRatio: 0.88 }];
};
fdModerate.start();
now = 145000; fdModerate.tick();
now = 160000; fdModerate.tick();
now = 175000; fdModerate.tick();
assert.deepStrictEqual(incidents, [], "88% FD is warning territory only");
fdModerate.stop();

assert.strictEqual(watchdogLib.memoryPressure({
  baselineRssKb: 120000, growthKb: 0, monotonicRatio: 1, lowMemorySamples: 20,
}), false, "4K-like low memory with stable core RSS must not reset VPN");
assert.strictEqual(watchdogLib.memoryPressure({
  baselineRssKb: 100000, growthKb: 70000, monotonicRatio: 0.9, lowMemorySamples: 6,
}), true, "sustained low memory plus monotonic core RSS growth must trip");
console.log("watchdog functional liveness and escalation tests passed");
