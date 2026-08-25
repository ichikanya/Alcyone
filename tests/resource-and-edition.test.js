"use strict";

/* Resource-safety and edition-behaviour coverage.

   Replaces the pre-rewrite tests that asserted against the retired frontend
   config builder and shell script. The properties are unchanged — bounded
   logging, bounded connection policy, bounded XHTTP multiplexing, a
   single-process sing-box path and a service-owned route manager — but they
   are now checked against the service modules that actually produce them. */

var path = require("path");

var ROOT = path.join(__dirname, "..");
var xray = require(
  path.join(ROOT, "app", "service", "lib", "config", "xray.js"),
);
var singbox = require(
  path.join(ROOT, "app", "service", "lib", "config", "singbox.js"),
);
var routes = require(
  path.join(ROOT, "app", "service", "lib", "net", "routes.js"),
);
var supervisor = require(
  path.join(ROOT, "app", "service", "lib", "supervisor.js"),
);
var subscriptions = require(
  path.join(ROOT, "app", "service", "lib", "net", "subscriptions.js"),
);
var httpClient = require(
  path.join(ROOT, "app", "service", "lib", "net", "http-client.js"),
);
var pairing = require(path.join(ROOT, "app", "service", "lib", "pairing.js"));
var logger = require(path.join(ROOT, "app", "service", "lib", "logger.js"));

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

var VLESS =
  "vless://11111111-2222-3333-4444-555555555555@edge.example.test:443";

/* --- Xray resource policy --- */
var cfg = xray.build({
  id: "p1",
  link: VLESS + "?security=reality&type=xhttp&pbk=K&sid=ab#N",
});
record(
  "generated Xray config disables per-connection access logging",
  cfg.log.access === "none",
);
record(
  "generated Xray config retains useful warning logs",
  cfg.log.loglevel === "warning",
);
record("generated Xray config disables DNS logging", cfg.log.dnsLog === false);
record(
  "generated Xray config expires incomplete handshakes",
  cfg.policy.levels["0"].handshake > 0 && cfg.policy.levels["0"].handshake <= 8,
);
record(
  "generated Xray config promptly expires idle connections",
  cfg.policy.levels["0"].connIdle > 0 && cfg.policy.levels["0"].connIdle <= 60,
);
record(
  "generated Xray config closes half-idle uplinks",
  cfg.policy.levels["0"].uplinkOnly > 0 &&
    cfg.policy.levels["0"].uplinkOnly <= 10,
);
record(
  "generated Xray config closes half-idle downlinks",
  cfg.policy.levels["0"].downlinkOnly > 0 &&
    cfg.policy.levels["0"].downlinkOnly <= 10,
);
record(
  "XHTTP multiplexing stays bounded",
  !!cfg.outbounds[0].streamSettings.xhttpSettings.xmux.maxConcurrency,
);
record(
  "the proxy inbound is loopback only",
  cfg.inbounds[0].listen === "127.0.0.1" && cfg.inbounds.length === 1,
);
record(
  "private destinations bypass the tunnel",
  cfg.routing.rules[0].outboundTag === "direct" &&
    cfg.routing.rules[0].ip.length >= 10,
);

var h2 = xray.build({
  id: "hy2",
  link: "hysteria2://hy2-password@edge.example.test:443?obfs=salamander&obfs-password=obfs-password#Hy2",
});
record(
  "XRay maps Hysteria2 Salamander obfuscation to FinalMask UDP",
  h2.outbounds[0].streamSettings.finalmask.udp[0].type === "salamander" &&
    h2.outbounds[0].streamSettings.finalmask.udp[0].settings.password ===
      "obfs-password" &&
    !h2.outbounds[0].streamSettings.hysteriaSettings.obfs,
);
record(
  "XRay rejects unsupported Hysteria2 obfuscation instead of generating a broken config",
  (function () {
    try {
      xray.build({
        id: "hy2-bad",
        link: "hysteria2://hy2-password@edge.example.test:443?obfs=unknown#Hy2",
      });
      return false;
    } catch (error) {
      return error && error.code === "UNSUPPORTED_TRANSPORT";
    }
  })(),
);

/* A hostile config must not be able to raise the limits. */
var hostile = xray.buildFullConfig({
  inbounds: [{ port: 1, protocol: "socks" }],
  outbounds: [
    {
      protocol: "vless",
      tag: "p",
      settings: {
        vnext: [{ address: "e.test", port: 443, users: [{ id: "u" }] }],
      },
    },
  ],
  log: { loglevel: "debug", access: "/tmp/access.log" },
  policy: {
    levels: {
      0: {
        handshake: 9999,
        connIdle: 9999,
        uplinkOnly: 9999,
        downlinkOnly: 9999,
      },
    },
  },
});
record(
  "a supplied config cannot re-enable access logging",
  hostile.log.access === "none",
);
record(
  "a supplied config cannot raise the handshake limit",
  hostile.policy.levels["0"].handshake <= 8,
);
record(
  "a supplied config cannot raise the idle limit",
  hostile.policy.levels["0"].connIdle <= 60,
);
record(
  "a supplied config keeps its own outbounds",
  hostile.outbounds.length >= 1,
);

/* --- sing-box edition behaviour --- */
var sb = singbox.build({
  id: "p2",
  link: VLESS + "?security=tls&type=ws&path=%2Fw#N",
});
record(
  "sing-box uses a native TUN plus loopback-only health inbound",
  sb.inbounds.length === 2 &&
    sb.inbounds[0].type === "tun" &&
    sb.inbounds[1].type === "socks" &&
    sb.inbounds[1].listen === "127.0.0.1" &&
    sb.inbounds[1].listen_port === singbox.SOCKS_PORT,
);
record(
  "the low-resource system stack is used",
  sb.inbounds[0].stack === "system",
);
record(
  "the service route manager remains authoritative",
  sb.inbounds[0].auto_route === false,
);
record("idle UDP state remains bounded", sb.inbounds[0].udp_timeout === "30s");
record("sing-box logging stays at warn level", sb.log.level === "warn");
record(
  "sing-box keeps exactly one proxy plus direct outbound",
  sb.outbounds.length === 2,
);
record(
  "private destinations bypass the sing-box tunnel",
  sb.route.rules[0].ip_is_private === true &&
    sb.route.rules[0].outbound === "direct",
);

/* --- process and network bounds --- */
record("the supervisor caps concurrent cores", supervisor.MAX_PROCESSES <= 4);
record("nested subscriptions are bounded", subscriptions.MAX_NESTED <= 32);
record(
  "total subscription bytes are bounded",
  subscriptions.MAX_TOTAL_BYTES <= 4 * 1024 * 1024,
);
record(
  "concurrent subscription fetches are bounded",
  httpClient.MAX_CONCURRENT <= 4,
);
record(
  "response bodies are bounded",
  httpClient.MAX_BODY_BYTES <= 2 * 1024 * 1024,
);
record(
  "decompressed responses are bounded",
  httpClient.MAX_DECOMPRESSED_BYTES <= 8 * 1024 * 1024,
);
record(
  "response headers are bounded",
  httpClient.MAX_HEADER_BYTES <= 32 * 1024,
);
record(
  "redirects are bounded",
  require(path.join(ROOT, "app", "service", "lib", "net", "ssrf.js"))
    .MAX_REDIRECTS <= 5,
);
record("diagnostic logs are size capped", logger.MAX_BYTES <= 512 * 1024);
record(
  "pairing windows are short lived",
  pairing.PAIRING_TTL_MS <= 10 * 60 * 1000,
);
record(
  "sessions have an absolute lifetime",
  pairing.SESSION_TOTAL_MS <= 60 * 60 * 1000,
);

/* --- routing teardown completeness (previously asserted against the shell) --- */
var issued = [];
var manager = new routes.RouteManager({
  logger: { info: function () {}, warn: function () {}, error: function () {} },
  core: "xray",
  stateFile: path.join(require("os").tmpdir(), "alcyone-route-test.json"),
  ipBinary: "/sbin/ip",
});
manager.ip = function (args) {
  issued.push(args);
  return { code: 0, stdout: "", stderr: "" };
};
manager.loadState = function () {
  return {
    original: { device: "wlan0", gateway: "192.168.1.1" },
    serverAddresses: ["203.0.113.9"],
  };
};
manager.readDefaultRoute = function () {
  return null;
};
manager.rollback();

function issuedMatching(predicate) {
  return issued.some(predicate);
}
record(
  "teardown removes every route attached to the TUN device",
  issuedMatching(function (a) {
    return a[0] === "route" && a[1] === "flush" && a.indexOf("alx0") >= 0;
  }),
);
record(
  "teardown removes stale TUN addresses",
  issuedMatching(function (a) {
    return a[0] === "addr" && a[1] === "flush" && a.indexOf("alx0") >= 0;
  }),
);
record(
  "teardown removes a persistent TUN device",
  issuedMatching(function (a) {
    return a[0] === "link" && a[1] === "delete" && a.indexOf("alx0") >= 0;
  }),
);
record(
  "teardown removes both split default routes",
  issuedMatching(function (a) {
    return a[0] === "route" && a[1] === "del" && a[2] === "0.0.0.0/1";
  }) &&
    issuedMatching(function (a) {
      return a[0] === "route" && a[1] === "del" && a[2] === "128.0.0.0/1";
    }),
);
record(
  "teardown removes the server bypass route",
  issuedMatching(function (a) {
    return a[0] === "route" && a[1] === "del" && a.indexOf("203.0.113.9") >= 0;
  }),
);
record(
  "teardown restores the original default route",
  issuedMatching(function (a) {
    return (
      a[0] === "route" &&
      a[1] === "replace" &&
      a[2] === "default" &&
      a.indexOf("wlan0") >= 0
    );
  }),
);
record(
  "every routing call uses an argument array, never a command string",
  issued.every(function (a) {
    return (
      Object.prototype.toString.call(a) === "[object Array]" &&
      a.every(function (part) {
        return (
          typeof part === "string" &&
          part.indexOf(";") < 0 &&
          part.indexOf("|") < 0
        );
      })
    );
  }),
);

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
