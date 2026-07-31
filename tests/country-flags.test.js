'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var countries = require(path.join(ROOT, 'app', 'countries'));
var parsers = require(path.join(ROOT, 'app', 'service', 'lib', 'proto', 'parsers'));
var templates = require(path.join(ROOT, 'app', 'service', 'lib', 'web', 'templates'));
var checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log('ok   - ' + name);
}

check('the effective country set exactly matches bundled native SVG flags', function () {
  var svgCodes = fs.readdirSync(path.join(ROOT, 'app', 'flags'))
    .filter(function (name) { return /^[a-z]{2}\.svg$/.test(name) && name !== 'un.svg'; })
    .map(function (name) { return name.slice(0, 2); })
    .sort();
  assert.deepStrictEqual(countries.supportedCodes(), svgCodes);
});

check('supported countries map to the matching native SVG and web emoji', function () {
  assert.strictEqual(countries.nativeSrc('NL'), 'flags/nl.svg');
  assert.strictEqual(countries.emoji('NL'), '🇳🇱');
  assert.strictEqual(parsers.flagEmoji('nl'), '🇳🇱');
});

check('unknown, unsupported and removed country codes share the UN fallback', function () {
  ['zz', 'so', 'su', '', null].forEach(function (code) {
    assert.strictEqual(countries.normalize(code), 'un');
    assert.strictEqual(countries.nativeSrc(code), 'flags/un.svg');
    assert.strictEqual(countries.emoji(code), '🇺🇳');
    assert.strictEqual(parsers.flagEmoji(code), '🇺🇳');
  });
});

check('the web importer renders Unicode flags and never references SVG flag assets', function () {
  var html = templates.importerPage('en', {
    csrf: 'test-csrf',
    subscriptions: [],
    profiles: [
      { id: 'nl', name: 'Amsterdam', endpoint: 'nl.example.test:443', protocol: 'vless', country: 'nl' },
      { id: 'old', name: 'Removed', endpoint: 'old.example.test:443', protocol: 'trojan', country: 'su' },
      { id: 'unknown', name: 'Unknown', endpoint: 'unknown.example.test:443', protocol: 'ss', country: 'zz' }
    ]
  });
  assert.ok(html.indexOf('🇳🇱') >= 0);
  assert.ok(html.indexOf('🇺🇳') >= 0);
  assert.strictEqual(html.indexOf('flags/'), -1);
  assert.strictEqual(html.indexOf('.svg'), -1);
});

check('the native TV frontend loads and uses the shared mapping before app startup', function () {
  var index = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  var app = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  assert.ok(index.indexOf('<script src="countries.js"></script>') <
    index.indexOf('<script src="app.js"></script>'));
  assert.ok(app.indexOf('COUNTRIES.nativeSrc(code)') >= 0);
  assert.ok(app.indexOf("this.src = 'flags/un.svg'") >= 0);
});

console.log('country flags: ' + checks + ' checks passed');
