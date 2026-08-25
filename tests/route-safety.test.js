"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var routesLib = require(
  path.join(ROOT, "app", "service", "lib", "net", "routes.js"),
);

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-routes-"));
var manager = new routesLib.RouteManager({
  core: "xray",
  stateFile: path.join(dir, "route.state"),
  ipBinary: "/sbin/ip",
});
var commands = [];
manager.ip = function (args) {
  commands.push(args.slice(0));
  if (args[0] === "route" && args[1] === "get") {
    return {
      code: 0,
      stdout: String(args[2]) + " via 192.168.1.1 dev wlan0\n",
    };
  }
  if (
    args[0] === "route" &&
    args[1] === "show" &&
    args[2] === "exact" &&
    args[3] === "0.0.0.0/8"
  ) {
    return { code: 0, stdout: "0.0.0.0/8 via 192.168.1.1 dev wlan0\n" };
  }
  return { code: 0, stdout: "" };
};
manager.available = function () {
  return true;
};
manager.readDefaultRoute = function () {
  return {
    gateway: "192.168.1.1",
    device: "wlan0",
    raw: "default via 192.168.1.1 dev wlan0",
  };
};
manager.readHostRoute = function () {
  return "203.0.113.10 via 192.168.1.254 dev wlan0 metric 50";
};
manager.readIpv4Route = function (prefix) {
  return prefix === "10.0.0.0/8"
    ? "10.0.0.0/8 via 192.168.1.254 dev eth0 metric 60"
    : "";
};
manager.readIpv6Route = function (prefix) {
  return prefix + " via 2001:db8::1 dev eth0 metric 100";
};

var state = manager.saveState(["203.0.113.10"]);
var results = [];
function record(name, ok) {
  results.push(!!ok);
  console.log((ok ? "ok   - " : "FAIL - ") + name);
}
function hasCommand(parts) {
  var expected = JSON.stringify(parts);
  return commands.some(function (command) {
    return JSON.stringify(command) === expected;
  });
}

record(
  "existing server route is snapshotted",
  state.serverRoutes["203.0.113.10"].indexOf("192.168.1.254") >= 0,
);
record(
  "existing IPv6 routes are snapshotted",
  !!state.ipv6Routes["::/1"] && !!state.ipv6Routes["8000::/1"],
);
record(
  "existing direct-range route is snapshotted",
  state.directRoutes["10.0.0.0/8"].indexOf("dev eth0") >= 0,
);

commands = [];
manager.applyTunRoutes(state);
record(
  "IPv6 is blocked while the IPv4-only VPN is active",
  hasCommand([
    "-6",
    "route",
    "replace",
    "unreachable",
    "::/1",
    "metric",
    "42760",
  ]) &&
    hasCommand([
      "-6",
      "route",
      "replace",
      "unreachable",
      "8000::/1",
      "metric",
      "42760",
    ]),
);
record(
  "only resolved proxy endpoints receive bypass routes, never public DNS",
  hasCommand([
    "route",
    "replace",
    "203.0.113.10",
    "via",
    "192.168.1.1",
    "dev",
    "wlan0",
  ]) &&
    !commands.some(function (command) {
      var text = command.join(" ");
      return (
        text.indexOf("1.1.1.1") >= 0 ||
        text.indexOf("8.8.8.8") >= 0 ||
        text.indexOf("9.9.9.9 via") >= 0
      );
    }),
);
record(
  "XRay direct IPv4 ranges bypass alx0 on the physical interface",
  hasCommand([
    "route",
    "replace",
    "10.0.0.0/8",
    "via",
    "192.168.1.1",
    "dev",
    "wlan0",
  ]) &&
    hasCommand(["route", "replace", "239.255.255.250"]) === false &&
    hasCommand(["route", "replace", "224.0.0.0/4", "dev", "wlan0"]) &&
    hasCommand(["route", "replace", "240.0.0.0/4", "dev", "wlan0"]),
);
record(
  "every direct-range route is verified off alx0 after split-route install",
  routesLib.DIRECT_BYPASS_ROUTES.every(function (route) {
    return route.probe
      ? hasCommand(["route", "get", route.probe])
      : hasCommand(["route", "show", "exact", route.prefix]);
  }),
);

commands = [];
manager.rollback();
record(
  "pre-existing server route is restored",
  hasCommand([
    "route",
    "replace",
    "203.0.113.10",
    "via",
    "192.168.1.254",
    "dev",
    "wlan0",
    "metric",
    "50",
  ]),
);
record(
  "pre-existing IPv6 route is restored",
  hasCommand([
    "-6",
    "route",
    "replace",
    "::/1",
    "via",
    "2001:db8::1",
    "dev",
    "eth0",
    "metric",
    "100",
  ]),
);
record(
  "pre-existing direct-range route is restored",
  hasCommand([
    "route",
    "replace",
    "10.0.0.0/8",
    "via",
    "192.168.1.254",
    "dev",
    "eth0",
    "metric",
    "60",
  ]),
);

manager.readDefaultRoute = function () {
  return null;
};
var missingDefaultCode = "";
try {
  manager.saveState([]);
} catch (missingDefaultError) {
  missingDefaultCode = missingDefaultError.code;
}
record(
  "route snapshot fails before core startup when no physical default is available",
  missingDefaultCode === "ROUTE_FAILED",
);

var procRoute = path.join(dir, "proc-route");
fs.writeFileSync(
  procRoute,
  "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
    "wlan0\t00000000\t0132A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n",
);
var fallbackManager = new routesLib.RouteManager({
  core: "xray",
  stateFile: path.join(dir, "fallback.state"),
  ipBinary: "/sbin/ip",
  procRouteFile: procRoute,
});
fallbackManager.ip = function () {
  return { code: -1, stdout: "", stderr: "transient spawn failure" };
};
var fallbackDefault = fallbackManager.readDefaultRoute();
record(
  "kernel route table preserves the physical default when ip spawn is transiently unavailable",
  fallbackDefault &&
    fallbackDefault.device === "wlan0" &&
    fallbackDefault.gateway === "192.168.50.1",
);

manager.readDefaultRoute = function () {
  return { device: "eth0", gateway: "192.168.1.1" };
};
record(
  "network-change detection notices a physical interface transition",
  manager.networkChanged(state) === true,
);
manager.readDefaultRoute = function () {
  return { device: "wlan0", gateway: "192.168.1.1" };
};
record(
  "network-change detection accepts the captured physical route",
  manager.networkChanged(state) === false,
);

var changedNetworkManager = new routesLib.RouteManager({
  core: "xray",
  stateFile: path.join(dir, "changed.state"),
  ipBinary: "/sbin/ip",
});
var changedCommands = [];
changedNetworkManager.ip = function (args) {
  changedCommands.push(args.slice(0));
  return { code: 0, stdout: "" };
};
changedNetworkManager.available = function () {
  return true;
};
changedNetworkManager.loadState = function () {
  return {
    original: { device: "wlan0", gateway: "192.168.1.1" },
    serverAddresses: ["203.0.113.10"],
    serverRoutes: { "203.0.113.10": "203.0.113.10 via 192.168.1.1 dev wlan0" },
    directRoutes: { "10.0.0.0/8": "10.0.0.0/8 via 192.168.1.1 dev wlan0" },
    ipv6Routes: { "::/1": "::/1 via 2001:db8::1 dev wlan0" },
  };
};
changedNetworkManager.rollback({ preserveCurrentNetwork: true });
record(
  "network-change rollback does not restore stale gateway or interface routes",
  !changedCommands.some(function (command) {
    var text = command.join(" ");
    return text.indexOf("192.168.1.1") >= 0 || text.indexOf("dev wlan0") >= 0;
  }),
);

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
