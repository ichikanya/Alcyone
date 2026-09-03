"use strict";
var assert = require("assert");
var networkLib = require("../app/service/lib/net/network-observer");
var calls = [];
var service = {
  call: function (uri, payload, callback) {
    calls.push(uri);
    if (uri.indexOf("com.webos.service.connectionmanager/getStatus") >= 0)
      return callback({ payload: { returnValue: false, errorCode: -1 } });
    if (uri.indexOf("com.webos.service.connectionmanager/getstatus") >= 0)
      return callback({ payload: { returnValue: true, isInternetConnectionAvailable: true } });
    callback({ payload: { returnValue: false } });
  },
};
var observer = new networkLib.NetworkObserver({
  service: service,
  routes: { readDefaultRoute: function () { return { device: "wlan0", gateway: "192.168.50.1" }; } },
});
observer.check(function (error, snapshot) {
  assert.ifError(error);
  assert.strictEqual(snapshot.source, "ls2");
  assert.strictEqual(snapshot.variant, "current-lowercase");
  assert.strictEqual(snapshot.ready, true);
});
assert.strictEqual(calls.length, 2, "observer must try the documented LS2 variants in order");

var denied = new networkLib.NetworkObserver({
  service: { call: function (uri, payload, callback) { callback({ payload: { returnValue: false } }); } },
  routes: { readDefaultRoute: function () { return { device: "wlan0", gateway: "192.168.50.1" }; } },
});
denied.check(function (error, snapshot) {
  assert.ifError(error);
  assert.strictEqual(snapshot.source, "kernel", "ACG denial must fall back to kernel signals");
});

var subscribedUris = [];
var readyEvents = 0;
var subscriptionService = {
  subscribe: function (uri) {
    var handlers = {};
    subscribedUris.push(uri);
    return {
      on: function (name, callback) {
        handlers[name] = callback;
        if (name === "response") {
          if (subscribedUris.length === 1) callback({ payload: { returnValue: false } });
          else callback({ payload: { returnValue: true, isInternetConnectionAvailable: true } });
        }
      },
      cancel: function () {},
    };
  },
};
var subscribed = new networkLib.NetworkObserver({ service: subscriptionService });
subscribed.subscribe(function () { readyEvents++; });
assert.strictEqual(subscribedUris.length, 2, "subscription must fall back across LS2 variants");
assert.strictEqual(readyEvents, 1, "a ready subscription event must be forwarded");
console.log("network observer LS2 variants and kernel fallback tests passed");
