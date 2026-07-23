'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
var control = fs.readFileSync(path.join(__dirname, '..', 'app', 'scripts', 'alcyonectl.sh'), 'utf8');

assert.ok(/function stopVpn\(\)[\s\S]*?ctl\('disconnect'/.test(app), 'UI disconnect must use the complete shutdown command');
assert.ok(/disconnect\(\) \{ stop; web_stop; web_start; \}/.test(control), 'disconnect must clean VPN state and restart the web control process');
assert.ok(/ip route flush dev "\$TUN_NAME"/.test(control), 'disconnect cleanup must remove every route attached to the TUN device');
assert.ok(/ip addr flush dev "\$TUN_NAME"/.test(control), 'disconnect cleanup must remove stale TUN addresses');
assert.ok(/ip link delete "\$TUN_NAME"/.test(control), 'disconnect cleanup must remove a persistent TUN device');

console.log('VPN shutdown cleanup tests passed');
