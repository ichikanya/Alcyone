"use strict";

/* End-to-end checks for the LAN importer HTTP surface.

   Drives the real server over a loopback socket and asserts the security
   contract: default-closed access, pairing before anything else, CSRF on every
   mutation, no wildcard CORS, and responses that never contain stored
   secrets. */

var http = require("http");
var os = require("os");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var serverLib = require(
  path.join(ROOT, "app", "service", "lib", "web", "server.js"),
);
var pairingLib = require(
  path.join(ROOT, "app", "service", "lib", "pairing.js"),
);
var storeLib = require(
  path.join(ROOT, "app", "service", "lib", "store", "profiles.js"),
);
var errors = require(path.join(ROOT, "app", "service", "lib", "errors.js"));

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

var SECRET_UUID = "11111111-2222-3333-4444-555555555555";
var SECRET_PASSWORD = "tr0janSecretPw";
var SECRET_SUB_URL = "https://panel.example.com/sub/SECRETTOKEN123";

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "alcyone-web-"));
var store = new storeLib.ProfileStore({
  file: path.join(dir, "profiles.json"),
});
store.upsertManualProfile(
  "vless://" +
    SECRET_UUID +
    "@a.example.com:443?security=reality&type=ws&pbk=PUBKEYVALUE#NL",
  "NL",
);
store.upsertManualProfile(
  "trojan://" + SECRET_PASSWORD + "@b.example.com:443#DE",
  "DE",
);
store.applySubscription(
  SECRET_SUB_URL,
  "My Sub",
  [
    {
      link: "vless://" + SECRET_UUID + "@c.example.com:443#SubNode",
      protocol: "vless",
      name: "SubNode",
    },
  ],
  {},
);

var warningRecords = [];
var quietLogger = {
  info: function () {},
  warn: function (message, fields) {
    warningRecords.push({ message: message, fields: fields });
  },
  error: function () {},
};
var pairing = new pairingLib.PairingManager({ logger: quietLogger });

var importCalls = [];
var diagnosticFailure = false;
var server = new serverLib.ImporterServer({
  pairing: pairing,
  store: store,
  logger: quietLogger,
  port: 0,
  handlers: {
    importValue: function (value, name, cb) {
      if (diagnosticFailure) {
        return cb(
          errors.err("NETWORK_ERROR", "ECONNRESET", {
            stage: "response-read",
            redirectHop: 2,
            protocol: "https",
            originChanged: true,
            transportErrorCode: "ECONNRESET",
            transportErrorName: "Error",
            tlsPhase: "tls-handshake",
          }),
        );
      }
      importCalls.push({ value: value, name: name });
      cb(null, { count: 1 });
    },
    updateSubscriptions: function (id, cb) {
      cb(null, { updated: 1 });
    },
    deleteSubscription: function (id, cb) {
      cb(null, {});
    },
    deleteProfile: function (id, cb) {
      cb(null, {});
    },
    setActive: function (id, cb) {
      cb(null, {});
    },
  },
});

var port = 0;

function responseLeaksSecret(body) {
  var secrets = [
    SECRET_UUID,
    SECRET_PASSWORD,
    SECRET_SUB_URL,
    "PUBKEYVALUE",
    "SECRETTOKEN123",
    "vless://",
    "trojan://",
  ];
  var text = String(body || "");
  var leaked = [];
  secrets.forEach(function (secret) {
    if (text.indexOf(secret) >= 0) leaked.push(secret);
  });
  return leaked;
}

function request(options, callback) {
  var req = http.request(
    {
      host: "127.0.0.1",
      port: port,
      method: options.method || "GET",
      path: options.path || "/",
      headers: options.headers || {},
      /* Fresh socket per request: a deliberately destroyed connection from the
       body-limit check must not poison later requests via keep-alive reuse. */
      agent: false,
    },
    function (res) {
      var chunks = [];
      res.on("data", function (c) {
        chunks.push(c);
      });
      res.on("end", function () {
        callback(null, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    },
  );
  req.on("error", function (e) {
    callback(e);
  });
  if (options.body) req.write(options.body);
  req.end();
}

function step(fn) {
  return new Promise(fn);
}

/* Bind the real listener on an ephemeral port. */
var raw = http.createServer(function (req, res) {
  server.handle(req, res);
});
raw.listen(0, "127.0.0.1", function () {
  port = raw.address().port;

  step(function (next) {
    /* Nothing enabled yet: the API must be closed. */
    request({ path: "/api/profiles" }, function (e, res) {
      record(
        "access is closed before pairing is enabled",
        res.status === 403,
        "status " + res.status,
      );
      record(
        "closed importer response exposes no profile URI, UUID, password, subscription URL or token",
        responseLeaksSecret(res.body).length === 0,
        responseLeaksSecret(res.body).join(","),
      );
      next();
    });
  })
    .then(function () {
      return step(function (next) {
        pairing.enable();
        request({ path: "/api/profiles" }, function (e, res) {
          record(
            "unauthenticated API access is rejected",
            res.status === 401,
            "status " + res.status,
          );
          record(
            "unauthenticated API response exposes no sensitive data",
            responseLeaksSecret(res.body).length === 0,
            responseLeaksSecret(res.body).join(","),
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        request({ path: "/" }, function (e, res) {
          var isPairPage = res.body.indexOf('name="code"') >= 0;
          var leaksCode = res.body.indexOf(pairing.pairing.code) >= 0;
          record("unauthenticated root serves the pairing form", isPairPage);
          record("pairing page never contains the code itself", !leaksCode);
          record(
            "pairing page exposes no stored sensitive data",
            responseLeaksSecret(res.body).length === 0,
            responseLeaksSecret(res.body).join(","),
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              value: "vless://" + SECRET_UUID + "@z.example.com:443",
            }),
          },
          function (e, res) {
            record(
              "unauthenticated mutation is rejected before its handler runs",
              res.status === 401 && importCalls.length === 0,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          {
            method: "POST",
            path: "/pair",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "code=WRONGXXX",
          },
          function (e, res) {
            record(
              "wrong pairing code is rejected",
              res.status === 401,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          {
            method: "POST",
            path: "/pair",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "code=" + pairing.pairing.code,
          },
          function (e, res) {
            var cookie = String((res.headers["set-cookie"] || [""])[0]);
            record(
              "valid code establishes a session",
              res.status === 303 && cookie.indexOf("alcyone_session=") === 0,
              "status " + res.status,
            );
            record(
              "session cookie is HttpOnly and SameSite=Strict",
              /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie),
            );
            global.__cookie = cookie.split(";")[0];
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          { path: "/api/profiles", headers: { Cookie: global.__cookie } },
          function (e, res) {
            var body = res.body;
            var leaks = [];
            [
              SECRET_UUID,
              SECRET_PASSWORD,
              SECRET_SUB_URL,
              "PUBKEYVALUE",
              "SECRETTOKEN123",
              "vless://",
              "trojan://",
            ].forEach(function (secret) {
              if (body.indexOf(secret) >= 0) leaks.push(secret);
            });
            record(
              "authenticated profile list is served",
              res.status === 200 && body.indexOf('"profiles"') >= 0,
            );
            record(
              "profile API returns no secrets",
              leaks.length === 0,
              leaks.join(","),
            );
            record(
              "profile API exposes display metadata",
              body.indexOf('"name"') >= 0 && body.indexOf('"protocol"') >= 0,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          { path: "/", headers: { Cookie: global.__cookie } },
          function (e, res) {
            var leaks = [];
            [
              SECRET_UUID,
              SECRET_PASSWORD,
              SECRET_SUB_URL,
              "PUBKEYVALUE",
              "SECRETTOKEN123",
            ].forEach(function (secret) {
              if (res.body.indexOf(secret) >= 0) leaks.push(secret);
            });
            record(
              "importer page renders no secrets",
              leaks.length === 0,
              leaks.join(","),
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        var session = pairing.sessions[Object.keys(pairing.sessions)[0]];
        diagnosticFailure = true;
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: {
              Cookie: global.__cookie,
              "Content-Type": "application/json",
              "X-Alcyone-CSRF": session.csrf,
            },
            body: JSON.stringify({ value: SECRET_SUB_URL }),
          },
          function (e, res) {
            diagnosticFailure = false;
            var payload = JSON.parse(res.body);
            var warning = warningRecords
              .filter(function (entry) {
                return entry.message === "lan importer request failed";
              })
              .pop();
            var serialized = JSON.stringify({
              response: payload,
              warning: warning,
            });
            record(
              "failed import returns safe stage and redirect diagnostics",
              res.status === 400 &&
                payload.errorCode === "NETWORK_ERROR" &&
                payload.errorMeta.stage === "response-read" &&
                payload.errorMeta.redirectHop === 2 &&
                payload.errorMeta.protocol === "https" &&
                payload.errorMeta.originChanged === true &&
                payload.errorMeta.transportErrorCode === "ECONNRESET" &&
                payload.errorMeta.transportErrorName === "Error" &&
                payload.errorMeta.tlsPhase === "tls-handshake" &&
                warning &&
                warning.fields.transportErrorCode === "ECONNRESET" &&
                warning.fields.transportErrorName === "Error" &&
                warning.fields.tlsPhase === "tls-handshake",
            );
            record(
              "failed import diagnostics leak no URL, token, credentials or HWID",
              responseLeaksSecret(serialized).length === 0 &&
                serialized.indexOf("X-HWID") < 0 &&
                serialized.indexOf("X-Device-") < 0,
              responseLeaksSecret(serialized).join(","),
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        /* No CSRF header: must be refused even with a valid session. */
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: {
              Cookie: global.__cookie,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              value: "vless://" + SECRET_UUID + "@z.example.com:443",
            }),
          },
          function (e, res) {
            record(
              "mutation without CSRF token is rejected",
              res.status === 403,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        var session = pairing.sessions[Object.keys(pairing.sessions)[0]];
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: {
              Cookie: global.__cookie,
              "Content-Type": "application/json",
              "X-Alcyone-CSRF": session.csrf,
            },
            body: JSON.stringify({
              value: "vless://" + SECRET_UUID + "@z.example.com:443",
            }),
          },
          function (e, res) {
            record(
              "mutation with CSRF token succeeds",
              res.status === 200 && importCalls.length === 1,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        var session = pairing.sessions[Object.keys(pairing.sessions)[0]];
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: {
              Cookie: global.__cookie,
              "Content-Type": "application/json",
              "X-Alcyone-CSRF": session.csrf,
              Origin: "http://evil.example.net",
            },
            body: JSON.stringify({
              value: "vless://" + SECRET_UUID + "@z.example.com:443",
            }),
          },
          function (e, res) {
            record(
              "foreign Origin is rejected",
              res.status === 403,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        var session = pairing.sessions[Object.keys(pairing.sessions)[0]];
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: {
              Cookie: global.__cookie,
              "Content-Type": "application/json",
              "X-Alcyone-CSRF": session.csrf,
            },
            body: JSON.stringify({
              value: "vless://x@y.example.com:443",
              unexpected: "field",
            }),
          },
          function (e, res) {
            record(
              "unknown request fields are rejected",
              res.status === 400 && res.body.indexOf("UNKNOWN_FIELD") >= 0,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          { path: "/api/profiles", headers: { Cookie: global.__cookie } },
          function (e, res) {
            record(
              "no wildcard CORS header is sent",
              res.headers["access-control-allow-origin"] === undefined,
              String(res.headers["access-control-allow-origin"]),
            );
            record(
              "security headers are present",
              res.headers["x-content-type-options"] === "nosniff" &&
                res.headers["referrer-policy"] === "same-origin",
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        /* Origin null + Sec-Fetch-Site same-origin must succeed (mobile browser behavior under same-origin referrer policy). */
        pairing.enable();
        request(
          {
            method: "POST",
            path: "/pair",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Origin: "null",
              "Sec-Fetch-Site": "same-origin",
            },
            body: "code=" + pairing.pairing.code,
          },
          function (e, res) {
            record(
              "Origin null with Sec-Fetch-Site same-origin is accepted",
              res.status === 303,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        /* Origin null + Sec-Fetch-Site cross-site must be rejected. */
        pairing.enable();
        request(
          {
            method: "POST",
            path: "/pair",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Origin: "null",
              "Sec-Fetch-Site": "cross-site",
            },
            body: "code=" + pairing.pairing.code,
          },
          function (e, res) {
            record(
              "Origin null with Sec-Fetch-Site cross-site is rejected",
              res.status === 403,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        /* Origin null without Sec-Fetch-Site header must be rejected. */
        pairing.enable();
        request(
          {
            method: "POST",
            path: "/pair",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Origin: "null",
            },
            body: "code=" + pairing.pairing.code,
          },
          function (e, res) {
            record(
              "Origin null without Sec-Fetch-Site is rejected",
              res.status === 403,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        /* Wrong CSRF token on mutation must be rejected with 403. */
        pairing.enable();
        request(
          {
            method: "POST",
            path: "/pair",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "code=" + pairing.pairing.code,
          },
          function (e, res) {
            var cookie = String((res.headers["set-cookie"] || [""])[0]).split(
              ";",
            )[0];
            global.__cookie = cookie;
            request(
              {
                method: "POST",
                path: "/api/import",
                headers: {
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "X-Alcyone-CSRF": "badtoken12345",
                },
                body: JSON.stringify({
                  value: "vless://" + SECRET_UUID + "@z.example.com:443",
                }),
              },
              function (e2, res2) {
                record(
                  "wrong CSRF token is rejected with 403",
                  res2.status === 403,
                  "status " + res2.status,
                );
                next();
              },
            );
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        request(
          { method: "OPTIONS", path: "/api/profiles" },
          function (e, res) {
            record(
              "CORS preflight is not honoured",
              res.status === 405 &&
                res.headers["access-control-allow-origin"] === undefined,
              "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        var session = pairing.sessions[Object.keys(pairing.sessions)[0]];
        var huge = new Array(80 * 1024).join("A");
        request(
          {
            method: "POST",
            path: "/api/import",
            headers: {
              Cookie: global.__cookie,
              "Content-Type": "application/json",
              "X-Alcyone-CSRF": session.csrf,
            },
            body: JSON.stringify({ value: huge }),
          },
          function (e, res) {
            record(
              "oversized request body is rejected",
              !!e || res.status === 413,
              e ? "socket closed" : "status " + res.status,
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        /* Closing the window must lock everything out again. */
        pairing.disable();
        request(
          {
            path: "/api/profiles",
            headers: { Cookie: global.__cookie, Connection: "close" },
          },
          function (e, res) {
            record(
              "disabling pairing revokes existing sessions",
              !!res && res.status === 403,
              res ? "status " + res.status : "request error " + (e && e.code),
            );
            next();
          },
        );
      });
    })
    .then(function () {
      raw.close();
      var passed = results.filter(Boolean).length;
      console.log("\n" + passed + "/" + results.length + " checks passed");
      if (passed !== results.length) process.exit(1);
    })
    .catch(function (e) {
      raw.close();
      console.error("harness error: " + ((e && e.stack) || e));
      process.exit(1);
    });
});
