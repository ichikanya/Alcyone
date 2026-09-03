"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var httpClient = require("../app/service/lib/net/http-client");
var subscriptions = require("../app/service/lib/net/subscriptions");
var storeLib = require("../app/service/lib/store/profiles");
var apiLib = require("../app/service/lib/api");
var DeviceInfo = require("../app/service/lib/device-info");

var URL = "https://provider.example.test/subscription";
var HWID = "0123456789abcdef0123456789abcdef";
var PROFILE =
  "vless://11111111-2222-3333-4444-555555555555@server.example.com:443#Server";
var PROFILE2 =
  "vless://11111111-2222-3333-4444-555555555555@server2.example.com:443#Server2";
var realFetchUrl = httpClient.fetchUrl;

function downloadWith(responses, options, callback) {
  var calls = [];
  httpClient.fetchUrl = function (url, request, done) {
    calls.push(request);
    var response = responses.shift();
    process.nextTick(function () {
      if (response && response.error) return done(response.error);
      done(null, response && response.body, {});
    });
  };
  subscriptions.download(URL, function (error, result) {
    httpClient.fetchUrl = realFetchUrl;
    callback(error, result, calls);
  }, options || {});
}

downloadWith(
  [
    {
      body:
        PROFILE.replace("#Server", "#Приложение не поддерживается"),
    },
    { body: PROFILE + "\n" + PROFILE2 },
  ],
  { hwid: HWID },
  function (error, result, calls) {
    assert.ifError(error);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].headers["x-hwid"], undefined);
    assert.strictEqual(calls[1].headers["x-client"], "INCY");
    assert.strictEqual(calls[1].headers["x-hwid"], HWID);
    assert.strictEqual(result.imported.length, 2);
    console.log("ok   - unsupported client placeholder advances to INCY headers");

    downloadWith(
      [{ body: PROFILE + "\n" + PROFILE2 }],
      { hwid: HWID },
      function (anonymousError, anonymousResult, anonymousCalls) {
        assert.ifError(anonymousError);
        assert.strictEqual(anonymousCalls.length, 1);
        assert.strictEqual(anonymousCalls[0].headers["x-hwid"], undefined);
        assert.strictEqual(anonymousResult.imported.length, 2);
        console.log("ok   - genuine anonymous response does not broadcast HWID");

        downloadWith(
          [
            {
              body: PROFILE.replace(
                "#Server",
                "#Достигнут предел количества устройств",
              ),
            },
            { body: PROFILE },
          ],
          { hwid: HWID, providerHwid: "incy-provider-hwid" },
          function (overrideError, overrideResult, overrideCalls) {
            assert.ifError(overrideError);
            assert.strictEqual(overrideCalls.length, 2);
            assert.strictEqual(overrideCalls[0].headers["x-client"], "INCY");
            assert.strictEqual(
              overrideCalls[0].headers["x-hwid"],
              "incy-provider-hwid",
            );
            assert.strictEqual(overrideCalls[1].headers["x-hwid"], undefined);
            assert.deepStrictEqual(
              overrideResult.warnings,
              ["PROVIDER_HWID_REJECTED"],
            );
            console.log("ok   - rejected provider HWID falls back without leaking it");

            downloadWith(
              [
                {
                  body: PROFILE.replace("#Server", "#Подписка неактивна"),
                },
              ],
              { hwid: HWID },
              function (statusError, statusResult, statusCalls) {
                assert.ifError(statusError);
                assert.strictEqual(statusCalls.length, 1);
                assert.strictEqual(statusResult.imported.length, 1);
                assert.strictEqual(
                  statusResult.imported[0].name,
                  "Подписка неактивна",
                );
                console.log("ok   - provider status profile remains importable");

                downloadWith(
                  [{ body: PROFILE + "\n{\"type\":\"tuic\"}" }],
                  { hwid: HWID },
                  function (mixedError, mixedResult) {
                    assert.ifError(mixedError);
                    assert.strictEqual(mixedResult.imported.length, 1);
                    assert.strictEqual(mixedResult.unsupportedProtocols.tuic, 1);
                    console.log("ok   - mixed unsupported protocol is skipped with a reason");
                    downloadWith(
                      [{ body: "wireguard://unsupported.example.test/profile" }],
                      { hwid: HWID },
                      function (unsupportedError) {
                        assert.ok(unsupportedError);
                        assert.strictEqual(
                          unsupportedError.code,
                          "UNSUPPORTED_SUBSCRIPTION_PROTOCOL",
                        );
                        console.log("ok   - unsupported subscription protocol is explicit");
                        finishStoreChecks();
                      },
                    );
                  },
                );
              },
            );
          },
        );
      },
    );
  },
);

function finishStoreChecks() {
  var tmpDir = path.join(__dirname, "tmp-incy-test");
  var storeFile = path.join(tmpDir, "profiles.json");
  var identityFile = path.join(tmpDir, "device-identity.json");
  try {
    fs.mkdirSync(tmpDir);
  } catch (e) {}
  try {
    fs.unlinkSync(storeFile);
  } catch (e) {}
  try {
    fs.unlinkSync(identityFile);
  } catch (e) {}

  var store = new storeLib.ProfileStore({ file: storeFile });
  var applied = store.applySubscription(
    URL,
    "Test",
    [{ link: PROFILE, protocol: "vless", name: "Server" }],
    {},
    { providerHwid: "provider-id" },
  );
  assert.strictEqual(store.sanitizedSubscriptions()[0].hasProviderHwid, true);
  assert.strictEqual(
    JSON.stringify(store.sanitizedSubscriptions()).indexOf("provider-id"),
    -1,
  );

  var api = new apiLib.Api({ store: store });
  api.setSubscriptionHwid(
    { subscriptionId: applied.subscription.id, providerHwid: "" },
    function (error, result) {
      assert.ifError(error);
      assert.strictEqual(result.hasProviderHwid, false);
      assert.strictEqual(store.sanitizedSubscriptions()[0].hasProviderHwid, false);
      api.setSubscriptionHwid(
        {
          subscriptionId: applied.subscription.id,
          providerHwid: "bad\nheader",
        },
        function (invalidError) {
          assert.ok(invalidError);
          assert.strictEqual(invalidError.code, "INVALID_PARAMS");
          var first = new DeviceInfo({ identityFile: identityFile });
          var firstHwid = first.getHwidSync();
          var second = new DeviceInfo({ identityFile: identityFile });
          assert.strictEqual(second.getHwidSync(), firstHwid);
          console.log("ok   - per-subscription HWID storage and stable identity are secret-safe");
          try {
            fs.unlinkSync(storeFile);
            fs.unlinkSync(identityFile);
            fs.rmdirSync(tmpDir);
          } catch (e) {}
          console.log("\nINCY subscription negotiation tests passed cleanly.");
        },
      );
    },
  );
}
