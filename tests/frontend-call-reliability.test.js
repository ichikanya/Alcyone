"use strict";

/* A Luna call that never comes back must not freeze the UI.

   On webOS 4.4.3 a service that is jailed, unelevated or dead never answers and
   Luna reports nothing at all. The UI disables a control and swaps in a
   "Loading..." label on the way into a call, so a callback that never runs
   leaves the Logs page stuck on "Loading..." and the Web Import row disabled —
   the exact fault reported on an LG 55UK6200PLA.

   These checks drive app.js against a PalmServiceBridge that never replies. */

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(ROOT, "app", "app.js"), "utf8");

var results = [];
function record(name, ok, detail) {
  results.push(!!ok);
  console.log(
    (ok ? "ok   - " : "FAIL - ") + name + (detail ? " (" + detail + ")" : ""),
  );
}

/* --- minimal DOM ---------------------------------------------------------- */

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
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
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
  "webHint",
].forEach(function (id) {
  elements[id] = makeElement(id);
});

var documentStub = {
  body: makeElement("body"),
  documentElement: makeElement("html"),
  activeElement: null,
  hidden: false,
  getElementById: function (id) {
    return Object.prototype.hasOwnProperty.call(elements, id)
      ? elements[id]
      : null;
  },
  querySelectorAll: function () {
    return [];
  },
  querySelector: function () {
    return null;
  },
  createElement: function (tag) {
    return makeElement(tag);
  },
  addEventListener: function (name, fn) {
    listeners[name] = fn;
  },
};

/* --- controllable clock --------------------------------------------------- */

var timers = [];
var timerSeq = 0;
function fakeSetTimeout(fn, ms) {
  var id = ++timerSeq;
  timers.push({ id: id, fn: fn, ms: ms || 0 });
  return id;
}
function fakeClearTimeout(id) {
  timers = timers.filter(function (t) {
    return t.id !== id;
  });
}
/* Fire only long deadlines: the per-call Luna timeout, not the UI's short
   cosmetic timers. */
function fireDeadlines() {
  var due = timers.filter(function (t) {
    return t.ms >= 10000;
  });
  timers = timers.filter(function (t) {
    return t.ms < 10000;
  });
  due.forEach(function (t) {
    t.fn();
  });
  return due.length;
}

/* --- a bridge that never answers ------------------------------------------ */

var bridges = [];
function PalmServiceBridge() {
  this.onservicecallback = null;
  this.calledWith = null;
  bridges.push(this);
}
PalmServiceBridge.prototype.call = function (uri, payload) {
  this.calledWith = { uri: uri, payload: payload };
};

var windowStub = {
  ALCYONE_EDITION: {
    appId: "com.alcyone.vpn",
    serviceId: "com.alcyone.vpn.service",
    core: "xray",
    coreLabel: "XRay",
    editionName: "XRay Edition",
    title: "Alcyone XRay",
    version: "4.0.1",
  },
  localStorage: {
    getItem: function () {
      return null;
    },
    setItem: function () {},
  },
  addEventListener: function () {},
  PalmServiceBridge: PalmServiceBridge,
  /* deliberately no window.webOS: exercise the raw bridge path a TV uses */
};

var context = {
  window: windowStub,
  document: documentStub,
  navigator: { language: "ru-RU", languages: ["ru-RU"] },
  localStorage: windowStub.localStorage,
  PalmServiceBridge: PalmServiceBridge,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
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
listeners.DOMContentLoaded();

record(
  "frontend uses PalmServiceBridge when window.webOS is absent",
  bridges.length > 0,
  bridges.length + " bridge(s)",
);
record(
  "bridge is addressed with the scoped service URI",
  bridges.length > 0 &&
    String(bridges[0].calledWith.uri).indexOf(
      "luna://com.alcyone.vpn.service/",
    ) === 0,
  bridges.length ? bridges[0].calledWith.uri : "none",
);

/* An in-flight bridge must stay referenced, or it can be collected before the
   native reply lands and the response is lost. */
record(
  "an in-flight bridge keeps a live onservicecallback reference",
  bridges.length > 0 && typeof bridges[0].onservicecallback === "function",
);

/* --- the reported symptom -------------------------------------------------- */

/* Complete the boot state/profile calls, then leave the state refresh started
   by the power button unanswered. This is the exact window in which the old
   frontend cleared the local "connecting" label and silently returned. */
if (bridges[0] && bridges[0].onservicecallback) {
  bridges[0].onservicecallback(
    JSON.stringify({
      returnValue: true,
      ok: true,
      vpn: { state: "idle", connected: false },
      lan: { pairingActive: false, secondsRemaining: 0 },
      autostart: false,
      health: { code: "" },
      privilege: { root: true },
      revision: "r1",
    }),
  );
}
var profilesBridge = bridges[bridges.length - 1];
if (
  profilesBridge &&
  profilesBridge.onservicecallback &&
  profilesBridge !== bridges[0]
) {
  profilesBridge.onservicecallback(
    JSON.stringify({
      returnValue: true,
      ok: true,
      profiles: [
        {
          id: "p1",
          name: "Test server",
          protocol: "vless",
          country: "nl",
          endpoint: "example.test:443",
          sourceType: "single",
        },
      ],
      subscriptions: [],
      activeId: "p1",
      autostartProfileId: null,
      lang: "auto",
      revision: "r1",
    }),
  );
}

var logsButton = elements.logsRefresh;
var bridgeCountBeforeLogs = bridges.length;

elements.power.onclick();
record(
  "power press immediately shows the connecting target",
  elements.stateText.textContent.indexOf("Подключение к") === 0,
  elements.stateText.textContent,
);
var powerDeadlines = fireDeadlines();
record(
  "a stale state refresh reports its failure instead of clearing the action",
  powerDeadlines > 0 &&
    elements.log.textContent.indexOf("elevate-service") >= 0 &&
    elements.stateText.textContent.indexOf("не отвечает") >= 0,
  elements.stateText.textContent,
);

logsButton.onclick();
var loadingLabel = logsButton.textContent;
record(
  "log refresh disables its button and shows a loading label",
  logsButton.disabled === true && loadingLabel.length > 0,
  loadingLabel,
);
record(
  "log refresh issued a getLogs call over the bridge",
  bridges.length === bridgeCountBeforeLogs + 2 &&
    bridges[bridges.length - 1].calledWith.uri.indexOf("/getLogs") > 0,
);

var fired = fireDeadlines();
record(
  "a call with no reply eventually hits its deadline",
  fired > 0,
  fired + " deadline(s)",
);
record(
  'log refresh button recovers instead of staying on "Loading..."',
  logsButton.disabled === false && logsButton.textContent !== loadingLabel,
  logsButton.textContent,
);
record(
  "the user is told the service is not answering",
  elements.log.textContent.indexOf("elevate-service") >= 0,
  elements.log.textContent.slice(-90).replace(/\n/g, " "),
);

/* The busy latch must clear too, or every later press is a no-op. */
var bridgeCountBeforeRetry = bridges.length;
logsButton.onclick();
record(
  "a second refresh is not blocked by a stale busy flag",
  bridges.length === bridgeCountBeforeRetry + 1,
);

/* --- Web Import row -------------------------------------------------------- */

fireDeadlines();
var pairBridges = bridges.length;
elements.pairStart.onclick();
record(
  '"Allow for 5 minutes" issues startPairing',
  bridges.length === pairBridges + 1 &&
    bridges[bridges.length - 1].calledWith.uri.indexOf("/startPairing") > 0,
  bridges.length > pairBridges
    ? bridges[bridges.length - 1].calledWith.uri
    : "no call",
);
fireDeadlines();
record(
  "a silent startPairing failure surfaces to the user rather than hanging",
  elements.log.textContent.indexOf("elevate-service") >= 0,
);

/* --- late replies ---------------------------------------------------------- */

var late = bridges[bridges.length - 1];
var threw = false;
try {
  if (late.onservicecallback) {
    late.onservicecallback(
      JSON.stringify({ returnValue: true, ok: true, code: "LATE" }),
    );
  }
} catch (e) {
  threw = true;
}
record("a reply arriving after the deadline is ignored safely", !threw);

var passed = results.filter(Boolean).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
if (passed !== results.length) process.exit(1);
