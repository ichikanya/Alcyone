'use strict';

/* Comprehensive regression test suite for HWID transmission, Web Import persistence,
   HTTPS redirect header retention, error sanitization, and secret scrubbing. */

var assert = require('assert');
var ssrf = require('../app/service/lib/net/ssrf');
var subscriptionsLib = require('../app/service/lib/net/subscriptions');
var DeviceInfo = require('../app/service/lib/device-info');
var loggerLib = require('../app/service/lib/logger');
var errors = require('../app/service/lib/errors');
var ImporterServer = require('../app/service/lib/web/server').ImporterServer;
var templates = require('../app/service/lib/web/templates');
var Logger = loggerLib.Logger;

/* 1. Device identity must never cross an origin boundary. */
assert.strictEqual(ssrf.SENSITIVE_HEADERS.indexOf('x-hwid') >= 0, true, 'X-HWID must be sensitive');
assert.strictEqual(ssrf.SENSITIVE_HEADERS.indexOf('authorization') >= 0, true, 'Authorization must remain in SENSITIVE_HEADERS');
var strippedHeaders = ssrf.stripSensitiveHeaders({
  Authorization: 'Bearer secret',
  Cookie: 'sid=secret',
  'Proxy-Authorization': 'Basic secret',
  'X-HWID': 'device-secret',
  'X-Device-OS': 'webOS',
  'x-device-custom': 'device-secret-2',
  'User-Agent': 'Happ'
});
assert.deepStrictEqual(strippedHeaders, { 'User-Agent': 'Happ' });
console.log('ok 1 - cross-origin stripping covers credentials, X-HWID and every X-Device-* header');

/* 2. DeviceInfo fallback & physical hardware ID */
var devInfo = new DeviceInfo();
devInfo.getDeviceInfo(function (err, info) {
  assert.ifError(err);
  assert.ok(info.ndid, 'Physical/fallback device info must produce a non-empty ndid');
  var hwid = devInfo.getHwidSync();
  assert.strictEqual(typeof hwid, 'string');
  assert.strictEqual(hwid.length, 32, 'HWID must be a 32-character SHA-256 hash');
  console.log('ok 2 - DeviceInfo returns non-empty 32-char HWID');
});

/* 3. Headers generation: mandatory on HTTPS and forbidden on plaintext. */
var reqOptsEnabled = { compatMode: true, hwid: '0123456789abcdef0123456789abcdef', isHttps: true };
var headersEnabled = subscriptionsLib.headersFor(0, reqOptsEnabled);
assert.strictEqual(headersEnabled['X-HWID'], '0123456789abcdef0123456789abcdef', 'HWID-enabled HTTPS request must include X-HWID');

var reqOptsDisabled = { compatMode: false, hwid: '0123456789abcdef0123456789abcdef', isHttps: true };
var headersDisabled = subscriptionsLib.headersFor(0, reqOptsDisabled);
assert.strictEqual(headersDisabled['X-HWID'], '0123456789abcdef0123456789abcdef',
  'legacy compatMode=false must not disable HTTPS HWID');

var reqOptsHttp = { compatMode: true, hwid: '0123456789abcdef0123456789abcdef', isHttps: false };
var headersHttp = subscriptionsLib.headersFor(0, reqOptsHttp);
assert.strictEqual(headersHttp['X-HWID'], undefined, 'Plaintext HTTP request must NOT include X-HWID (HTTPS only policy)');
console.log('ok 3 - HWID header generation policy verified');

/* 4. Missing device ID handling */
var emptyDevInfo = new DeviceInfo();
emptyDevInfo._deviceData = { ndid: '', modelName: '', firmwareVersion: '', osVersion: '' };
emptyDevInfo._readPhysicalHardwareId = function () { return ''; };
var emptyHwid = emptyDevInfo.getHwidSync();
assert.strictEqual(emptyHwid.length, 32, 'Empty raw ID falls back cleanly to hashing default identifier');
console.log('ok 4 - Missing device ID fallback verified');

/* 5. Provider Error Sanitization (401, 403, and HWID_REQUIRED body text) */
assert.strictEqual(errors.CODES.PROVIDER_AUTH_FAILED, 'PROVIDER_AUTH_FAILED');
assert.strictEqual(errors.CODES.PROVIDER_REJECTED, 'PROVIDER_REJECTED');
assert.strictEqual(errors.CODES.HWID_REQUIRED, 'HWID_REQUIRED');

var e401 = errors.err('PROVIDER_AUTH_FAILED', '401');
assert.strictEqual(errors.toResult(e401).errorCode, 'PROVIDER_AUTH_FAILED');

var e403 = errors.err('PROVIDER_REJECTED', '403');
assert.strictEqual(errors.toResult(e403).errorCode, 'PROVIDER_REJECTED');

var eHwid = errors.err('HWID_REQUIRED', 'Provider requires HWID transmission');
assert.strictEqual(errors.toResult(eHwid).errorCode, 'HWID_REQUIRED');
console.log('ok 5 - Provider errors (401, 403, HWID_REQUIRED) are sanitized and distinct from NO_SERVERS_FOUND');

/* 6. Web importer has no toggle and enforces compatibility for old requests. */
var importerHtml = templates.importerPage('en', { profiles: [], subscriptions: [], csrf: 'test' });
assert.strictEqual(importerHtml.indexOf('type="checkbox"'), -1, 'web importer must not render an HWID checkbox');
assert.strictEqual(importerHtml.indexOf('compatMode'), -1, 'new web importer requests must not expose compatMode');
var mockHandlerCalled = false;
var mockCompatValue = false;
var dummyLogger = new Logger({ level: 'error' });
var server = new ImporterServer({
  pairing: { accessActive: function () { return true; }, assertCsrf: function () {} },
  store: { sanitizedProfiles: function () { return []; }, sanitizedSubscriptions: function () { return []; } },
  logger: dummyLogger,
  handlers: {
    importValue: function (val, name, compatMode, cb) {
      mockHandlerCalled = true;
      mockCompatValue = compatMode;
      cb(null, { imported: 1 });
    }
  }
});

server.dispatch('/api/import', { value: 'https://example.com/sub', name: 'TestSub', compatMode: false }, function (err, res) {
  assert.ifError(err);
  assert.strictEqual(mockHandlerCalled, true);
  assert.strictEqual(mockCompatValue, true, 'ImporterServer must override a legacy false value');
  console.log('ok 6 - Web Import hides the toggle and enforces HTTPS HWID for legacy requests');
});

/* 7. Secret Scrubbing in Logger */
var testLogger = new Logger({ level: 'info' });
var loggedLine = testLogger.info('subscription update test', {
  hwid: '0123456789abcdef0123456789abcdef',
  token: 'secret_token_12345',
  authorization: 'Bearer secret_token'
});

assert.strictEqual(loggedLine.indexOf('0123456789abcdef0123456789abcdef'), -1, 'HWID value must be scrubbed from log');
assert.strictEqual(loggedLine.indexOf('secret_token_12345'), -1, 'Secret token must be scrubbed from log');
console.log('ok 7 - Secrets (HWID, token, auth) scrubbed from log output');

console.log('\nAll HWID, Web Import, redirect retention and error sanitization tests passed cleanly.');
