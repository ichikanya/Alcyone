'use strict';

/* Pure protocol and subscription parsing.

   This module converts proxy URIs, Clash YAML and JSON/sing-box/Xray configs
   into normalized profile descriptors. It is deliberately inert: no
   filesystem, no HTTP, no Luna, no child processes, no routing and no global
   mutable state. Everything is a function of its arguments, so the parsers are
   unit testable and cannot be a source of side effects.

   Errors carry structured codes; user-facing wording lives in the frontend
   localization tables. */

var errors = require('../errors');
var err = errors.err;

function locErr(code, extra) { return err(code, extra || ''); }
function safeText(value, maxLen) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLen || 4096);
}
function decodeUrlPart(s) {
  try { return decodeURIComponent(String(s || '').replace(/\+/g, '%20')); } catch (e) { return String(s || ''); }
}
function bufferFrom(data, enc) { return Buffer.from ? Buffer.from(data, enc) : new Buffer(data, enc); }
function truthy(v) { v = String(v == null ? '' : v).toLowerCase(); return v === 'true' || v === '1' || v === 'yes' || v === 'on'; }

function looksLikeUnsupportedSubscriptionPage(content) {
  var s = htmlEntityDecode(String(content || '')).toLowerCase();
  return (s.indexOf('<html') >= 0 || s.indexOf('raytune') >= 0 || s.indexOf('app') >= 0) &&
    (s.indexOf('не поддерж') >= 0 || s.indexOf('приложен') >= 0 || s.indexOf('unsupported') >= 0 || s.indexOf('not supported') >= 0 || s.indexOf('not support') >= 0);
}

function htmlEntityDecode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function percentDecodeLoose(s) {
  var x = String(s || ''), i, y;
  for (i = 0; i < 3; i++) {
    try { y = decodeURIComponent(x); } catch (e) { break; }
    if (y === x) break;
    x = y;
  }
  return x;
}
function stripYamlQuote(v) {
  v = String(v == null ? '' : v).trim();
  if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) v = v.slice(1, -1);
  return v;
}
function normalizeYamlList(v) {
  var parts, out = [], i;
  v = String(v == null ? '' : v).trim();
  if (v.charAt(0) === '[' && v.charAt(v.length - 1) === ']') v = v.slice(1, -1);
  parts = v.split(',');
  for (i = 0; i < parts.length; i++) { var item = stripYamlQuote(parts[i]); if (item) out.push(item); }
  return out.join(',');
}

function cleanServerName(name) {
  name = htmlEntityDecode(percentDecodeLoose(decodeUrlPart(String(name == null ? '' : name))));
  name = name.replace(/[\r\n\t]+/g, ' ').replace(/^['"`]+|['"`]+$/g, '').replace(/\s+/g, ' ').trim();
  return safeText(name, 120);
}
function isGenericName(name) {
  var n = cleanServerName(name).toLowerCase();
  return !n || n === 'proxy' || n === 'vless' || n === 'server' || n === 'default' || n === 'outbound' || n === 'direct' || n === 'block' || n === 'dns' || n === 'undefined' || n === 'null' || /^(proxy|outbound|server|node|vless|vmess|trojan|ss|socks|hysteria2?)[\s._-]*\d+$/i.test(n);
}
function descriptiveName() {
  var i, v;
  for (i = 0; i < arguments.length; i++) {
    v = cleanServerName(arguments[i]);
    if (v && !isGenericName(v)) return v;
  }
  return '';
}
function hostDisplayName(host) {
  var label = cleanServerName(String(host || '').split('.')[0]).replace(/[_-]+/g, ' ').trim();
  if (!label) return '';
  if (label.length <= 3) return label.toUpperCase();
  return label.replace(/(^|\s)([a-zа-яё])/gi, function (_, space, ch) { return space + ch.toUpperCase(); });
}
function jsonProfileName(name, inheritedName, host) {
  return descriptiveName(name, inheritedName) || hostDisplayName(host) || cleanServerName(host);
}
function importedProfileName(parsed, previous, subscriptionName, index) {
  parsed = parsed || {};
  previous = previous || null;
  var parsedName = descriptiveName(parsed.name);
  var hostName = hostDisplayName(parsed.host);
  var previousName = previous && descriptiveName(previous.name);
  if (previousName && (!parsedName || parsedName.toLowerCase() === hostName.toLowerCase())) return previousName;
  return parsedName || previousName || hostName || cleanServerName(parsed.host) || ((subscriptionName || 'VPN') + ' #' + index);
}
function bestName() {
  var i, v;
  for (i = 0; i < arguments.length; i++) {
    v = cleanServerName(arguments[i]);
    if (v && !isGenericName(v)) return v;
  }
  for (i = 0; i < arguments.length; i++) {
    v = cleanServerName(arguments[i]);
    if (v) return v;
  }
  return '';
}
function splitInlineMap(s) {
  var out = [], cur = '', q = '', depth = 0, i, ch;
  s = String(s || '').trim();
  if (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') s = s.slice(1, -1);
  for (i = 0; i < s.length; i++) {
    ch = s.charAt(i);
    if (q) { cur += ch; if (ch === q && s.charAt(i - 1) !== '\\') q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth <= 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseInlineMap(s) {
  var obj = {}, parts = splitInlineMap(s), i, p, idx, k, v;
  for (i = 0; i < parts.length; i++) {
    p = parts[i]; idx = p.indexOf(':');
    if (idx < 0) continue;
    k = p.slice(0, idx).trim().toLowerCase();
    v = stripYamlQuote(p.slice(idx + 1).trim());
    if (k) obj[k] = v;
  }
  return obj;
}
function applyYamlKey(cur, section, key, val) {
  key = String(key || '').toLowerCase();
  val = stripYamlQuote(String(val == null ? '' : val).replace(/\s+#.*$/, ''));
  if (!cur) return section || '';
  if (!val) {
    if ((section === 'ws-opts' || section === 'ws_opts') && key === 'headers') return 'ws-headers';
    return key;
  }
  if (val.charAt(0) === '{' && val.charAt(val.length - 1) === '}') {
    var o = parseInlineMap(val);
    if (key === 'reality-opts' || key === 'reality_opts') { cur.publicKey = o['public-key'] || o.publickey || cur.publicKey; cur.shortId = o['short-id'] || o.shortid || cur.shortId; return section || ''; }
    if (key === 'ws-opts' || key === 'ws_opts') { var wsHeaders = parseInlineMap(o.headers || ''); cur.path = o.path || cur.path; cur.hostHeader = o.host || wsHeaders.host || cur.hostHeader; return section || ''; }
    if (key === 'grpc-opts' || key === 'grpc_opts') { cur.serviceName = o['grpc-service-name'] || o['service-name'] || o.path || cur.serviceName; return section || ''; }
    if (key === 'http-opts' || key === 'http_opts' || key === 'xhttp-opts' || key === 'xhttp_opts') { cur.path = o.path || cur.path; cur.mode = o.mode || cur.mode; cur.hostHeader = o.host || cur.hostHeader; return section || ''; }
  }
  if (section === 'reality-opts' || section === 'reality_opts') { if (key === 'public-key') cur.publicKey = val; else if (key === 'short-id') cur.shortId = val; else cur[key] = val; return section; }
  if (section === 'ws-opts' || section === 'ws_opts') { if (key === 'path') cur.path = val; if (key === 'headers') return 'ws-headers'; return section; }
  if (section === 'grpc-opts' || section === 'grpc_opts') { if (key === 'grpc-service-name' || key === 'service-name') cur.serviceName = val; return section; }
  if (section === 'http-opts' || section === 'http_opts' || section === 'xhttp-opts' || section === 'xhttp_opts') { if (key === 'path') cur.path = val; if (key === 'mode') cur.mode = val; if (key === 'host') cur.hostHeader = val; return section; }
  if (section === 'ws-headers') { if (key === 'host') cur.hostHeader = val; return section; }
  if (key === 'name' || key === 'remark' || key === 'remarks' || key === 'ps') cur.name = val;
  else if (key === 'type') cur.proto = val;
  else if (key === 'server' || key === 'address') cur.host = val;
  else if (key === 'port' || key === 'server-port' || key === 'server_port') cur.port = val;
  else if (key === 'uuid' || key === 'id') cur.uuid = val;
  else if (key === 'password' || key === 'auth' || key === 'auth-str') cur.password = val;
  else if (key === 'network') cur.network = val;
  else if (key === 'tls') cur.tls = val;
  else if (key === 'servername' || key === 'sni' || key === 'peer') cur.sni = val;
  else if (key === 'client-fingerprint' || key === 'fingerprint' || key === 'fp') cur.fp = val;
  else if (key === 'flow') cur.flow = val;
  else if (key === 'skip-cert-verify' || key === 'skip_cert_verify' || key === 'insecure') cur.insecure = val;
  else if (key === 'obfs') cur.obfs = val;
  else if (key === 'obfs-password' || key === 'obfs_password') cur.obfsPassword = val;
  else if (key === 'up' || key === 'upmbps' || key === 'up-mbps') cur.up = val;
  else if (key === 'down' || key === 'downmbps' || key === 'down-mbps') cur.down = val;
  else if (key === 'alpn') cur.alpn = normalizeYamlList(val);
  else if (key === 'cipher') cur.cipher = val;
  else if (key === 'alterid') cur.alterId = val;
  else if (key === 'username' || key === 'user') cur.username = val;
  return section || '';
}
function pushParam(parts, k, v) { if (v !== undefined && v !== null && String(v) !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v))); }
function buildVlessLink(o) {
  var host = o.host || o.server || o.address;
  var port = parseInt(o.port || o.server_port || 443, 10) || 443;
  var uuid = o.uuid || o.id;
  if (!host || !uuid) return '';
  var params = [], security = o.security || 'none', type = o.type || o.network || 'tcp';
  pushParam(params, 'encryption', o.encryption || 'none');
  if (security && security !== 'none') pushParam(params, 'security', security);
  if (type) pushParam(params, 'type', type);
  pushParam(params, 'sni', o.sni || o.servername || o.serverName);
  pushParam(params, 'fp', o.fp || o.fingerprint || o.clientFingerprint || o.client_fingerprint);
  pushParam(params, 'pbk', o.pbk || o.publicKey || o.public_key);
  pushParam(params, 'sid', o.sid || o.shortId || o.short_id);
  pushParam(params, 'spx', o.spx || o.spiderX || o.spider_x);
  pushParam(params, 'flow', o.flow);
  pushParam(params, 'path', o.path);
  pushParam(params, 'host', o.hostHeader || o.host_header || o.headersHost);
  pushParam(params, 'serviceName', o.serviceName || o.grpcServiceName || o.grpc_service_name);
  pushParam(params, 'mode', o.mode);
  pushParam(params, 'alpn', o.alpn);
  return 'vless://' + encodeURIComponent(uuid) + '@' + host + ':' + port + (params.length ? '?' + params.join('&') : '') + '#' + encodeURIComponent(bestName(o.name, o.remarks, o.remark, o.ps, o.tag, host));
}
function buildHysteria2Link(o) {
  var host = o.host || o.server || o.address;
  var port = parseInt(o.port || o.server_port || 443, 10) || 443;
  var password = o.password || o.auth || o['auth-str'];
  if (!host || !password) return '';
  var params = [];
  pushParam(params, 'sni', o.sni || o.servername || o.serverName || o.peer);
  pushParam(params, 'insecure', truthy(o.insecure || o['skip-cert-verify'] || o.skipCertVerify) ? '1' : '');
  pushParam(params, 'obfs', o.obfs);
  pushParam(params, 'obfs-password', o.obfsPassword || o['obfs-password'] || o.obfs_password);
  pushParam(params, 'alpn', o.alpn);
  pushParam(params, 'upmbps', o.up || o.upmbps || o['up-mbps']);
  pushParam(params, 'downmbps', o.down || o.downmbps || o['down-mbps']);
  return 'hy2://' + encodeURIComponent(password) + '@' + host + ':' + port + (params.length ? '?' + params.join('&') : '') + '#' + encodeURIComponent(bestName(o.name, o.remarks, o.remark, o.ps, o.tag, host));
}
function buildTrojanLink(o) {
  var host = o.host || o.server || o.address;
  var port = parseInt(o.port || o.server_port || 443, 10) || 443;
  var password = o.password;
  if (!host || !password) return '';
  var params = [], type = o.type || o.network || 'tcp';
  if (o.security && o.security !== 'tls') pushParam(params, 'security', o.security);
  if (type && type !== 'tcp') pushParam(params, 'type', type);
  pushParam(params, 'sni', o.sni || o.servername || o.serverName);
  pushParam(params, 'fp', o.fp || o.fingerprint || o.clientFingerprint);
  pushParam(params, 'path', o.path);
  pushParam(params, 'host', o.hostHeader || o.host_header);
  pushParam(params, 'serviceName', o.serviceName);
  pushParam(params, 'alpn', o.alpn);
  pushParam(params, 'allowInsecure', truthy(o.insecure || o['skip-cert-verify'] || o.skipCertVerify) ? '1' : '');
  return 'trojan://' + encodeURIComponent(password) + '@' + host + ':' + port + (params.length ? '?' + params.join('&') : '') + '#' + encodeURIComponent(bestName(o.name, o.remarks, o.remark, o.ps, o.tag, host));
}
function buildVmessLink(o) {
  var host = o.host || o.server || o.address;
  var port = parseInt(o.port || o.server_port || 443, 10) || 443;
  var uuid = o.uuid || o.id;
  if (!host || !uuid) return '';
  var obj = {
    v: '2',
    ps: bestName(o.name, o.remarks, o.remark, o.ps, o.tag, host),
    add: String(host), port: String(port), id: String(uuid),
    aid: String(parseInt(o.aid || o.alterId || o.alter_id || 0, 10) || 0),
    scy: String(o.scy || o.cipher || o.security || 'auto'),
    net: String(o.net || o.network || 'tcp'), type: 'none',
    host: String(o.hostHeader || o.host_header || ''),
    path: String(o.path || ''),
    tls: (truthy(o.tls) || o.tls === 'tls') ? 'tls' : '',
    sni: String(o.sni || o.servername || ''), alpn: String(o.alpn || ''), fp: String(o.fp || '')
  };
  try { return 'vmess://' + bufferFrom(JSON.stringify(obj), 'utf8').toString('base64'); } catch (e) { return ''; }
}
function buildSsLink(o) {
  var host = o.host || o.server || o.address;
  var port = parseInt(o.port || o.server_port || 8388, 10) || 8388;
  var method = o.method || o.cipher;
  var password = o.password;
  if (!host || !method || !password) return '';
  var ui;
  try { ui = bufferFrom(method + ':' + password, 'utf8').toString('base64').replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''); } catch (e) { return ''; }
  return 'ss://' + ui + '@' + host + ':' + port + '#' + encodeURIComponent(bestName(o.name, o.remarks, o.remark, o.ps, o.tag, host));
}
function buildSocksLink(o) {
  var host = o.host || o.server || o.address;
  var port = parseInt(o.port || o.server_port || 1080, 10) || 1080;
  if (!host) return '';
  var cred = '';
  var user = o.user || o.username, pass = o.pass || o.password;
  if (user) cred = encodeURIComponent(user) + (pass ? ':' + encodeURIComponent(pass) : '') + '@';
  return 'socks5://' + cred + host + ':' + port + '#' + encodeURIComponent(bestName(o.name, o.remarks, o.remark, o.ps, o.tag, host));
}
function addUniqueLink(links, seen, link) {
  link = safeText(link, 16000).replace(/^["'`]+|["'`,;\]\)]+$/g, '');
  /* Decode HTML wrappers, but keep URI escapes: %23/%3F/%26 may be credentials or transport data. */
  link = htmlEntityDecode(link);
  if (!/^(vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i.test(link)) return;
  try { parseProxyLink(link); } catch (e) { return; }
  var key = profileKeyFromLink(link);
  if (!seen[key]) { seen[key] = true; links.push(link); }
}
function parseClashVless(content, links, seen) {
  var lines = String(content || '').split(/\r?\n/);
  var items = [], cur = null, section = '', i, raw, line, m, key, val, inline, indent, trimmed;
  var hasProxySection = /^\s*proxies\s*:\s*(?:#.*)?$/im.test(String(content || ''));
  var inProxies = !hasProxySection, proxiesIndent = -1, itemIndent = -1, sectionIndent = -1;
  function done() { if (cur) { items.push(cur); cur = null; } section = ''; sectionIndent = -1; }
  for (i = 0; i < lines.length; i++) {
    raw = lines[i]; line = raw.replace(/\t/g, '  '); trimmed = line.trim(); indent = line.length - line.replace(/^\s+/, '').length;
    if (hasProxySection && /^\s*proxies\s*:\s*(?:#.*)?$/i.test(line)) {
      done(); inProxies = true; proxiesIndent = indent; itemIndent = -1; continue;
    }
    if (hasProxySection && inProxies && trimmed && trimmed.charAt(0) !== '#' && indent <= proxiesIndent && /^[A-Za-z0-9_.-]+\s*:/.test(trimmed)) {
      done(); inProxies = false;
    }
    if (!inProxies || !trimmed || trimmed.charAt(0) === '#') continue;
    if (/^\s*-\s+/.test(line)) {
      if (itemIndent < 0) itemIndent = indent;
      if (indent !== itemIndent) {
        if (cur && section === 'alpn' && indent > sectionIndent) {
          var alpnItem = normalizeYamlList(line.replace(/^\s*-\s+/, ''));
          if (alpnItem) cur.alpn = cur.alpn ? cur.alpn + ',' + alpnItem : alpnItem;
        }
        continue;
      }
      done(); cur = {}; line = line.replace(/^\s*-\s+/, '').trim();
      if (line.charAt(0) === '{' && line.charAt(line.length - 1) === '}') {
        inline = parseInlineMap(line);
        Object.keys(inline).forEach(function (k) { section = applyYamlKey(cur, section, k, inline[k]); });
        continue;
      }
    }
    if (!cur) continue;
    m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    key = m[1].toLowerCase(); val = m[2];
    if (section && sectionIndent >= 0 && indent <= sectionIndent) { section = ''; sectionIndent = -1; }
    var previousSection = section;
    section = applyYamlKey(cur, section, key, val);
    if (section && section !== previousSection) sectionIndent = indent;
    if (!section) sectionIndent = -1;
  }
  done();
  for (i = 0; i < items.length; i++) {
    var it = items[i];
    var proto = String(it.proto || '').toLowerCase();
    if (proto === 'vless') {
      addUniqueLink(links, seen, buildVlessLink({ name: it.name, uuid: it.uuid, host: it.host, port: it.port, network: it.network || 'tcp', security: it.publicKey ? 'reality' : (truthy(it.tls) ? 'tls' : 'none'), sni: it.sni, fp: it.fp, pbk: it.publicKey, sid: it.shortId, flow: it.flow, path: it.path, hostHeader: it.hostHeader, serviceName: it.serviceName, mode: it.mode, alpn: it.alpn }));
    } else if (proto === 'hysteria2' || proto === 'hy2' || proto === 'hysteria') {
      addUniqueLink(links, seen, buildHysteria2Link({ name: it.name, password: it.password, host: it.host, port: it.port, sni: it.sni, insecure: it.insecure, obfs: it.obfs, obfsPassword: it.obfsPassword, alpn: it.alpn, up: it.up, down: it.down }));
    } else if (proto === 'trojan') {
      addUniqueLink(links, seen, buildTrojanLink({ name: it.name, password: it.password, host: it.host, port: it.port, sni: it.sni, network: it.network || 'tcp', path: it.path, hostHeader: it.hostHeader, serviceName: it.serviceName, insecure: it.insecure, alpn: it.alpn, fp: it.fp }));
    } else if (proto === 'ss') {
      addUniqueLink(links, seen, buildSsLink({ name: it.name, method: it.cipher, password: it.password, host: it.host, port: it.port }));
    } else if (proto === 'vmess') {
      addUniqueLink(links, seen, buildVmessLink({ name: it.name, uuid: it.uuid, host: it.host, port: it.port, aid: it.alterId || 0, scy: it.cipher || 'auto', network: it.network || 'tcp', tls: it.tls, sni: it.sni, path: it.serviceName || it.path, hostHeader: it.hostHeader, alpn: it.alpn, fp: it.fp }));
    } else if (proto === 'socks5' || proto === 'socks') {
      addUniqueLink(links, seen, buildSocksLink({ name: it.name, user: it.username, pass: it.password, host: it.host, port: it.port }));
    }
  }
}

function parseJsonVless(content, links, seen) {
  var parsed;
  try { parsed = JSON.parse(String(content || '').trim()); } catch (e) { return; }
  function each(arr, fn) { var i; if (Object.prototype.toString.call(arr) !== '[object Array]') return; for (i = 0; i < arr.length; i++) fn(arr[i]); }
  function jsonOwnName(x) {
    if (!x || typeof x !== 'object') return '';
    return bestName(
      x.name, x.remarks, x.remark, x.ps, x.title, x.label, x.displayName, x.display_name,
      x.profileName, x.profile_name, x.serverName, x.server_name,
      x.meta && x.meta.name, x.meta && x.meta.remarks, x.metadata && x.metadata.name, x.metadata && x.metadata.remarks
    );
  }
  function jsonTagName(x) {
    if (!x || typeof x !== 'object') return '';
    return descriptiveName(x.name, x.remarks, x.remark, x.ps, x.title, x.label, x.displayName, x.display_name, x.tag);
  }
  function walk(x, inheritedName) {
    var k, ownName, nextName;
    if (!x || typeof x !== 'object') return;
    ownName = jsonOwnName(x);
    nextName = bestName(ownName, inheritedName);
    var xt = String(x.type || x.protocol || '').toLowerCase();
    if (xt === 'vless') {
      var tls = x.tls || {}, reality = tls.reality || {}, transport = x.transport || {};
      addUniqueLink(links, seen, buildVlessLink({ name: jsonProfileName(jsonTagName(x), inheritedName, x.server || x.address), uuid: x.uuid, host: x.server || x.address, port: x.server_port || x.port, network: transport.type || x.network || 'tcp', security: reality.enabled ? 'reality' : (tls.enabled ? 'tls' : 'none'), sni: tls.server_name || x.server_name, fp: tls.utls && tls.utls.fingerprint, pbk: reality.public_key, sid: reality.short_id, flow: x.flow, path: transport.path, hostHeader: transport.headers && (transport.headers.Host || transport.headers.host), serviceName: transport.service_name || transport.serviceName, mode: transport.mode }));
    } else if (xt === 'hysteria2' || xt === 'hy2' || xt === 'hysteria') {
      var tlsH = x.tls || {}, obfsH = x.obfs || {};
      addUniqueLink(links, seen, buildHysteria2Link({ name: jsonProfileName(jsonTagName(x), inheritedName, x.server || x.address), password: x.password || x.auth || x.auth_str, host: x.server || x.address, port: x.server_port || x.port, sni: tlsH.server_name || x.server_name || x.sni, insecure: tlsH.insecure || x.insecure, obfs: obfsH.type || x.obfs_type || x.obfs, obfsPassword: obfsH.password || x.obfs_password, alpn: tlsH.alpn, up: x.up_mbps || x.upmbps, down: x.down_mbps || x.downmbps }));
    } else if (xt === 'trojan') {
      var tlsT = x.tls || {}, trT = x.transport || {};
      addUniqueLink(links, seen, buildTrojanLink({ name: jsonProfileName(jsonTagName(x), inheritedName, x.server || x.address), password: x.password, host: x.server || x.address, port: x.server_port || x.port, sni: tlsT.server_name || x.sni, insecure: tlsT.insecure || x.insecure, network: trT.type || x.network || 'tcp', path: trT.path, hostHeader: trT.headers && (trT.headers.Host || trT.headers.host), serviceName: trT.service_name || trT.serviceName, alpn: tlsT.alpn, fp: tlsT.utls && tlsT.utls.fingerprint }));
    } else if (xt === 'vmess') {
      var tlsV = x.tls || {}, trV = x.transport || {};
      addUniqueLink(links, seen, buildVmessLink({ name: jsonProfileName(jsonTagName(x), inheritedName, x.server || x.address), uuid: x.uuid, host: x.server || x.address, port: x.server_port || x.port, aid: x.alter_id || x.alterId || 0, scy: x.security || 'auto', network: trV.type || x.network || 'tcp', tls: tlsV.enabled, sni: tlsV.server_name, path: trV.service_name || trV.serviceName || trV.path, hostHeader: trV.headers && (trV.headers.Host || trV.headers.host), alpn: tlsV.alpn, fp: tlsV.utls && tlsV.utls.fingerprint }));
    } else if (xt === 'shadowsocks' || xt === 'ss' || (!xt && x.server && (x.server_port || x.port) && x.method && x.password)) {
      addUniqueLink(links, seen, buildSsLink({ name: jsonProfileName(jsonTagName(x), inheritedName, x.server || x.address), method: x.method, password: x.password, host: x.server || x.address, port: x.server_port || x.port }));
    } else if (xt === 'socks' || xt === 'socks5') {
      addUniqueLink(links, seen, buildSocksLink({ name: jsonProfileName(jsonTagName(x), inheritedName, x.server || x.address), user: x.username, pass: x.password, host: x.server || x.address, port: x.server_port || x.port }));
    }
    if (String(x.protocol || '').toLowerCase() === 'vless' && x.settings && x.settings.vnext) {
      each(x.settings.vnext, function (vnext) {
        each(vnext.users, function (u) {
          var stream = x.streamSettings || {}, reality2 = stream.realitySettings || {}, tls2 = stream.tlsSettings || {};
          var grpc2 = stream.grpcSettings || {}, ws2 = stream.wsSettings || {}, http2 = stream.httpSettings || {}, xhttp2 = stream.xhttpSettings || stream.splithttpSettings || {};
          var transportPath2 = xhttp2.path || ws2.path || http2.path || '';
          var transportHost2 = xhttp2.host || (ws2.headers && (ws2.headers.Host || ws2.headers.host)) || (http2.host && http2.host[0]) || '';
          addUniqueLink(links, seen, buildVlessLink({ name: jsonProfileName(descriptiveName(jsonTagName(x), u.email), inheritedName, vnext.address), uuid: u.id, host: vnext.address, port: vnext.port, network: stream.network || 'tcp', security: stream.security || 'none', sni: reality2.serverName || tls2.serverName, fp: reality2.fingerprint, pbk: reality2.publicKey, sid: reality2.shortId, spx: reality2.spiderX, flow: u.flow, path: transportPath2, hostHeader: transportHost2, serviceName: grpc2.serviceName || grpc2.service_name, mode: xhttp2.mode }));
        });
      });
    } else if (String(x.protocol || '').toLowerCase() === 'vmess' && x.settings && x.settings.vnext) {
      each(x.settings.vnext, function (vnext) {
        each(vnext.users, function (u) {
          var streamV = x.streamSettings || {}, tlsV2 = streamV.tlsSettings || {}, grpcV = streamV.grpcSettings || {}, wsV = streamV.wsSettings || {};
          addUniqueLink(links, seen, buildVmessLink({ name: jsonProfileName(descriptiveName(jsonTagName(x), u.email), inheritedName, vnext.address), uuid: u.id, host: vnext.address, port: vnext.port, aid: u.alterId || 0, scy: u.security || 'auto', network: streamV.network || 'tcp', tls: streamV.security === 'tls', sni: tlsV2.serverName, path: streamV.network === 'grpc' ? (grpcV.serviceName || '') : (wsV.path || ''), hostHeader: wsV.headers && (wsV.headers.Host || wsV.headers.host), alpn: tlsV2.alpn, fp: tlsV2.fingerprint }));
        });
      });
    } else if (String(x.protocol || '').toLowerCase() === 'trojan' && x.settings && x.settings.servers) {
      each(x.settings.servers, function (server) {
        var streamT2 = x.streamSettings || {}, tlsT2 = streamT2.tlsSettings || {}, grpcT = streamT2.grpcSettings || {}, wsT = streamT2.wsSettings || {};
        addUniqueLink(links, seen, buildTrojanLink({ name: jsonProfileName(descriptiveName(jsonTagName(x), server.email), inheritedName, server.address), password: server.password, host: server.address, port: server.port, security: streamT2.security || 'tls', network: streamT2.network || 'tcp', sni: tlsT2.serverName, fp: tlsT2.fingerprint, path: wsT.path, hostHeader: wsT.headers && (wsT.headers.Host || wsT.headers.host), serviceName: grpcT.serviceName }));
      });
    } else if (String(x.protocol || '').toLowerCase() === 'shadowsocks' && x.settings && x.settings.servers) {
      each(x.settings.servers, function (server) { addUniqueLink(links, seen, buildSsLink({ name: jsonProfileName(jsonTagName(x), inheritedName, server.address), method: server.method, password: server.password, host: server.address, port: server.port })); });
    } else if (String(x.protocol || '').toLowerCase() === 'socks' && x.settings && x.settings.servers) {
      each(x.settings.servers, function (server) {
        var user = server.users && server.users[0] || {};
        addUniqueLink(links, seen, buildSocksLink({ name: jsonProfileName(jsonTagName(x), inheritedName, server.address), user: user.user, pass: user.pass, host: server.address, port: server.port }));
      });
    } else if (String(x.protocol || '').toLowerCase() === 'hysteria' && x.settings) {
      var hysteriaSettings = x.streamSettings && x.streamSettings.hysteriaSettings || {}, hysteriaTls = x.streamSettings && x.streamSettings.tlsSettings || {};
      addUniqueLink(links, seen, buildHysteria2Link({ name: jsonProfileName(jsonTagName(x), inheritedName, x.settings.address), password: hysteriaSettings.auth, host: x.settings.address, port: x.settings.port, sni: hysteriaTls.serverName, insecure: hysteriaTls.allowInsecure, obfs: hysteriaSettings.obfs && hysteriaSettings.obfs.type, obfsPassword: hysteriaSettings.obfs && hysteriaSettings.obfs.password, alpn: hysteriaTls.alpn }));
    }
    for (k in x) if (Object.prototype.hasOwnProperty.call(x, k)) walk(x[k], nextName);
  }
  walk(parsed, '');
}


function looksLikeProxyContent(decoded, raw) {
  decoded = String(decoded || ''); raw = String(raw || '');
  return /vless:\/\//i.test(decoded) || /vmess:\/\//i.test(decoded) || /trojan:\/\//i.test(decoded) || /ss:\/\//i.test(decoded) || /socks5?:\/\//i.test(decoded) || /hysteria2?:\/\//i.test(decoded) || /hy2:\/\//i.test(decoded) || /tuic:\/\//i.test(decoded) || /^\s*https?:\/\/[^\s]+\s*$/i.test(decoded) || decoded.split('\n').length > raw.split('\n').length || /^\s*[\[{]/.test(decoded);
}
function decodeBase64Candidate(candidate, raw) {
  var normalized = String(candidate || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  try {
    var decoded = bufferFrom(normalized, 'base64').toString('utf8');
    if (looksLikeProxyContent(decoded, raw)) return decoded;
  } catch (e) {}
  return '';
}
function safeBase64Decode(text) {
  var raw = String(text || '').trim();
  var compact = raw.replace(/\s+/g, '');
  var filtered, decoded;
  if (!compact || compact.length < 8) return raw;
  if (/^\s*[\[{]/.test(raw) || /(?:vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i.test(raw)) return raw;
  if (/^\s*(proxies|proxy-providers|outbounds)\s*:/im.test(raw) || /^\s*-\s+/.test(raw)) return raw;
  if (/^[A-Za-z0-9+/_=-]+$/.test(compact)) {
    decoded = decodeBase64Candidate(compact, raw);
    if (decoded) return decoded;
  }
  filtered = raw.replace(/[^A-Za-z0-9+/_=-]/g, '');
  if (filtered.length >= 16 && filtered.length > compact.length * 0.55) {
    decoded = decodeBase64Candidate(filtered, raw);
    if (decoded) return decoded;
  }
  return raw;
}

function parseContentHeaders(content) {
  var headers = {};
  var decoded = safeBase64Decode(content);
  var lines = decoded.split(/\r?\n/);
  var max = lines.length < 10 ? lines.length : 10;
  var i, line, idx, key, value;
  for (i = 0; i < max; i++) {
    line = lines[i] || '';
    if (line.indexOf('#') !== 0 && line.indexOf('//') !== 0) continue;
    idx = line.indexOf(':');
    if (idx < 0) continue;
    key = line.slice(0, idx).replace(/^#|^\/\//, '').trim().toLowerCase();
    value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function profileTitleFromHeaders(headers, fallback) {
  var t = headers['profile-title'] || headers['content-disposition'] || '';
  var m;
  if (t.indexOf('base64:') === 0) {
    try { t = bufferFrom(t.replace(/^base64:/, ''), 'base64').toString('utf8'); } catch (e) {}
  }
  m = String(t).match(/filename="([^"]+)"/);
  if (m) t = m[1];
  t = safeText(t, 80);
  /* An empty name is localized at display time (TV and web). */
  return t || fallback || '';
}

function parseQuery(query) {
  var params = {}, parts = String(query || '').split('&'), i, part, eq, k, v;
  for (i = 0; i < parts.length; i++) {
    part = parts[i]; if (!part) continue;
    eq = part.indexOf('='); k = eq >= 0 ? part.slice(0, eq) : part; v = eq >= 0 ? part.slice(eq + 1) : '';
    try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, '%20')); } catch (e) { params[k] = v; }
  }
  return params;
}
function parseHostPort(hp, defaultPort) {
  var host = hp, port = defaultPort || 443, end, lastColon;
  if (hp.charAt(0) === '[') {
    end = hp.indexOf(']'); host = hp.slice(1, end);
    if (hp.slice(end + 1, end + 2) === ':') port = parseInt(hp.slice(end + 2), 10);
  } else {
    lastColon = hp.lastIndexOf(':');
    if (lastColon > -1) { host = hp.slice(0, lastColon); port = parseInt(hp.slice(lastColon + 1), 10); }
  }
  return { host: host, port: port };
}
function parseVless(link) {
  link = safeText(link, 16000);
  if (!/^vless:\/\//i.test(link)) throw locErr('INVALID_LINK', 'vless expected');
  var noScheme = link.replace(/^vless:\/\//i, '');
  var hashSplit = noScheme.split('#');
  var name = hashSplit[1] ? cleanServerName(hashSplit.slice(1).join('#')) : '';
  var main = hashSplit[0];
  var qIdx = main.indexOf('?');
  var authority = qIdx >= 0 ? main.slice(0, qIdx) : main;
  var query = qIdx >= 0 ? main.slice(qIdx + 1) : '';
  var at = authority.lastIndexOf('@');
  var uuid, hp, parsed;
  if (at < 0) throw locErr('INVALID_LINK', 'missing user@host:port');
  uuid = authority.slice(0, at);
  hp = authority.slice(at + 1);
  parsed = parseHostPort(hp, 443);
  if (!uuid || !parsed.host || !parsed.port) throw locErr('INVALID_LINK', 'malformed link');
  var params = parseQuery(query);
  name = bestName(name, params.name, params.remarks, params.remark, params.ps, params.title);
  return { protocol: 'vless', uuid: uuid, host: parsed.host, port: parsed.port, params: params, name: name };
}
function parseHysteria2(link) {
  link = safeText(link, 16000);
  if (!/^(hy2|hysteria2|hysteria):\/\//i.test(link)) throw locErr('INVALID_LINK', 'hysteria2 expected');
  var noScheme = link.replace(/^(hy2|hysteria2|hysteria):\/\//i, '');
  var hashSplit = noScheme.split('#');
  var name = hashSplit[1] ? cleanServerName(hashSplit.slice(1).join('#')) : '';
  var main = hashSplit[0];
  var qIdx = main.indexOf('?');
  var authority = qIdx >= 0 ? main.slice(0, qIdx) : main;
  var query = qIdx >= 0 ? main.slice(qIdx + 1) : '';
  var at = authority.lastIndexOf('@');
  var password = '', hp = authority, parsed, params;
  if (at >= 0) { password = decodeUrlPart(authority.slice(0, at)); hp = authority.slice(at + 1); }
  parsed = parseHostPort(hp, 443);
  params = parseQuery(query);
  password = password || params.auth || params.password || params['auth-str'] || '';
  if (!parsed.host || !parsed.port || !password) throw locErr('INVALID_LINK', 'malformed hysteria2 link');
  name = bestName(name, params.name, params.remarks, params.remark, params.ps, params.title, parsed.host);
  return { protocol: 'hysteria2', password: password, host: parsed.host, port: parsed.port, params: params, name: name };
}
function b64DecodeLoose(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  try { return bufferFrom(s, 'base64').toString('utf8'); } catch (e) { return ''; }
}
function splitLinkParts(link, schemeRe) {
  var noScheme = safeText(link, 16000).replace(schemeRe, '');
  var hashSplit = noScheme.split('#');
  var name = hashSplit[1] ? cleanServerName(hashSplit.slice(1).join('#')) : '';
  var main = hashSplit[0];
  var qIdx = main.indexOf('?');
  return { name: name, authority: qIdx >= 0 ? main.slice(0, qIdx) : main, query: qIdx >= 0 ? main.slice(qIdx + 1) : '' };
}
function parseTrojan(link) {
  if (!/^trojan:\/\//i.test(String(link || ''))) throw locErr('INVALID_LINK', 'unsupported protocol');
  var parts = splitLinkParts(link, /^trojan:\/\//i);
  var at = parts.authority.lastIndexOf('@');
  if (at < 0) throw locErr('INVALID_LINK', 'missing user@host:port');
  var password = decodeUrlPart(parts.authority.slice(0, at));
  var hp = parseHostPort(parts.authority.slice(at + 1), 443);
  var params = parseQuery(parts.query);
  if (!password || !hp.host || !hp.port) throw locErr('INVALID_LINK', 'malformed link');
  var name = bestName(parts.name, params.name, params.remarks, params.remark, params.ps, hp.host);
  return { protocol: 'trojan', password: password, host: hp.host, port: hp.port, params: params, name: name };
}
function parseVmess(link) {
  if (!/^vmess:\/\//i.test(String(link || ''))) throw locErr('INVALID_LINK', 'unsupported protocol');
  var parts = splitLinkParts(link, /^vmess:\/\//i);
  var o = null;
  try { o = JSON.parse(b64DecodeLoose(parts.authority)); } catch (e) { o = null; }
  if (o && (o.add || o.host) && o.id) {
    var net = String(o.net || 'tcp').toLowerCase();
    var isTls = String(o.tls || '').toLowerCase() === 'tls' || o.tls === true;
    var params = { security: isTls ? 'tls' : 'none', type: net, sni: String(o.sni || (isTls ? (o.host || '') : '')), path: String(o.path || ''), host: String(o.host || ''), alpn: String(o.alpn || ''), fp: String(o.fp || '') };
    if (net === 'grpc') params.serviceName = String(o.path || '');
    var port = parseInt(o.port, 10);
    if (!port || !(o.add || o.host)) throw locErr('INVALID_LINK', 'malformed link');
    return { protocol: 'vmess', uuid: String(o.id), host: String(o.add || o.host), port: port, aid: parseInt(o.aid, 10) || 0, scy: String(o.scy || o.security || 'auto'), params: params, name: bestName(String(o.ps || ''), parts.name, String(o.add || o.host)) };
  }
  var at = parts.authority.lastIndexOf('@');
  if (at < 0) throw locErr('INVALID_LINK', 'missing user@host:port');
  var uuid = decodeUrlPart(parts.authority.slice(0, at));
  var hp = parseHostPort(parts.authority.slice(at + 1), 443);
  var q = parseQuery(parts.query);
  if (!uuid || !hp.host || !hp.port) throw locErr('INVALID_LINK', 'malformed link');
  return { protocol: 'vmess', uuid: uuid, host: hp.host, port: hp.port, aid: parseInt(q.aid, 10) || 0, scy: String(q.scy || q.encryption || 'auto'), params: q, name: bestName(parts.name, q.name, q.remarks, hp.host) };
}
function parseSs(link) {
  if (!/^ss:\/\//i.test(String(link || ''))) throw locErr('INVALID_LINK', 'unsupported protocol');
  var parts = splitLinkParts(link, /^ss:\/\//i);
  var authority = parts.authority.replace(/\/$/, '');
  var method = '', password = '', hp = null;
  var at = authority.lastIndexOf('@');
  if (at >= 0) {
    var ui = b64DecodeLoose(authority.slice(0, at));
    if (!ui || ui.indexOf(':') < 0) ui = decodeUrlPart(authority.slice(0, at));
    var c = ui.indexOf(':');
    if (c < 0) throw locErr('INVALID_LINK', 'malformed link');
    method = ui.slice(0, c); password = ui.slice(c + 1);
    hp = parseHostPort(authority.slice(at + 1), 8388);
  } else {
    var dec = b64DecodeLoose(authority);
    var at2 = dec.lastIndexOf('@');
    if (at2 < 0) throw locErr('INVALID_LINK', 'malformed link');
    var mp = dec.slice(0, at2);
    var c2 = mp.indexOf(':');
    if (c2 < 0) throw locErr('INVALID_LINK', 'malformed link');
    method = mp.slice(0, c2); password = mp.slice(c2 + 1);
    hp = parseHostPort(dec.slice(at2 + 1), 8388);
  }
  var params = parseQuery(parts.query);
  if (!method || !password || !hp.host || !hp.port) throw locErr('INVALID_LINK', 'malformed link');
  var name = bestName(parts.name, params.name, params.remarks, hp.host);
  return { protocol: 'ss', method: method.toLowerCase(), password: password, host: hp.host, port: hp.port, params: params, name: name };
}
function parseSocks(link) {
  if (!/^socks5?:\/\//i.test(String(link || ''))) throw locErr('INVALID_LINK', 'unsupported protocol');
  var parts = splitLinkParts(link, /^socks5?:\/\//i);
  var user = '', pass = '', authority = parts.authority;
  var at = authority.lastIndexOf('@');
  if (at >= 0) {
    var cred = authority.slice(0, at);
    if (cred.indexOf(':') < 0) { var dec = b64DecodeLoose(cred); if (dec && dec.indexOf(':') >= 0) cred = dec; }
    var c = cred.indexOf(':');
    user = decodeUrlPart(c >= 0 ? cred.slice(0, c) : cred);
    pass = c >= 0 ? decodeUrlPart(cred.slice(c + 1)) : '';
    authority = authority.slice(at + 1);
  }
  var hp = parseHostPort(authority, 1080);
  if (!hp.host || !hp.port) throw locErr('INVALID_LINK', 'malformed link');
  var name = bestName(parts.name, hp.host);
  return { protocol: 'socks', user: user, pass: pass, host: hp.host, port: hp.port, params: parseQuery(parts.query), name: name };
}
function parseProxyLink(link) {
  var s = String(link || '');
  if (/^vless:\/\//i.test(s)) return parseVless(link);
  if (/^(hy2|hysteria2|hysteria):\/\//i.test(s)) return parseHysteria2(link);
  if (/^trojan:\/\//i.test(s)) return parseTrojan(link);
  if (/^vmess:\/\//i.test(s)) return parseVmess(link);
  if (/^ss:\/\//i.test(s)) return parseSs(link);
  if (/^socks5?:\/\//i.test(s)) return parseSocks(link);
  throw locErr('INVALID_LINK', 'unsupported protocol');
}

var PROTO_RE = /^(vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\//i;
var PROTO_BADGE = { vless: 'VLESS', hysteria2: 'HYSTERIA2', trojan: 'TROJAN', vmess: 'VMESS', ss: 'SS', socks: 'SOCKS5' };
function inferName(link) { try { var p = parseProxyLink(link); return bestName(p.name, p.host) || p.host; } catch (e) { return 'VPN profile'; } }
function summary(link) {
  try {
    var p = parseProxyLink(link), hp = p.host + ':' + p.port;
    if (p.protocol === 'hysteria2') return hp + ' · hysteria2';
    if (p.protocol === 'trojan') return hp + ' · trojan · ' + (p.params.type || p.params.network || 'tcp');
    if (p.protocol === 'vmess') return hp + ' · vmess · ' + (p.params.security || 'none') + ' · ' + (p.params.type || 'tcp');
    if (p.protocol === 'ss') return hp + ' · shadowsocks · ' + p.method;
    if (p.protocol === 'socks') return hp + ' · socks5' + (p.user ? ' · auth' : '');
    return hp + ' · ' + (p.params.security || 'none') + ' · ' + (p.params.type || p.params.network || 'tcp');
  } catch (e) { return link; }
}
function validateLink(link) { if (!link) throw locErr('INVALID_LINK', 'empty link'); if (!PROTO_RE.test(link)) throw locErr('INVALID_LINK', 'unsupported protocol'); if (link.length > 16000) throw locErr('INVALID_LINK', 'link too long'); parseProxyLink(link); }


function paramsIdentity(params) {
  var skip = { name: 1, remarks: 1, remark: 1, ps: 1, title: 1 }, keys = [], out = [], k, i;
  params = params || {};
  for (k in params) if (Object.prototype.hasOwnProperty.call(params, k) && !skip[String(k).toLowerCase()]) keys.push(k);
  keys.sort(function (a, b) { a = String(a).toLowerCase(); b = String(b).toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; });
  for (i = 0; i < keys.length; i++) out.push([String(keys[i]).toLowerCase(), String(params[keys[i]])]);
  return JSON.stringify(out);
}
function profileKeyFromLink(link) {
  try {
    var v = parseProxyLink(link);
    var p = v.params || {};
    if (v.protocol === 'hysteria2') {
      return ['hysteria2', String(v.password || ''), String(v.host || '').toLowerCase(), String(v.port || ''), paramsIdentity(p)].join('|');
    }
    if (v.protocol === 'trojan') return ['trojan', String(v.password || ''), String(v.host || '').toLowerCase(), String(v.port || ''), paramsIdentity(p)].join('|');
    if (v.protocol === 'vmess') return ['vmess', String(v.uuid || '').toLowerCase(), String(v.host || '').toLowerCase(), String(v.port || ''), String(v.aid || 0), String(v.scy || 'auto').toLowerCase(), paramsIdentity(p)].join('|');
    if (v.protocol === 'ss') return ['ss', String(v.method || ''), String(v.password || ''), String(v.host || '').toLowerCase(), String(v.port || ''), paramsIdentity(p)].join('|');
    if (v.protocol === 'socks') return ['socks', String(v.user || ''), String(v.pass || ''), String(v.host || '').toLowerCase(), String(v.port || ''), paramsIdentity(p)].join('|');
    return [
      'vless', String(v.uuid || '').toLowerCase(), String(v.host || '').toLowerCase(), String(v.port || ''),
      paramsIdentity(p)
    ].join('|');
  } catch (e) { return 'raw|' + String(link || '').split('#')[0]; }
}
function profileKey(profile) {
  if (profile && profile.sourceKey) return String(profile.sourceKey);
  if (profile && profile.fullConfig && profile.id) return 'fullConfig|' + String(profile.id);
  return profileKeyFromLink(profile && profile.link || profile || '');
}
function profileStoreKey(profile) {
  if (profile && profile.subscriptionId) return 'subscription|' + String(profile.subscriptionId) + '|' + profileKey(profile);
  return 'single|' + profileKey(profile);
}

function dedupeProfilesInStore(store) {
  var oldActive = store.activeId, activeKey = '', seen = {}, out = [], i, p, key, idx;
  if (!store || Object.prototype.toString.call(store.profiles) !== '[object Array]') return store;
  for (i = 0; i < store.profiles.length; i++) if (store.profiles[i] && store.profiles[i].id === oldActive) activeKey = profileStoreKey(store.profiles[i]);
  for (i = 0; i < store.profiles.length; i++) {
    p = store.profiles[i]; if (!p || (!p.link && !p.fullConfig)) continue;
    key = profileStoreKey(p);
    if (seen[key] !== undefined) {
      idx = seen[key];
      if (p.id === oldActive || (!out[idx].name && p.name)) { out[idx] = p; seen[key] = idx; }
      continue;
    }
    seen[key] = out.length; out.push(p);
  }
  store.profiles = out;
  if (oldActive) {
    for (i = 0; i < out.length; i++) if (out[i].id === oldActive) return store;
    if (activeKey) for (i = 0; i < out.length; i++) if (profileStoreKey(out[i]) === activeKey) { store.activeId = out[i].id; return store; }
  }
  if (!store.activeId || !out.some(function (x) { return x.id === store.activeId; })) store.activeId = out[0] && out[0].id || null;
  return store;
}
function cleanServerLabel(text) { return String(text || '').replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '').replace(/^[\s·|:-]+|[\s·|:-]+$/g, '').replace(/\s{2,}/g, ' ').trim(); }
function profileDisplayName(p) { return cleanServerLabel(p && (p.name || inferName(p.link)) || ''); }

var countries = require('../../countries');
var COUNTRY_WORDS = [
  ['россия','ru'],['russia','ru'],['москва','ru'],['moscow','ru'],['петербург','ru'],['petersburg','ru'],
  ['украина','ua'],['ukraine','ua'],['киев','ua'],['kyiv','ua'],['kiev','ua'],
  ['беларусь','by'],['белоруссия','by'],['belarus','by'],['минск','by'],['minsk','by'],
  ['казахстан','kz'],['kazakhstan','kz'],['алматы','kz'],['almaty','kz'],['астана','kz'],['astana','kz'],
  ['германия','de'],['germany','de'],['deutschland','de'],['франкфурт','de'],['frankfurt','de'],['falkenstein','de'],['берлин','de'],['berlin','de'],['мюнхен','de'],['munich','de'],['нюрнберг','de'],['nuremberg','de'],
  ['нидерланды','nl'],['голландия','nl'],['netherlands','nl'],['holland','nl'],['амстердам','nl'],['amsterdam','nl'],
  ['франция','fr'],['france','fr'],['париж','fr'],['paris','fr'],['страсбург','fr'],['strasbourg','fr'],
  ['финляндия','fi'],['finland','fi'],['хельсинки','fi'],['helsinki','fi'],
  ['швеция','se'],['sweden','se'],['стокгольм','se'],['stockholm','se'],
  ['швейцария','ch'],['switzerland','ch'],['цюрих','ch'],['zurich','ch'],['женева','ch'],['geneva','ch'],
  ['польша','pl'],['poland','pl'],['варшава','pl'],['warsaw','pl'],
  ['литва','lt'],['lithuania','lt'],['вильнюс','lt'],['vilnius','lt'],
  ['латвия','lv'],['latvia','lv'],['рига','lv'],['riga','lv'],
  ['эстония','ee'],['estonia','ee'],['таллин','ee'],['tallinn','ee'],
  ['чехия','cz'],['czech','cz'],['прага','cz'],['prague','cz'],
  ['австрия','at'],['austria','at'],['вена','at'],['vienna','at'],
  ['австралия','au'],['australia','au'],['сидней','au'],['sydney','au'],
  ['великобритания','gb'],['британия','gb'],['англия','gb'],['united kingdom','gb'],['britain','gb'],['england','gb'],['лондон','gb'],['london','gb'],
  ['сша','us'],['америка','us'],['united states','us'],['usa','us'],['america','us'],['нью-йорк','us'],['new york','us'],['даллас','us'],['dallas','us'],['майами','us'],['miami','us'],['чикаго','us'],['chicago','us'],['сиэтл','us'],['seattle','us'],['ashburn','us'],
  ['канада','ca'],['canada','ca'],['торонто','ca'],['toronto','ca'],['ванкувер','ca'],['vancouver','ca'],
  ['япония','jp'],['japan','jp'],['токио','jp'],['tokyo','jp'],['осака','jp'],['osaka','jp'],
  ['корея','kr'],['korea','kr'],['сеул','kr'],['seoul','kr'],
  ['сингапур','sg'],['singapore','sg'],
  ['гонконг','hk'],['hong kong','hk'],['hongkong','hk'],
  ['тайвань','tw'],['taiwan','tw'],['тайбэй','tw'],['taipei','tw'],
  ['турция','tr'],['turkey','tr'],['turkiye','tr'],['стамбул','tr'],['istanbul','tr'],
  ['израиль','il'],['israel','il'],
  ['эмираты','ae'],['оаэ','ae'],['emirates','ae'],['дубай','ae'],['dubai','ae'],
  ['испания','es'],['spain','es'],['мадрид','es'],['madrid','es'],['барселона','es'],['barcelona','es'],
  ['италия','it'],['italy','it'],['милан','it'],['milan','it'],
  ['португалия','pt'],['portugal','pt'],['лиссабон','pt'],['lisbon','pt'],
  ['ирландия','ie'],['ireland','ie'],['дублин','ie'],['dublin','ie'],
  ['норвегия','no'],['norway','no'],['осло','no'],['oslo','no'],
  ['дания','dk'],['denmark','dk'],['копенгаген','dk'],['copenhagen','dk'],
  ['бельгия','be'],['belgium','be'],['брюссель','be'],['brussels','be'],
  ['люксембург','lu'],['luxembourg','lu'],
  ['венгрия','hu'],['hungary','hu'],['будапешт','hu'],['budapest','hu'],
  ['румыния','ro'],['romania','ro'],['бухарест','ro'],['bucharest','ro'],
  ['болгария','bg'],['bulgaria','bg'],['софия','bg'],
  ['греция','gr'],['greece','gr'],['афины','gr'],['athens','gr'],
  ['сербия','rs'],['serbia','rs'],['белград','rs'],['belgrade','rs'],
  ['хорватия','hr'],['croatia','hr'],
  ['словакия','sk'],['slovakia','sk'],
  ['словения','si'],['slovenia','si'],
  ['молдова','md'],['молдавия','md'],['moldova','md'],
  ['грузия','ge'],['тбилиси','ge'],['tbilisi','ge'],['georgia','ge'],
  ['армения','am'],['armenia','am'],['ереван','am'],['yerevan','am'],
  ['азербайджан','az'],['azerbaijan','az'],['баку','az'],['baku','az'],
  ['узбекистан','uz'],['uzbekistan','uz'],['ташкент','uz'],['tashkent','uz'],
  ['киргизия','kg'],['кыргызстан','kg'],['kyrgyzstan','kg'],['бишкек','kg'],['bishkek','kg'],
  ['индонезия','id'],['indonesia','id'],
  ['индия','in'],['india','in'],
  ['бразилия','br'],['brazil','br'],
  ['аргентина','ar'],['argentina','ar'],
  ['мексика','mx'],['mexico','mx'],
  ['таиланд','th'],['thailand','th'],
  ['вьетнам','vn'],['vietnam','vn'],
  ['малайзия','my'],['malaysia','my'],
  ['филиппины','ph'],['philippines','ph'],
  ['исландия','is'],['iceland','is'],
  ['кипр','cy'],['cyprus','cy'],
  ['мальта','mt'],['malta','mt'],
  ['албания','al'],['albania','al'],
  ['босния','ba'],['bosnia','ba'],
  ['македония','mk'],['macedonia','mk'],
  ['черногория','me'],['montenegro','me'],
  ['новая зеландия','nz'],['new zealand','nz'],
  ['чили','cl'],['chile','cl'],
  ['китай','cn'],['china','cn']
];
function detectCountry(text) {
  var s = String(text || '');
  if (!s) return '';
  var m = s.match(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/);
  if (m) {
    var code = String.fromCharCode(97 + m[0].charCodeAt(1) - 0xDDE6, 97 + m[0].charCodeAt(3) - 0xDDE6);
    if (countries.isSupported(code)) return code;
  }
  var low = s.toLowerCase(), i;
  for (i = 0; i < COUNTRY_WORDS.length; i++) if (low.indexOf(COUNTRY_WORDS[i][0]) >= 0) return COUNTRY_WORDS[i][1];
  var re = /(^|[^A-Za-z0-9])([A-Z]{2})(?![A-Za-z])/g, mm, c;
  while ((mm = re.exec(s))) {
    c = mm[2].toLowerCase();
    if (c === 'gb') continue; /* GB почти всегда гигабайты, а не Британия */
    if (countries.isSupported(c)) return c;
  }
  return '';
}
function detectCountryForProfile(p) {
  var raw = '';
  try { raw = parseProxyLink(p.link).name || ''; } catch (e) {}
  return detectCountry(String(p && p.name || '') + ' ' + raw);
}
function flagEmoji(code) {
  return countries.emoji(code);
}

function extractProxyLinks(content) {
  var raw = htmlEntityDecode(content);
  var decoded = safeBase64Decode(raw) || raw;
  var lines = decoded.split(/\r?\n/);
  var links = [], seen = {}, i, line, matches, j, extra;
  for (i = 0; i < lines.length; i++) addUniqueLink(links, seen, lines[i]);
  matches = decoded.match(/(?:vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\/[^\s<>'"`]+/ig) || [];
  for (j = 0; j < matches.length; j++) addUniqueLink(links, seen, matches[j]);
  extra = htmlEntityDecode(decoded).replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  matches = extra.match(/(?:vless|hy2|hysteria2|hysteria|trojan|vmess|ss|socks5?):\/\/[^\s<>'"`]+/ig) || [];
  for (j = 0; j < matches.length; j++) addUniqueLink(links, seen, matches[j]);
  parseClashVless(decoded, links, seen);
  parseJsonVless(decoded, links, seen);
  return links;
}

function isFullXrayConfig(value) {
  return !!value && typeof value === 'object' && Object.prototype.toString.call(value.inbounds) === '[object Array]' && Object.prototype.toString.call(value.outbounds) === '[object Array]';
}
function fullXrayProfile(config, index) {
  var links = [], seen = {}, parsed, name, identity;
  parseJsonVless(JSON.stringify(config), links, seen);
  if (!links.length) return null;
  parsed = parseProxyLink(links[0]);
  name = cleanServerName(config.remarks || config.remark || config.name || config.ps || parsed.name);
  if (!name) name = parsed.host || ('VPN #' + (index + 1));
  identity = cleanServerName(config.id || config.profileId || config.profile_id || config.uuid || '');
  return {
    link: links[0],
    protocol: parsed.protocol || 'vless',
    name: name,
    sourceKey: identity ? ('xray|id|' + identity) : ('xray|name|' + name + '|' + profileKeyFromLink(links[0])),
    fullConfig: config
  };
}
function extractSubscriptionProfiles(content) {
  var decoded = safeBase64Decode(htmlEntityDecode(content));
  var decoded2 = safeBase64Decode(percentDecodeLoose(decoded));
  var parsed = null, profiles = [], links, i, item, fullCount = 0, fp;
  try { parsed = JSON.parse(String(decoded || '').trim()); } catch (e) {
    if (decoded2 && decoded2 !== decoded) try { parsed = JSON.parse(String(decoded2 || '').trim()); decoded = decoded2; } catch (e2) {}
  }
  if (isFullXrayConfig(parsed)) {
    fp = fullXrayProfile(parsed, 0);
    return fp ? [fp] : [];
  }
  if (Object.prototype.toString.call(parsed) === '[object Array]') {
    for (i = 0; i < parsed.length; i++) if (isFullXrayConfig(parsed[i])) fullCount++;
    if (fullCount) {
      for (i = 0; i < parsed.length; i++) {
        item = parsed[i];
        if (isFullXrayConfig(item)) {
          fp = fullXrayProfile(item, i);
          if (fp) profiles.push(fp);
        } else {
          links = extractProxyLinks(JSON.stringify(item));
          links.forEach(function (link) { var p = parseProxyLink(link); profiles.push({ link: link, protocol: p.protocol, name: p.name }); });
        }
      }
      return profiles;
    }
  }
  links = extractProxyLinks(content);
  for (i = 0; i < links.length; i++) {
    var p = parseProxyLink(links[i]);
    profiles.push({ link: links[i], protocol: p.protocol, name: p.name });
  }
  return profiles;
}


module.exports = {
  PROTO_RE: PROTO_RE,
  PROTO_BADGE: PROTO_BADGE,
  safeText: safeText,
  cleanServerName: cleanServerName,
  cleanServerLabel: cleanServerLabel,
  htmlEntityDecode: htmlEntityDecode,
  percentDecodeLoose: percentDecodeLoose,
  safeBase64Decode: safeBase64Decode,
  parseProxyLink: parseProxyLink,
  parseVless: parseVless,
  parseVmess: parseVmess,
  parseTrojan: parseTrojan,
  parseSs: parseSs,
  parseSocks: parseSocks,
  parseHysteria2: parseHysteria2,
  validateLink: validateLink,
  inferName: inferName,
  summary: summary,
  profileKey: profileKey,
  profileKeyFromLink: profileKeyFromLink,
  profileStoreKey: profileStoreKey,
  profileDisplayName: profileDisplayName,
  dedupeProfilesInStore: dedupeProfilesInStore,
  detectCountry: detectCountry,
  detectCountryForProfile: detectCountryForProfile,
  flagEmoji: flagEmoji,
  extractProxyLinks: extractProxyLinks,
  extractSubscriptionProfiles: extractSubscriptionProfiles,
  isFullXrayConfig: isFullXrayConfig,
  fullXrayProfile: fullXrayProfile,
  parseContentHeaders: parseContentHeaders,
  profileTitleFromHeaders: profileTitleFromHeaders,
  looksLikeUnsupportedSubscriptionPage: looksLikeUnsupportedSubscriptionPage,
  isGenericName: isGenericName,
  descriptiveName: descriptiveName,
  bestName: bestName,
  hostDisplayName: hostDisplayName,
  importedProfileName: importedProfileName,
  jsonProfileName: jsonProfileName,
  parseQuery: parseQuery,
  parseHostPort: parseHostPort,
  truthy: truthy
};
