'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var appPath = path.join(__dirname, '..', 'app', 'app.js');
var controlPath = path.join(__dirname, '..', 'app', 'scripts', 'alcyonectl.sh');
var app = fs.readFileSync(appPath, 'utf8');
var control = fs.readFileSync(controlPath, 'utf8');
var document = {
  hidden: false,
  getElementById: function () { return null; },
  addEventListener: function () {},
  removeEventListener: function () {}
};
var window = {
  ALCYONE_EDITION: {
    appId: 'com.alcyone.vpn.singbox',
    autostart: 'alcyone-singbox-vpn',
    core: 'sing-box',
    coreLabel: 'sing-box',
    dataDir: '/var/lib/alcyone-singbox',
    editionName: 'sing-box Edition',
    title: 'Alcyone sing-box',
    version: '3.2.1',
    webPort: 8081
  },
  localStorage: { getItem: function () { return null; } }
};
var context = {
  window: window,
  document: document,
  navigator: { language: 'en-US', languages: ['en-US'] },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: function () { return 1; },
  clearInterval: function () {},
  btoa: function (value) { return Buffer.from(value, 'binary').toString('base64'); },
  atob: function (value) { return Buffer.from(value, 'base64').toString('binary'); },
  escape: escape,
  unescape: unescape,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent
};
var source = app.replace(
  /\}\)\(\);\s*$/,
  'window.__editionTest = { buildConfig: buildConfig, routeEnv: routeEnv };\n})();'
);
vm.runInNewContext(source, context, { filename: appPath });

function build(link, extra) {
  var profile = { id: 'test', name: 'Test', link: link };
  if (extra) Object.keys(extra).forEach(function (key) { profile[key] = extra[key]; });
  return context.window.__editionTest.buildConfig(profile);
}

var vless = build(
  'vless://00000000-0000-0000-0000-000000000000@example.test:443?security=reality&type=ws&path=%2Fws&host=edge.example.test&sni=www.example.com&fp=chrome&pbk=3zJVVNBJj3Br7sedk4ABBCmt8fKlYFL4IMyHaUNHxRA&sid=0123#Reality'
);
assert.strictEqual(vless.inbounds.length, 1, 'sing-box must use a single native TUN inbound');
assert.strictEqual(vless.inbounds[0].type, 'tun');
assert.strictEqual(vless.inbounds[0].stack, 'system', 'the low-resource system stack must be used');
assert.strictEqual(vless.inbounds[0].auto_route, false, 'the existing deterministic route manager must remain authoritative');
assert.strictEqual(vless.inbounds[0].udp_timeout, '30s', 'idle UDP state must remain bounded');
assert.strictEqual(vless.outbounds[0].type, 'vless');
assert.strictEqual(vless.outbounds[0].transport.type, 'ws');
assert.strictEqual(vless.outbounds[0].transport.headers.Host, 'edge.example.test');
assert.strictEqual(vless.outbounds[0].tls.reality.enabled, true);
assert.strictEqual(vless.outbounds[0].tls.reality.public_key, '3zJVVNBJj3Br7sedk4ABBCmt8fKlYFL4IMyHaUNHxRA');
assert.strictEqual(vless.outbounds[0].tls.utls.fingerprint, 'chrome');
assert.strictEqual(vless.route.final, 'proxy');
assert.strictEqual(vless.route.auto_detect_interface, true, 'outbound traffic must be bound away from the TUN loop');

var vmess = build(
  'vmess://' + Buffer.from(JSON.stringify({
    v: '2', ps: 'VMess', add: 'vmess.example.test', port: '443',
    id: '11111111-1111-1111-1111-111111111111', aid: '0',
    scy: 'auto', net: 'grpc', type: 'none', host: '', path: 'service',
    tls: 'tls', sni: 'vmess.example.test'
  })).toString('base64')
);
assert.strictEqual(vmess.outbounds[0].type, 'vmess');
assert.strictEqual(vmess.outbounds[0].transport.type, 'grpc');
assert.strictEqual(vmess.outbounds[0].transport.service_name, 'service');

var trojan = build('trojan://secret@trojan.example.test:443?type=httpupgrade&path=%2Fup&host=cdn.example.test#Trojan');
assert.strictEqual(trojan.outbounds[0].type, 'trojan');
assert.strictEqual(trojan.outbounds[0].tls.enabled, true);
assert.strictEqual(trojan.outbounds[0].transport.type, 'httpupgrade');

var shadowsocks = build('ss://' + Buffer.from('aes-128-gcm:password').toString('base64') + '@ss.example.test:8388#SS');
assert.strictEqual(shadowsocks.outbounds[0].type, 'shadowsocks');
assert.strictEqual(shadowsocks.outbounds[0].method, 'aes-128-gcm');

var socks = build('socks5://user:pass@socks.example.test:1080#SOCKS');
assert.strictEqual(socks.outbounds[0].type, 'socks');
assert.strictEqual(socks.outbounds[0].username, 'user');

var hysteria = build('hysteria2://password@hy.example.test:443?sni=hy.example.test&obfs=salamander&obfs-password=mask#HY2');
assert.strictEqual(hysteria.outbounds[0].type, 'hysteria2');
assert.strictEqual(hysteria.outbounds[0].obfs.type, 'salamander');
assert.strictEqual(hysteria.outbounds[0].obfs.password, 'mask');

var fullProfile = {
  id: 'full',
  name: 'Full',
  link: 'vless://22222222-2222-2222-2222-222222222222@selected.example.test:443?security=tls&type=tcp#Selected',
  fullConfig: {
    inbounds: [],
    outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: 'unused.example.test', port: 443 }] } }]
  }
};
var converted = context.window.__editionTest.buildConfig(fullProfile);
assert.strictEqual(converted.outbounds[0].server, 'selected.example.test', 'sing-box must safely use the selected compatible link from an imported XRay profile');
assert.ok(context.window.__editionTest.routeEnv(fullProfile).indexOf('unused.example.test') < 0, 'sing-box route bypasses must include only the active endpoint');

assert.throws(function () {
  build('vless://33333333-3333-3333-3333-333333333333@xhttp.example.test:443?security=tls&type=xhttp#XHTTP');
}, /XHTTP/, 'sing-box must reject unsupported XHTTP profiles before starting');

assert.ok(/if \[ "\$CORE" = "sing-box" \][\s\S]*?"\$SINGBOX_BIN" run -c "\$CONFIG"/.test(control), 'sing-box must have an independent native-TUN launch path');
assert.ok(/set_open_files_limit 1024[\s\S]*?"\$SINGBOX_BIN"/.test(control), 'sing-box descriptor use must be bounded for low-powered TVs');
assert.ok(/ALCYONE_WEB_PORT="\$WEB_PORT"[\s\S]*?ALCYONE_EDITION_NAME=/.test(control), 'the shared web UI must receive edition-specific runtime settings');
var routeRetry = control.match(/wait_for_route_active\(\) \{([\s\S]*?)\n\}/);
assert.ok(routeRetry && /if \[ "\$CORE" = "sing-box" \]; then[\s\S]*?0\.0\.0\.0\/1 dev "\$TUN_NAME"[\s\S]*?else[\s\S]*?0\.0\.0\.0\/1 via "\$TUN_GW"/.test(routeRetry[1]), 'route retries must keep native sing-box TUN routes gateway-free without changing XRay routing');

if (process.env.ALCYONE_CONFIG_OUTPUT) {
  var outputDir = path.resolve(process.env.ALCYONE_CONFIG_OUTPUT);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  [
    ['vless-reality-ws.json', vless],
    ['vmess-grpc.json', vmess],
    ['trojan-httpupgrade.json', trojan],
    ['shadowsocks.json', shadowsocks],
    ['socks5.json', socks],
    ['hysteria2.json', hysteria]
  ].forEach(function (entry) {
    fs.writeFileSync(path.join(outputDir, entry[0]), JSON.stringify(entry[1], null, 2) + '\n');
  });
}

console.log('dual-edition configuration tests passed');
