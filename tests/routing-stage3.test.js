"use strict";

/* Stage 3 routing fixes:
   - edition-specific TUN interfaces (alx0 / als0, shared tun0 is gone);
   - policy backend verification consults its own vendor table (the P0
     false-negative that disabled healthy policy sessions);
   - rollback refuses to touch the network without owned route state. */

var os = require("os");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var routesLib = require(
  path.join(ROOT, "app", "service", "lib", "net", "routes.js"),
);

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}
var quiet = { info: function () {}, warn: function () {}, error: function () {} };
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-stage3-"));
}

/* --- edition-specific interface naming --- */
record(
  "tunNameFor maps xray to alx0 and sing-box to als0",
  routesLib.tunNameFor("xray") === "alx0" &&
    routesLib.tunNameFor("sing-box") === "als0" &&
    routesLib.tunNameFor("unknown") === routesLib.TUN_NAME,
);
(function () {
  var rx = new routesLib.RouteManager({
    core: "xray",
    stateFile: path.join(tempDir(), "route.state"),
    ipBinary: "",
  });
  var sb = new routesLib.RouteManager({
    core: "sing-box",
    stateFile: path.join(tempDir(), "route.state"),
    ipBinary: "",
  });
  record(
    "RouteManager instances own distinct interface names",
    rx.tunName === "alx0" && sb.tunName === "als0" && rx.tunName !== sb.tunName,
  );
})();

/* --- policy verifier must be table-aware --- */
(function () {
  var rm = new routesLib.RouteManager({
    core: "xray",
    stateFile: path.join(tempDir(), "route.state"),
    ipBinary: "/sbin/ip",
  });
  var calls = [];
  rm.ip = function (args) {
    calls.push(args.slice(0));
    /* Simulate the vendor table holding every direct prefix on wlan0. */
    return { code: 0, stdout: "blackhole 203.0.113.1 dev wlan0\n", stderr: "" };
  };
  var ok = rm.directRoutesActive({
    routingBackend: "policy",
    original: { device: "wlan0", gateway: "192.168.50.1" },
    policy: { table: 42761 },
  });
  var tableQueries = calls.filter(function (args) {
    return (
      args[0] === "route" &&
      args[1] === "show" &&
      args[2] === "table" &&
      args[3] === "42761"
    );
  });
  var exactShow = routesLib.DIRECT_BYPASS_ROUTES.filter(function (r) {
    return !r.probe;
  });
  record(
    "policy backend verifies direct prefixes inside its vendor table",
    ok &&
      tableQueries.length === exactShow.length &&
      calls.every(function (args) {
        /* probe lookups stay global; exact shows must be table-scoped */
        if (args[1] === "get") return true;
        return args.indexOf("table") >= 0 && args.indexOf("42761") >= 0;
      }),
    "tableQueries=" + tableQueries.length,
  );

  calls.length = 0;
  rm.directRoutesActive({
    routingBackend: "legacy",
    original: { device: "wlan0" },
  });
  record(
    "legacy backend keeps verifying against main (no table argument)",
    calls.every(function (args) {
      return args.indexOf("table") < 0;
    }),
  );
})();

/* --- rollback refuses to act without owned state --- */
(function () {
  var dir = tempDir();
  var rm = new routesLib.RouteManager({
    core: "xray",
    stateFile: path.join(dir, "absent-route.state"),
    ipBinary: "/sbin/ip",
  });
  var issued = [];
  rm.ip = function (args) {
    issued.push(args.join(" "));
    return { code: 1, stdout: "", stderr: "" };
  };
  rm.readDefaultRoute = function () {
    return { device: "wlan0", gateway: "192.168.50.1" };
  };
  rm.ip9 = null;
  /* physicalRestored uses route get; make it report restored via stub */
  rm.ip = function (args) {
    issued.push(args.join(" "));
    if (args[0] === "route" && args[1] === "get")
      return { code: 0, stdout: "9.9.9.9 via 192.168.50.1 dev wlan0\n" };
    return { code: 0, stdout: "", stderr: "" };
  };
  var result = rm.rollback();
  record(
    "rollback with no owned state issues no destructive commands",
    issued.every(function (text) {
      return text.indexOf("link delete") < 0 && text.indexOf("route del") < 0;
    }),
    JSON.stringify(issued),
  );
  record(
    "ownership-guarded rollback still reports physical path truthfully",
    result === true,
  );
})();

/* --- rollback with owned state still tears down its own objects --- */
(function () {
  var dir = tempDir();
  var stateFile = path.join(dir, "route.state");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      original: { gateway: "192.168.50.1", device: "wlan0" },
      serverAddresses: ["203.0.113.9"],
      directRoutes: {},
      ipv6Routes: {},
      routingBackend: "legacy",
    }),
  );
  var rm = new routesLib.RouteManager({
    core: "xray",
    stateFile: stateFile,
    ipBinary: "/sbin/ip",
  });
  var issued = [];
  rm.ip = function (args) {
    issued.push(args.join(" "));
    if (args[0] === "route" && args[1] === "get")
      return { code: 1, stdout: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  rm.readDefaultRoute = function () {
    return null; /* physical default gone -> physicalRestored false */
  };
  var result = rm.rollback();
  record(
    "owned teardown removes the edition interface and split routes",
    issued.some(function (t) {
      return t.indexOf("link delete alx0") >= 0;
    }) &&
      issued.some(function (t) {
        return t.indexOf("route del 128.0.0.0/1") >= 0;
      }),
  );
  record(
    "failed physical restore keeps rollback reporting failure",
    result === false,
  );
  record(
    "the state file survives a failed physical restore for re-rollback",
    fs.existsSync(stateFile),
  );
})();

/* --- cross-edition isolation: one edition never names the other's device --- */
(function () {
  var sb = new routesLib.RouteManager({
    core: "sing-box",
    stateFile: path.join(tempDir(), "route.state"),
    ipBinary: "",
  });
  record(
    "sing-box teardown can never issue commands against alx0",
    (function probe() {
      var bad = null;
      var orig = sb.ip;
      sb.ip = function (args) {
        if (args.indexOf("alx0") >= 0) bad = args.join(" ");
        return { code: 0, stdout: "", stderr: "" };
      };
      try {
        sb.rollback({ force: true });
      } catch (e) {}
      sb.ip = orig;
      return bad === null;
    })(),
  );
})();

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
