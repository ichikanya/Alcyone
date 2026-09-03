"use strict";

/* Listener-scope regression checks. The HTTP request/authentication contract is
   covered end-to-end in lan-importer.test.js; this suite pins the bind lifecycle
   that cannot be observed through its manually created loopback harness. */

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var pairingLib = require(
  path.join(ROOT, "app", "service", "lib", "pairing.js"),
);
var serverLib = require(
  path.join(ROOT, "app", "service", "lib", "web", "server.js"),
);

var now = 1000;
var pairing = new pairingLib.PairingManager({
  now: function () {
    return now;
  },
  logger: { info: function () {}, warn: function () {}, error: function () {} },
});
var server = new serverLib.ImporterServer({
  pairing: pairing,
  store: {
    sanitizedProfiles: function () {
      return [];
    },
    sanitizedSubscriptions: function () {
      return [];
    },
  },
  logger: { info: function () {}, warn: function () {}, error: function () {} },
  port: 0,
});

var serviceSource = fs.readFileSync(
  path.join(ROOT, "app", "service", "service.js"),
  "utf8",
);
assert.ok(
  /importer\.listen\((?:false|!1),/.test(serviceSource),
  "service startup must explicitly select the loopback listener",
);
console.log("ok 1 - service startup is loopback-only by default");

server.listen(false, function (loopbackError) {
  assert.ifError(loopbackError);
  assert.strictEqual(server.boundHost, "127.0.0.1");
  console.log("ok 2 - default listener binds only to 127.0.0.1");

  server.listen(true, function (closedLanError) {
    assert.ifError(closedLanError);
    assert.strictEqual(
      server.boundHost,
      "127.0.0.1",
      "listen(true) without temporary access must remain loopback-only",
    );
    console.log(
      "ok 3 - LAN bind cannot be enabled without an active temporary window",
    );

    var opened = pairing.enable(100);
    server.listen(true, function (lanError) {
      assert.ifError(lanError);
      assert.strictEqual(server.boundHost, "0.0.0.0");
      assert.ok(pairing.accessActive());
      console.log(
        "ok 4 - explicit pairing activation temporarily enables LAN scope",
      );

      var session = pairing.redeem(opened.code, "127.0.0.1");
      session.expiresAt = now + 100;
      now += 101;
      assert.strictEqual(pairing.accessActive(), false);

      server.enforceExposure(function (expiryError) {
        assert.ifError(expiryError);
        assert.strictEqual(server.boundHost, "127.0.0.1");
        console.log(
          "ok 5 - expired pairing/session access automatically returns to loopback",
        );
        server.close(function () {
          console.log("\nAll LAN listener-scope checks passed.");
        });
      });
    });
  });
});
