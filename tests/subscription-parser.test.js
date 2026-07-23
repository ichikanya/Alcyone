'use strict';

var assert = require('assert');
var parser = require('../app/web/alcyone-web.js');

function vlessOutbound(tag, host, uuid, serviceName) {
  return {
    tag: tag,
    protocol: 'vless',
    settings: { vnext: [{ address: host, port: 10121, users: [{ id: uuid, encryption: 'none' }] }] },
    streamSettings: {
      network: 'grpc',
      security: 'reality',
      realitySettings: { serverName: 'example.com', fingerprint: 'chrome', publicKey: 'public-key', shortId: 'abcd' },
      grpcSettings: { serviceName: serviceName }
    }
  };
}

assert.strictEqual(parser.isGenericName('proxy-11'), true);
assert.strictEqual(parser.isGenericName('outbound_3'), true);
assert.strictEqual(parser.isGenericName('Auto-choice'), false);
assert.strictEqual(parser.isGenericName('Авто-выбор'), false);
assert.strictEqual(parser.isGenericName('Финляндия'), false);

var fullConfigs = [
  {
    id: 'auto-profile',
    remarks: '💎 Авто-выбор 🔥',
    inbounds: [{ tag: 'mixed-in', protocol: 'mixed', port: 1080 }],
    outbounds: [
      vlessOutbound('proxy-1', 'alpha.example.test', '11111111-1111-1111-1111-111111111111', 'alpha-service'),
      vlessOutbound('proxy-2', 'beta.example.test', '22222222-2222-2222-2222-222222222222', 'beta-service'),
      { tag: 'direct', protocol: 'freedom' }
    ],
    routing: { balancers: [{ tag: 'auto', selector: ['proxy-'] }], rules: [{ type: 'field', network: 'tcp,udp', balancerTag: 'auto' }] }
  },
  {
    id: 'finland-profile',
    remarks: '🇫🇮 Финляндия',
    inbounds: [{ tag: 'mixed-in', protocol: 'mixed', port: 1080 }],
    outbounds: [vlessOutbound('proxy', 'finland.example.test', '33333333-3333-3333-3333-333333333333', 'finland-service')]
  }
];

var profiles = parser.extractSubscriptionProfiles(JSON.stringify(fullConfigs));
assert.strictEqual(profiles.length, 2, 'a complete Xray config is one profile, not one profile per outbound');
assert.strictEqual(profiles[0].name, '💎 Авто-выбор 🔥');
assert.strictEqual(profiles[1].name, '🇫🇮 Финляндия');
assert.strictEqual(profiles[0].fullConfig.outbounds.length, 3);
assert.strictEqual(profiles[0].fullConfig.routing.balancers[0].tag, 'auto');
assert.strictEqual(profiles[0].sourceKey, 'xray|id|auto-profile');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.serviceName, 'alpha-service');

var singBoxConfig = {
  outbounds: [{
    tag: 'Нидерланды', type: 'vless', server: 'nl.example.test', server_port: 10121,
    uuid: '44444444-4444-4444-4444-444444444444',
    tls: { enabled: true, server_name: 'example.org' },
    transport: { type: 'grpc', service_name: 'singbox-service' }
  }]
};
profiles = parser.extractSubscriptionProfiles(JSON.stringify(singBoxConfig));
assert.strictEqual(profiles.length, 1);
assert.strictEqual(profiles[0].name, 'Нидерланды');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.serviceName, 'singbox-service');

var encodedTrojan = 'trojan://pa%23ss%3Fx@trojan.example.test:443?type=ws&path=%2Fws%3Fed%3D2048%26x%3D1#Encoded';
profiles = parser.extractSubscriptionProfiles(encodedTrojan);
assert.strictEqual(profiles.length, 1, 'encoded reserved characters must not make a valid URI disappear');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).password, 'pa#ss?x');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.path, '/ws?ed=2048&x=1');

var grpcUuid = '55555555-5555-5555-5555-555555555555';
var grpcVlessA = 'vless://' + grpcUuid + '@grpc.example.test:443?security=tls&type=grpc&serviceName=alpha#Alpha';
var grpcVlessB = 'vless://' + grpcUuid + '@grpc.example.test:443?security=tls&type=grpc&serviceName=beta#Beta';
profiles = parser.extractSubscriptionProfiles(grpcVlessA + '\n' + grpcVlessB);
assert.strictEqual(profiles.length, 2, 'distinct VLESS gRPC services must not be deduplicated');

var transportUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
var sameNameTcp = 'vless://' + transportUuid + '@transport.example.test:443?security=tls&type=tcp#Same';
var sameNameXhttp = 'vless://' + transportUuid + '@transport.example.test:443?security=tls&type=xhttp&path=%2Fxhttp&mode=auto#Same';
profiles = parser.extractSubscriptionProfiles(sameNameTcp + '\n' + sameNameXhttp);
assert.strictEqual(profiles.length, 2, 'same-name VLESS nodes with distinct TCP and XHTTP transports must both be imported');

var grpcTrojanA = 'trojan://secret@grpc.example.test:443?type=grpc&serviceName=alpha#Alpha';
var grpcTrojanB = 'trojan://secret@grpc.example.test:443?type=grpc&serviceName=beta#Beta';
profiles = parser.extractSubscriptionProfiles(grpcTrojanA + '\n' + grpcTrojanB);
assert.strictEqual(profiles.length, 2, 'distinct Trojan gRPC services must not be deduplicated');

var singleSocks = 'socks5://user:pass@socks.example.test:1080#SOCKS';
profiles = parser.extractSubscriptionProfiles(Buffer.from(singleSocks, 'utf8').toString('base64'));
assert.strictEqual(profiles.length, 1, 'a single base64-encoded SOCKS5 node must decode');
assert.strictEqual(profiles[0].protocol, 'socks');

var jsonAliases = [
  { type: 'ss', name: 'SS alias', server: 'ss.example.test', server_port: 8388, method: 'aes-128-gcm', password: 'one' },
  { type: 'socks5', name: 'SOCKS alias', server: 'socks2.example.test', server_port: 1080, username: 'u', password: 'p' },
  { remarks: 'SIP008', server: 'sip008.example.test', server_port: 8389, method: 'chacha20-ietf-poly1305', password: 'two' }
];
profiles = parser.extractSubscriptionProfiles(JSON.stringify(jsonAliases));
assert.strictEqual(profiles.length, 3, 'JSON protocol aliases and SIP008 records must be imported');
assert.deepStrictEqual(profiles.map(function (p) { return p.protocol; }).sort(), ['socks', 'ss', 'ss']);

var clashNested = [
  'proxies:',
  '  - name: Nested ALPN',
  '    type: vless',
  '    alpn:',
  '      - h2',
  '      - http/1.1',
  '    server: nested.example.test',
  '    port: 443',
  '    uuid: 66666666-6666-6666-6666-666666666666',
  '    network: grpc',
  '    tls: true',
  '    grpc-opts:',
  '      grpc-service-name: nested-service',
  'proxy-groups:',
  '  - name: ignored group',
  '    type: select',
  '    proxies:',
  '      - Nested ALPN'
].join('\n');
profiles = parser.extractSubscriptionProfiles(clashNested);
assert.strictEqual(profiles.length, 1, 'nested YAML lists must not terminate a Clash proxy');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.serviceName, 'nested-service');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.alpn, 'h2,http/1.1');

var clashInline = 'proxies:\n  - {name: Inline gRPC, type: trojan, server: inline.example.test, port: 443, password: secret, network: grpc, alpn: [h2, http/1.1], grpc-opts: {grpc-service-name: inline-service}}';
profiles = parser.extractSubscriptionProfiles(clashInline);
assert.strictEqual(profiles.length, 1);
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.serviceName, 'inline-service');
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.alpn, 'h2,http/1.1');

var clashInlineWs = 'proxies:\n  - {name: Inline WS, type: vless, server: inline-ws.example.test, port: 443, uuid: 99999999-9999-9999-9999-999999999999, network: ws, tls: true, ws-opts: {path: /ws, headers: {Host: inline-origin.example.test}}}';
profiles = parser.extractSubscriptionProfiles(clashInlineWs);
assert.strictEqual(profiles.length, 1);
assert.strictEqual(parser.parseProxyLink(profiles[0].link).params.host, 'inline-origin.example.test');

var clashWs = [
  'proxies:',
  '  - name: VLESS WS',
  '    type: vless',
  '    server: vless-ws.example.test',
  '    port: 443',
  '    uuid: 77777777-7777-7777-7777-777777777777',
  '    network: ws',
  '    tls: true',
  '    ws-opts:',
  '      path: /vless',
  '      headers:',
  '        Host: vless-origin.example.test',
  '  - name: VMess WS',
  '    type: vmess',
  '    server: vmess-ws.example.test',
  '    port: 443',
  '    uuid: 88888888-8888-8888-8888-888888888888',
  '    network: ws',
  '    tls: true',
  '    ws-opts:',
  '      path: /vmess',
  '      headers:',
  '        Host: vmess-origin.example.test',
  '  - name: Trojan WS',
  '    type: trojan',
  '    server: trojan-ws.example.test',
  '    port: 443',
  '    password: secret',
  '    network: ws',
  '    ws-opts:',
  '      path: /trojan',
  '      headers:',
  '        Host: trojan-origin.example.test'
].join('\n');
profiles = parser.extractSubscriptionProfiles(clashWs);
assert.strictEqual(profiles.length, 3);
var wsHosts = profiles.map(function (p) { return parser.parseProxyLink(p.link).params.host; }).sort();
assert.deepStrictEqual(wsHosts, ['trojan-origin.example.test', 'vless-origin.example.test', 'vmess-origin.example.test']);

console.log('subscription parser tests passed');
