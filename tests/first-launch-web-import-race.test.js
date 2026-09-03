"use strict";

/* Regression test for Web Import first-launch race condition:

   - Verifies that Luna Service getState returns authoritative port and addresses.
   - Verifies that frontend refreshState preserves port and addresses when receiving getState responses.
   - Verifies that fallback ports (e.g. 8081) are properly returned and rendered.
   - Verifies that polling responses cannot wipe out the port or degrade the advertised URL to an IP-only string. */

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var apiLib = require("../app/service/lib/api");
var pairingLib = require("../app/service/lib/pairing");

/* ---------- 1. Backend Luna Service Test ---------- */

var pairing = new pairingLib.PairingManager();
var mockImporter = {
  boundPort: 8081,
  port: 8081,
  listen: function (lanEnabled, cb) {
    cb(null, { host: "0.0.0.0", port: 8081 });
  },
};

var ctx = {
  pairing: pairing,
  importer: mockImporter,
  edition: { id: "xray", webPort: 8080 },
  autostart: {
    isEnabled: function () {
      return false;
    },
  },
  store: {
    revision: function () {
      return "rev1";
    },
    read: function () {
      return { profiles: [], subscriptions: [] };
    },
  },
  vpn: {
    status: function () {
      return { connected: false };
    },
  },
  localAddresses: function () {
    return ["192.168.1.50"];
  },
};

var api = new apiLib.Api(ctx);

api.getState({}, function (err, state) {
  assert.ifError(err);
  assert.ok(state.lan, "getState must include lan section");
  assert.strictEqual(
    state.lan.port,
    8081,
    "getState must return the authoritative bound port (e.g. 8081 fallback)",
  );
  assert.deepEqual(
    state.lan.addresses,
    ["192.168.1.50"],
    "getState must return local addresses",
  );
  console.log(
    "ok   - getState includes authoritative bound port and local addresses",
  );
});

api.startPairing({ forceNew: false }, function (err, res) {
  assert.ifError(err);
  assert.strictEqual(
    res.port,
    8081,
    "startPairing must return actual bound port",
  );
  assert.deepEqual(
    res.addresses,
    ["192.168.1.50"],
    "startPairing must return local addresses",
  );
  console.log("ok   - startPairing returns actual bound port and addresses");
});

/* ---------- 2. Frontend Race Condition Test ---------- */

function Element(id) {
  this.id = id;
  this.textContent = "";
  this.innerHTML = "";
  this.attrs = {};
  this.style = {};
  this.classList = {
    contains: function () {
      return false;
    },
  };
}
Element.prototype.setAttribute = function (k, v) {
  this.attrs[k] = String(v);
};
Element.prototype.getAttribute = function (k) {
  return this.attrs[k] || null;
};
Element.prototype.removeAttribute = function (k) {
  delete this.attrs[k];
};

var elements = {};
function el(id) {
  if (!elements[id]) elements[id] = new Element(id);
  return elements[id];
}
[
  "stateText",
  "hint",
  "power",
  "current",
  "homeStage",
  "webUrl",
  "webHint",
  "webPairInfo",
  "webCode",
  "webExpiry",
  "pairState",
  "pairBox",
  "autostartState",
  "log",
  "count",
  "serverList",
  "pingServers",
  "refresh",
  "subUpdate",
  "search",
  "rowRestart",
  "rowCheckIp",
  "rowLang",
  "rowAutostart",
  "rowPair",
  "pairStart",
  "pairStop",
  "rowLogs",
  "rowAbout",
  "rowDonate",
  "rowDonate2",
  "logsRefresh",
  "clearLog",
  "freezeLog",
  "langState",
  "checkIpSub",
].forEach(el);

var document = {
  body: el("body"),
  getElementById: function (id) {
    return elements[id] || null;
  },
  querySelectorAll: function () {
    return [];
  },
  addEventListener: function () {},
};

var getStateResponse = {
  vpn: { connected: false },
  autostart: false,
  lan: {
    pairingActive: true,
    secondsRemaining: 298,
    sessions: 0,
    port: 8080,
    addresses: ["192.168.1.50"],
  },
};

var webOS = {
  service: {
    request: function (service, opts) {
      if (opts.method === "getState") opts.onSuccess(getStateResponse);
    },
  },
};

var window = {
  webOS: webOS,
  localStorage: {
    getItem: function () {
      return null;
    },
    setItem: function () {},
  },
  ALCYONE_EDITION: {
    appId: "com.alcyone.vpn",
    serviceId: "com.alcyone.vpn.service",
    core: "xray",
    version: "4.0.1",
  },
};

var vmContext = {
  window: window,
  webOS: webOS,
  document: document,
  navigator: { language: "en-US" },
  console: console,
  setTimeout: function () {
    return 0;
  },
  clearTimeout: function () {},
  setInterval: function () {
    return 0;
  },
  clearInterval: function () {},
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  btoa: function (v) {
    return Buffer.from(v).toString("base64");
  },
  atob: function (v) {
    return Buffer.from(v, "base64").toString();
  },
  escape: escape,
  unescape: unescape,
};

var appPath = path.join(__dirname, "..", "app", "app.js");
var appSource = fs
  .readFileSync(appPath, "utf8")
  .replace(
    /\}\)\(\);\s*$/,
    "window.__t = {\n" +
      "  renderPairing: vt,\n" +
      "  refreshState: nt,\n" +
      "  setPairing: function (p) { T = p; },\n" +
      "  getPairing: function () { return T; },\n" +
      "  webUrl: function () { return y; }\n" +
      "};\n})();",
  );
vm.runInNewContext(appSource, vmContext, { filename: appPath });
var t = vmContext.window.__t;

/* Simulate startPairing returning first */
t.setPairing({
  code: "ABCD-1234",
  port: 8080,
  addresses: ["192.168.1.50"],
  secondsRemaining: 300,
});
t.renderPairing();
assert.strictEqual(
  el("webUrl").textContent,
  "http://192.168.1.50:8080",
  "Initial startPairing must set complete URL",
);

/* Trigger refreshState with Luna getState response (first-launch race simulation) */
t.refreshState(function () {
  assert.strictEqual(
    t.getPairing().port,
    8080,
    "refreshState must preserve port",
  );
  assert.strictEqual(
    el("webUrl").textContent,
    "http://192.168.1.50:8080",
    "first-launch getState response must NOT degrade URL to IP-only",
  );
  console.log(
    "ok   - first-launch race condition resolved: complete URL http://192.168.1.50:8080 maintained",
  );
});

/* Test fallback port 8081 rendering */
t.setPairing({
  code: "WXYZ-9876",
  port: 8081,
  addresses: ["192.168.1.50"],
  secondsRemaining: 250,
});
t.renderPairing();
assert.strictEqual(
  el("webUrl").textContent,
  "http://192.168.1.50:8081",
  "Fallback port 8081 rendered correctly in URL",
);
console.log("ok   - fallback port 8081 rendered correctly");

console.log("\nAll first-launch Web Import race tests passed cleanly.");
