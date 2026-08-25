"use strict";
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var watchdogLib = require("../app/service/lib/vpn/watchdog");

var temp = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-watchdog-"));
fs.writeFileSync(path.join(temp, "rx_bytes"), "100\n");
fs.writeFileSync(path.join(temp, "tx_bytes"), "100\n");
var now = 0;
var probes = 0;
var incidents = [];
var watchdog = new watchdogLib.Watchdog({
  supervisor: { status: function () { return {}; } },
  routes: {},
  tunStatsDir: temp,
  now: function () { return now; },
  physicalAvailable: function () { return true; },
  probe: { run: function (callback) { probes++; callback(null, false); } },
  onIncident: function (code) { incidents.push(code); },
  setInterval: function () { return { unref: function () {} }; },
  clearInterval: function () {},
});
watchdog.start();
now = 15000;
fs.writeFileSync(path.join(temp, "rx_bytes"), "120\n");
fs.writeFileSync(path.join(temp, "tx_bytes"), "130\n");
watchdog.tick();
assert.strictEqual(probes, 0, "bidirectional TUN traffic must suppress the active probe");
now = 30000;
fs.writeFileSync(path.join(temp, "rx_bytes"), "150\n");
watchdog.tick();
assert.strictEqual(probes, 0, "one-way UDP/QUIC traffic must suppress the active probe");
now = 61000;
watchdog.tick();
assert.strictEqual(probes, 1, "30 seconds of idle must start an HTTPS probe");
now = 76000;
watchdog.tick();
assert.deepStrictEqual(incidents, [], "probe failures alone must not disconnect a live tunnel");
assert.strictEqual(probes, 2, "idle probing continues while the tunnel has no traffic");
now = 91000;
watchdog.tick();
assert.deepStrictEqual(incidents, [], "repeated probe failures remain diagnostic evidence only");
assert.strictEqual(watchdog.status().warning, "LIVENESS_PROBE_FAILED");

var oneFailure = new watchdogLib.Watchdog({
  supervisor: { status: function () { return {}; } }, routes: {}, tunStatsDir: temp,
  now: function () { return now; }, physicalAvailable: function () { return true; },
  probe: { run: function (callback) { callback(null, false); } },
  onIncident: function (code) { incidents.push(code); },
  setInterval: function () { return { unref: function () {} }; }, clearInterval: function () {},
});
oneFailure.start();
now = 100000;
oneFailure.tick();
assert.strictEqual(incidents.length, 0, "one probe failure must not disconnect the VPN");

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
now = 115000;
fdWatchdog.tick();
assert.strictEqual(incidents.length, 0, "one FD pressure sample must not disconnect the VPN");
now = 130000;
fdWatchdog.tick();
assert.strictEqual(incidents.length, 0, "descriptor exhaustion is diagnostic while supervised cores remain alive");
assert.strictEqual(fdWatchdog.status().warning, "FD_PRESSURE_SUSTAINED");

assert.strictEqual(watchdogLib.memoryPressure({
  baselineRssKb: 120000, growthKb: 0, monotonicRatio: 1, lowMemorySamples: 20,
}), false, "4K-like low memory with stable core RSS must not reset VPN");
assert.strictEqual(watchdogLib.memoryPressure({
  baselineRssKb: 100000, growthKb: 70000, monotonicRatio: 0.9, lowMemorySamples: 6,
}), true, "sustained low memory plus monotonic core RSS growth must trip");
console.log("watchdog passive liveness and resource-pressure tests passed");
