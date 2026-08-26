"use strict";

var assert = require("assert");
var events = require("events");
var https = require("https");
var originalGet = https.get;
var observed = null;

https.get = function (options, callback) {
  observed = { argc: arguments.length, options: options };
  var request = new events.EventEmitter();
  request.setTimeout = function () {};
  request.abort = function () {};
  process.nextTick(function () {
    var response = new events.EventEmitter();
    response.statusCode = 204;
    response.setEncoding = function () {};
    callback(response);
    process.nextTick(function () { response.emit("end"); });
  });
  return request;
};

var probe = require("../app/service/lib/vpn/liveness-probe");
probe.requestEndpoint(
  { url: "https://example.test/generate_204", kind: "204" },
  1000,
  function (error, ok) {
    https.get = originalGet;
    assert.ifError(error);
    assert.strictEqual(ok, true, "HTTP 204 is a successful liveness result");
    assert.strictEqual(observed.argc, 2, "Node 8 receives options plus callback only");
    assert.strictEqual(observed.options.protocol, "https:");
    assert.strictEqual(observed.options.hostname, "example.test");
    assert.ok(/alcyone=\d+/.test(observed.options.search), "probe cache-buster is preserved");
    assert.strictEqual(observed.options.headers.Connection, "close");
    console.log("liveness probe Node 8 compatibility test passed");
  },
);

setTimeout(function () {
  https.get = originalGet;
  if (!observed) throw new Error("liveness probe did not call https.get");
}, 100);
