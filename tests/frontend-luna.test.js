"use strict";

/* Frontend contract tests.

   Runs app.js inside a minimal DOM/webOS stub and asserts that the UI talks
   only to scoped Luna methods, never constructs a shell command, and renders
   correctly from the sanitized metadata the service returns. */

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var APP = path.join(ROOT, "app", "app.js");
var source = fs.readFileSync(APP, "utf8");

var results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

/* --- static guarantees ------------------------------------------------- */

/* Arbitrary root execution stays forbidden outright. This is the property the
   original single guard was protecting, and it is now checked on its own terms
   rather than as a side effect of banning the word "hbchannel" — and it covers
   /spawn as well, which the earlier form did not. */
record(
  "frontend never references Homebrew Channel exec or spawn",
  source.indexOf("/exec") < 0 && source.indexOf("/spawn") < 0,
);

/* The frontend may address Homebrew Channel for exactly two narrowly scoped
   things, both explicitly allow-listed here:

     checkRoot       read-only; confirms the hard prerequisite is met
     elevateService  takes a single service id and grants the Alcyone service
                     the root it needs for tun0 and routing

   Neither is an arbitrary-execution endpoint. Anything else on that bus — and
   any method whose name is not a literal constant at its call site — is a
   failure. Note this is an allow-list, not a deny-list: a newly added method
   fails by default. */
var HB_ALLOWED_METHODS = ["checkRoot", "elevateService"];
var hbMethods = [];
var hbCallRe = /(?:lunaAt|te)\(\s*([A-Za-z_$][\w$]*)\s*,\s*["']([^"']+)["']/g;
var hbMatch;
while ((hbMatch = hbCallRe.exec(source)) !== null) {
  if (hbMatch[1].indexOf("HBCHANNEL") >= 0 || hbMatch[1] === "Et") hbMethods.push(hbMatch[2]);
}
record(
  "frontend calls only allow-listed Homebrew Channel methods",
  hbMethods.every(function (name) {
    return HB_ALLOWED_METHODS.indexOf(name) >= 0;
  }),
  hbMethods.length ? hbMethods.join(",") : "none",
);

/* Elevation must actually be reachable: an allow-list that passes because the
   call was silently dropped would be a vacuous guard. */
record(
  "frontend still performs the allow-listed elevation call",
  hbMethods.indexOf("elevateService") >= 0,
);

/* Every Homebrew Channel call site must name its method as a string literal.
   A variable there would let the allow-list above be bypassed at runtime. */
var hbVariableMethodRe =
  /lunaAt\(\s*[A-Za-z_$][\w$]*HBCHANNEL[\w$]*\s*,\s*[^'\s]/;
record(
  "Homebrew Channel method names are string literals",
  !hbVariableMethodRe.test(source),
);

/* The Homebrew Channel service URI must be a constant, never assembled from a
   profile, a subscription or anything else a caller could influence. */
record(
  "Homebrew Channel URI is a literal constant",
  /["']luna:\/\/org\.webosbrew\.hbchannel\.service["']/.test(source) ||
    source.indexOf("hbchannel") < 0,
);

/* The URI must appear exactly once, as that constant. A second spelling — or
   one built by concatenation — is how a fixed target quietly stops being
   fixed. */
var hbUriOccurrences = source.split("org.webosbrew.hbchannel").length - 1;
record(
  "Homebrew Channel URI appears exactly once",
  hbUriOccurrences === 1,
  String(hbUriOccurrences),
);
record(
  "Homebrew Channel URI is never concatenated",
  !/['"]luna:\/\/org\.webosbrew[^'"]*['"]\s*\+/.test(source) &&
    !/\+\s*['"][^'"]*org\.webosbrew/.test(source),
);

/* The elevation target must be a fixed edition constant matched against a
   closed list, never whatever the edition table happens to contain and never
   anything derived from user input. */
record(
  "elevation target ids are a fixed closed list",
  /(?:ELEVATABLE_SERVICE_IDS|Tt)\s*=\s*\[\s*["']com\.alcyone\.vpn\.service["']\s*,\s*["']com\.alcyone\.vpn\.singbox\.service["']\s*\]/.test(
    source,
  ),
);
record(
  "elevation id is validated against that list before use",
  /(?:ELEVATABLE_SERVICE_IDS|Tt)\.indexOf\((?:id|t)\)\s*>=\s*0/.test(source),
);

/* No user-controlled source may flow into an elevation call. */
var elevateOffset = source.indexOf('te(Et, "elevateService"');
if (elevateOffset < 0) elevateOffset = source.indexOf("lunaAt(HBCHANNEL, 'elevateService'");
var elevateCall = source.slice(elevateOffset);
elevateCall = elevateCall.slice(0, elevateCall.indexOf("\n") + 1);
record(
  "elevation call passes only the validated constant id",
  /(?:lunaAt\(HBCHANNEL, 'elevateService', \{ id: id \}, ELEVATE_TIMEOUT_MS,|te\(Et, "elevateService", \{ id: r \}, 6e4,)/.test(elevateCall),
  elevateCall.trim(),
);
["value", "search", "profile", "subscription", "input", "params."].forEach(
  function (token) {
    record(
      "elevation call carries no " + token,
      elevateCall.indexOf(token) < 0,
    );
  },
);
record("frontend has no shell quoting helper", source.indexOf("shQuote") < 0);
record(
  "frontend does not build core configs",
  source.indexOf("buildConfig") < 0 && source.indexOf("streamSettings") < 0,
);
record(
  "frontend does not parse proxy links",
  source.indexOf("parseProxyLink") < 0,
);
record(
  "frontend has no direct HTTP client",
  source.indexOf("XMLHttpRequest") < 0,
);
record(
  "frontend references the retired control script nowhere",
  source.indexOf("alcyonectl") < 0,
);
record(
  "frontend does not reference the unrelated legacy app",
  source.indexOf("vless.m.vpn") < 0,
);

/* --- runtime behaviour -------------------------------------------------- */

var PROFILES = [
  {
    id: "p1",
    name: "NL Reality",
    protocol: "vless",
    country: "nl",
    endpoint: "a.example.com:443",
    transport: "ws",
    security: "reality",
    sourceType: "single",
    subscriptionId: "",
    subscriptionName: "",
    hasFullConfig: false,
    selected: true,
  },
  {
    id: "p2",
    name: "DE Node",
    protocol: "trojan",
    country: "de",
    endpoint: "b.example.com:443",
    transport: "tcp",
    security: "tls",
    sourceType: "subscription",
    subscriptionId: "s1",
    subscriptionName: "My Sub",
    hasFullConfig: false,
    selected: false,
  },
];

var calls = [];
var elements = {};
var listeners = {};

function makeElement(id) {
  return {
    id: id,
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    style: {},
    childNodes: [],
    classList: {
      add: function () {},
      remove: function () {},
      contains: function () {
        return false;
      },
    },
    getAttribute: function () {
      return null;
    },
    setAttribute: function () {},
    removeAttribute: function () {},
    querySelectorAll: function () {
      return [];
    },
    querySelector: function () {
      return null;
    },
    contains: function () {
      return false;
    },
    getBoundingClientRect: function () {
      return { width: 10, height: 10, top: 0, bottom: 10, left: 0, right: 10 };
    },
    focus: function () {},
    addEventListener: function () {},
    onclick: null,
  };
}
[
  "stateText",
  "hint",
  "power",
  "current",
  "homeStage",
  "serverList",
  "count",
  "search",
  "pingServers",
  "refresh",
  "subUpdate",
  "log",
  "logsRefresh",
  "clearLog",
  "freezeLog",
  "autostartState",
  "langState",
  "restartSub",
  "checkIpSub",
  "rowRestart",
  "rowCheckIp",
  "rowLang",
  "rowAutostart",
  "rowPair",
  "pairStart",
  "pairStop",
  "pairState",
  "pairBox",
  "rowLogs",
  "rowAbout",
  "rowDonate",
  "rowDonate2",
  "editionBrand",
  "editionVersion",
  "aboutVersion",
  "webUrl",
  "webState",
  "webSub",
  "autostart",
  "autostartToggle",
  "autostartChoose",
  "autostartPageState",
  "autostartServerSummary",
  "autostartStatus",
  "dns",
  "dnsInput",
  "dnsSave",
  "dnsDefault",
  "dnsStatus",
  "dnsModeValue",
  "vpnDnsState",
  "rowVpnDns",
].forEach(function (id) {
  elements[id] = makeElement(id);
});

var documentStub = {
  hidden: false,
  activeElement: null,
  body: { classList: { add: function () {}, remove: function () {} } },
  getElementById: function (id) {
    return elements[id] || null;
  },
  querySelectorAll: function () {
    return [];
  },
  querySelector: function () {
    return null;
  },
  addEventListener: function (name, cb) {
    listeners[name] = cb;
  },
  removeEventListener: function () {},
};

/* The stub answers exactly like the real service would. */
function serviceRespond(method, params, onSuccess) {
  if (method === "getProfiles") {
    return onSuccess({
      returnValue: true,
      ok: true,
      profiles: PROFILES,
      subscriptions: [
        {
          id: "s1",
          name: "My Sub",
          host: "panel.example.com",
          count: 1,
          lastUpdate: 0,
          hasError: false,
        },
      ],
      activeId: "p1",
      autostartProfileId: "p1",
      lang: "auto",
      revision: "r1",
    });
  }
  if (method === "getProfilesMeta")
    return onSuccess({ returnValue: true, ok: true, revision: "r1" });
  if (method === "getState") {
    return onSuccess({
      returnValue: true,
      ok: true,
      edition: {
        id: "xray",
        core: "xray",
        coreLabel: "XRay",
        title: "Alcyone XRay",
        version: "3.2.1",
      },
      vpn: {
        state: "idle",
        connected: false,
        connectedAt: 0,
        profileId: "",
        lastErrorCode: "",
        ownsTunnel: false,
        tunnelOwner: "",
      },
      lan: { pairingActive: false, secondsRemaining: 0, sessions: 0 },
      autostart: false,
      revision: "r1",
    });
  }
  if (
    method === "setLanguage" ||
    method === "setAutostart" ||
    method === "setDnsServer" ||
    method === "setAutostartProfile"
  ) {
    return onSuccess({ returnValue: true, ok: true });
  }
  if (method === "startPairing") {
    return onSuccess({
      returnValue: true,
      ok: true,
      code: "ABCD2345",
      expiresAt: Date.now() + 300000,
      port: 8080,
      addresses: ["192.168.1.50"],
    });
  }
  if (method === "getLogs") {
    return onSuccess({
      returnValue: true,
      ok: true,
      log: "service-started-marker",
      tunnelLog: "vpn-core-marker",
    });
  }
  return onSuccess({ returnValue: true, ok: true });
}

var windowStub = {
  ALCYONE_EDITION: {
    appId: "com.alcyone.vpn",
    serviceId: "com.alcyone.vpn.service",
    core: "xray",
    coreLabel: "XRay",
    editionName: "XRay Edition",
    title: "Alcyone XRay",
    version: "3.2.1",
  },
  localStorage: {
    getItem: function () {
      return null;
    },
    setItem: function () {},
  },
  addEventListener: function () {},
  webOS: {
    service: {
      request: function (uri, options) {
        calls.push({
          uri: uri,
          method: options.method,
          parameters: options.parameters,
        });
        serviceRespond(
          options.method,
          options.parameters,
          options.onSuccess || function () {},
        );
      },
    },
  },
};

var context = {
  window: windowStub,
  webOS: windowStub.webOS,
  document: documentStub,
  navigator: { language: "ru-RU", languages: ["ru-RU"] },
  localStorage: windowStub.localStorage,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: function () {
    return 0;
  },
  clearInterval: function () {},
  Date: Date,
  Math: Math,
  console: console,
  JSON: JSON,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object,
  isFinite: isFinite,
  parseInt: parseInt,
  parseFloat: parseFloat,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
};
context.self = context;
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: "app.js" });

/* Boot the app. */
listeners.DOMContentLoaded();

var methods = calls.map(function (c) {
  return c.method;
});
record(
  "frontend calls only the Alcyone service URI",
  calls.every(function (c) {
    return (
      c.uri === "luna://com.alcyone.vpn.service" ||
      c.uri === "luna://com.webos.settingsservice"
    );
  }),
  calls
    .map(function (c) {
      return c.uri;
    })
    .join(","),
);
record("frontend requests state on boot", methods.indexOf("getState") >= 0);
record(
  "frontend requests profiles on boot",
  methods.indexOf("getProfiles") >= 0,
);
record(
  "no call carries a command parameter",
  calls.every(function (c) {
    return !c.parameters || c.parameters.command === undefined;
  }),
);

record(
  "server list renders from sanitized metadata",
  elements.serverList.innerHTML.indexOf("NL Reality") >= 0 &&
    elements.serverList.innerHTML.indexOf("DE Node") >= 0,
);
record(
  "server list shows endpoint and protocol badges",
  elements.serverList.innerHTML.indexOf("a.example.com:443") >= 0 &&
    elements.serverList.innerHTML.indexOf("VLESS") >= 0,
);
record(
  "server list groups subscription profiles",
  elements.serverList.innerHTML.indexOf("My Sub") >= 0,
);
record(
  "home shows the selected server",
  elements.current.innerHTML.indexOf("NL Reality") >= 0,
);
record(
  "profile count is localized",
  /2\s/.test(elements.count.textContent),
  elements.count.textContent,
);

/* Power button must ask the service to connect, not run anything. */
calls.length = 0;
elements.power.onclick();
var connectCall = calls.filter(function (c) {
  return c.method === "connect";
});
record("power button issues a connect method", connectCall.length === 1);
record(
  "connect call sends a structured payload",
  connectCall.length === 1 && typeof connectCall[0].parameters === "object",
);

/* Pairing must surface a code for the TV screen. */
calls.length = 0;
elements.pairStart.onclick();
record(
  "pairing start calls startPairing",
  calls.filter(function (c) {
    return c.method === "startPairing";
  }).length === 1,
);
record(
  "pairing code is displayed on the TV",
  elements.pairBox.innerHTML.indexOf("ABCD2345") >= 0,
);
record(
  "pairing shows the LAN address",
  elements.pairBox.innerHTML.indexOf("192.168.1.50") >= 0,
);

/* The viewer must show service startup failures and native core output. */
calls.length = 0;
elements.logsRefresh.onclick();
record(
  "log viewer requests bounded service logs",
  calls.filter(function (c) {
    return c.method === "getLogs";
  }).length === 1,
);
record(
  "log viewer renders both service and VPN core output",
  elements.log.textContent.indexOf("service-started-marker") >= 0 &&
    elements.log.textContent.indexOf("vpn-core-marker") >= 0,
);

/* Autostart toggle goes through the service. */
calls.length = 0;
elements.autostartToggle.onclick();
record(
  "autostart toggle calls setAutostart",
  calls.filter(function (c) {
    return c.method === "setAutostart";
  }).length === 1,
);

/* DNS save goes through the service. */
calls.length = 0;
elements.dnsSave.onclick();
record(
  "dns save calls setDnsServer",
  calls.filter(function (c) {
    return c.method === "setDnsServer";
  }).length === 1,
);

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
