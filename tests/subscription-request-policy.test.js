"use strict";

var assert = require("assert");
var errors = require("../app/service/lib/errors");
var httpClient = require("../app/service/lib/net/http-client");
var subscriptions = require("../app/service/lib/net/subscriptions");

var URL = "https://provider.example.test/subscription";
var HWID = "0123456789abcdef0123456789abcdef";
var PROFILE =
  "vless://11111111-2222-3333-4444-555555555555@server.example.com:443#Server";
var realFetchUrl = httpClient.fetchUrl;

function restore() {
  httpClient.fetchUrl = realFetchUrl;
}

function fail(error) {
  restore();
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}

/* A rate limit is authoritative. Retrying with four more cosmetic identities
   only extends the ban and was the source of the visible request storm. */
var calls = 0;
httpClient.fetchUrl = function (url, options, callback) {
  calls++;
  process.nextTick(function () {
    callback(errors.err("RATE_LIMITED", "429", { status: 429 }));
  });
};
subscriptions.download(URL, function (error) {
  try {
    assert.ok(error);
    assert.strictEqual(error.code, "RATE_LIMITED");
    assert.strictEqual(calls, 1, "429 must stop the client-profile ladder");
    console.log("ok   - 429 stops after one request");
  } catch (e) {
    return fail(e);
  }

  /* Alternate User-Agents are useful only when a provider explicitly rejects
     the client application. */
  calls = 0;
  var userAgents = [];
  httpClient.fetchUrl = function (url, options, callback) {
    calls++;
    userAgents.push(options.headers["User-Agent"]);
    process.nextTick(function () {
      if (calls === 1)
        return callback(null, "<html>application not supported</html>", {});
      callback(null, PROFILE, {});
    });
  };
  subscriptions.download(URL, function (retryError, result) {
    try {
      assert.ifError(retryError);
      assert.strictEqual(calls, 2);
      assert.notStrictEqual(userAgents[0], userAgents[1]);
      assert.strictEqual(result.imported.length, 1);
      console.log("ok   - explicit client rejection advances one profile");
    } catch (e) {
      return fail(e);
    }

    /* Device identity is negotiated, not broadcast. The first request is
       minimal; an HTTPS provider can explicitly ask for HWID and receive one
       bounded retry with the sensitive headers. */
    calls = 0;
    httpClient.fetchUrl = function (url, options, callback) {
      calls++;
      try {
        if (calls === 1) {
          assert.strictEqual(options.headers["X-HWID"], undefined);
          return process.nextTick(function () {
            callback(null, "Turn on HWID to use this subscription", {});
          });
        }
        assert.strictEqual(options.headers["X-HWID"], HWID);
        assert.strictEqual(
          options.headers["User-Agent"],
          subscriptions.CLIENT_PROFILES[0].ua,
          "HWID retry must not collapse the client-profile identity",
        );
      } catch (e) {
        return fail(e);
      }
      process.nextTick(function () {
        callback(null, PROFILE, {});
      });
    };
    subscriptions.download(
      URL,
      function (hwidError, hwidResult) {
        try {
          assert.ifError(hwidError);
          assert.strictEqual(calls, 2);
          assert.strictEqual(hwidResult.imported.length, 1);
          console.log("ok   - HWID is sent only after an explicit request");
          restore();
          console.log("\nAll subscription request-policy tests passed cleanly.");
        } catch (e) {
          fail(e);
        }
      },
      { hwid: HWID },
    );
  });
});
