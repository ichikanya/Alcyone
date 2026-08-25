"use strict";

var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Migrator = require("../app/service/lib/migrate").Migrator;
var VpnManager = require("../app/service/lib/vpn/manager").VpnManager;
var xrayAssets = require("../app/service/lib/xray-assets");
var serviceSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "service", "service.js"),
  "utf8",
);

assert.ok(
  /path\.resolve\(__dirname,\s*['"]\.\.['"],\s*['"]\.\.['"],\s*['"]applications['"],\s*edition\.appId\)/.test(
    serviceSource,
  ),
  "service appDir must resolve to the sibling installed application",
);

function mkdir(dir) {
  if (fs.existsSync(dir)) return;
  mkdir(path.dirname(dir));
  fs.mkdirSync(dir);
}

function removeTree(target) {
  var stat, names, i;
  if (!fs.existsSync(target)) return;
  stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    fs.unlinkSync(target);
    return;
  }
  names = fs.readdirSync(target);
  for (i = 0; i < names.length; i++) removeTree(path.join(target, names[i]));
  fs.rmdirSync(target);
}

function hash(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

var root = path.join(
  os.tmpdir(),
  "alcyone-xray-assets-" + process.pid + "-" + Date.now(),
);
var appDir = path.join(root, "app");
var dataDir = path.join(root, "data");
var appBin = path.join(appDir, "bin");
var dataBin = path.join(dataDir, "bin");
var staged = path.join(__dirname, "..", "build", "cores", "xray");
var logger = {
  info: function () {},
  warn: function () {},
  error: function () {},
};
var paths = {
  appDir: appDir,
  dataDir: dataDir,
  storeFile: path.join(dataDir, "profiles.json"),
  stateFile: path.join(dataDir, "service-state.json"),
  routeState: path.join(dataDir, "route.state"),
  configFile: path.join(dataDir, "core-config.json"),
  tunnelLog: path.join(dataDir, "tunnel.log"),
};
var edition = { core: "xray", appId: "com.alcyone.vpn", id: "xray" };
var migrator;

try {
  mkdir(appBin);
  fs.writeFileSync(path.join(appBin, "xray"), "packaged-xray");
  fs.writeFileSync(path.join(appBin, "tun2socks"), "packaged-tun2socks");
  fs.chmodSync(path.join(appBin, "xray"), 493);
  fs.chmodSync(path.join(appBin, "tun2socks"), 493);
  fs.copyFileSync(
    path.join(staged, "geosite.dat"),
    path.join(appBin, "geosite.dat"),
  );
  fs.copyFileSync(
    path.join(staged, "geoip.dat"),
    path.join(appBin, "geoip.dat"),
  );

  migrator = new Migrator({ paths: paths, edition: edition, logger: logger });
  migrator.ensureLayout();

  /* A same-size persisted executable is deliberately retained: adding assets
     must not change the established binary installation policy. */
  fs.writeFileSync(path.join(dataBin, "xray"), "persisted-xra");
  assert.strictEqual(
    fs.statSync(path.join(dataBin, "xray")).size,
    fs.statSync(path.join(appBin, "xray")).size,
  );
  migrator.installBundledCores();
  assert.strictEqual(
    fs.readFileSync(path.join(dataBin, "xray"), "utf8"),
    "persisted-xra",
  );
  assert.strictEqual(
    fs.readFileSync(path.join(dataBin, "tun2socks"), "utf8"),
    "packaged-tun2socks",
  );

  assert.deepStrictEqual(migrator.installBundledXrayAssets(), [
    "geoip.dat",
    "geosite.dat",
  ]);
  Object.keys(xrayAssets.ASSETS).forEach(function (name) {
    var target = path.join(dataBin, name);
    assert.strictEqual(hash(target), xrayAssets.ASSETS[name].sha256);
    assert.strictEqual(fs.statSync(target).mode & 73, 0);
  });

  fs.writeFileSync(path.join(dataBin, "geosite.dat"), "corrupt");
  assert.deepStrictEqual(migrator.installBundledXrayAssets(), ["geosite.dat"]);
  assert.strictEqual(
    hash(path.join(dataBin, "geosite.dat")),
    xrayAssets.ASSETS["geosite.dat"].sha256,
  );

  fs.unlinkSync(path.join(dataBin, "geosite.dat"));
  var manager = new VpnManager({
    edition: edition,
    paths: paths,
    logger: logger,
    lock: {},
    store: {
      activeProfile: function () {
        return {
          id: "asset-test",
          fullConfig: {
            outbounds: [{ protocol: "freedom", tag: "direct" }],
            routing: {
              rules: [
                {
                  type: "field",
                  domain: ["geosite:private"],
                  outboundTag: "direct",
                },
              ],
            },
          },
        };
      },
    },
  });
  manager.resolveCores = function () {
    return {
      xray: path.join(dataBin, "xray"),
      tun2socks: path.join(dataBin, "tun2socks"),
    };
  };
  /* Discovery is stubbed here on purpose: this suite pins the *config-driven*
     asset verification inside connect(), which reports ASSET_MISSING and the
     legacy ASSET_CORRUPT for the assets a specific profile actually
     references. The installation health gate is a separate, earlier check with
     its own ordering, and it would otherwise reject this synthetic tree (dummy
     text cores, no appinfo.json) before the code under test ran. The gate is
     covered by tests/elevation-and-health.test.js. */
  manager.checkHealth = function () {
    return null;
  };
  manager.resolveEndpoints = function (profile, callback) {
    callback(null, {
      entries: [
        {
          host: "redacted.test",
          addresses: ["93.184.216.34"],
          targets: [{ port: 443, network: "tcp" }],
        },
      ],
      addresses: ["93.184.216.34"],
      map: { "redacted.test": ["93.184.216.34"] },
    });
  };
  manager.connect(function (missing) {
    assert.ok(missing);
    assert.strictEqual(missing.code, "ASSET_MISSING");
    assert.ok(missing.detail.indexOf(path.join(dataBin, "geosite.dat")) >= 0);
  });

  fs.writeFileSync(path.join(dataBin, "geosite.dat"), "corrupt");
  manager.connect(function (corrupt) {
    assert.ok(corrupt);
    assert.strictEqual(corrupt.code, "ASSET_CORRUPT");
  });

  assert.deepStrictEqual(
    xrayAssets.referenced({
      routing: {
        rules: [{ domain: ["geosite:private"] }, { ip: ["geoip:private"] }],
      },
    }),
    ["geoip.dat", "geosite.dat"],
  );
  console.log(
    "ok - pinned Xray assets install, verify, repair, and fail precisely",
  );
} finally {
  removeTree(root);
}
