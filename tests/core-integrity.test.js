"use strict";

/* Runtime core integrity: real release binaries, real SHA-256 pins and real
   atomic staging. No child process is executed. */

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var integrity = require(
  path.join(ROOT, "app", "service", "lib", "core-integrity.js"),
);
var provenance = require(path.join(ROOT, "cores", "provenance.json"));

var sources = {
  "alcyone-exec": path.join(ROOT, "build", "cores", "launcher", "alcyone-exec"),
  "alcyone-netguard": path.join(
    ROOT,
    "build",
    "cores",
    "netguard",
    "alcyone-netguard",
  ),
  xray: path.join(ROOT, "build", "cores", "xray", "xray"),
  tun2socks: path.join(ROOT, "build", "cores", "tun2socks", "tun2socks"),
  "sing-box": path.join(ROOT, "build", "cores", "sing-box", "sing-box"),
};

var recorded = {};
provenance.components.forEach(function (component) {
  recorded[component.name] = component.sha256;
});
assert.deepStrictEqual(
  integrity.PINNED_SHA256,
  recorded,
  "runtime checksum pins must exactly match the build provenance metadata",
);
console.log(
  "ok 1 - runtime SHA-256 pins match provenance for launcher, XRay, tun2socks and sing-box",
);

Object.keys(sources).forEach(function (name) {
  assert.ok(
    fs.existsSync(sources[name]),
    "missing generated test core: " + name,
  );
  assert.strictEqual(
    integrity.sha256File(sources[name]),
    integrity.PINNED_SHA256[name],
  );
});
console.log("ok 2 - every packaged candidate matches its pinned SHA-256");

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-core-integrity-"));
var staged = path.join(tmp, "bin", "tun2socks");
var packaged = sources.tun2socks;

assert.strictEqual(integrity.prepare(packaged, staged, "tun2socks"), staged);
assert.strictEqual(
  integrity.sha256File(staged),
  integrity.PINNED_SHA256.tun2socks,
);
if (process.platform !== "win32")
  assert.ok((fs.statSync(staged).mode & 73) !== 0);
console.log(
  "ok 3 - a missing staged core is atomically restored from a verified package core",
);

var damaged = fs.readFileSync(staged);
damaged[damaged.length - 1] = damaged[damaged.length - 1] ^ 1;
fs.writeFileSync(staged, damaged);
assert.strictEqual(
  fs.statSync(staged).size,
  fs.statSync(packaged).size,
  "fixture must reproduce the prior same-size staging bypass",
);
assert.strictEqual(integrity.prepare(packaged, staged, "tun2socks"), staged);
assert.strictEqual(
  integrity.sha256File(staged),
  integrity.PINNED_SHA256.tun2socks,
);
assert.ok(
  !fs.existsSync(staged + ".integrity-" + String(process.pid || 0) + ".tmp"),
);
console.log(
  "ok 4 - a same-size corrupt stage is replaced atomically and leaves no temporary file",
);

var badPackage = path.join(tmp, "bad-package");
fs.writeFileSync(badPackage, damaged);
assert.throws(
  function () {
    integrity.prepare(badPackage, staged, "tun2socks");
  },
  function (error) {
    return error && error.code === "CORE_INTEGRITY_FAILED";
  },
);
assert.strictEqual(
  integrity.sha256File(staged),
  integrity.PINNED_SHA256.tun2socks,
  "an invalid package must never overwrite a verified staged core",
);
console.log(
  "ok 5 - a packaged checksum mismatch fails closed without touching the stage",
);

damaged = fs.readFileSync(staged);
damaged[0] = damaged[0] ^ 1;
fs.writeFileSync(staged, damaged);
assert.throws(
  function () {
    integrity.verifyForLaunch(staged, "tun2socks");
  },
  function (error) {
    return error && error.code === "CORE_INTEGRITY_FAILED";
  },
);
console.log(
  "ok 6 - final pre-spawn verification rejects post-staging tampering",
);

var verifyCalls = [];
var managerLib = require(
  path.join(ROOT, "app", "service", "lib", "vpn", "manager.js"),
);
var editionLib = require(path.join(ROOT, "app", "service", "lib", "edition.js"));
assert.strictEqual(
  editionLib.paths({ dataDir: "/data" }, "/installed/application").launcher,
  "/installed/application/bin/alcyone-exec",
  "launcher path must follow the installed application payload",
);
var manager = new managerLib.VpnManager({
  edition: { core: "sing-box" },
  paths: {
    appDir: "/app",
    dataDir: "/data",
    tunnelLog: path.join(tmp, "tunnel.log"),
  },
  logger: { info: function () {}, warn: function () {}, error: function () {} },
  coreIntegrity: {
    prepare: function (source, target) {
      return target;
    },
    verifyForLaunch: function (file, name) {
      verifyCalls.push(name + ":" + file);
      throw require(path.join(ROOT, "app", "service", "lib", "errors.js")).err(
        "CORE_INTEGRITY_FAILED",
        name,
      );
    },
  },
});
manager.supervisor.start = function () {
  throw new Error("spawn must not be reached");
};
assert.throws(
  function () {
    manager.spawnLogged("sing-box", "/data/bin/sing-box", ["run"]);
  },
  function (error) {
    return error && error.code === "CORE_INTEGRITY_FAILED";
  },
);
assert.deepStrictEqual(verifyCalls, ["sing-box:/data/bin/sing-box"]);
console.log("ok 7 - VpnManager never passes an unverified final path to spawn");

var preparedLauncher = [];
var launchedThrough = "";
var launcherManager = new managerLib.VpnManager({
  edition: { core: "sing-box" },
  paths: { appDir: "/app", dataDir: "/data", tunnelLog: path.join(tmp, "launcher.log") },
  launcher: { executable: "/app/bin/alcyone-exec" },
  logger: { info: function () {}, warn: function () {}, error: function () {} },
  coreIntegrity: {
    prepare: function (source, target, name) {
      preparedLauncher.push(name + ":" + source + ":" + target);
      return target;
    },
    verifyForLaunch: function () {},
  },
});
launcherManager.supervisor.start = function (name, executable, args, options) {
  launchedThrough = options.launcher.executable;
  return { name: name, executable: executable };
};
launcherManager.spawnLogged("sing-box", "/data/bin/sing-box", ["run"], { captureOutput: false });
assert.deepStrictEqual(preparedLauncher, [
  "alcyone-exec:/app/bin/alcyone-exec:/data/bin/alcyone-exec",
]);
assert.strictEqual(launchedThrough, "/data/bin/alcyone-exec");
console.log("ok 8 - a non-executable package launcher is integrity-staged before spawn");

console.log("\nAll runtime core integrity checks passed.");
