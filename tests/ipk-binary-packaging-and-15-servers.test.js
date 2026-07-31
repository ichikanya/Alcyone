'use strict';

/* Regression test suite verifying:
   1. Subscription retrieval and parsing, for both an active and an expired
      subscription, against local fixtures.
   2. Both XRay and sing-box IPK packages contain their respective ARM ELF binaries with 0755 permissions at expected runtime paths. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var httpClient = require('../app/service/lib/net/http-client');
var subscriptions = require('../app/service/lib/net/subscriptions');
var parsers = require('../app/service/lib/proto/parsers');
var VpnManager = require('../app/service/lib/vpn/manager').VpnManager;
var editionLib = require('../app/service/lib/edition');

/* 1. Subscription retrieval and parsing.

   This used to fetch a real third-party subscription over the network, which
   made a mandatory release test depend on a panel staying up, on the machine
   having connectivity, and on a subscription staying unexpired — none of which
   the build controls. One of the project's two real subscriptions is in fact
   expired, so the live form of this test could not be green and correct at the
   same time.

   Both outcomes are now covered by local fixtures, so the release gate is
   deterministic and offline. The transport is stubbed at `fetchUrl`, which
   leaves everything above it real: the client-profile ladder, nested
   expansion, header merging, dedupe and the parser. No real subscription URL,
   token, UUID or credential appears in the fixtures — the hosts are
   `.example.test` and the UUIDs are structurally valid placeholders.

   A live check against a real subscription is available but optional and never
   release-blocking; see the end of this section. */
var FIXTURES = {
  'https://fixture.example.test/active': {
    body: fs.readFileSync(path.join(__dirname, 'fixtures', 'subscription-active.txt'), 'utf8'),
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'profile-title': 'Fixture Active',
      /* expire is in the future: 2099-01-01T00:00:00Z */
      'subscription-userinfo': 'upload=0; download=0; total=107374182400; expire=4070908800'
    }
  },
  'https://fixture.example.test/expired': {
    body: fs.readFileSync(path.join(__dirname, 'fixtures', 'subscription-expired.txt'), 'utf8'),
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      /* expire is in the past: 2025-01-01T00:00:00Z */
      'subscription-userinfo': 'upload=0; download=0; total=107374182400; expire=1735689600'
    }
  }
};

var realFetchUrl = httpClient.fetchUrl;
httpClient.fetchUrl = function (url, options, callback) {
  var fixture = FIXTURES[url];
  if (!fixture) return realFetchUrl(url, options, callback);
  process.nextTick(function () { callback(null, fixture.body, fixture.headers); });
};

var subscriptionChecks = 0;

/* 1a. An active subscription yields the full server set. */
subscriptions.download('https://fixture.example.test/active', function (err, result) {
  assert.ifError(err, 'Active subscription download must succeed');
  assert.strictEqual(result.imported.length, 15, 'The active subscription fixture MUST yield exactly 15 unique servers');

  var names = result.imported.map(function (p) { return p.name; });
  assert.ok(names.every(function (n) { return n && n.trim().length > 0; }), 'All server names must be non-empty and valid');
  assert.strictEqual(names.length, Object.keys(names.reduce(function (acc, n) { acc[n] = 1; return acc; }, {})).length,
    'Server names must be unique');
  assert.strictEqual(result.clients, 'Happ', 'Primary client candidate Happ must be used without redundant merging');
  assert.ok(!/expire/i.test(parsers.profileTitleFromHeaders(result.headers, '')),
    'An active subscription must not carry an expiry message');

  console.log('ok 1a - active subscription fixture imported exactly 15 unique servers with clean names');
  subscriptionChecks++;
});

/* 1b. An expired subscription yields the panel's expiry profile and message.

   An expired panel still answers with a well-formed subscription; what changes
   is that it carries a single notice profile and a `subscription-userinfo`
   whose `expire` is in the past. Both must survive parsing, because that
   notice is the only thing the user can be shown. */
subscriptions.download('https://fixture.example.test/expired', function (err, result) {
  assert.ifError(err, 'Expired subscription download must still parse');
  assert.strictEqual(result.imported.length, 1, 'The expired subscription fixture yields exactly one notice profile');
  assert.strictEqual(result.imported[0].name, 'Подписка истекла',
    'The expired-subscription notice must be preserved verbatim as the profile name');

  assert.strictEqual(parsers.profileTitleFromHeaders(result.headers, ''), 'Subscription expired',
    'The expired-subscription message must be read from the content headers');

  var userinfo = result.headers['subscription-userinfo'];
  assert.ok(userinfo, 'subscription-userinfo must be merged from the response headers');
  var expire = Number((/expire=(\d+)/.exec(userinfo) || [])[1]);
  assert.ok(expire > 0, 'subscription-userinfo must carry a parseable expire timestamp');
  assert.ok(expire * 1000 < Date.now(), 'The expired fixture must parse as expired, not as active');

  console.log('ok 1b - expired subscription fixture parsed into its notice profile and expiry message');
  subscriptionChecks++;
});

/* 1c. Optional live check. Never release-blocking.

   Off unless ALCYONE_LIVE_SUBSCRIPTION_URL is set, and a failure is reported
   without failing the suite. No URL is stored in the repository: the value is
   supplied by the operator at run time and is never printed. */
if (process.env.ALCYONE_LIVE_SUBSCRIPTION_URL) {
  /* The stub above passes any non-fixture URL through to the real transport,
     so this reaches the network unmodified. */
  subscriptions.download(process.env.ALCYONE_LIVE_SUBSCRIPTION_URL, function (liveError, liveResult) {
    if (liveError) {
      console.log('# optional live subscription check skipped: ' + liveError.code);
      return;
    }
    console.log('# optional live subscription check: ' + liveResult.imported.length + ' servers');
  });
}

process.on('exit', function (code) {
  if (code === 0 && subscriptionChecks !== 2) {
    console.error('subscription fixture checks did not both run (' + subscriptionChecks + '/2)');
    process.exitCode = 1;
  }
});


/* 2. IPK Package Inspection & Binary Verification */
function readTarEntries(tarBuffer) {
  var entries = {};
  var offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    var header = tarBuffer.slice(offset, offset + 512);
    if (header[0] === 0) break;
    var name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    var mode = parseInt(header.toString('utf8', 100, 108).trim(), 8);
    var size = parseInt(header.toString('utf8', 124, 136).trim(), 8);
    var typeflag = String.fromCharCode(header[156]);
    offset += 512;
    var data = tarBuffer.slice(offset, offset + size);
    entries[name] = { name: name, mode: mode, size: size, typeflag: typeflag, data: data };
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

function unpackDataTarFromIpk(ipkPath) {
  var buf = fs.readFileSync(ipkPath);
  assert.strictEqual(buf.slice(0, 8).toString('ascii'), '!<arch>\n', 'IPK must start with !<arch>\\n');
  var pos = 8;
  while (pos + 60 <= buf.length) {
    var name = buf.toString('ascii', pos, pos + 16).trim().replace(/\/$/, '');
    var size = parseInt(buf.toString('ascii', pos + 48, pos + 58).trim(), 10);
    pos += 60;
    var data = buf.slice(pos, pos + size);
    if (name === 'data.tar.gz') {
      var dataTar = zlib.gunzipSync(data);
      return readTarEntries(dataTar);
    }
    pos += size + (size % 2);
  }
  throw new Error('data.tar.gz not found in ' + ipkPath);
}

var packagesDir = path.join(__dirname, '..', 'packages');
var xrayIpk = path.join(packagesDir, 'Alcyone-XRay_4.0.3_arm.ipk');
var singboxIpk = path.join(packagesDir, 'Alcyone-sing-box_4.0.3_arm.ipk');

assert.ok(fs.existsSync(xrayIpk), 'XRay IPK package must exist');
assert.ok(fs.existsSync(singboxIpk), 'sing-box IPK package must exist');

var xrayEntries = unpackDataTarFromIpk(xrayIpk);
var singboxEntries = unpackDataTarFromIpk(singboxIpk);

/* Verify XRay IPK contents.

   Cores ship under the *application* payload only.

   This expectation was corrected: the test previously also required a second
   copy of every core under `usr/palm/services/<serviceId>/bin/`. The builder
   has never produced that copy, and the runtime does not need it —
   `VpnManager.resolveCores()` reaches the application payload through the
   `appDir` candidate, which `service.js` derives as the sibling
   `usr/palm/applications/<appId>` tree, and stages from there into the data
   directory on first use. Satisfying the old expectation would have meant
   duplicating roughly 37 MB of xray plus tun2socks (and 30 MB of routing data)
   into every package to be resolved by nobody, nearly doubling the IPK for no
   runtime benefit. The assertions below now pin the supported layout and
   actively forbid the duplication. */
var xrayExePath = 'usr/palm/applications/com.alcyone.vpn/bin/xray';
var tunExePath = 'usr/palm/applications/com.alcyone.vpn/bin/tun2socks';
var xrayServiceExePath = 'usr/palm/services/com.alcyone.vpn.service/bin/xray';
var tunServiceExePath = 'usr/palm/services/com.alcyone.vpn.service/bin/tun2socks';

assert.ok(xrayEntries[xrayExePath], 'XRay IPK app must contain bin/xray');
assert.ok(xrayEntries[tunExePath], 'XRay IPK app must contain bin/tun2socks');
assert.ok(!xrayEntries[xrayServiceExePath], 'XRay service payload must not duplicate bin/xray');
assert.ok(!xrayEntries[tunServiceExePath], 'XRay service payload must not duplicate bin/tun2socks');
assert.strictEqual(xrayEntries[xrayExePath].mode & 0o111, 0o111, 'bin/xray must have 0755 executable permission');
assert.strictEqual(xrayEntries[tunExePath].mode & 0o111, 0o111, 'bin/tun2socks must have 0755 executable permission');

/* The routing databases are large too and must likewise appear exactly once. */
assert.ok(xrayEntries['usr/palm/applications/com.alcyone.vpn/bin/geoip.dat'], 'geoip.dat must ship with the app payload');
assert.ok(!xrayEntries['usr/palm/services/com.alcyone.vpn.service/bin/geoip.dat'], 'service payload must not duplicate geoip.dat');
assert.ok(!xrayEntries['usr/palm/services/com.alcyone.vpn.service/bin/geosite.dat'], 'service payload must not duplicate geosite.dat');

/* Verify ARM ELF Header for XRay binaries */
assert.strictEqual(xrayEntries[xrayExePath].data.toString('ascii', 1, 4), 'ELF', 'xray must be an ELF binary');
assert.strictEqual(xrayEntries[xrayExePath].data.readUInt16LE(18), 40, 'xray binary must target ARM (e_machine == 40)');

console.log('ok 2 - XRay IPK carries ARM ELF cores once, in the app payload, with 0755 permissions');

/* Verify sing-box IPK contents */
var singboxExePath = 'usr/palm/applications/com.alcyone.vpn.singbox/bin/sing-box';
var singboxServiceExePath = 'usr/palm/services/com.alcyone.vpn.singbox.service/bin/sing-box';

assert.ok(singboxEntries[singboxExePath], 'sing-box IPK app must contain bin/sing-box');
assert.ok(!singboxEntries[singboxServiceExePath], 'sing-box service payload must not duplicate bin/sing-box');
assert.strictEqual(singboxEntries[singboxExePath].mode & 0o111, 0o111, 'bin/sing-box must have 0755 executable permission');
assert.strictEqual(singboxEntries[singboxExePath].data.toString('ascii', 1, 4), 'ELF', 'sing-box must be an ELF binary');
assert.strictEqual(singboxEntries[singboxExePath].data.readUInt16LE(18), 40, 'sing-box binary must target ARM (e_machine == 40)');

console.log('ok 3 - sing-box IPK carries its ARM ELF core once, in the app payload, with 0755 permission');

/* No large payload may appear under two prefixes in either package. */
function assertNoDuplicateLargeEntries(entries, label) {
  var byBasename = {};
  Object.keys(entries).forEach(function (name) {
    var entry = entries[name];
    if (entry.typeflag !== '0' || entry.size < 1024 * 1024) return;
    var base = name.split('/').pop();
    byBasename[base] = (byBasename[base] || 0) + 1;
  });
  Object.keys(byBasename).forEach(function (base) {
    assert.strictEqual(byBasename[base], 1, label + ' duplicates large payload ' + base);
  });
}
assertNoDuplicateLargeEntries(xrayEntries, 'XRay IPK');
assertNoDuplicateLargeEntries(singboxEntries, 'sing-box IPK');

console.log('ok 3b - neither package duplicates any payload larger than 1 MB');


/* 3. Runtime Resolution Test */
var xrayEdition = editionLib.DEFAULTS.xray;
var prepared = [];
var xrayPaths = editionLib.paths(xrayEdition, '/packaged/alcyone');
xrayPaths.dataDir = '/private/alcyone';
var xrayVpn = new VpnManager({
  edition: xrayEdition,
  paths: xrayPaths,
  coreIntegrity: {
    prepare: function (packaged, staged, name) {
      prepared.push({ packaged: packaged, staged: staged, name: name });
      return staged;
    },
    verifyForLaunch: function (file) { return file; }
  }
});
var resolvedXrayCores = xrayVpn.resolveCores();
assert.strictEqual(resolvedXrayCores.xray, '/private/alcyone/bin/xray');
assert.strictEqual(resolvedXrayCores.tun2socks, '/private/alcyone/bin/tun2socks');
assert.deepStrictEqual(prepared, [
  { packaged: '/packaged/alcyone/bin/xray', staged: '/private/alcyone/bin/xray', name: 'xray' },
  { packaged: '/packaged/alcyone/bin/tun2socks', staged: '/private/alcyone/bin/tun2socks', name: 'tun2socks' }
]);

console.log('ok 4 - VpnManager verifies packaged cores into fixed staged executable paths');

console.log('\nAll subscription-fixture and IPK binary packaging tests passed cleanly.');
