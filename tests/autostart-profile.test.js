"use strict";

/* Independent autostart selection is persisted as an opaque profile id and
   never follows the ordinary Home selection. */
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var storeLib = require("../app/service/lib/store/profiles");
var apiLib = require("../app/service/lib/api");
var logger = {
  info: function () {},
  warn: function () {},
  error: function () {},
};

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-autostart-profile-"));
var store = new storeLib.ProfileStore({
  file: path.join(dir, "profiles.json"),
});
assert.strictEqual(store.read().autostartProfileId, null);
var first = store.upsertManualProfile(
  "vless://11111111-2222-3333-4444-555555555555@one.example.com:443#One",
  "One",
).profile;
var second = store.upsertManualProfile(
  "trojan://password@two.example.com:443#Two",
  "Two",
).profile;
assert.strictEqual(store.read().activeId, second.id);
store.setAutostartProfile(first.id);
assert.strictEqual(store.read().autostartProfileId, first.id);
assert.strictEqual(store.read().activeId, second.id);
assert.strictEqual(store.sanitizedStore().autostartProfileId, first.id);

var enabled = false;
var context = {
  edition: {
    id: "xray",
    core: "xray",
    coreLabel: "XRay",
    title: "Alcyone XRay",
    version: "4.2.0",
    webPort: 8080,
  },
  store: store,
  autostart: {
    isEnabled: function () {
      return enabled;
    },
    set: function (value) {
      enabled = value;
    },
  },
  vpn: {
    status: function () {
      return { state: "idle", connected: false };
    },
  },
  logger: logger,
  pairing: {
    status: function () {
      return { pairingActive: false };
    },
  },
  localAddresses: function () {
    return [];
  },
};
var api = new apiLib.Api(context);
api.setAutostart({ enabled: true }, function (error) {
  assert.ifError(error);
});
assert.strictEqual(enabled, true);
api.setAutostart({ enabled: false }, function (error, result) {
  assert.ifError(error);
  assert.strictEqual(result.profileId, first.id);
});
assert.strictEqual(store.read().autostartProfileId, first.id);

store.deleteProfile(first.id);
assert.strictEqual(store.read().autostartProfileId, null);
api.setAutostart({ enabled: true }, function (error) {
  assert.strictEqual(error.code, "NO_AUTOSTART_PROFILE");
});

console.log("autostart profile contract passed");
