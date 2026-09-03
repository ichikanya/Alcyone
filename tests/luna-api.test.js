"use strict";

/* Contract tests for the Luna method layer.

   Verifies that every method validates its input, rejects unknown fields,
   returns structured error codes, and never returns stored secrets. The VPN
   manager and importer are stubbed so the tests stay hermetic. */

var os = require("os");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var apiLib = require(path.join(ROOT, "app", "service", "lib", "api.js"));
var storeLib = require(
  path.join(ROOT, "app", "service", "lib", "store", "profiles.js"),
);
var pairingLib = require(
  path.join(ROOT, "app", "service", "lib", "pairing.js"),
);
var loggerLib = require(path.join(ROOT, "app", "service", "lib", "logger.js"));

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

var SECRET_UUID = "11111111-2222-3333-4444-555555555555";
var SECRET_PASSWORD = "trojanSecret42";
var SECRET_SUB = "https://panel.example.com/sub/TOKENSECRET";

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-api-"));
var store = new storeLib.ProfileStore({
  file: path.join(dir, "profiles.json"),
});
store.upsertManualProfile(
  "vless://" +
    SECRET_UUID +
    "@a.example.com:443?security=reality&pbk=PUBKEY#NL",
  "NL",
);
store.upsertManualProfile(
  "trojan://" + SECRET_PASSWORD + "@b.example.com:443#DE",
  "DE",
);
store.applySubscription(
  SECRET_SUB,
  "Sub",
  [
    {
      link: "vless://" + SECRET_UUID + "@c.example.com:443#S1",
      protocol: "vless",
      name: "S1",
    },
  ],
  {},
);

var logger = new loggerLib.Logger({ file: path.join(dir, "service.log") });
var autostartEnabled = false;

var context = {
  edition: {
    id: "xray",
    core: "xray",
    coreLabel: "XRay",
    title: "Alcyone XRay",
    version: "3.2.1",
    webPort: 8080,
  },
  logger: logger,
  store: store,
  pairing: new pairingLib.PairingManager({ logger: logger }),
  vpn: {
    connected: false,
    verified: false,
    status: function () {
      return {
        state: this.connected ? "connected" : "idle",
        connected: this.connected,
        connectedAt: 0,
        dataPlaneVerified: this.verified,
        profileId: "",
        lastErrorCode: "",
        ownsTunnel: false,
        tunnelOwner: "",
        routes: { routeActive: true, directBypassActive: true },
      };
    },
    connect: function (cb) {
      this.connected = true;
      cb(null, { state: "connected" });
    },
    disconnect: function (cb) {
      this.connected = false;
      cb(null, { state: "idle" });
    },
  },
  autostart: {
    isEnabled: function () {
      return autostartEnabled;
    },
    set: function (v) {
      autostartEnabled = v;
      return true;
    },
  },
  diagnostics: {
    probeProfiles: function (cb) {
      cb(null, [{ id: "p1", latencyMs: 42 }]);
    },
    externalIp: function (cb) {
      cb(null, "203.0.113.7");
    },
  },
  importer: {
    listen: function (lan, cb) {
      cb(null, {});
    },
  },
  localAddresses: function () {
    return ["192.168.1.50"];
  },
};

var api = new apiLib.Api(context);

function call(method, payload, cb) {
  api[method](payload, cb);
}

function expectError(name, method, payload, expectedCode) {
  call(method, payload, function (error) {
    record(
      name,
      !!error && (!expectedCode || error.code === expectedCode),
      error ? error.code : "no error",
    );
  });
}

/* --- unknown field rejection across every method that takes a payload --- */
expectError(
  "getState rejects unknown fields",
  "getState",
  { bogus: 1 },
  "UNKNOWN_FIELD",
);
expectError(
  "getProfiles rejects unknown fields",
  "getProfiles",
  { bogus: 1 },
  "UNKNOWN_FIELD",
);
expectError(
  "connect rejects unknown fields",
  "connect",
  { bogus: 1 },
  "UNKNOWN_FIELD",
);
expectError(
  "disconnect rejects unknown fields",
  "disconnect",
  { bogus: 1 },
  "UNKNOWN_FIELD",
);
expectError(
  "selectProfile rejects unknown fields",
  "selectProfile",
  { profileId: "x", bogus: 1 },
  "UNKNOWN_FIELD",
);
expectError(
  "setAutostart rejects unknown fields",
  "setAutostart",
  { enabled: true, bogus: 1 },
  "UNKNOWN_FIELD",
);

/* --- type and value validation --- */
expectError(
  "selectProfile requires a profile id",
  "selectProfile",
  {},
  "MISSING_FIELD",
);
expectError(
  "selectProfile rejects a traversal id",
  "selectProfile",
  { profileId: "../../etc/passwd" },
  "INVALID_PROFILE_ID",
);
expectError(
  "deleteProfile rejects an unknown profile",
  "deleteProfile",
  { profileId: "doesnotexist" },
  "PROFILE_NOT_FOUND",
);
expectError(
  "importLink rejects a non-proxy scheme",
  "importLink",
  { link: "file:///etc/passwd" },
  "INVALID_LINK",
);
expectError(
  "importLink rejects a shell metacharacter payload",
  "importLink",
  { link: "vless://x; rm -rf /" },
  "INVALID_LINK",
);
expectError(
  "addSubscription rejects a non-http url",
  "addSubscription",
  { url: "file:///etc/passwd" },
  "INVALID_URL",
);
expectError(
  "addSubscription rejects url credentials",
  "addSubscription",
  { url: "https://u:p@example.com/s" },
  "URL_CREDENTIALS_REJECTED",
);
expectError(
  "setLanguage rejects an unknown language",
  "setLanguage",
  { lang: "xx" },
  "INVALID_LANG",
);
expectError(
  "setAutostart rejects a non-boolean",
  "setAutostart",
  { enabled: "yes" },
  "INVALID_PARAMS",
);
expectError(
  "deleteSubscription rejects an unknown id",
  "deleteSubscription",
  { subscriptionId: "nope" },
  "SUBSCRIPTION_NOT_FOUND",
);
expectError(
  "updateSubscriptions rejects an unknown id",
  "updateSubscriptions",
  { subscriptionId: "nope" },
  "SUBSCRIPTION_NOT_FOUND",
);

/* --- secret-free responses --- */
var SECRETS = [
  SECRET_UUID,
  SECRET_PASSWORD,
  SECRET_SUB,
  "PUBKEY",
  "TOKENSECRET",
  "vless://",
  "trojan://",
];
function assertNoSecrets(name, method, payload) {
  call(method, payload, function (error, result) {
    var text = JSON.stringify(result || {});
    var leaks = SECRETS.filter(function (s) {
      return text.indexOf(s) >= 0;
    });
    record(
      name,
      !error && leaks.length === 0,
      error ? error.code : leaks.join(","),
    );
  });
}
assertNoSecrets("getProfiles returns no secrets", "getProfiles", {});
assertNoSecrets("getState returns no secrets", "getState", {});
assertNoSecrets("getLogs returns no secrets", "getLogs", {});
assertNoSecrets("probeProfiles returns no secrets", "probeProfiles", {});

/* --- happy paths --- */
call("getProfiles", {}, function (error, result) {
  record(
    "getProfiles lists stored profiles",
    !error && result.profiles.length === 3,
    error ? error.code : String(result && result.profiles.length),
  );
  record(
    "getProfiles exposes display metadata",
    !error && !!result.profiles[0].name && !!result.profiles[0].protocol,
  );
});

call("getState", {}, function (error, result) {
  record(
    "getState reports edition and lan state",
    !error &&
      result.edition.id === "xray" &&
      result.lan.pairingActive === false,
    error ? error.code : "",
  );
});

context.vpn.connected = true;
call("checkExternalIp", {}, function (error, result) {
  record(
    "external IP is not labelled as VPN traffic before data-plane verification",
    !error && result.address === "203.0.113.7" && result.viaVpn === false,
  );
});
context.vpn.verified = true;
call("checkExternalIp", {}, function (error, result) {
  record(
    "external IP is labelled as VPN traffic only after route and data-plane verification",
    !error && result.viaVpn === true,
  );
});
context.vpn.connected = false;
context.vpn.verified = false;

context.store.setAutostartProfile(context.store.read().profiles[0].id);
call("setAutostart", { enabled: true }, function (error, result) {
  record(
    "setAutostart enables autostart",
    !error && result.enabled === true,
    error ? error.code : "",
  );
});

call("setLanguage", { lang: "ru" }, function (error) {
  record(
    "setLanguage accepts a supported language",
    !error,
    error ? error.code : "",
  );
});

call("startPairing", {}, function (error, result) {
  var code1 = result ? result.code : "";
  record(
    "startPairing returns a code for the TV screen",
    !error && typeof code1 === "string" && code1.length === 8,
    error ? error.code : "",
  );
  record(
    "startPairing reports the LAN address and port",
    !error && result.port === 8080 && result.addresses.length === 1,
  );
  call("getState", {}, function (stateError, state) {
    record(
      "pairing window shows as active in state",
      !stateError && state.lan.pairingActive === true,
    );
    call("startPairing", {}, function (reError, reResult) {
      record(
        "startPairing reuses active code when forceNew is omitted",
        !reError && reResult.code === code1,
        reError ? reError.code : "",
      );
      call(
        "startPairing",
        { forceNew: true },
        function (forceError, forceResult) {
          record(
            "startPairing generates new code when forceNew is true",
            !forceError &&
              typeof forceResult.code === "string" &&
              forceResult.code.length === 8,
            forceError ? forceError.code : "",
          );
          call("stopPairing", {}, function (stopError, stopResult) {
            record(
              "stopPairing closes the window",
              !stopError && stopResult.pairingActive === false,
            );
            finish();
          });
        },
      );
    });
  });
});

function finish() {
  var passed = results.filter(Boolean).length;
  console.log("\n" + passed + "/" + results.length + " checks passed");
  if (passed !== results.length) process.exit(1);
}
