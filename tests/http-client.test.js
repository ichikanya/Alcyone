"use strict";

/* Behavioural checks for the hardened subscription HTTP client.

   The SSRF policy blocks loopback by design, so these tests intercept DNS
   resolution to map a public-looking test hostname onto the local test server.
   That exercises the real request path (redirects, header stripping, TLS
   handling, size limits) while keeping the policy itself untouched. */

var assert = require("assert");
var http = require("http");
var https = require("https");
var zlib = require("zlib");
var dns = require("dns");
var tls = require("tls");
var path = require("path");
var errors = require("../app/service/lib/errors");

var CLIENT = path.join(
  __dirname,
  "..",
  "app",
  "service",
  "lib",
  "net",
  "http-client.js",
);
var ssrf = require(
  path.join(__dirname, "..", "app", "service", "lib", "net", "ssrf.js"),
);

/* Pretend the loopback test server lives at a public address. The client pins
   its socket to the address DNS returns, so we also patch the SSRF check for
   that single address to let the connection through. */
var TEST_HOST = "subs.test.example";
var ALT_HOST = "other.test.example";
var FAKE_PUBLIC = "93.184.216.34";
var realLookup = dns.lookup;
var realResolve4 = dns.resolve4;
var realResolve6 = dns.resolve6;
var realAssert = ssrf.assertAddressAllowed;
var serverPort = 0;
var resolvedHosts = [];

dns.lookup = function (hostname, options, callback) {
  if (hostname === TEST_HOST || hostname === ALT_HOST) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (options && options.all)
      return process.nextTick(function () {
        callback(null, [{ address: FAKE_PUBLIC, family: 4 }]);
      });
    return process.nextTick(function () {
      callback(null, FAKE_PUBLIC, 4);
    });
  }
  return realLookup.apply(dns, arguments);
};
dns.resolve4 = function (hostname, callback) {
  if (hostname === TEST_HOST || hostname === ALT_HOST) {
    resolvedHosts.push(hostname);
    return process.nextTick(function () {
      callback(null, [FAKE_PUBLIC]);
    });
  }
  return realResolve4.apply(dns, arguments);
};
dns.resolve6 = function (hostname, callback) {
  if (hostname === TEST_HOST || hostname === ALT_HOST) {
    var noData = new Error("no AAAA records");
    noData.code = "ENODATA";
    return process.nextTick(function () {
      callback(noData);
    });
  }
  return realResolve6.apply(dns, arguments);
};
ssrf.assertAddressAllowed = function (address, family) {
  if (address === FAKE_PUBLIC) return;
  return realAssert.call(ssrf, address, family);
};

/* The client connects to the pinned address; redirect the socket to loopback. */
var realHttpRequest = http.request;
http.request = function (options, cb) {
  if (options && options.host === FAKE_PUBLIC) {
    options.host = "127.0.0.1";
    options.port = serverPort;
  }
  return realHttpRequest.call(http, options, cb);
};

var client = require(CLIENT);

var results = [];
function record(name, ok, detail) {
  results.push({ name: name, ok: ok, detail: detail || "" });
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

var received = [];
var server = http.createServer(function (req, res) {
  received.push({ url: req.url, headers: req.headers });
  if (req.url === "/plain") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(
      "vless://11111111-2222-3333-4444-555555555555@a.ex.com:443#A",
    );
  }
  if (req.url === "/gzip") {
    var body = zlib.gzipSync(
      new Buffer("vless://11111111-2222-3333-4444-555555555555@b.ex.com:443#B"),
    );
    res.writeHead(200, { "Content-Encoding": "gzip" });
    return res.end(body);
  }
  if (req.url === "/redirect-same") {
    res.writeHead(302, { Location: "http://" + TEST_HOST + "/plain" });
    return res.end();
  }
  if (req.url === "/redirect-private") {
    res.writeHead(302, { Location: "http://192.168.1.5/secret" });
    return res.end();
  }
  if (req.url === "/redirect-cross") {
    res.writeHead(302, { Location: "http://" + ALT_HOST + "/plain" });
    return res.end();
  }
  if (req.url === "/redirect-chain") {
    res.writeHead(302, {
      Location: "http://" + ALT_HOST + "/redirect-chain-mid",
    });
    return res.end();
  }
  if (req.url === "/redirect-chain-mid") {
    res.writeHead(307, { Location: "/plain" });
    return res.end();
  }
  if (req.url === "/redirect-port") {
    res.writeHead(302, { Location: "http://" + TEST_HOST + ":81/plain" });
    return res.end();
  }
  if (req.url === "/redirect-loop") {
    res.writeHead(302, { Location: "http://" + TEST_HOST + "/redirect-loop" });
    return res.end();
  }
  if (req.url === "/redirect-cookie") {
    if (req.headers.cookie === "sid=ok") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(
        "vless://11111111-2222-3333-4444-555555555555@cookie.example.com:443#Cookie",
      );
    }
    res.writeHead(307, {
      Location: "http://" + TEST_HOST + "/redirect-cookie",
      "Set-Cookie": "sid=ok; Path=/; HttpOnly",
    });
    return res.end();
  }
  if (req.url === "/rate-limit") {
    res.writeHead(429, { "Retry-After": "60" });
    return res.end("Too Many Requests");
  }
  if (req.url.indexOf("/reset") === 0) {
    req.socket.destroy();
    return;
  }
  if (req.url === "/huge") {
    res.writeHead(200);
    /* Stream past the body cap so the limit must trigger mid-transfer. */
    var chunk = new Buffer(256 * 1024);
    chunk.fill(65);
    var sent = 0;
    (function push() {
      if (sent > 4 * 1024 * 1024) return res.end();
      sent += chunk.length;
      if (res.write(chunk)) return setImmediate(push);
      res.once("drain", push);
    })();
    return;
  }
  if (req.url === "/zipbomb") {
    /* Small on the wire, enormous once inflated. */
    var big = new Buffer(32 * 1024 * 1024);
    big.fill(66);
    res.writeHead(200, { "Content-Encoding": "gzip" });
    return res.end(zlib.gzipSync(big));
  }
  res.writeHead(404);
  res.end();
});

function step(fn) {
  return new Promise(fn);
}

server.listen(0, "127.0.0.1", function () {
  serverPort = server.address().port;
  var base = "http://" + TEST_HOST;

  step(function (next) {
    client.fetchUrl(base + "/plain", {}, function (e, body) {
      record(
        "plain body downloads",
        !e && /vless:\/\//.test(String(body)),
        e ? e.code : "",
      );
      next();
    });
  })
    .then(function () {
      return step(function (next) {
        client.fetchUrl(base + "/gzip", {}, function (e, body) {
          record(
            "gzip response decompresses",
            !e && /b\.ex\.com/.test(String(body)),
            e ? e.code : "",
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        received.length = 0;
        client.fetchUrl(
          base + "/redirect-same",
          {
            headers: {
              Authorization: "Bearer SECRET",
              "X-Hwid": "HW1",
              "User-Agent": "Happ/3.1.0",
            },
          },
          function (e, body) {
            var followed = received.length === 2;
            var keptAuth = followed && !!received[1].headers.authorization;
            record(
              "same-origin redirect is followed",
              !e && followed && /a\.ex\.com/.test(String(body)),
              e ? e.code : "",
            );
            record("same-origin redirect keeps auth header", keptAuth);
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        received.length = 0;
        client.fetchUrl(
          base + "/redirect-cross",
          {
            headers: {
              Authorization: "Bearer SECRET",
              "Proxy-Authorization": "Basic SECRET",
              "X-Hwid": "HW1",
              "X-Device-OS": "webOS",
              "x-device-custom": "SECRET",
              Cookie: "sid=abc",
              "User-Agent": "Happ/3.1.0",
            },
          },
          function (e, body) {
            var hopped = received.length === 2;
            var second = hopped ? received[1].headers : {};
            var stripped =
              hopped &&
              !second.authorization &&
              !second.cookie &&
              !second["proxy-authorization"] &&
              !second["x-hwid"] &&
              !second["x-device-os"] &&
              !second["x-device-custom"];
            var keptUa = hopped && !!second["user-agent"];
            record(
              "cross-origin redirect strips credential headers",
              !e && stripped,
              e ? e.code : hopped ? "" : "not followed",
            );
            record("cross-origin redirect keeps non-sensitive headers", keptUa);
            void body;
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        received.length = 0;
        resolvedHosts.length = 0;
        client.fetchUrl(
          base + "/redirect-chain",
          {
            headers: {
              Authorization: "Bearer SECRET",
              "X-HWID": "HW1",
              "X-Device-model": "TV",
            },
          },
          function (e, body) {
            var third = received.length === 3 ? received[2].headers : {};
            var changedOriginUsed = received.length >= 2 && received[1].headers.host === ALT_HOST;
            record(
              "redirect chain uses the validated changed origin and follows every hop",
              !e &&
                received.length === 3 &&
                changedOriginUsed &&
                /a\.ex\.com/.test(String(body)),
              e ? e.code : "",
            );
            record(
              "headers stripped on an origin change stay stripped for the rest of the chain",
              !third.authorization &&
                !third["x-hwid"] &&
                !third["x-device-model"],
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        received.length = 0;
        client.fetchUrl(
          base + "/redirect-port",
          {
            headers: { Authorization: "Bearer SECRET", Cookie: "sid=abc" },
          },
          function (e) {
            var second = received.length === 2 ? received[1].headers : {};
            record(
              "effective port participates in cross-origin header stripping",
              !e && !second.authorization && !second.cookie,
              e ? e.code : "",
            );
            next();
          },
        );
      });
    })
    .then(function () {
      return step(function (next) {
        client.fetchUrl(base + "/redirect-private", {}, function (e) {
          record(
            "redirect to private address is revalidated and blocked",
            !!e && e.code === "BLOCKED_ADDRESS",
            e ? e.code + "/" + e.detail : "no error",
          );
          record(
            "redirect SSRF failure includes safe hop diagnostics",
            !!e &&
              e.meta &&
              e.meta.stage === "redirect" &&
              e.meta.redirectHop === 1 &&
              e.meta.protocol === "http" &&
              e.meta.originChanged === true,
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        var secretUrl = base + "/reset?token=DO-NOT-LOG-THIS";
        client.fetchUrl(secretUrl, {}, function (e) {
          var serialized = JSON.stringify(errors.toResult(e));
          record(
            "connection reset identifies its safe request stage",
            !!e &&
              e.code === "NETWORK_ERROR" &&
              e.meta &&
              (e.meta.stage === "connect" ||
                e.meta.stage === "response-read") &&
              e.meta.redirectHop === 0 &&
              e.meta.protocol === "http" &&
              e.meta.originChanged === false &&
              e.meta.transportErrorCode === "ECONNRESET" &&
              e.meta.transportErrorName === "Error" &&
              e.meta.tlsPhase === "not-applicable",
          );
          record(
            "network diagnostics contain no URL, host, path, query or token",
            serialized.indexOf("DO-NOT-LOG-THIS") < 0 &&
              serialized.indexOf(TEST_HOST) < 0 &&
              serialized.indexOf("/reset") < 0,
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        received.length = 0;
        client.fetchUrl(base + "/redirect-cookie", {}, function (e, body) {
          var cookieRequest = received.length === 2 ? received[1] : null;
          record(
            "same-target redirect follows a changed cookie session",
            !e &&
              received.length === 2 &&
              cookieRequest.headers.cookie === "sid=ok" &&
              /cookie\.example\.com/.test(String(body)),
            e ? e.code : "",
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        received.length = 0;
        client.fetchUrl(base + "/redirect-loop", {}, function (e) {
          record(
            "redirect loop is bounded",
            !!e && e.code === "TOO_MANY_REDIRECTS",
            e ? e.code : "no error",
          );
          record(
            "an immediate self-redirect is rejected after one request",
            received.length === 1,
            String(received.length),
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        client.fetchUrl(base + "/rate-limit", {}, function (e) {
          record(
            "HTTP 429 has a terminal rate-limit error",
            !!e &&
              e.code === "RATE_LIMITED" &&
              e.meta &&
              e.meta.status === 429,
            e ? e.code : "no error",
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        client.fetchUrl(base + "/huge", {}, function (e) {
          record(
            "oversized body is rejected",
            !!e && e.code === "RESPONSE_TOO_LARGE",
            e ? e.code : "no error",
          );
          next();
        });
      });
    })
    .then(function () {
      return step(function (next) {
        client.fetchUrl(base + "/zipbomb", {}, function (e) {
          record(
            "decompression bomb is rejected",
            !!e &&
              (e.code === "DECOMPRESSED_TOO_LARGE" ||
                e.code === "RESPONSE_TOO_LARGE" ||
                e.code === "NETWORK_ERROR"),
            e ? e.code : "no error",
          );
          next();
        });
      });
    })
    .then(function () {
      var httpsTarget = ssrf.assertUrlAllowed(
        "https://" + TEST_HOST + "/secure",
      );
      var downgrade = null;
      try {
        client.redirectUrl(httpsTarget, "http://" + TEST_HOST + "/plain");
      } catch (e) {
        downgrade = e;
      }
      record(
        "HTTPS to HTTP redirect downgrade is rejected",
        !!downgrade && downgrade.code === "HTTPS_DOWNGRADE_REJECTED",
        downgrade ? downgrade.code : "no error",
      );
      record(
        "downgrade diagnostics identify the redirect without destination data",
        downgrade &&
          downgrade.meta &&
          downgrade.meta.stage === "redirect" &&
          downgrade.meta.protocol === "http" &&
          downgrade.meta.originChanged === true &&
          JSON.stringify(downgrade.meta).indexOf(TEST_HOST) < 0,
      );
      record(
        "same origin uses scheme, hostname and effective port",
        ssrf.sameOrigin(
          ssrf.assertUrlAllowed("https://example.com/a"),
          ssrf.assertUrlAllowed("https://example.com:443/b"),
        ) &&
          !ssrf.sameOrigin(
            ssrf.assertUrlAllowed("https://example.com/a"),
            ssrf.assertUrlAllowed("https://example.com:444/b"),
          ),
      );
      server.close();
      return runTlsCheck();
    })
    .then(function () {
      var failed = results.filter(function (r) {
        return !r.ok;
      });
      console.log(
        "\n" +
          (results.length - failed.length) +
          "/" +
          results.length +
          " checks passed",
      );
      if (failed.length) process.exit(1);
    })
    .catch(function (e) {
      console.error("harness error: " + ((e && e.stack) || e));
      process.exit(1);
    });
});

/* A self-signed HTTPS server must fail closed with a certificate error and
   must never be retried insecurely. */
function runTlsCheck() {
  return new Promise(function (resolve) {
    var selfSigned = makeSelfSigned();
    if (!selfSigned) {
      record(
        "self-signed TLS is rejected without insecure retry (skipped: no test cert)",
        true,
        "skipped",
      );
      return resolve();
    }
    var tlsServer = https.createServer(selfSigned, function (req, res) {
      res.writeHead(200);
      res.end("should-not-be-read");
    });
    tlsServer.listen(0, "127.0.0.1", function () {
      var tlsPort = tlsServer.address().port;
      var realHttpsRequest = https.request;
      var tlsOptionsSeen = null;
      https.request = function (options, cb) {
        tlsOptionsSeen = options;
        if (options && options.host === FAKE_PUBLIC) {
          options.host = "127.0.0.1";
          options.port = tlsPort;
        }
        return realHttpsRequest.call(https, options, cb);
      };
      client.fetchUrl(
        "https://" + TEST_HOST + "/plain",
        {},
        function (e, body) {
          record(
            "self-signed TLS is rejected without insecure retry",
            !!e &&
              e.code === "TLS_CERTIFICATE_INVALID" &&
              !body &&
              e.meta &&
              e.meta.transportErrorName === "Error" &&
              /^(tcp-connect|tls-handshake|certificate-verification)$/.test(
                e.meta.tlsPhase,
              ),
            e ? e.code + "/" + (e.meta && e.meta.tlsPhase) : "no error",
          );
          record(
            "supported Node runtimes advertise the safe P-256/P-384/P-521 compatibility list",
            tlsOptionsSeen &&
              tlsOptionsSeen.ecdhCurve === "prime256v1:secp384r1:secp521r1",
          );
          https.request = realHttpsRequest;
          tlsServer.close();
          resolve();
        },
      );
    });
  });
}

/* Generate a throwaway certificate if the platform provides the API. */
function makeSelfSigned() {
  try {
    if (typeof tls.createSecureContext !== "function") return null;
    var selfsigned = require("./fixtures/self-signed.json");
    return { key: selfsigned.key, cert: selfsigned.cert };
  } catch (e) {
    return null;
  }
}
