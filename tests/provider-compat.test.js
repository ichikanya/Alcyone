"use strict";

var assert = require("assert");
var httpClient = require("../app/service/lib/net/http-client");
var subscriptions = require("../app/service/lib/net/subscriptions");
var loggerLib = require("../app/service/lib/logger");
var DeviceInfo = require("../app/service/lib/device-info");
var apiLib = require("../app/service/lib/api");
var storeLib = require("../app/service/lib/store/profiles");
var fs = require("fs");
var path = require("path");

var tmpDir = path.join(__dirname, "tmp-compat-test");
try {
  fs.mkdirSync(tmpDir);
} catch (e) {}
var storeFile = path.join(tmpDir, "profiles.json");
var logFile = path.join(tmpDir, "test.log");

try {
  fs.unlinkSync(storeFile);
} catch (e) {}
try {
  fs.unlinkSync(logFile);
} catch (e) {}

/* The import path is exercised against a local fixture rather than a live
   third-party panel. A mandatory release test must not depend on a subscription
   staying up or staying unexpired, and no real subscription URL belongs in the
   repository. Only the transport is stubbed; the compatibility headers, the
   client-profile ladder, the parser and the store are all real. */
var FIXTURE_URL = "https://fixture.example.test/provider-compat";
var NESTED_URL = "https://nested.fixture.example.test/list";
var FIXTURE_BODY = fs.readFileSync(
  path.join(__dirname, "fixtures", "subscription-active.txt"),
  "utf8",
);
var realFetchUrl = httpClient.fetchUrl;
httpClient.fetchUrl = function (url, options, callback) {
  if (url === NESTED_URL) {
    assert.strictEqual(
      options.headers["X-HWID"],
      undefined,
      "ordinary nested fetch must not acquire compatibility headers",
    );
    return process.nextTick(function () {
      callback(
        null,
        new Buffer(
          "vless://11111111-2222-3333-4444-555555555555@nested.example.com:443#Nested",
        ).toString("base64"),
      );
    });
  }
  if (url !== FIXTURE_URL) return realFetchUrl(url, options, callback);
  /* The negotiation always starts with a minimal request. Identity headers are
     added only if the provider explicitly asks for HWID. */
  assert.strictEqual(options.headers["X-HWID"], undefined);
  assert.strictEqual(options.headers["X-Device-OS"], undefined);
  process.nextTick(function () {
    callback(null, FIXTURE_BODY, {
      "content-type": "text/plain; charset=utf-8",
    });
  });
};

var logger = new loggerLib.Logger({ file: logFile });
var store = new storeLib.ProfileStore({ file: storeFile, logger: logger });
var deviceInfo = new DeviceInfo({ logger: logger });

var ctx = {
  store: store,
  logger: logger,
  deviceInfo: deviceInfo,
  edition: { id: "xray" },
};
var api = new apiLib.Api(ctx);

console.log("--- Provider Compatibility Unit Tests ---");

/* 1. DeviceInfo & HWID derivation */
deviceInfo.getHwid(function (err, hwid) {
  assert.ifError(err);
  assert.equal(typeof hwid, "string");
  assert.equal(hwid.length, 32);
  console.log("ok   - DeviceInfo generates 32-character HWID hash");

  /* 2. Headers verification: HTTPS + compatMode=true */
  var headersHttpsCompat = subscriptions.headersFor(0, {
    compatMode: true,
    isHttps: true,
    hwid: hwid,
    ua: "Happ/4.0.0/webOS",
    deviceOS: "webOS",
    verOS: "4.0.0",
    deviceModel: "OLED55",
  });
  assert.equal(headersHttpsCompat["X-HWID"], hwid);
  assert.equal(headersHttpsCompat["User-Agent"], "Happ/4.0.0/webOS");
  assert.equal(headersHttpsCompat["X-Device-OS"], "webOS");
  assert.equal(headersHttpsCompat["X-Ver-OS"], "4.0.0");
  assert.equal(headersHttpsCompat["X-Device-model"], "OLED55");
  console.log(
    "ok   - headersFor injects X-HWID and Happ metadata for HTTPS with compatMode=true",
  );

  /* 3. Headers verification: HTTP + compatMode=true (must NOT send HWID over plaintext HTTP) */
  var headersHttpCompat = subscriptions.headersFor(0, {
    compatMode: true,
    isHttps: false,
    hwid: hwid,
  });
  assert.strictEqual(headersHttpCompat["X-HWID"], undefined);
  assert.equal(
    headersHttpCompat["User-Agent"],
    subscriptions.CLIENT_PROFILES[0].ua,
  );
  console.log(
    "ok   - headersFor suppresses X-HWID for plaintext HTTP (HTTPS only policy)",
  );

  /* 4. Ordinary mode keeps device identity private. */
  var headersHttpsDefault = subscriptions.headersFor(0, {
    compatMode: false,
    isHttps: true,
    hwid: hwid,
  });
  assert.strictEqual(headersHttpsDefault["X-HWID"], undefined);
  assert.equal(
    headersHttpsDefault["User-Agent"],
    subscriptions.CLIENT_PROFILES[0].ua,
  );
  console.log("ok   - ordinary mode sends no device identity headers");

  /* 5. Log scrubbing */
  logger.info("testing hwid log scrub", {
    hwid: hwid,
    x_hwid: hwid,
    token: "secret-token",
  });
  var logContent = fs.readFileSync(logFile, "utf8");
  assert.strictEqual(logContent.indexOf(hwid), -1);
  assert.notStrictEqual(logContent.indexOf("[redacted]"), -1);
  console.log("ok   - Logger scrubs HWID and sensitive metadata");

  /* 6. Import in compatibility mode, against the local fixture. */
  api.addSubscription(
    { url: FIXTURE_URL, name: "Fixture Provider Test", compatMode: true },
    function (addErr, addRes) {
      assert.ifError(addErr);
      assert.strictEqual(
        addRes.count,
        15,
        "Compatibility-mode import must yield the fixture server set",
      );
      console.log(
        "ok   - subscription imported in compatibility mode with " +
          addRes.count +
          " profiles",
      );

      /* 7. Existing clients may still send false; it remains schema-compatible
       and starts with the same minimal request. */
      api.addSubscription(
        { url: FIXTURE_URL, name: "Ordinary Fixture Test", compatMode: false },
        function (ordinaryErr, ordinaryRes) {
          assert.ifError(ordinaryErr);
          assert.strictEqual(ordinaryRes.count, 15);
          console.log(
            "ok   - legacy compatMode=false request imports with minimal headers",
          );

          /* 8. Nested subscription downloads use the same explicit header set and
         retain safe stage metadata on failures. */
          subscriptions.expandNested(
            NESTED_URL,
            {
              headers: subscriptions.headersFor(0, {
                compatMode: false,
                isHttps: true,
              }),
              deadline: Date.now() + 1000,
            },
            function (nestedErr, nestedBody) {
              assert.ifError(nestedErr);
              assert.ok(nestedBody.indexOf("nested.example.com") >= 0);
              console.log(
                "ok   - nested subscription fetch preserves the secure ordinary request behavior",
              );

              /* Optional live check. Never release-blocking: it runs only when the
           operator supplies a URL at run time, the URL is never printed, and a
           failure is reported without failing the suite. */
              function done() {
                try {
                  fs.unlinkSync(storeFile);
                } catch (e) {}
                try {
                  fs.unlinkSync(logFile);
                } catch (e) {}
                try {
                  fs.rmdirSync(tmpDir);
                } catch (e) {}
                console.log(
                  "\nAll provider compatibility tests passed cleanly.",
                );
              }

              if (!process.env.ALCYONE_LIVE_SUBSCRIPTION_URL) return done();
              api.addSubscription(
                {
                  url: process.env.ALCYONE_LIVE_SUBSCRIPTION_URL,
                  name: "Live Provider Check",
                  compatMode: true,
                },
                function (liveErr, liveRes) {
                  if (liveErr)
                    console.log(
                      "# optional live compatibility check skipped: " +
                        liveErr.code,
                    );
                  else
                    console.log(
                      "# optional live compatibility check: " +
                        liveRes.count +
                        " profiles",
                    );
                  done();
                },
              );
            },
          );
        },
      );
    },
  );
});
