'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var listeners = {};
var elements = {};
['stateText', 'hint', 'power', 'current', 'webUrl', 'webState', 'webSub'].forEach(function (id) {
  elements[id] = { className: '', textContent: '', disabled: false };
});
var statusOutput = 'Alcyone: stopped\nWeb UI: stopped url=http://192.0.2.1:8080';
var requests = [];
var document = {
  hidden: false,
  getElementById: function (id) { return elements[id] || null; },
  addEventListener: function (name, cb) { listeners[name] = cb; }
};
var window = {
  localStorage: { getItem: function () { return null; } },
  webOS: { service: { request: function (uri, options) {
    requests.push(options.parameters.command);
    options.onSuccess({ stdout: statusOutput, stderr: '' });
  } } }
};
var context = {
  window: window,
  webOS: window.webOS,
  document: document,
  navigator: { language: 'en-US', languages: ['en-US'] },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: function () {},
  XMLHttpRequest: function () {},
  btoa: function (value) { return Buffer.from(value, 'binary').toString('base64'); },
  atob: function (value) { return Buffer.from(value, 'base64').toString('binary'); },
  escape: escape,
  unescape: unescape,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent
};
var appPath = path.join(__dirname, '..', 'app', 'app.js');
var source = fs.readFileSync(appPath, 'utf8').replace(/\}\)\(\);\s*$/, 'window.__vpnTest = { refreshStatus: refreshStatus, updateHome: updateHome, wireRuntimeLifecycle: wireRuntimeLifecycle };\n})();');
vm.runInNewContext(source, context, { filename: appPath });

context.window.__vpnTest.updateHome();
assert.strictEqual(elements.power.disabled, true, 'power must stay disabled until service state is known');

statusOutput = 'Alcyone: running xray=11 tun2socks=12\nWeb UI: running pid=13 url=http://192.0.2.1:8080';
context.window.__vpnTest.refreshStatus();
assert.ok(/\bon\b/.test(elements.power.className), 'running service must restore active UI');
assert.strictEqual(elements.power.disabled, false, 'power must be usable after state restoration');

statusOutput = 'ERROR: Luna bridge unavailable';
context.window.__vpnTest.refreshStatus();
assert.ok(/\bon\b/.test(elements.power.className), 'transient status failures must not overwrite known running state');

statusOutput = 'Alcyone: stopped\nWeb UI: stopped url=http://192.0.2.1:8080';
context.window.__vpnTest.refreshStatus();
assert.ok(!/\bon\b/.test(elements.power.className), 'stopped service must restore inactive UI');

context.window.__vpnTest.wireRuntimeLifecycle();
assert.strictEqual(typeof listeners.visibilitychange, 'function', 'foreground visibility listener must be registered');
assert.strictEqual(typeof listeners.webOSRelaunch, 'function', 'webOS relaunch listener must be registered');
assert.ok(requests.some(function (command) { return /alcyonectl\.sh status$/.test(command); }), 'state restoration must query the control service');

console.log('VPN lifecycle state restoration tests passed');
