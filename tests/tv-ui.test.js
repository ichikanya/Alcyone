'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var body = {};
var document = {
  body: body,
  activeElement: null,
  addEventListener: function () {},
  getElementById: function () { return null; }
};
var window = { localStorage: { getItem: function () { return null; } } };
var context = {
  window: window,
  document: document,
  navigator: { language: 'en-US', languages: ['en-US'] },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: function () {},
  btoa: function (value) { return Buffer.from(value, 'binary').toString('base64'); },
  atob: function (value) { return Buffer.from(value, 'base64').toString('binary'); },
  escape: escape,
  unescape: unescape,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent
};
var appPath = path.join(__dirname, '..', 'app', 'app.js');
var source = fs.readFileSync(appPath, 'utf8').replace(/\}\)\(\);\s*$/, 'window.__tvUiTest = { focusTvElement: focusTvElement };\n})();');
vm.runInNewContext(source, context, { filename: appPath });

function pageScroller(scrollTop) {
  return {
    scrollTop: scrollTop,
    parentNode: body,
    classList: { contains: function (name) { return name === 'page'; } },
    getBoundingClientRect: function () { return { top: 0, bottom: 300, width: 800, height: 300 }; }
  };
}
function focusTarget(scroller, rect) {
  return {
    disabled: false,
    parentNode: scroller,
    focus: function () { scroller.scrollTop = 0; },
    getBoundingClientRect: function () { return rect; }
  };
}

var visiblePage = pageScroller(120);
assert.strictEqual(context.window.__tvUiTest.focusTvElement(focusTarget(visiblePage, { top: 80, bottom: 160, width: 300, height: 80 })), true);
assert.strictEqual(visiblePage.scrollTop, 120, 'focusing an already visible server must preserve scroll position');

var belowPage = pageScroller(120);
context.window.__tvUiTest.focusTvElement(focusTarget(belowPage, { top: 280, bottom: 380, width: 300, height: 100 }));
assert.strictEqual(belowPage.scrollTop, 200, 'a server below the viewport must scroll only enough to reveal its bottom edge');

var abovePage = pageScroller(120);
context.window.__tvUiTest.focusTvElement(focusTarget(abovePage, { top: -25, bottom: 55, width: 300, height: 80 }));
assert.strictEqual(abovePage.scrollTop, 95, 'a server above the viewport must scroll only enough to reveal its top edge');

console.log('TV focus scroll tests passed');
