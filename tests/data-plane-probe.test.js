"use strict";

/* The external-IP check is a data-plane capability probe, not a dependency on
   one public service. A proxy that can carry HTTPS but is unable to reach one
   probe source must continue through the bounded source list and still accept
   only a valid IP response. */

var assert = require("assert");
var diagnostics = require("../app/service/lib/diagnostics.js");
var httpClient = require("../app/service/lib/net/http-client.js");

var originalFetch = httpClient.fetchUrl;
var calls = [];
var sourceCount = diagnostics.IP_CHECK_URLS.length;

assert.ok(
  sourceCount >= 3,
  "data-plane probe needs independent fallback sources",
);
assert.strictEqual(diagnostics.IP_CHECK_URLS[0], "https://ipinfo.io/ip");
diagnostics.IP_CHECK_URLS.forEach(function (url) {
  assert.strictEqual(
    url.indexOf("https://"),
    0,
    "IP probe sources stay HTTPS-only",
  );
});

httpClient.fetchUrl = function (url, options, callback) {
  calls.push(url);
  if (calls.length === 1)
    return callback(new Error("probe source unavailable"));
  if (calls.length === 2) return callback(null, "not-an-ip response");
  callback(null, "198.51.100.20\n");
};

new diagnostics.Diagnostics({}).externalIp(function (error, address) {
  httpClient.fetchUrl = originalFetch;
  assert.ifError(error);
  assert.strictEqual(address, "198.51.100.20");
  assert.strictEqual(
    calls.length,
    3,
    "probe stops at the first valid IP response",
  );
  assert.deepStrictEqual(calls, diagnostics.IP_CHECK_URLS.slice(0, 3));
  console.log("data-plane probe compatibility tests passed");
});
