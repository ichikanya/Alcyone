"use strict";

var https = require("https");
var urlLib = require("url");
var ENDPOINTS = [
  { url: "https://connectivitycheck.gstatic.com/generate_204", kind: "204" },
  { url: "https://cp.cloudflare.com/generate_204", kind: "204" },
  { url: "https://api.ipify.org", kind: "ip" },
];

function once(callback) {
  var called = false;
  return function () {
    if (called) return;
    called = true;
    callback.apply(null, arguments);
  };
}

function validIp(text) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(text || "").trim()) ||
    /^[0-9a-f:]+$/i.test(String(text || "").trim());
}

function requestEndpoint(endpoint, deadlineMs, callback) {
  var done = once(callback);
  var body = "";
  var separator = endpoint.url.indexOf("?") >= 0 ? "&" : "?";
  var request;
  try {
    /* webOS 4/5 ship Node 8, whose https.get does not support the modern
       three-argument (url, options, callback) overload. Passing one legacy
       options object keeps the watchdog functional across the supported
       firmware range instead of turning every probe into a TypeError. */
    var requestOptions = urlLib.parse(
      endpoint.url + separator + "alcyone=" + Date.now()
    );
    requestOptions.headers = { Connection: "close", "Cache-Control": "no-cache" };
    request = https.get(requestOptions, function (response) {
        response.setEncoding("utf8");
        response.on("data", function (chunk) {
          body += chunk;
          if (body.length > 1024) {
            request.abort();
            done(null, false);
          }
        });
        response.on("end", function () {
          var ok = endpoint.kind === "204"
            ? response.statusCode === 204
            : response.statusCode === 200 && validIp(body);
          done(null, ok);
        });
      });
    request.setTimeout(deadlineMs, function () {
      request.abort();
      done(null, false);
    });
    request.on("error", function () { done(null, false); });
  } catch (error) {
    done(null, false);
  }
}

function LivenessProbe(options) {
  options = options || {};
  this.endpoints = options.endpoints || ENDPOINTS;
  this.deadlineMs = options.deadlineMs || 8000;
  this.cursor = 0;
  this.requestEndpoint = options.requestEndpoint || requestEndpoint;
}

LivenessProbe.prototype.run = function (callback) {
  var self = this;
  var startedAt = Date.now();
  var start = this.cursor++ % this.endpoints.length;
  var attempts = 0;
  var done = once(callback);
  function next() {
    var remaining = self.deadlineMs - (Date.now() - startedAt);
    if (attempts >= 2 || remaining <= 0) return done(null, false);
    var endpoint = self.endpoints[(start + attempts) % self.endpoints.length];
    attempts++;
    self.requestEndpoint(endpoint, remaining, function (error, ok) {
      if (ok) return done(null, true);
      next();
    });
  }
  next();
};

module.exports = {
  ENDPOINTS: ENDPOINTS,
  validIp: validIp,
  requestEndpoint: requestEndpoint,
  LivenessProbe: LivenessProbe,
};
