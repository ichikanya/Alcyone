"use strict";

/* Runs with the exact Node.js 0.12.2 used by webOS TV 4.x services. */

var path = require("path");
var zlib = require("zlib");
var dns = require("dns");
var https = require("https");
var events = require("events");

var ROOT = path.join(__dirname, "..");
var dnsResolver = require(
  path.join(ROOT, "app", "service", "lib", "net", "dns-resolver.js")
);
var endpointBootstrap = require(
  path.join(ROOT, "app", "service", "lib", "net", "endpoint-bootstrap.js")
);
var httpClient = require(
  path.join(ROOT, "app", "service", "lib", "net", "http-client.js")
);
var ssrf = require(path.join(ROOT, "app", "service", "lib", "net", "ssrf.js"));
var subscriptions = require(
  path.join(ROOT, "app", "service", "lib", "net", "subscriptions.js")
);
var xrayConfig = require(
  path.join(ROOT, "app", "service", "lib", "config", "xray.js")
);
var singboxConfig = require(
  path.join(ROOT, "app", "service", "lib", "config", "singbox.js")
);

var passed = 0;
var total = 0;
function check(name, condition) {
  total++;
  if (condition) passed++;
  console.log((condition ? "ok   - " : "FAIL - ") + name);
}

function dnsCheck(next) {
  var real4 = dns.resolve4;
  var real6 = dns.resolve6;
  dns.resolve4 = function (host, callback) {
    process.nextTick(function () {
      callback(null, ["93.184.216.34"]);
    });
  };
  dns.resolve6 = function (host, callback) {
    process.nextTick(function () {
      callback(new Error("no AAAA"));
    });
  };
  dnsResolver.resolveAll("webos4.test", function (error, addresses) {
    dns.resolve4 = real4;
    dns.resolve6 = real6;
    check(
      "DNS result shape works on Node 0.12.2",
      !error && addresses.length === 1 && addresses[0].family === 4
    );
    next();
  });
}

function endpointBootstrapCheck(next) {
  var callbacks = 0;
  endpointBootstrap.resolve(
    [
      { host: "Runtime.Example", port: 443, network: "tcp" },
      { host: "runtime.example", port: 8443, network: "tcp" },
    ],
    function (error, result) {
      var profile;
      var xray;
      var singbox;
      callbacks++;
      profile = {
        id: "runtime",
        link: "vless://11111111-2222-3333-4444-555555555555@Runtime.Example:443?security=tls",
      };
      xray = xrayConfig.build(profile, result);
      singbox = singboxConfig.build(profile, result);
      check(
        "endpoint bootstrap works on Node 0.12.2",
        !error &&
          callbacks === 1 &&
          result.addresses.length === 2 &&
          result.entries.length === 1 &&
          result.entries[0].targets.length === 2
      );
      check(
        "XRay bootstrap schema builds on Node 0.12.2",
        xray.dns.hosts["runtime.example"].length === 2 &&
          xray.outbounds[0].streamSettings.sockopt.domainStrategy === "UseIP"
      );
      check(
        "sing-box bootstrap schema builds on Node 0.12.2",
        singbox.dns.servers[0].type === "hosts" &&
          singbox.outbounds[0].domain_resolver.strategy === "ipv4_only"
      );
      next();
    },
    {
      resolver: {
        resolveAll: function (host, callback) {
          process.nextTick(function () {
            callback(null, [
              { address: "93.184.216.34", family: 4 },
              { address: "93.184.216.35", family: 4 },
              { address: "93.184.216.34", family: 4 },
            ]);
          });
        },
      },
      timeoutMs: 100,
    }
  );
}

function decompressionCheck(next) {
  var large = new Buffer(9 * 1024 * 1024);
  large.fill(65);
  zlib.gzip(large, function (gzipError, compressed) {
    if (gzipError) {
      check("decompression limit works on Node 0.12.2", false);
      return next();
    }
    httpClient.decodeBody(compressed, "gzip", function (error) {
      check(
        "decompression limit works on Node 0.12.2",
        !!error && error.code === "DECOMPRESSED_TOO_LARGE"
      );
      next();
    });
  });
}

function nestedFailureCheck(next) {
  var original = httpClient.fetchUrl;
  var calls = 0;
  var callbacks = 0;
  httpClient.fetchUrl = function (url, options, callback) {
    calls++;
    process.nextTick(function () {
      if (url.indexOf("/1") >= 0) callback(new Error("failed"));
      else callback(null, "dmxlc3M6Ly8x");
    });
  };
  subscriptions.expandNested(
    "https://example.com/1\nhttps://example.com/2\nhttps://example.com/3\n" +
      "https://example.com/4\nhttps://example.com/5",
    { headers: {}, deadline: Date.now() + 1000 },
    function (error) {
      callbacks++;
      httpClient.fetchUrl = original;
      check(
        "nested failure completes on Node 0.12.2",
        !!error && callbacks === 1 && calls === 4
      );
      next();
    }
  );
}

function httpsRedirectCheck(next) {
  var real4 = dns.resolve4;
  var real6 = dns.resolve6;
  var realRequest = https.request;
  var requests = [];

  dns.resolve4 = function (host, callback) {
    process.nextTick(function () {
      callback(null, ["93.184.216.34"]);
    });
  };
  dns.resolve6 = function (host, callback) {
    process.nextTick(function () {
      callback(new Error("no AAAA"));
    });
  };
  https.request = function (options, callback) {
    var request = new events.EventEmitter();
    requests.push({
      host: options.host,
      servername: options.servername,
      path: options.path,
      headers: options.headers,
    });
    request.setTimeout = function () {};
    request.destroy = function () {};
    request.end = function () {
      process.nextTick(function () {
        var response = new events.EventEmitter();
        response.setTimeout = function () {};
        response.destroy = function () {};
        response.resume = function () {};
        if (options.path === "/start") {
          response.statusCode = 302;
          response.headers = {
            location: "https://redirect-target.example/finish",
          };
          callback(response);
          return;
        }
        response.statusCode = 200;
        response.headers = {};
        callback(response);
        process.nextTick(function () {
          response.emit("data", new Buffer("vless://runtime.example"));
          response.emit("end");
        });
      });
    };
    return request;
  };

  httpClient.fetchUrl(
    "https://redirect-source.example/start",
    {
      headers: {
        Authorization: "Bearer secret",
        "User-Agent": "Happ/3.1.0/android",
      },
    },
    function (error, body) {
      dns.resolve4 = real4;
      dns.resolve6 = real6;
      https.request = realRequest;
      check(
        "HTTPS redirect chain works on Node 0.12.2",
        !error && requests.length === 2 && body === "vless://runtime.example"
      );
      check(
        "approved IPv4 is pinned while Host and SNI keep the original name on Node 0.12.2",
        requests.length === 2 &&
          requests[0].host === "93.184.216.34" &&
          requests[0].servername === "redirect-source.example" &&
          requests[0].headers.Host === "redirect-source.example" &&
          requests[1].host === "93.184.216.34" &&
          requests[1].servername === "redirect-target.example" &&
          requests[1].headers.Host === "redirect-target.example"
      );
      check(
        "cross-origin credentials are stripped on Node 0.12.2",
        requests.length === 2 &&
          !requests[1].headers.Authorization &&
          !requests[1].headers.authorization
      );
      next();
    }
  );
}

check(
  "bundled Mozilla CA roots load on Node 0.12.2",
  httpClient.loadBundledCa() && httpClient.loadBundledCa().length === 119
);
var runningNode012 = /^0\.12\./.test(String(process.versions.node || ""));
check(
  "runtime selects the compatible ECDH curve policy",
  runningNode012
    ? httpClient.compatibleEcdhCurves() === null
    : httpClient.compatibleEcdhCurves() === "prime256v1:secp384r1:secp521r1"
);

var safeTransport = httpClient.transportDiagnostic(
  { code: "ECONNRESET", name: "Error" },
  "tls-handshake"
);
var scrubbedTransport = httpClient.transportDiagnostic(
  { code: "ECONNRESET secret.example/token", name: "Error\nsecret" },
  "tls-handshake secret"
);
check(
  "transport diagnostics are useful and secret-safe on Node 0.12.2",
  safeTransport.transportErrorCode === "ECONNRESET" &&
    safeTransport.transportErrorName === "Error" &&
    safeTransport.tlsPhase === "tls-handshake" &&
    scrubbedTransport.transportErrorCode === "UNKNOWN" &&
    scrubbedTransport.transportErrorName === "Error" &&
    scrubbedTransport.tlsPhase === "unknown"
);

var downgrade = null;
try {
  httpClient.redirectUrl(
    ssrf.assertUrlAllowed("https://subscriptions.example.com/a"),
    "http://subscriptions.example.com/b"
  );
} catch (redirectError) {
  downgrade = redirectError;
}
check(
  "redirect resolution rejects HTTPS downgrade on Node 0.12.2",
  !!downgrade && downgrade.code === "HTTPS_DOWNGRADE_REJECTED"
);

httpsRedirectCheck(function () {
  dnsCheck(function () {
    endpointBootstrapCheck(function () {
      decompressionCheck(function () {
        nestedFailureCheck(function () {
          console.log("\n" + passed + "/" + total + " checks passed");
          process.exit(passed === total ? 0 : 1);
        });
      });
    });
  });
});
