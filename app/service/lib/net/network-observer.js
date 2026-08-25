"use strict";

var os = require("os");
var net = require("net");
var routesLib = require("./routes");
var LS2_VARIANTS = [
  { uri: "luna://com.webos.service.connectionmanager", method: "getStatus", name: "current" },
  { uri: "luna://com.webos.service.connectionmanager", method: "getstatus", name: "current-lowercase" },
  { uri: "luna://com.palm.connectionmanager", method: "getstatus", name: "legacy" },
];

function once(callback) {
  var called = false;
  return function () {
    if (called) return;
    called = true;
    callback.apply(null, arguments);
  };
}

function hasIpv4() {
  var interfaces = os.networkInterfaces();
  var names = Object.keys(interfaces);
  var i;
  var j;
  var address;
  for (i = 0; i < names.length; i++) {
    for (j = 0; j < (interfaces[names[i]] || []).length; j++) {
      address = interfaces[names[i]][j];
      if (address.family === "IPv4" && !address.internal &&
          String(address.address).indexOf("169.254.") !== 0) return true;
    }
  }
  return false;
}

function ls2Ready(payload) {
  if (!payload || payload.returnValue === false) return false;
  if (payload.isInternetConnectionAvailable === true ||
      payload.internetConnectionAvailable === true) return true;
  var wired = payload.wired || {};
  var wifi = payload.wifi || {};
  return /^(connected|online|ready)$/i.test(String(wired.state || "")) ||
    /^(connected|online|ready)$/i.test(String(wifi.state || ""));
}

function NetworkObserver(options) {
  options = options || {};
  this.service = options.service || null;
  this.routes = options.routes || new routesLib.RouteManager(options);
  this.logger = options.logger || null;
  this.callTimeoutMs = options.callTimeoutMs || 5000;
  this.setTimeout = options.setTimeout || setTimeout;
  this.clearTimeout = options.clearTimeout || clearTimeout;
  this.variant = "";
  this.source = "kernel";
  this.lastDenialLogged = false;
  this.lastLs2AttemptAt = 0;
  this.endpointProvider = options.endpointProvider || function () { return null; };
}

NetworkObserver.prototype.setService = function (service) {
  this.service = service || null;
  this.variant = "";
};

NetworkObserver.prototype.callVariant = function (variant, subscribe, callback) {
  var done = once(callback);
  var timer = this.setTimeout(function () { done(new Error("timeout")); }, this.callTimeoutMs);
  try {
    if (!this.service || typeof this.service.call !== "function") {
      this.clearTimeout(timer);
      return done(new Error("unavailable"));
    }
    this.service.call(variant.uri + "/" + variant.method, { subscribe: !!subscribe }, function (reply) {
      var payload = (reply && reply.payload) || reply || {};
      if (payload.returnValue === false) {
        this.clearTimeout(timer);
        return done(new Error("denied"));
      }
      this.clearTimeout(timer);
      done(null, payload);
    }.bind(this));
  } catch (error) {
    this.clearTimeout(timer);
    done(error);
  }
};

NetworkObserver.prototype.kernelSnapshot = function (callback) {
  var route = this.routes.readDefaultRoute();
  var endpoint = this.endpointProvider() || null;
  var base = {
    source: "kernel", variant: "", ipv4: hasIpv4(),
    device: (route && route.device) || "", gateway: (route && route.gateway) || "",
    ready: !!(route && route.device && hasIpv4()), endpointReachable: null,
  };
  if (!base.ready || !endpoint || !endpoint.address || !endpoint.port)
    return callback(null, base);
  var done = once(function (ok) { base.endpointReachable = ok; base.ready = base.ready && ok; callback(null, base); });
  var socket = net.connect({ host: endpoint.address, port: endpoint.port });
  socket.setTimeout(3000);
  socket.on("connect", function () { socket.destroy(); done(true); });
  socket.on("timeout", function () { socket.destroy(); done(false); });
  socket.on("error", function () { done(false); });
};

NetworkObserver.prototype.check = function (callback, forceLs2) {
  var self = this;
  var now = Date.now();
  if (!forceLs2 && this.source === "kernel" && this.lastLs2AttemptAt && now - this.lastLs2AttemptAt < 30 * 60 * 1000)
    return this.kernelSnapshot(callback);
  this.lastLs2AttemptAt = now;
  var variants = LS2_VARIANTS.slice(0);
  if (this.variant) variants.sort(function (a) { return a.name === self.variant ? -1 : 1; });
  var index = 0;
  function next() {
    if (index >= variants.length) {
      self.source = "kernel";
      if (!self.lastDenialLogged && self.logger) {
        self.lastDenialLogged = true;
        self.logger.warn("connection manager unavailable; using kernel observer", { code: "LS2_UNAVAILABLE" });
      }
      return self.kernelSnapshot(callback);
    }
    var variant = variants[index++];
    self.callVariant(variant, false, function (error, payload) {
      if (error) return next();
      self.source = "ls2";
      self.variant = variant.name;
      self.lastDenialLogged = false;
      callback(null, { source: "ls2", variant: variant.name, ready: ls2Ready(payload), device: "", gateway: "" });
    });
  }
  next();
};

NetworkObserver.prototype.waitUntilReady = function (callback) {
  var self = this;
  var cancelled = false;
  var timer = null;
  var checks = 0;
  var firstReadyAt = 0;
  var previousKey = "";
  var startedAt = Date.now();
  function delay() {
    if (checks === 0) return 2000;
    if (checks === 1) return 5000;
    if (checks === 2) return 10000;
    return Date.now() - startedAt < 120000 ? 10000 : 30000;
  }
  function schedule() {
    timer = self.setTimeout(check, delay());
    if (timer && timer.unref) timer.unref();
  }
  function check() {
    if (cancelled) return;
    checks++;
    self.check(function (error, snapshot) {
      if (cancelled) return;
      var key = snapshot && snapshot.ready ? [snapshot.source, snapshot.device, snapshot.gateway].join("|") : "";
      if (key && key === previousKey) {
        if (!firstReadyAt) firstReadyAt = Date.now();
        if (Date.now() - firstReadyAt >= 5000) return callback(null, snapshot);
      } else {
        previousKey = key;
        firstReadyAt = key ? Date.now() : 0;
      }
      if (Date.now() - startedAt >= 10 * 60 * 1000 && self.logger)
        self.logger.warn("autostart still waiting for network", { code: "NETWORK_WAIT_DELAYED" });
      schedule();
    });
  }
  schedule();
  return { cancel: function () { cancelled = true; if (timer) self.clearTimeout(timer); } };
};

NetworkObserver.prototype.subscribe = function (callback) {
  var self = this;
  var cancelled = false;
  var current = null;
  var index = 0;
  function cancelCurrent() {
    if (current && typeof current.cancel === "function") {
      try { current.cancel(); } catch (error) {}
    }
    current = null;
  }
  function next() {
    var variant;
    if (cancelled || !self.service || typeof self.service.subscribe !== "function") return;
    if (index >= LS2_VARIANTS.length) {
      self.source = "kernel";
      return;
    }
    variant = LS2_VARIANTS[index++];
    try {
      current = self.service.subscribe(variant.uri + "/" + variant.method, { subscribe: true });
      current.on("response", function (reply) {
        var payload = (reply && reply.payload) || reply || {};
        if (cancelled) return;
        if (payload.returnValue === false) {
          cancelCurrent();
          return next();
        }
        self.source = "ls2";
        self.variant = variant.name;
        if (ls2Ready(payload)) callback({
          source: "ls2", variant: variant.name, ready: true, device: "", gateway: "",
        });
      });
      if (current.on) current.on("cancel", function () {
        if (!cancelled) { current = null; next(); }
      });
    } catch (error) {
      cancelCurrent();
      next();
    }
  }
  next();
  return { cancel: function () { cancelled = true; cancelCurrent(); } };
};

NetworkObserver.prototype.status = function () {
  return { networkSource: this.source, connManVariant: this.variant || "" };
};

module.exports = { LS2_VARIANTS: LS2_VARIANTS, hasIpv4: hasIpv4, ls2Ready: ls2Ready, NetworkObserver: NetworkObserver };
