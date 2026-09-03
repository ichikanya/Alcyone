"use strict";

var fs = require("fs");
var TICK_MS = 15000;
var RESUME_GAP_MS = 60000;
function bootId() {
  try { return String(fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8")).trim(); }
  catch (error) { return "unknown-boot"; }
}

function LifecycleObserver(options) {
  options = options || {};
  this.edition = options.edition || {};
  this.logger = options.logger || null;
  this.network = options.network;
  this.onResume = options.onResume || function () {};
  this.service = null;
  this.timer = null;
  this.networkSubscription = null;
  this.keepalive = null;
  this.lastTickAt = 0;
  this.wakeGeneration = 0;
  this.wakeCapability = "degraded";
}

LifecycleObserver.prototype.setService = function (service) { this.service = service || null; };

LifecycleObserver.prototype.installActivityTrigger = function () {
  var self = this;
  var variants = [
    "luna://com.webos.service.connectionmanager/getStatus",
    "luna://com.webos.service.connectionmanager/getstatus",
    "luna://com.palm.connectionmanager/getstatus",
  ];
  var index = 0;
  if (!this.service || typeof this.service.call !== "function") return false;
  function create() {
    var trigger = variants[index++];
    var spec = {
      activity: {
        name: "alcyone-network-wake",
        description: "Restore Alcyone after network wake",
        type: { background: true, continuous: true },
        persist: true,
        trigger: { method: trigger, params: { subscribe: true }, where: { prop: "isInternetConnectionAvailable", op: "=", val: true } },
        callback: { method: "luna://" + self.edition.serviceId + "/autostart", params: { source: "activity" }, ignoreReturn: true },
      },
      replace: true,
      start: true,
      subscribe: false,
    };
    try {
      self.service.call("luna://com.webos.service.activitymanager/create", spec, function (reply) {
        var payload = (reply && reply.payload) || reply || {};
        if (payload.returnValue === false && index < variants.length) return create();
        self.wakeCapability = payload.returnValue === false ? "degraded" : "activity";
      });
    } catch (error) {
      if (index < variants.length) return create();
      self.wakeCapability = "degraded";
    }
  }
  try {
    this.wakeCapability = "activity-pending";
    create();
    return true;
  } catch (error) {
    this.wakeCapability = "degraded";
    return false;
  }
};

LifecycleObserver.prototype.acquireKeepalive = function () {
  var manager = this.service && this.service.activityManager;
  var self = this;
  if (this.keepalive || !manager || typeof manager.create !== "function") return false;
  try {
    manager.create("alcyone-vpn-supervisor", function (activity) { self.keepalive = activity || true; });
    return true;
  } catch (error) { return false; }
};

LifecycleObserver.prototype.handleResume = function (source) {
  this.wakeGeneration++;
  if (this.network) this.network.check(function () {}, true);
  this.onResume({ source: source || "timer-gap", wakeGeneration: this.wakeGeneration });
};

LifecycleObserver.prototype.start = function () {
  if (this.timer) return;
  this.installActivityTrigger();
  this.acquireKeepalive();
  var self = this;
  if (this.network && typeof this.network.subscribe === "function")
    this.networkSubscription = this.network.subscribe(function () { self.handleResume("network-subscription"); });
  this.lastTickAt = Date.now();
  this.timer = setInterval(function () {
    var now = Date.now();
    if (now - self.lastTickAt > RESUME_GAP_MS) self.handleResume("timer-gap");
    self.lastTickAt = now;
  }, TICK_MS);
  if (this.timer.unref) this.timer.unref();
};

LifecycleObserver.prototype.stop = function () {
  if (this.timer) clearInterval(this.timer);
  if (this.networkSubscription && this.networkSubscription.cancel) this.networkSubscription.cancel();
  this.timer = null;
  this.networkSubscription = null;
};
LifecycleObserver.prototype.status = function () { return { wakeGeneration: this.wakeGeneration, wakeCapability: this.wakeCapability }; };

module.exports = { TICK_MS: TICK_MS, RESUME_GAP_MS: RESUME_GAP_MS, bootId: bootId, LifecycleObserver: LifecycleObserver };
