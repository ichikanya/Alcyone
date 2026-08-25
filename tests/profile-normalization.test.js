"use strict";

/* Focused regression coverage for profile-store normalization. */

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var storeLib = require("../app/service/lib/store/profiles.js");

var LINK =
  "vless://11111111-2222-3333-4444-555555555555@vpn.example.test:443?security=tls#Test";
var FULL_CONFIG = {
  inbounds: [{ tag: "source-in", protocol: "socks", port: 1080 }],
  outbounds: [
    {
      tag: "proxy",
      protocol: "vless",
      settings: {
        vnext: [
          {
            address: "vpn.example.test",
            port: 443,
            users: [
              {
                id: "11111111-2222-3333-4444-555555555555",
                encryption: "none",
              },
            ],
          },
        ],
      },
    },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tempStore(contents) {
  var dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "alcyone-profile-normalize-"),
  );
  var file = path.join(dir, "profiles.json");
  fs.writeFileSync(file, JSON.stringify(contents));
  return { file: file, store: new storeLib.ProfileStore({ file: file }) };
}

var normalized = storeLib.normalize({
  profiles: [
    { id: "link-profile", link: LINK, name: "Link profile" },
    {
      id: "config-profile",
      fullConfig: clone(FULL_CONFIG),
      name: "Config profile",
      sourceKey: "full|one",
    },
  ],
  subscriptions: [],
  activeId: "config-profile",
});

assert.strictEqual(
  normalized.profiles.length,
  2,
  "valid profiles must survive normalization",
);
assert.strictEqual(
  normalized.profiles[0].id,
  "link-profile",
  "a valid link-based profile must survive",
);
assert.strictEqual(
  normalized.profiles[1].id,
  "config-profile",
  "a valid fullConfig profile must survive without a link",
);

normalized = storeLib.normalize({
  profiles: [
    null,
    {},
    { id: "" },
    { id: "../../bad", link: LINK },
    { id: "missing-payload" },
    { id: "bad-link", link: "ftp://vpn.example.test" },
    { id: "malformed-config", fullConfig: { inbounds: {}, outbounds: [] } },
    { id: "empty-config", fullConfig: { inbounds: [], outbounds: [] } },
  ],
  subscriptions: [],
  activeId: "bad-link",
});
assert.strictEqual(
  normalized.profiles.length,
  0,
  "malformed and empty profiles must still be removed",
);
assert.strictEqual(
  normalized.activeId,
  null,
  "an invalid active profile must be cleared",
);

var restartFixture = tempStore({
  profiles: [
    {
      id: "active-config",
      fullConfig: clone(FULL_CONFIG),
      name: "Active config",
      sourceKey: "full|restart",
    },
  ],
  subscriptions: [],
  activeId: "active-config",
});
var beforeRestart = restartFixture.store.activeProfile();
var afterRestart = new storeLib.ProfileStore({
  file: restartFixture.file,
}).activeProfile();
assert.strictEqual(
  beforeRestart && beforeRestart.id,
  "active-config",
  "the active fullConfig profile must be readable",
);
assert.strictEqual(
  afterRestart && afterRestart.id,
  "active-config",
  "the active profile must remain valid after service restart",
);

var refreshFixture = tempStore({
  profiles: [
    {
      id: "imported-active",
      fullConfig: clone(FULL_CONFIG),
      name: "Imported config",
      sourceKey: "xray|id|imported",
      sourceType: "subscription",
      subscriptionId: "subscription-one",
      subscriptionName: "Existing subscription",
    },
  ],
  subscriptions: [
    {
      id: "subscription-one",
      url: "https://subscription.example.test/path",
      name: "Existing subscription",
    },
  ],
  activeId: "imported-active",
});
var refreshResult = refreshFixture.store.applySubscription(
  "https://subscription.example.test/path",
  "Existing subscription",
  [
    {
      link: LINK,
      protocol: "vless",
      name: "Imported config",
      sourceKey: "xray|id|imported",
      fullConfig: clone(FULL_CONFIG),
    },
  ],
  {},
  {},
);
assert.strictEqual(
  refreshResult.store.profiles.length,
  1,
  "subscription refresh must keep the imported profile",
);
assert.strictEqual(
  refreshResult.store.profiles[0].id,
  "imported-active",
  "subscription refresh must preserve the imported profile id",
);
assert.strictEqual(
  refreshResult.store.activeId,
  "imported-active",
  "subscription refresh must preserve the active selection",
);
assert.ok(
  refreshFixture.store.activeProfile(),
  "the refreshed imported profile must remain active on the next read",
);

console.log("Profile normalization regression tests passed.");
