"use strict";
var assert = require("assert");
var policyLib = require("../app/service/lib/net/policy-routes");
var calls = [];
function ip(args) {
  calls.push(args.slice(0));
  var text = args.join(" ");
  if (text === "rule show") return { code: 0, stdout: "0: from all lookup local\n32766: from all lookup main\n" };
  if (text.indexOf("route show table 42760") === 0) return { code: 0, stdout: "" };
  if (text.indexOf("route get 203.0.113.9") === 0)
    return { code: 0, stdout: "203.0.113.9 via 192.168.50.1 dev wlan0 src 192.168.50.58 table 1001\n" };
  if (text.indexOf("route get 9.9.9.9") === 0)
    return { code: 0, stdout: "9.9.9.9 dev tun0 table 42760\n" };
  return { code: 0, stdout: "" };
}
var state = {
  original: { gateway: "192.168.50.1", device: "wlan0" },
  serverAddresses: ["203.0.113.9"],
};
var policy = new policyLib.PolicyRoutes({ ip: ip, persist: function () {}, core: "xray" });
policy.prepare(state);
assert.strictEqual(state.policy.endpointPaths[0].table, "1001", "physical vendor table must be preserved");
assert.ok(state.policy.endpointPaths[0].priority < state.policy.tunnelPriority);
policy.apply(state);
var endpointRule = calls.findIndex(function (args) { return args.join(" ").indexOf("to 203.0.113.9/32 lookup 1001") >= 0; });
var tunnelRule = calls.findIndex(function (args) { return args.join(" ").indexOf("from all lookup 42760") >= 0 && args[0] !== "-6"; });
assert.ok(endpointRule >= 0 && tunnelRule > endpointRule, "endpoint bypass must precede the tunnel rule");
calls.length = 0;
policy.rollback(state);
assert.strictEqual(calls[0].join(" "), "rule del priority " + state.policy.tunnelPriority, "rollback must remove tunnel rule first");
console.log("policy routing table, priority and rollback-order tests passed");
