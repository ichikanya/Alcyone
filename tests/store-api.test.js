'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-store-api-'));
var port = 18080 + (process.pid % 1000);
var profiles = [];
var i;
for (i = 0; i < 700; i++) {
  profiles.push({
    id: 'profile-' + i,
    name: 'Large subscription server ' + i,
    protocol: 'vless',
    link: 'vless://00000000-0000-0000-0000-' + String(100000000000 + i) + '@server-' + i + '.example.test:443?security=tls#Server-' + i,
    sourceType: 'subscription',
    subscriptionId: 'large-subscription',
    fullConfig: { remarks: 'Server ' + i, routing: { rules: [{ type: 'field', domain: [Array(80).join('domain-' + i + '.example,')] }] } }
  });
}
var store = { profiles: profiles, subscriptions: [{ id: 'large-subscription', name: 'Large test subscription', url: 'https://example.test/sub' }], activeId: profiles[0].id };
var storeText = JSON.stringify(store, null, 2);
assert.ok(Buffer.byteLength(storeText) > 1024 * 1024, 'fixture must exceed one MiB');
fs.writeFileSync(path.join(dir, 'profiles.json'), storeText);

function request(method, pathname, data) {
  return new Promise(function (resolve, reject) {
    var body = data === undefined ? null : JSON.stringify(data);
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: pathname, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, function (res) {
      var text = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { text += chunk; });
      res.on('end', function () {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

var server = childProcess.spawn(process.execPath, [path.join(__dirname, '..', 'app', 'web', 'alcyone-web.js')], {
  env: Object.assign({}, process.env, { ALCYONE_DATA_DIR: dir, ALCYONE_WEB_HOST: '127.0.0.1', ALCYONE_WEB_PORT: String(port) }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var stderr = '';
server.stderr.on('data', function (chunk) { stderr += chunk.toString(); });

var ready = new Promise(function (resolve, reject) {
  var output = '';
  var timer = setTimeout(function () { reject(new Error('server startup timeout: ' + stderr)); }, 5000);
  server.stdout.on('data', function (chunk) {
    output += chunk.toString();
    if (output.indexOf('Alcyone web import listening') >= 0) { clearTimeout(timer); resolve(); }
  });
  server.on('exit', function (code) { reject(new Error('server exited with ' + code + ': ' + stderr)); });
});

ready.then(function () {
  return request('GET', '/api/profiles');
}).then(function (result) {
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.store.profiles.length, profiles.length);
  return request('POST', '/api/active', { id: 'profile-699' });
}).then(function (result) {
  assert.strictEqual(result.body.store.activeId, 'profile-699');
  return request('POST', '/api/settings', { lang: 'en' });
}).then(function (result) {
  assert.strictEqual(result.body.store.lang, 'en');
  return request('DELETE', '/api/profiles/profile-699');
}).then(function (result) {
  assert.strictEqual(result.body.store.profiles.length, profiles.length - 1);
  assert.notStrictEqual(result.body.store.activeId, 'profile-699');
  console.log('large store API tests passed (' + Buffer.byteLength(storeText) + ' bytes)');
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}).catch(function (err) {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
