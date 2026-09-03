"use strict";
var assert = require("assert");
var policyLib = require("../app/service/lib/net/policy-routes");
var calls = [];
function ip(args) {
  calls.push(args.slice(0));
  var text = args.join(" ");
  if (text === "rule show") return { code: 0, stdout: "0: from all lookup local\n32766: from all lookup main\n" };
  if (text === "route show table main scope link")
    return {
      code: 0,
      stdout:
        "192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.50\n" +
        "192.168.1.50 dev wlan0 scope link\n",
    };
  if (text === "route show table 42760 exact 192.168.1.0/24")
    return {
      code: 0,
      stdout: "192.168.1.0/24 dev wlan0 scope link src 192.168.1.50\n",
    };
  if (text === "route show table 42760 exact 192.168.1.50")
    return { code: 0, stdout: "192.168.1.50 dev wlan0 scope link\n" };
  if (text.indexOf("route show table 42760") === 0) return { code: 0, stdout: "" };
  if (text.indexOf("route get 203.0.113.9") === 0)
    return { code: 0, stdout: "203.0.113.9 via 192.168.1.1 dev wlan0 src 192.168.1.50 table 1001\n" };
  if (text.indexOf("route get 9.9.9.9") === 0)
    return { code: 0, stdout: "9.9.9.9 dev alx0 table 42760\n" };
  return { code: 0, stdout: "" };
}
var state = {
  original: { gateway: "192.168.1.1", device: "wlan0" },
  serverAddresses: ["203.0.113.9"],
};
var policy = new policyLib.PolicyRoutes({ ip: ip, persist: function () {}, core: "xray", tunName: "alx0" });
policy.prepare(state);
assert.ok(
  calls.some(function (args) {
    return args.join(" ") === "route show table main scope link";
  }),
  "link-route discovery must keep device names visible on old iproute2",
);
assert.strictEqual(state.policy.endpointPaths[0].table, "1001", "physical vendor table must be preserved");
assert.deepStrictEqual(
  state.policy.linkRoutes,
  [
    { prefix: "192.168.1.0/24", device: "wlan0", source: "192.168.1.50" },
    { prefix: "192.168.1.50", device: "wlan0", source: "" },
  ],
  "physical on-link routes are captured before the policy rule is activated",
);
assert.ok(state.policy.endpointPaths[0].priority < state.policy.tunnelPriority);
policy.apply(state);
var endpointRule = calls.findIndex(function (args) { return args.join(" ").indexOf("to 203.0.113.9/32 lookup 1001") >= 0; });
var linkRoute = calls.findIndex(function (args) {
  return args.join(" ") ===
    "route replace 192.168.1.0/24 dev wlan0 scope link src 192.168.1.50 table 42760";
});
var tunnelRule = calls.findIndex(function (args) { return args.join(" ").indexOf("from all lookup 42760") >= 0 && args[0] !== "-6"; });
assert.ok(endpointRule >= 0 && tunnelRule > endpointRule, "endpoint bypass must precede the tunnel rule");
assert.ok(linkRoute >= 0 && tunnelRule > linkRoute, "LAN on-link route must precede the tunnel rule");
assert.deepStrictEqual(
  policyLib.parseLinkRoutes(
    "default via 192.168.1.1 dev wlan0\n" +
      "192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.50\n" +
      "203.0.113.0/24 via 192.168.1.1 dev wlan0\n" +
      "198.18.0.0/30 dev alx0 scope link\n",
    "wlan0",
  ),
  [{ prefix: "192.168.1.0/24", device: "wlan0", source: "192.168.1.50" }],
  "only injection-safe, gateway-free routes owned by the physical NIC are copied",
);
calls.length = 0;
policy.rollback(state);
assert.strictEqual(calls[0].join(" "), "rule del priority " + state.policy.tunnelPriority, "rollback must remove tunnel rule first");
console.log("policy routing table, priority and rollback-order tests passed");
