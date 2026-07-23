'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var appPath = path.join(__dirname, '..', 'app', 'app.js');
var controlPath = path.join(__dirname, '..', 'app', 'scripts', 'alcyonectl.sh');
var webPath = path.join(__dirname, '..', 'app', 'web', 'alcyone-web.js');
var app = fs.readFileSync(appPath, 'utf8');
var control = fs.readFileSync(controlPath, 'utf8');
var web = fs.readFileSync(webPath, 'utf8');

var logElement = { textContent: '', scrollHeight: 0, scrollTop: 0, clientHeight: 100 };
var document = {
  hidden: false,
  getElementById: function (id) { return id === 'log' ? logElement : null; },
  addEventListener: function () {},
  removeEventListener: function () {}
};
var window = { localStorage: { getItem: function () { return null; } } };
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
var source = app.replace(/\}\)\(\);\s*$/, 'window.__resourceTest = { buildConfig: buildConfig, log: log };\n})();');
vm.runInNewContext(source, context, { filename: appPath });

var generated = context.window.__resourceTest.buildConfig({
  link: 'vless://00000000-0000-0000-0000-000000000000@example.test:443?security=tls&type=tcp#Test'
});
assert.strictEqual(generated.log.access, 'none', 'generated Xray config must disable per-connection access logging');
assert.strictEqual(generated.log.loglevel, 'warning', 'generated Xray config must retain useful warning logs');
assert.strictEqual(generated.policy.levels['0'].handshake, 5, 'generated Xray config must expire incomplete handshakes');
assert.strictEqual(generated.policy.levels['0'].connIdle, 60, 'generated Xray config must promptly expire idle connections');
assert.strictEqual(generated.policy.levels['0'].uplinkOnly, 5, 'generated Xray config must close half-idle uplinks');
assert.strictEqual(generated.policy.levels['0'].downlinkOnly, 5, 'generated Xray config must close half-idle downlinks');

var xhttp = context.window.__resourceTest.buildConfig({
  link: 'vless://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@xhttp.example.test:443?security=tls&type=xhttp&path=%2Fstream&mode=packet-up#XHTTP'
});
assert.strictEqual(xhttp.outbounds[0].streamSettings.network, 'xhttp', 'XHTTP links must keep their transport');
assert.strictEqual(xhttp.outbounds[0].streamSettings.xhttpSettings.path, '/stream');
assert.strictEqual(xhttp.outbounds[0].streamSettings.xhttpSettings.mode, 'packet-up');
assert.strictEqual(xhttp.outbounds[0].streamSettings.xhttpSettings.xmux.maxConcurrency, '16-32', 'XHTTP must multiplex requests instead of opening one physical connection per request');
assert.strictEqual(xhttp.outbounds[0].streamSettings.xhttpSettings.xmux.hMaxReusableSecs, '300-600', 'XHTTP physical connections must have a bounded lifetime');

var xhttpExtra = context.window.__resourceTest.buildConfig({
  link: 'vless://bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb@xhttp.example.test:443?security=tls&type=xhttp&extra=%7B%22noSSEHeader%22%3Atrue%7D#XHTTP-extra'
});
assert.strictEqual(xhttpExtra.outbounds[0].streamSettings.xhttpSettings.extra.noSSEHeader, true, 'existing XHTTP extra settings must be preserved');
assert.strictEqual(xhttpExtra.outbounds[0].streamSettings.xhttpSettings.extra.xmux.maxConcurrency, '16-32', 'XHTTP limits must be added inside extra when present');

var full = context.window.__resourceTest.buildConfig({
  fullConfig: {
    log: { access: '/tmp/access.log', error: '/tmp/error.log', loglevel: 'debug', dnsLog: true },
    policy: { levels: { '0': { connIdle: 240 } } },
    inbounds: [{ tag: 'original' }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }]
  }
});
assert.strictEqual(full.log.access, 'none', 'imported configs must not create unbounded access logs');
assert.strictEqual(full.log.error, '', 'imported error logs must use the managed tunnel log');
assert.strictEqual(full.log.loglevel, 'warning', 'verbose imported logs must be capped at warning');
assert.strictEqual(full.log.dnsLog, false, 'per-query DNS logging must be disabled');
assert.strictEqual(full.policy.levels['0'].connIdle, 60, 'unsafe imported idle policies must be capped');
assert.strictEqual(full.policy.levels['0'].handshake, 5, 'imported configs must receive a handshake timeout');

var fullXhttp = context.window.__resourceTest.buildConfig({
  fullConfig: {
    inbounds: [],
    outbounds: [{
      tag: 'proxy',
      protocol: 'vless',
      streamSettings: { network: 'xhttp', xhttpSettings: { path: '/', xmux: { maxConcurrency: 3 } } }
    }]
  }
});
assert.strictEqual(fullXhttp.outbounds[0].streamSettings.xhttpSettings.xmux.maxConcurrency, 3, 'provider-defined XHTTP multiplexing must be preserved');

for (var i = 0; i < 100; i++) context.window.__resourceTest.log(Array(1001).join(String(i % 10)), true);
assert.ok(logElement.textContent.length <= 32768, 'TV log DOM must remain bounded');

assert.ok(/-udpTimeout 30s -loglevel warn/.test(control), 'legacy tun2socks must expire UDP sessions and suppress connection logs');
assert.ok(/--udp-timeout 30s --loglevel warn/.test(control), 'modern tun2socks fallback must use the same resource limits');
assert.ok(/MAX_LOG_BYTES=2097152/.test(control) && /start_log_guard/.test(control) && /stop_log_guard/.test(control), 'tunnel log guard must be bounded and lifecycle-managed');
assert.ok(/set_open_files_limit 4096[\s\S]*?"\$XRAY_BIN"[\s\S]*?set_open_files_limit 2048[\s\S]*?"\$TUN2SOCKS_BIN"/.test(control), 'Xray must have bounded headroom without raising the tun2socks limit');
assert.ok(/set_open_files_limit 256/.test(control), 'the web process must retain its low descriptor limit');
assert.ok(!/ulimit -n 8192/.test(control), 'the previous system-risking descriptor ceiling must not return');
assert.ok(/function selectProfile\(id\)[\s\S]*?var reconnect = running && id !== state\.activeId;[\s\S]*?if \(reconnect\) restartVpn\(\);/.test(app), 'selecting a different server while connected must restart the tunnel');
assert.ok(/ctl\('clear-logs'[\s\S]*?lastLogText = '';/.test(app), 'the log clear action must clear managed files before resetting the viewer');
assert.ok(/clear_logs\(\)[\s\S]*?: > "\$clear_file"[\s\S]*?clear-logs\) clear_logs/.test(control), 'the controller must physically truncate every managed log');
assert.ok(/process_open_files\(\)/.test(control) && /Max open files/.test(control), 'log diagnostics must report descriptor usage');
assert.ok(/server\.maxConnections = 24/.test(web), 'web control sockets must be bounded');
assert.ok(/server\.keepAliveTimeout = 5000/.test(web), 'idle web keep-alive sockets must expire');
assert.ok(/\/api\/profiles\/meta/.test(web), 'lightweight store polling endpoint must exist');
assert.ok(/active < 4/.test(web), 'expanded subscription downloads must cap concurrency');
assert.ok(/MAX_EXPANDED_DOWNLOAD = 4 \* 1024 \* 1024/.test(web) && /MAX_REMOTE_URLS = 64/.test(web), 'nested subscriptions must have aggregate size and child-count caps');
assert.ok(/IMPORT_TIMEOUT = 60 \* 1000/.test(web) && /deadlineTimer = setTimeout/.test(web), 'subscription imports must have a wall-clock deadline');
assert.ok(/refreshStoreIfChanged/.test(app) && /}, 15000\)/.test(app), 'TV background polling must avoid frequent full-store reloads');
assert.ok(/function restartVpn\(\)[\s\S]*?ctl\('disconnect'[\s\S]*?startVpn\(\)/.test(app), 'VPN restart must wait for complete disconnect cleanup');
var healthBody = (control.match(/vpn_health_check\(\) \{([\s\S]*?)\n\}/) || [])[1] || '';
assert.ok(/wait_for_route_active/.test(healthBody) && /is_running/.test(healthBody), 'startup health must verify the route and VPN processes');
assert.ok(!/get_public_ip|curl/.test(healthBody), 'startup health must not restart a working tunnel because an external IP service failed');
assert.ok(/get_direct_public_ip\(\)/.test(control) && /cleanup_direct_check_routes/.test(control) && /route_add_lan_ip/.test(control) && /route_del_lan_ip/.test(control), 'direct IP checks must temporarily bypass the VPN route and clean up');
assert.ok(/trap 'cleanup_direct_check_routes' 0/.test(control) && /ip route get "\$check_ip"/.test(control), 'direct IP bypass routes must be verified and cleaned on early exit');
assert.ok(!/--interface "\$TUN_NAME"/.test(control), 'external IP checks must not bind curl to the TUN device');
assert.ok(/IP via VPN:/.test(control) && /IP direct:/.test(control), 'IP test output must distinguish the VPN and direct routes');
assert.ok(app.indexOf('IP (?:via VPN|via tun0)') >= 0 && app.indexOf('IP (?:direct|default route)') >= 0, 'the TV UI must parse current and legacy IP-test output');

console.log('resource safety tests passed');
