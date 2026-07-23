'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcyone-import-api-'));
var appPort = 19080 + (process.pid % 1000);
var appServer = null;
var fixtureServer = null;
var fixturePort = 0;
var childFails = false;
var happHeaders = null;
var singboxHeaders = null;
var firstSingboxHwid = '';
var incidentalUrlRequests = 0;
var incyRequests = 0;

function vless(id, host, name, service) {
  return 'vless://' + id + '@' + host + ':443?security=tls&type=grpc&serviceName=' + service + '#' + encodeURIComponent(name);
}
var nodeA = vless('11111111-1111-1111-1111-111111111111', 'one.example.test', 'One', 'one');
var nodeB = vless('22222222-2222-2222-2222-222222222222', 'two.example.test', 'Two', 'two');
var nodeC = 'trojan://secret@three.example.test:443?type=tcp#Three';
var xhttpNode = 'vless://11111111-1111-1111-1111-111111111111@one.example.test:443?security=tls&type=xhttp&path=%2Fxhttp&mode=auto#One';
var duplicateNode = 'trojan://secret@shared.example.test:443?type=tcp#Shared';
var partialHysteria = 'hysteria2://secret@partial.example.test:443?sni=partial.example.test#Partial';

function request(port, method, pathname, data) {
  return new Promise(function (resolve, reject) {
    var body = data === undefined ? null : JSON.stringify(data);
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: pathname, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, function (res) {
      var text = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { text += chunk; });
      res.on('end', function () {
        var parsed = {};
        try { parsed = JSON.parse(text || '{}'); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, text: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function stop() {
  if (appServer) appServer.kill();
  if (fixtureServer) fixtureServer.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

fixtureServer = http.createServer(function (req, res) {
  var pathname = req.url.split('?')[0];
  var ua = String(req.headers['user-agent'] || '');
  if (/^INCY\//.test(ua)) incyRequests++;
  if (/^Happ\//.test(ua)) happHeaders = req.headers;
  if (/^singbox\//.test(ua)) {
    singboxHeaders = req.headers;
    if (!firstSingboxHwid) firstSingboxHwid = String(req.headers['x-hwid'] || '');
    else assert.strictEqual(req.headers['x-hwid'], firstSingboxHwid, 'sing-box HWID must remain stable between requests');
  }
  if (pathname === '/partial') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'profile-title': 'Primary comparison' });
    return res.end(/^Happ\//.test(ua) ? nodeA + '\n' + nodeB : nodeA);
  }
  if (pathname === '/complementary') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'profile-title': 'Complementary formats' });
    return res.end(/^Happ\//.test(ua) ? nodeA + '\n' + nodeB : nodeA + '\n' + xhttpNode);
  }
  if (pathname === '/singbox-required') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'profile-title': 'sing-box compatibility' });
    return res.end(/^singbox\//.test(ua) ? nodeA + '\n' + nodeB + '\n' + nodeC : partialHysteria);
  }
  if (pathname === '/duplicate-a' || pathname === '/duplicate-b') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(duplicateNode);
  }
  if (pathname === '/flaky') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('http://127.0.0.1:' + fixturePort + '/child-flaky');
  }
  if (pathname === '/encoded-parent') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(Buffer.from('http://127.0.0.1:' + fixturePort + '/child-flaky', 'utf8').toString('base64'));
  }
  if (pathname === '/mixed') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(nodeA + '\nhttp://127.0.0.1:' + fixturePort + '/incidental-dead-link');
  }
  if (pathname === '/incidental-dead-link') {
    incidentalUrlRequests++;
    res.writeHead(503);
    return res.end('not a child subscription');
  }
  if (pathname === '/child-flaky') {
    if (childFails) { res.writeHead(503); return res.end('temporary failure'); }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(nodeA + '\n' + nodeB);
  }
  res.writeHead(404);
  res.end('not found');
});

fixtureServer.listen(0, '127.0.0.1', function () {
  fixturePort = fixtureServer.address().port;
  appServer = childProcess.spawn(process.execPath, [path.join(__dirname, '..', 'app', 'web', 'alcyone-web.js')], {
    env: Object.assign({}, process.env, { ALCYONE_DATA_DIR: dir, ALCYONE_WEB_HOST: '127.0.0.1', ALCYONE_WEB_PORT: String(appPort) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  var stderr = '', stdout = '', started = false;
  var startupTimer = setTimeout(function () {
    if (!started && !appServer.killed) { console.error('server startup timeout: ' + stderr); process.exitCode = 1; stop(); }
  }, 5000);
  appServer.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
  appServer.stdout.on('data', function (chunk) {
    stdout += chunk.toString();
    if (started || stdout.indexOf('Alcyone web import listening') < 0) return;
    started = true;
    clearTimeout(startupTimer);
    run().catch(function (err) {
      console.error(err && err.stack || err);
      process.exitCode = 1;
      stop();
    });
  });
  appServer.on('exit', function (code) {
    if (process.exitCode) return;
    if (code && code !== 0) { console.error('server exited with ' + code + ': ' + stderr); process.exitCode = 1; stop(); }
  });
});

async function run() {
  var result = await request(appPort, 'GET', '/');
  assert.strictEqual(result.status, 200);
  assert.ok(result.text.indexOf('/api/import') >= 0, 'unified importer endpoint must be used by the page');
  assert.strictEqual((result.text.match(/id="importValue"/g) || []).length, 1, 'the page must render one importer');

  result = await request(appPort, 'POST', '/api/import', { name: 'Encoded manual', value: 'trojan://pa%23ss@manual.example.test:443#Manual' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.kind, 'profile');
  assert.strictEqual(result.body.count, 1);

  result = await request(appPort, 'POST', '/api/import', { name: '', value: 'http://127.0.0.1:' + fixturePort + '/partial' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.kind, 'subscription');
  assert.strictEqual(result.body.count, 2, 'canonical HAPP and sing-box responses must be deduplicated');
  assert.ok(/Happ\/3\.1\.0\//.test(result.body.clientProfile));
  assert.ok(/singbox\/1\.12\.0/.test(result.body.clientProfile));
  assert.ok(happHeaders, 'a canonical HAPP request must be sent');
  assert.strictEqual(happHeaders['x-client'], undefined, 'HAPP requests must not contain another client identity');
  assert.strictEqual(happHeaders['x-app-version'], undefined, 'HAPP subscription requests must not contain updater headers');
  assert.strictEqual(happHeaders['x-device-os'], 'Android');
  assert.strictEqual(happHeaders['x-device-model'], 'Android TV');
  assert.ok(/^[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{12}$/.test(happHeaders['x-hwid']));

  result = await request(appPort, 'POST', '/api/import', { name: '', value: 'http://127.0.0.1:' + fixturePort + '/complementary' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.count, 3, 'unique nodes from equally sized HAPP and sing-box responses must be merged');
  var complementaryProfiles = result.body.store.profiles.filter(function (p) { return p.subscriptionId === result.body.subscription.id; });
  assert.ok(complementaryProfiles.some(function (p) { return /[?&]type=xhttp(?:&|#|$)/.test(p.link); }), 'an XHTTP node present only in one client response must not be dropped');

  result = await request(appPort, 'POST', '/api/import', { name: '', value: 'http://127.0.0.1:' + fixturePort + '/singbox-required' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.kind, 'subscription');
  assert.strictEqual(result.body.count, 4, 'supported nodes from HAPP and sing-box responses must be preserved together');
  assert.ok(/singbox\/1\.12\.0/.test(result.body.clientProfile));
  assert.ok(singboxHeaders, 'a canonical sing-box request must be sent');
  assert.strictEqual(singboxHeaders['x-device-os'], 'webOS Linux');
  assert.ok(singboxHeaders['x-device-model']);
  assert.ok(singboxHeaders['x-ver-os']);
  assert.strictEqual(singboxHeaders['x-device-locale'], 'EN');
  assert.ok(/^[a-f0-9]{4}(?:-[a-f0-9]{4}){3}$/.test(singboxHeaders['x-hwid']), 'sing-box HWID must use the provider-compatible deterministic format');

  result = await request(appPort, 'POST', '/api/import', { name: 'Encoded child URL', value: 'http://127.0.0.1:' + fixturePort + '/encoded-parent' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.count, 2, 'a base64-encoded single child URL must be expanded');

  result = await request(appPort, 'POST', '/api/import', { name: 'Mixed content', value: 'http://127.0.0.1:' + fixturePort + '/mixed' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.count, 1, 'an incidental URL must not invalidate direct proxy content');
  assert.strictEqual(incidentalUrlRequests, 0, 'mixed-content URLs must not be treated as required child subscriptions');

  result = await request(appPort, 'POST', '/api/import', { name: 'Duplicate A', value: 'http://127.0.0.1:' + fixturePort + '/duplicate-a' });
  assert.strictEqual(result.status, 200);
  result = await request(appPort, 'POST', '/api/import', { name: 'Duplicate B', value: 'http://127.0.0.1:' + fixturePort + '/duplicate-b' });
  assert.strictEqual(result.status, 200);
  var duplicateProfiles = result.body.store.profiles.filter(function (p) { return p.link.indexOf('shared.example.test') >= 0; });
  assert.strictEqual(duplicateProfiles.length, 2, 'two subscriptions must retain ownership of the same endpoint independently');
  assert.notStrictEqual(duplicateProfiles[0].subscriptionId, duplicateProfiles[1].subscriptionId);

  result = await request(appPort, 'POST', '/api/import', { name: 'Flaky nested', value: 'http://127.0.0.1:' + fixturePort + '/flaky' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.count, 2);
  var flakyId = result.body.subscription.id;
  var beforeIds = result.body.store.profiles.filter(function (p) { return p.subscriptionId === flakyId; }).map(function (p) { return p.id; }).sort();
  childFails = true;
  result = await request(appPort, 'POST', '/api/subscriptions/' + encodeURIComponent(flakyId) + '/update', {});
  assert.strictEqual(result.status, 400, 'a failed nested refresh must not be committed as a partial subscription');
  result = await request(appPort, 'GET', '/api/profiles');
  var afterIds = result.body.store.profiles.filter(function (p) { return p.subscriptionId === flakyId; }).map(function (p) { return p.id; }).sort();
  assert.deepStrictEqual(afterIds, beforeIds, 'previous nested profiles must survive a transient child failure');
  assert.strictEqual(incyRequests, 0, 'subscription loading must not impersonate INCY');

  console.log('unified import API tests passed');
  stop();
}
