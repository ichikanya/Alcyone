"use strict";

/* Stage 5 data-plane groundwork:
   - MTU policy (1400 preferred, 1280 floor, physical-capped);
   - sing-box config honours interface/mtu overrides, defaults to als0@1400;
   - XRay native-tun mode prepends a single tun inbound and keeps the
     loopback health SOCKS; legacy tun2socks shape is untouched by default;
   - data plane selection comes from the edition config only. */

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var routesLib = require(
  path.join(ROOT, "app", "service", "lib", "net", "routes.js"),
);
var mtuPolicyLib = require(path.join(ROOT, "app", "service", "lib", "mtu-policy.js"));
var xrayConfig = require(
  path.join(ROOT, "app", "service", "lib", "config", "xray.js"),
);
var singboxConfig = require(
  path.join(ROOT, "app", "service", "lib", "config", "singbox.js"),
);

/* --- mtu policy --- */
assert.strictEqual(mtuPolicyLib.mtuPolicy(), 1400, "unknown physical mtu falls back to preferred 1400");
assert.strictEqual(mtuPolicyLib.mtuPolicy(1500), 1400, "standard ethernet link gets 1400");
assert.strictEqual(mtuPolicyLib.mtuPolicy(9000), 1400, "jumbo links are still capped at 1400");
assert.strictEqual(mtuPolicyLib.mtuPolicy(1300), 1300, "smaller links keep their mtu");
assert.strictEqual(mtuPolicyLib.mtuPolicy(1200), 1280, "ipv6 minimum of 1280 is enforced");
assert.strictEqual(mtuPolicyLib.mtuPolicy(0), 1400, "invalid mtu uses the default");
assert.strictEqual(routesLib.mtuPolicy, mtuPolicyLib.mtuPolicy, "routes re-exports the shared policy");

/* --- RouteManager.physicalMtu parsing --- */
(function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-stage5-"));
  var stateFile = path.join(dir, "route.state");
  var rm = new routesLib.RouteManager({
    core: "xray",
    stateFile: stateFile,
    ipBinary: "/sbin/ip",
  });
  var asked = [];
  rm.ip = function (args) {
    asked.push(args.join(" "));
    if (args[0] === "link" && args[1] === "show")
      return { code: 0, stdout: "3: wlan0: <BROADCAST,MULTICAST,UP> mtu 1500 qdisc\n" };
    return { code: 0, stdout: "" };
  };
  rm.readDefaultRoute = function () {
    return { device: "wlan0", gateway: "192.168.50.1" };
  };
  assert.strictEqual(rm.physicalMtu(), 1500, "parses mtu from ip link show");
  assert.ok(asked.some(function (c) { return c.indexOf("link show wlan0") >= 0; }));
  rm.readDefaultRoute = function () { return null; };
  assert.strictEqual(rm.physicalMtu(), 0, "no known device means no mtu knowledge");
})();

/* --- sing-box config --- */
var sbProfile = {
  id: "p1",
  protocol: "vless",
  link:
    "vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=reality&pbk=K&sid=AB#A",
};
var sbDefault = singboxConfig.build(sbProfile, "pin");
assert.strictEqual(sbDefault.inbounds[0].interface_name, "als0", "default interface is edition-owned als0");
assert.strictEqual(sbDefault.inbounds[0].mtu, 1400, "default mtu follows the policy");
var sbCustom = singboxConfig.build(sbProfile, "pin", { interfaceName: "als0", mtu: 1380 });
assert.strictEqual(sbCustom.inbounds[0].mtu, 1380, "manager-provided mtu wins");
assert.strictEqual(sbCustom.inbounds[1].protocol === "socks" || sbCustom.inbounds[1].type === "socks", true,
  "health socks inbound stays for probes");

/* --- xray legacy (tun2socks) shape unchanged --- */
var xrProfile = {
  id: "p2",
  protocol: "vless",
  link:
    "vless://11111111-2222-3333-4444-555555555555@b.example.com:443?security=reality&pbk=K#B",
};
var xrLegacy = xrayConfig.build(xrProfile, "pin", {
  physicalInterface: "wlan-test0",
});
assert.strictEqual(xrLegacy.inbounds.length, 1, "legacy mode has exactly the health inbound");
assert.strictEqual(xrLegacy.inbounds[0].port, xrayConfig.SOCKS_PORT);
assert.strictEqual(
  xrLegacy.outbounds[1].streamSettings.sockopt.interface,
  "wlan-test0",
  "generated freedom outbound is pinned to the physical interface",
);

/* --- xray native-tun simple profile --- */
var xrNative = xrayConfig.build(xrProfile, "pin", {
  dataPlane: "native-tun",
  interfaceName: "alx0",
  mtu: 1380,
});
assert.strictEqual(xrNative.inbounds.length, 2, "native mode adds the tun inbound");
assert.strictEqual(xrNative.inbounds[0].protocol, "tun");
assert.strictEqual(xrNative.inbounds[0].settings.name, "alx0");
assert.strictEqual(xrNative.inbounds[0].settings.mtu, 1380);
assert.strictEqual(xrNative.inbounds[1].port, xrayConfig.SOCKS_PORT, "health probe inbound remains");

/* --- xray native-tun full config path --- */
var fullConfigProfile = {
  id: "p3",
  protocol: "vless",
  link: "vless://11111111-2222-3333-4444-555555555555@c.example.com:443?type=xhttp#C",
  fullConfig: {
    inbounds: [{ port: 10000, protocol: "socks" }],
    outbounds: [
      {
        protocol: "vless",
        tag: "proxy",
        settings: { vnext: [{ address: "c.example.com", port: 443, users: [{ id: "u" }] }] },
        streamSettings: { network: "xhttp" },
      },
      { protocol: "freedom", tag: "direct" },
    ],
  },
};
var xrFullNative = xrayConfig.build(fullConfigProfile, "pin", {
  dataPlane: "native-tun",
  interfaceName: "alx0",
  mtu: 1400,
});
assert.strictEqual(xrFullNative.inbounds[0].protocol, "tun", "full configs get the tun inbound too");
assert.strictEqual(
  xrFullNative.inbounds[1].port,
  xrayConfig.SOCKS_PORT,
  "full configs keep the managed health inbound",
);

/* systemProxy mode must never carry the tun device */
var xrProxy = xrayConfig.build(fullConfigProfile, "pin", {
  mode: "systemProxy",
  dataPlane: "native-tun",
});
assert.strictEqual(
  xrProxy.inbounds.some(function (i) { return i.protocol === "tun"; }),
  false,
  "system proxy replaces all inbounds with http only",
);

/* --- data plane selection is explicit --- */
assert.strictEqual(xrayConfig.dataPlaneFor(undefined), "tun2socks");
assert.strictEqual(xrayConfig.dataPlaneFor({}), "tun2socks");
assert.strictEqual(xrayConfig.dataPlaneFor({ dataPlane: "native-tun" }), "native-tun");
assert.strictEqual(xrayConfig.dataPlaneFor({ dataPlane: "yolo" }), "tun2socks", "unknown values stay on the proven path");

/* override hook for the hardware spike */
var overridden = xrayConfig.nativeTunInbound({
  tunInboundOverride: { tag: "spike", protocol: "tun", settings: { name: "alx0", mtu: 1420 } },
});
assert.strictEqual(overridden.tag, "spike");
assert.strictEqual(overridden.settings.mtu, 1420);

console.log("stage 5 data-plane tests passed");
