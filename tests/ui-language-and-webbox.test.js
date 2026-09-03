"use strict";

/* Regression tests for two TV-observable frontend defects:

   1. Switching language updated the interface but left the language row's own
      value stale, because updateLangUi() called a function that no longer
      existed and threw before reaching the label.
   2. The home screen's web-import box was left over from the always-listening
      importer and showed "starting..." forever, since nothing wrote to it
      after pairing became opt-in.

   Both are exercised through the real app.js code paths against a stub DOM. */

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

/* ---------- minimal DOM ---------- */
function Element(id) {
  this.id = id;
  this.textContent = "";
  this.innerHTML = "";
  this.className = "";
  this.disabled = false;
  this.attrs = {};
  this.children = [];
  this.style = {};
  this.classList = {
    contains: function () {
      return false;
    },
    add: function () {},
    remove: function () {},
  };
}
Element.prototype.setAttribute = function (k, v) {
  this.attrs[k] = String(v);
};
Element.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attrs, k)
    ? this.attrs[k]
    : null;
};
Element.prototype.removeAttribute = function (k) {
  delete this.attrs[k];
};
Element.prototype.querySelectorAll = function () {
  return [];
};
Element.prototype.addEventListener = function () {};
Element.prototype.appendChild = function (c) {
  this.children.push(c);
  return c;
};
Element.prototype.getBoundingClientRect = function () {
  return { top: 0, bottom: 100, width: 100, height: 100 };
};

var elements = {};
function el(id) {
  if (!elements[id]) elements[id] = new Element(id);
  return elements[id];
}

/* Ids the app touches on the home, servers and settings screens. */
var IDS = [
  "stateText",
  "hint",
  "power",
  "current",
  "homeStage",
  "webUrl",
  "webHint",
  "webPairInfo",
  "webCode",
  "webExpiry",
  "pairState",
  "pairBox",
  "langState",
  "autostartState",
  "log",
  "list",
  "srvCount",
  "probeBtn",
  "subBtn",
  "search",
  "sortState",
  "coreState",
  "verState",
  "translationProbe",
];
IDS.forEach(el);
el("translationProbe").setAttribute("data-i18n", "common.checking");

var document = {
  body: el("body"),
  activeElement: null,
  documentElement: el("html"),
  addEventListener: function () {},
  getElementById: function (id) {
    return Object.prototype.hasOwnProperty.call(elements, id)
      ? elements[id]
      : null;
  },
  querySelectorAll: function (sel) {
    /* applyI18n() walks [data-i18n]; return the nodes carrying that attribute. */
    if (sel === "[data-i18n]") {
      return Object.keys(elements)
        .map(function (k) {
          return elements[k];
        })
        .filter(function (node) {
          return node.getAttribute("data-i18n") !== null;
        });
    }
    return [];
  },
  createElement: function (tag) {
    return new Element("<" + tag + ">");
  },
};

var window = {
  localStorage: {
    getItem: function () {
      return null;
    },
    setItem: function () {},
  },
  ALCYONE_EDITION: {
    appId: "com.alcyone.vpn",
    serviceId: "com.alcyone.vpn.service",
    core: "xray",
    coreLabel: "XRay",
    editionName: "XRay Edition",
    title: "Alcyone XRay",
    version: "3.2.1",
  },
};

var context = {
  window: window,
  document: document,
  navigator: { language: "en-US", languages: ["en-US"] },
  console: { log: function () {}, warn: function () {}, error: function () {} },
  setTimeout: function () {
    return 0;
  },
  clearTimeout: function () {},
  setInterval: function () {
    return 0;
  },
  clearInterval: function () {},
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  btoa: function (v) {
    return Buffer.from(v, "binary").toString("base64");
  },
  atob: function (v) {
    return Buffer.from(v, "base64").toString("binary");
  },
  escape: escape,
  unescape: unescape,
};

/* Expose the internals under test without altering production behaviour. */
var appPath = path.join(__dirname, "..", "app", "app.js");
var source = fs
  .readFileSync(appPath, "utf8")
  .replace(
    /\}\)\(\);\s*$/,
    "window.__t = {\n" +
      "  setLang: function (v) { ae = v; },\n" +
      "  updateLangUi: Se,\n" +
      "  renderPairing: vt,\n" +
      "  setPairing: function (p) { T = p; },\n" +
      "  webUrl: function () { return y; },\n" +
      "  tr: ge,\n" +
      "  langLabel: me\n" +
      "};\n})();",
  );
vm.runInNewContext(source, context, { filename: appPath });
var t = context.window.__t;

var checks = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}
function eq(a, b, msg) {
  assert.strictEqual(a, b, msg);
  checks++;
}

/* ---------- 1. language row label ---------- */

/* The defect was a thrown ReferenceError, so assert it does not throw at all. */
assert.doesNotThrow(function () {
  t.setLang("ru");
  t.updateLangUi();
}, "updateLangUi must not throw: a throw leaves the language row stale");
checks++;

var ruLabel = el("langState").textContent;
ok(
  ruLabel && ruLabel.length > 0,
  "language row must show a value after switching to Russian",
);
eq(ruLabel, t.langLabel(), "language row must match the active language label");

t.setLang("en");
t.updateLangUi();
var enLabel = el("langState").textContent;
ok(
  enLabel && enLabel.length > 0,
  "language row must show a value after switching to English",
);
ok(
  enLabel !== ruLabel,
  "language row label must change when the language changes",
);

/* The rest of the screen must be translated in the same pass. */
eq(
  el("translationProbe").textContent,
  t.tr("common.checking"),
  "applyI18n must still run when the language changes",
);

/* ---------- 2. home web-import box ---------- */

t.setPairing(null);
t.renderPairing();
eq(
  el("webUrl").textContent,
  t.tr("home.webOff"),
  'with pairing closed the home box must read "off", not "starting..."',
);
ok(
  el("webUrl").textContent.indexOf("...") < 0,
  'the home box must never be left showing a permanent "starting..." state',
);
eq(
  el("webUrl").getAttribute("data-i18n"),
  "home.webOff",
  "closed-state text must stay translatable",
);
eq(
  el("webHint").getAttribute("data-i18n"),
  "home.webHintOff",
  "closed-state hint must point users at Settings",
);

t.setPairing({
  code: "7F3K-92QD",
  port: 8080,
  addresses: ["192.168.1.50"],
  secondsRemaining: 300,
});
t.renderPairing();
eq(
  el("webUrl").textContent,
  "http://192.168.1.50:8080",
  "an open pairing window must publish the real address on the home screen",
);
eq(
  el("webUrl").getAttribute("data-i18n"),
  null,
  "a live address must not be overwritten by the next applyI18n pass",
);
eq(
  el("webHint").getAttribute("data-i18n"),
  "home.webHint",
  "open-state hint must tell the user to enter the on-screen code",
);
eq(
  el("webPairInfo").style.display,
  "block",
  "main screen pairing info container must be displayed when active",
);
eq(
  el("webCode").textContent,
  "7F3K-92QD",
  "main screen must display the active pairing code",
);
ok(
  el("webExpiry").textContent.indexOf("300") >= 0,
  "main screen must display remaining seconds",
);

/* The pairing code belongs on the TV only; the address line must not leak it. */
ok(
  el("webUrl").textContent.indexOf("7F3K") < 0,
  "the pairing code must not be embedded in the advertised URL",
);

/* Closing the window must retract the address and hide pair info. */
t.setPairing(null);
t.renderPairing();
eq(
  el("webUrl").textContent,
  t.tr("home.webOff"),
  "closing the pairing window must retract the advertised address",
);
eq(
  el("webPairInfo").style.display,
  "none",
  "closing the pairing window must hide the main screen pairing info container",
);

/* Language switching must survive with a live pairing window. */
t.setPairing({
  code: "ABCD-1234",
  port: 8080,
  addresses: ["10.0.0.7"],
  secondsRemaining: 120,
});
t.setLang("ru");
assert.doesNotThrow(function () {
  t.updateLangUi();
}, "updateLangUi must not throw while a pairing window is open");
checks++;
eq(
  el("webUrl").textContent,
  "http://10.0.0.7:8080",
  "a language switch must not wipe the live pairing address",
);
ok(
  el("langState").textContent === t.langLabel(),
  "language row must still update while pairing is open",
);

/* Static guard: no user-visible Russian may be baked into the markup without a
   localization key, or non-Russian users see it verbatim. Attribute text is
   easy to miss because it never appears on screen during review. */
var indexHtml = require("fs").readFileSync(
  require("path").join(__dirname, "..", "app", "index.html"),
  "utf8",
);
var CYRILLIC = /[А-яЁё]/;

indexHtml.replace(/aria-label="([^"]*)"/g, function (whole, value, offset) {
  if (!CYRILLIC.test(value)) return whole;
  var tag = indexHtml.slice(
    indexHtml.lastIndexOf("<", offset),
    offset + whole.length,
  );
  ok(
    tag.indexOf("data-i18n-aria=") >= 0,
    "Russian aria-label must carry data-i18n-aria: " + value,
  );
  return whole;
});

indexHtml.replace(/placeholder="([^"]*)"/g, function (whole, value, offset) {
  if (!CYRILLIC.test(value)) return whole;
  var tag = indexHtml.slice(
    indexHtml.lastIndexOf("<", offset),
    offset + whole.length,
  );
  ok(
    tag.indexOf("data-i18n-ph=") >= 0,
    "Russian placeholder must carry data-i18n-ph: " + value,
  );
  return whole;
});

/* applyI18n must localize aria labels, not just text and placeholders. */
ok(
  /\[data-i18n-aria\]/.test(
    require("fs").readFileSync(
      require("path").join(__dirname, "..", "app", "app.js"),
      "utf8",
    ),
  ),
  "applyI18n must translate [data-i18n-aria] elements",
);

console.log("ui-language-and-webbox: " + checks + " checks passed");
