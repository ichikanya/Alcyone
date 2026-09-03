"use strict";

var fs = require("fs");
var path = require("path");
var TICK_MS = 15000;
var CONNECT_GRACE_MS = 90000;
var IDLE_PROBE_MS = 30000;
var TRAFFIC_EVIDENCE_MS = 2 * TICK_MS + 5000;
var RSS_WARMUP_MS = 10 * 60 * 1000;
var RSS_WINDOW_MS = 30 * 60 * 1000;
/* TV memory collapses long before Xray's intentionally generous RLIMIT.
   Real incidents reached thousands of recursive sockets in under 90s, so
   absolute count and one-tick growth are stronger signals than ratio alone. */
var FD_ABSOLUTE_LIMIT = 512;
var FD_GROWTH_LIMIT = 256;
var FD_COMBINED_LIMIT = 768;

function numberFile(file) {
  try {
    var value = parseInt(fs.readFileSync(file, "utf8"), 10);
    return isFinite(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function readStatus(pid) {
  var result = { rssKb: null, threads: null };
  var text;
  try { text = fs.readFileSync("/proc/" + pid + "/status", "utf8"); }
  catch (error) { return result; }
  var rss = /^VmRSS:\s+(\d+)\s+kB/im.exec(text);
  var threads = /^Threads:\s+(\d+)/im.exec(text);
  if (rss) result.rssKb = parseInt(rss[1], 10);
  if (threads) result.threads = parseInt(threads[1], 10);
  return result;
}

function readNofileLimit(pid) {
  var text;
  try { text = fs.readFileSync("/proc/" + pid + "/limits", "utf8"); }
  catch (error) { return null; }
  var match = /^Max open files\s+(\d+)/im.exec(text);
  return match ? parseInt(match[1], 10) : null;
}

function countFds(pid) {
  try { return fs.readdirSync("/proc/" + pid + "/fd").length; }
  catch (error) { return null; }
}

function readMemory() {
  var text;
  try { text = fs.readFileSync("/proc/meminfo", "utf8"); }
  catch (error) { return { totalKb: null, availableKb: null }; }
  var total = /^MemTotal:\s+(\d+)\s+kB/im.exec(text);
  var available = /^MemAvailable:\s+(\d+)\s+kB/im.exec(text);
  if (!available) available = /^MemFree:\s+(\d+)\s+kB/im.exec(text);
  return {
    totalKb: total ? parseInt(total[1], 10) : null,
    availableKb: available ? parseInt(available[1], 10) : null,
  };
}

function median(values) {
  if (!values.length) return 0;
  var copy = values.slice(0).sort(function (a, b) { return a - b; });
  return copy[Math.floor(copy.length / 2)];
}

function memoryPressure(input) {
  input = input || {};
  return !!input.baselineRssKb &&
    input.growthKb >= Math.max(65536, input.baselineRssKb * 0.5) &&
    input.monotonicRatio >= 0.8 && input.lowMemorySamples >= 6;
}

function Watchdog(options) {
  options = options || {};
  this.supervisor = options.supervisor;
  this.routes = options.routes;
  this.probe = options.probe;
  this.physicalAvailable = options.physicalAvailable || function () { return true; };
  this.onIncident = options.onIncident || function () {};
  this.logger = options.logger || null;
  this.tunStatsDir = options.tunStatsDir || "/sys/class/net/tun0/statistics";
  this.now = options.now || Date.now;
  this.intervalMs = options.intervalMs || TICK_MS;
  this.setInterval = options.setInterval || setInterval;
  this.clearInterval = options.clearInterval || clearInterval;
  this.timer = null;
  this.startedAt = 0;
  this.lastCounters = null;
  this.lastBidirectionalAt = 0;
  this.lastProbeOkAt = 0;
  this.failedProbes = 0;
  this.probeBusy = false;
  this.fdHighSamples = 0;
  this.fdCriticalSamples = 0;
  this.lastFdByProcess = {};
  this.lowMemorySamples = 0;
  this.rssSamples = [];
  this.baselineRssKb = 0;
  this.incidentOpen = false;
  this.snapshot = { state: "stopped", warning: "", lastProbeOk: null };
}

Watchdog.prototype.counters = function () {
  return {
    rx: numberFile(path.join(this.tunStatsDir, "rx_bytes")),
    tx: numberFile(path.join(this.tunStatsDir, "tx_bytes")),
  };
};

Watchdog.prototype.processMetrics = function () {
  var status = this.supervisor.status();
  var names = Object.keys(status);
  var metrics = [];
  var i;
  for (i = 0; i < names.length; i++) {
    var item = status[names[i]];
    if (!item.running || !item.pid) continue;
    var proc = readStatus(item.pid);
    var fdLimit = readNofileLimit(item.pid);
    var fdCount = countFds(item.pid);
    metrics.push({
      name: names[i], pid: item.pid, rssKb: proc.rssKb, threads: proc.threads,
      fdCount: fdCount, fdLimit: fdLimit,
      fdRatio: fdCount !== null && fdLimit ? fdCount / fdLimit : null,
    });
  }
  return metrics;
};

Watchdog.prototype.openIncident = function (code, detail) {
  if (this.incidentOpen) return;
  /* Post-connect probes legitimately wobble, so liveness incidents degrade
     to warnings during warm-up.  Resource/FD runaway is never graced: the
     real recursion incident started inside this window and endangered the
     whole TV long before the process ratio looked critical. */
  if (
    this.now() < this.graceUntil &&
    "RESOURCE_PRESSURE" !== code &&
    "FD_EXHAUSTION_RISK" !== code
  ) {
    this.snapshot.warning = code + "_GRACE";
    return;
  }
  this.incidentOpen = true;
  this.snapshot.state = "incident";
  this.snapshot.lastErrorCode = code;
  this.onIncident(code, detail || "");
};

Watchdog.prototype.checkResources = function (now) {
  var metrics = this.processMetrics();
  var combinedRss = 0;
  var combinedFds = 0;
  var maximumFdRatio = 0;
  var maximumFdCount = 0;
  var maximumFdGrowth = 0;
  var currentFdByProcess = {};
  var i, processKey, previousFd, fdGrowth;
  for (i = 0; i < metrics.length; i++) {
    if (metrics[i].rssKb !== null) combinedRss += metrics[i].rssKb;
    if (metrics[i].fdCount !== null) {
      processKey = String(metrics[i].name) + ":" + String(metrics[i].pid);
      previousFd = this.lastFdByProcess[processKey];
      fdGrowth = previousFd === undefined ? 0 : metrics[i].fdCount - previousFd;
      currentFdByProcess[processKey] = metrics[i].fdCount;
      combinedFds += metrics[i].fdCount;
      if (metrics[i].fdCount > maximumFdCount)
        maximumFdCount = metrics[i].fdCount;
      if (fdGrowth > maximumFdGrowth) maximumFdGrowth = fdGrowth;
    }
    if (metrics[i].fdRatio !== null && metrics[i].fdRatio > maximumFdRatio)
      maximumFdRatio = metrics[i].fdRatio;
  }
  this.lastFdByProcess = currentFdByProcess;
  this.snapshot.processes = metrics;
  this.snapshot.maximumFdRatio = maximumFdRatio;
  this.snapshot.maximumFdCount = maximumFdCount;
  this.snapshot.maximumFdGrowth = maximumFdGrowth;
  this.snapshot.combinedFds = combinedFds;
  this.fdCriticalSamples = maximumFdRatio >= 0.95 ? this.fdCriticalSamples + 1 : 0;
  this.fdHighSamples = maximumFdRatio >= 0.85 ? this.fdHighSamples + 1 : 0;
  if (this.fdCriticalSamples >= 2 || this.fdHighSamples >= 4)
    this.snapshot.warning = "FD_PRESSURE_SUSTAINED";
  else
    this.snapshot.warning = maximumFdRatio >= 0.70 ? "FD_PRESSURE" : "";
  if (
    maximumFdCount >= FD_ABSOLUTE_LIMIT ||
    maximumFdGrowth >= FD_GROWTH_LIMIT ||
    combinedFds >= FD_COMBINED_LIMIT
  )
    return this.openIncident(
      "FD_EXHAUSTION_RISK",
      "fd-runaway count=" +
        maximumFdCount +
        " growth=" +
        maximumFdGrowth +
        " combined=" +
        combinedFds,
    );
  /* EMFILE history on real devices: a core approaching its descriptor
     ceiling is a functional failure in progress, not a cosmetic warning.
     Two consecutive critical samples (~30s) escalate to an incident so
     the recovery path runs before accept() starts failing. */
  if (this.fdCriticalSamples >= 2)
    return this.openIncident(
      "FD_EXHAUSTION_RISK",
      "fd-ratio " + Math.round(maximumFdRatio * 100) + "% sustained",
    );

  if (combinedRss > 0) {
    this.rssSamples.push({ at: now, rssKb: combinedRss });
    while (this.rssSamples.length && now - this.rssSamples[0].at > RSS_WINDOW_MS)
      this.rssSamples.shift();
    if (!this.baselineRssKb && now - this.startedAt >= RSS_WARMUP_MS)
      this.baselineRssKb = median(this.rssSamples.map(function (sample) { return sample.rssKb; }));
  }
  var memory = readMemory();
  var lowThreshold = memory.totalKb === null ? 32768 : Math.max(32768, memory.totalKb * 0.04);
  this.lowMemorySamples = memory.availableKb !== null && memory.availableKb < lowThreshold
    ? this.lowMemorySamples + 1 : 0;
  var oldest = this.rssSamples.length ? this.rssSamples[0].rssKb : combinedRss;
  var growth = combinedRss - oldest;
  var growthThreshold = Math.max(65536, this.baselineRssKb * 0.5);
  var nonnegative = 0;
  for (i = 1; i < this.rssSamples.length; i++)
    if (this.rssSamples[i].rssKb >= this.rssSamples[i - 1].rssKb) nonnegative++;
  var monotonicRatio = this.rssSamples.length > 1 ? nonnegative / (this.rssSamples.length - 1) : 0;
  this.snapshot.memory = {
    availableKb: memory.availableKb, baselineRssKb: this.baselineRssKb,
    combinedRssKb: combinedRss, growthKb: growth,
  };
  if (this.lowMemorySamples > 0 && !this.snapshot.warning)
    this.snapshot.warning = "LOW_SYSTEM_MEMORY";
  if (memoryPressure({ baselineRssKb: this.baselineRssKb, growthKb: growth, monotonicRatio: monotonicRatio, lowMemorySamples: this.lowMemorySamples }))
    this.openIncident("RESOURCE_PRESSURE", "core-rss-growth");
};

Watchdog.prototype.tick = function () {
  if (this.incidentOpen) return;
  var now = this.now();
  var counters = this.counters();
  /* Only growth of BOTH directions is evidence of a working data plane.
     A one-way QUIC/UDP flood used to suppress probes forever while the
     tunnel was functionally dead for TCP. */
  var bothGrew = !!this.lastCounters &&
    counters.rx !== null && counters.tx !== null &&
    counters.rx > this.lastCounters.rx && counters.tx > this.lastCounters.tx;
  if (bothGrew) this.lastBidirectionalAt = now;
  if (counters.rx === null || counters.tx === null ||
      (this.lastCounters && (counters.rx < this.lastCounters.rx || counters.tx < this.lastCounters.tx))) {
    /* interface recreated: stale baselines mean nothing */
    this.lastProbeOkAt = 0;
  }
  this.lastCounters = counters;
  this.snapshot.counters = counters;
  this.checkResources(now);
  if (this.incidentOpen || this.probeBusy) return;
  if (!this.physicalAvailable()) return;
  /* Fresh bidirectional traffic keeps the probe quiet only while the
     last successful probe is younger than IDLE_PROBE_MS; afterwards the
     active check runs regardless of throughput. */
  if (bothGrew && now - this.lastProbeOkAt < IDLE_PROBE_MS) return;
  var self = this;
  this.probeBusy = true;
  this.probe.run(function (error, ok) {
    self.probeBusy = false;
    self.snapshot.lastProbeOk = !!ok;
    if (ok) {
      self.failedProbes = 0;
      self.lastProbeOkAt = self.now();
      self.snapshot.failedProbes = 0;
      if (
        "LIVENESS_PROBE_FAILED" === self.snapshot.warning ||
        "LIVENESS_PROBE_FAILED_TRAFFIC_OK" === self.snapshot.warning
      )
        self.snapshot.warning = "";
      return;
    }
    /* Public connectivity-check sites are evidence, not an authority over
       real user traffic. Providers and captive/CDN edges occasionally block
       every probe URL while YouTube continues moving data through the TUN.
       Restarting a demonstrably active tunnel turns a harmless probe outage
       into the user-visible disconnect we are trying to prevent. */
    if (
      self.lastBidirectionalAt &&
      self.now() - self.lastBidirectionalAt <= TRAFFIC_EVIDENCE_MS
    ) {
      self.failedProbes = 0;
      self.snapshot.failedProbes = 0;
      self.snapshot.warning = "LIVENESS_PROBE_FAILED_TRAFFIC_OK";
      return;
    }
    self.failedProbes++;
    self.snapshot.failedProbes = self.failedProbes;
    self.snapshot.warning = "LIVENESS_PROBE_FAILED";
    /* A live-but-hung core (SIGSTOP, blackhole, EMFILE'd accept) must be
       handed to recovery, not merely described. Three consecutive
       deadline-bounded failures ~= <=60s at a 15s tick. */
    if (self.failedProbes >= 3)
      self.openIncident("LIVENESS_FAILED", "functional-probe x" + self.failedProbes);
  });
};

Watchdog.prototype.start = function () {
  if (this.timer) return;
  this.startedAt = this.now();
  this.graceUntil = this.startedAt + CONNECT_GRACE_MS;
  this.lastProbeOkAt = 0;
  this.lastCounters = null;
  this.lastBidirectionalAt = 0;
  this.failedProbes = 0;
  this.probeBusy = false;
  this.fdHighSamples = 0;
  this.fdCriticalSamples = 0;
  this.lastFdByProcess = {};
  this.lowMemorySamples = 0;
  this.rssSamples = [];
  this.baselineRssKb = 0;
  this.incidentOpen = false;
  this.snapshot = { state: "watching", warning: "", lastProbeOk: null };
  var self = this;
  this.timer = this.setInterval(function () { self.tick(); }, this.intervalMs);
  if (this.timer && this.timer.unref) this.timer.unref();
};

Watchdog.prototype.stop = function () {
  if (this.timer) this.clearInterval(this.timer);
  this.timer = null;
  this.probeBusy = false;
  this.snapshot.state = "stopped";
};

Watchdog.prototype.status = function () { return this.snapshot; };

module.exports = {
  TICK_MS: TICK_MS,
  IDLE_PROBE_MS: IDLE_PROBE_MS,
  TRAFFIC_EVIDENCE_MS: TRAFFIC_EVIDENCE_MS,
  RSS_WARMUP_MS: RSS_WARMUP_MS,
  RSS_WINDOW_MS: RSS_WINDOW_MS,
  FD_ABSOLUTE_LIMIT: FD_ABSOLUTE_LIMIT,
  FD_GROWTH_LIMIT: FD_GROWTH_LIMIT,
  FD_COMBINED_LIMIT: FD_COMBINED_LIMIT,
  numberFile: numberFile,
  readStatus: readStatus,
  readNofileLimit: readNofileLimit,
  countFds: countFds,
  readMemory: readMemory,
  median: median,
  memoryPressure: memoryPressure,
  Watchdog: Watchdog,
};
