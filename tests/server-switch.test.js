'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var appPath = path.join(__dirname, '..', 'app', 'app.js');
var app = fs.readFileSync(appPath, 'utf8');
var commands = [];
var apiBodies = [];

function element() {
  return {
    textContent: '', className: '', innerHTML: '', disabled: false,
    scrollHeight: 0, scrollTop: 0, clientHeight: 100,
    querySelectorAll: function () { return []; }
  };
}

var elements = {
  log: element(), stateText: element(), homeStage: element(), hint: element(),
  power: element(), current: element()
};
var document = {
  hidden: false,
  getElementById: function (id) { return elements[id] || null; },
  addEventListener: function () {},
  removeEventListener: function () {}
};

function MockXHR() {}
MockXHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
MockXHR.prototype.setRequestHeader = function () {};
MockXHR.prototype.abort = function () {};
MockXHR.prototype.send = function (body) {
  apiBodies.push(JSON.parse(body));
  var activeId = apiBodies[apiBodies.length - 1].id;
  this.readyState = 4;
  this.status = 200;
  this.responseText = JSON.stringify({ ok: true, store: testStore(activeId) });
  this.onreadystatechange();
};

var service = {
  request: function (uri, options) {
    var command = options.parameters.command;
    commands.push(command);
    options.onSuccess({ stdout: command.indexOf(' disconnect') >= 0 ? 'Stopped' : 'Started' });
  }
};
var webOS = { service: service };
var window = { localStorage: { getItem: function () { return null; } }, webOS: webOS };
var context = {
  window: window,
  webOS: webOS,
  document: document,
  XMLHttpRequest: MockXHR,
  navigator: { language: 'en-US', languages: ['en-US'] },
  console: console,
  Date: Date,
  setTimeout: function () { return 1; },
  clearTimeout: function () {},
  setInterval: function () { return 1; },
  clearInterval: function () {},
  btoa: function (value) { return Buffer.from(value, 'binary').toString('base64'); },
  atob: function (value) { return Buffer.from(value, 'base64').toString('binary'); },
  escape: escape,
  unescape: unescape,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent
};

function profile(id, host) {
  return { id: id, name: id, link: 'vless://00000000-0000-0000-0000-000000000000@' + host + ':443?security=tls&type=tcp#' + id };
}
function testStore(activeId) {
  return { profiles: [profile('old', 'old.example.test'), profile('new', 'new.example.test')], subscriptions: [], activeId: activeId };
}

var source = app.replace(/\}\)\(\);\s*$/, [
  'window.__switchTest = {',
  '  selectProfile: selectProfile,',
  '  configure: function (store, isRunning) { state = store; running = isRunning; statusKnown = true; vpnActionBusy = false; }',
  '};',
  '})();'
].join('\n'));
vm.runInNewContext(source, context, { filename: appPath });

context.window.__switchTest.configure(testStore('old'), true);
context.window.__switchTest.selectProfile('new');
assert.deepStrictEqual(apiBodies[0], { id: 'new' }, 'the selected profile must be persisted first');
assert.strictEqual(commands.length, 2, 'a connected server switch must issue exactly disconnect and start');
assert.ok(/alcyonectl\.sh disconnect$/.test(commands[0]), 'the old tunnel must be fully disconnected first');
assert.ok(/alcyonectl\.sh' start$/.test(commands[1]), 'the new tunnel must start only after cleanup');

commands.length = 0;
context.window.__switchTest.configure(testStore('new'), true);
context.window.__switchTest.selectProfile('new');
assert.strictEqual(commands.length, 0, 'selecting the already-active server must not restart the tunnel');

commands.length = 0;
context.window.__switchTest.configure(testStore('old'), false);
context.window.__switchTest.selectProfile('new');
assert.strictEqual(commands.length, 0, 'selecting a server while disconnected must not start VPN unexpectedly');

console.log('active server switch tests passed');
