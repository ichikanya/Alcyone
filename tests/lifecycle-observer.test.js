"use strict";
var assert = require("assert");
var lifecycleLib = require("../app/service/lib/lifecycle-observer");
var created = [];
var resumed = null;
var observer = new lifecycleLib.LifecycleObserver({
  edition: { serviceId: "com.alcyone.vpn.service" },
  network: { check: function (callback, force) { assert.strictEqual(force, true); callback(null, {}); } },
  onResume: function (event) { resumed = event; },
});
observer.setService({
  call: function (uri, spec, callback) { created.push({ uri: uri, spec: spec }); callback({ payload: { returnValue: true, activityId: 42 } }); },
  activityManager: { create: function (name, callback) { callback({ name: name }); } },
});
assert.strictEqual(observer.installActivityTrigger(), true);
assert.strictEqual(created[0].spec.activity.persist, true);
assert.strictEqual(created[0].spec.activity.callback.method, "luna://com.alcyone.vpn.service/autostart");
assert.strictEqual(created[0].spec.activity.trigger.method, "luna://com.webos.service.connectionmanager/getStatus");
assert.strictEqual(observer.acquireKeepalive(), true);
observer.handleResume("timer-gap");
assert.strictEqual(resumed.wakeGeneration, 1);
assert.strictEqual(observer.status().wakeCapability, "activity");
console.log("Quick Start activity and timer-gap lifecycle tests passed");
