#!/usr/bin/env node
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var urlmod = require('url');

var DATA_DIR = process.env.ALCYONE_DATA_DIR || '/var/lib/alcyone';
var STORE_FILE = path.join(DATA_DIR, 'profiles.json');
var PORT = parseInt(process.env.ALCYONE_WEB_PORT || '8080', 10);
var HOST = process.env.ALCYONE_WEB_HOST || '0.0.0.0';
var CORE = process.env.ALCYONE_CORE || 'xray';
var EDITION_NAME = process.env.ALCYONE_EDITION_NAME || 'XRay Edition';
var APP_TITLE = process.env.ALCYONE_TITLE || 'Alcyone XRay';
var APP_VERSION = process.env.ALCYONE_VERSION || '3.2.0';
var MAX_DOWNLOAD = 2 * 1024 * 1024;
var MAX_EXPANDED_DOWNLOAD = 4 * 1024 * 1024;
var MAX_REMOTE_URLS = 64;
var IMPORT_TIMEOUT = 60 * 1000;
var MAX_BODY = 64 * 1024;

/* ---------- i18n (RU / EN, auto by Accept-Language region) ---------- */
var MSG = {
  ru: {
    'err.needHttp': 'Нужна http/https ссылка подписки',
    'err.tooManyRedirects': 'Слишком много redirect',
    'err.tooBig': 'Подписка больше 2 МБ',
    'err.timeout': 'Таймаут загрузки подписки',
    'err.vlessOnly': 'Поддерживаются VLESS-ссылки',
    'err.hysteriaOnly': 'Поддерживаются Hysteria2-ссылки',
    'err.protoOnly': 'Поддерживаются VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2',
    'err.noUuidHost': 'Не найден user@host:port',
    'err.badVless': 'Некорректная серверная ссылка',
    'err.badHysteria': 'Некорректный Hysteria2',
    'err.emptyLink': 'Ссылка пустая',
    'err.acceptOnly': 'Alcyone принимает ссылки VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2',
    'err.linkTooLong': 'Ссылка слишком длинная',
    'err.importType': 'Вставь серверную ссылку или http/https ссылку подписки',
    'err.tooManyNested': 'В подписке слишком много вложенных ссылок',
    'err.expandedTooBig': 'Подписка после загрузки вложенных списков больше 4 МБ',
    'err.nestedFailed': 'Не удалось полностью загрузить вложенную подписку: ',
    'err.rejectedMode': 'Сервер подписки отклонил режим ',
    'err.noServersInSub': 'В подписке не найдено поддерживаемых серверов. Alcyone попробовал режимы HAPP, sing-box, v2RayTun и Clash.',
    'err.subNotFound': 'Подписка не найдена',
    'err.profileNotFound': 'Профиль не найден',
    'sub.default': 'Подписка',
    'sub.neverUpdated': 'не обновлялась',
    'sub.servers': 'Серверов: ',
    'row.subscription': 'подписка',
    'row.manual': 'ручной профиль',
    'row.active': 'Активен',
    'row.select': 'Выбрать',
    'row.delete': 'Удалить',
    'row.update': 'Обновить',
    'empty.profiles': 'Профилей пока нет. Добавь серверную ссылку или подписку выше.',
    'empty.subs': 'Подписок пока нет.',
    'hero.text': 'Добавляй одиночные ссылки VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2 или ссылку подписки. Alcyone скачает подписку, разберёт серверы и покажет их на телевизоре.',
    'hero.ips': 'Адреса ТВ: ',
    'hero.noIp': 'IP не определён',
    'form.addProfile': 'Добавить сервер по ссылке',
    'form.name': 'Название',
    'form.namePh': 'Например: NL Reality',
    'form.link': 'Ссылка',
    'form.linkPh': 'vless:// · vmess:// · trojan:// · ss:// · socks5://user:pass@ip:port · hy2://',
    'form.saveProfile': 'Сохранить профиль',
    'form.addSub': 'Добавить подписку',
    'form.subName': 'Название подписки',
    'form.subNamePh': 'Например: Epsiquad',
    'form.subUrl': 'Ссылка подписки',
    'form.subUrlPh': 'https://example.com/sub/... или страница панели',
    'form.loadSub': 'Загрузить подписку',
    'form.updateAll': 'Обновить все подписки',
    'form.importTitle': 'Импорт сервера или подписки',
    'form.importName': 'Название (необязательно)',
    'form.importNamePh': 'Например: Домашний VPN',
    'form.importValue': 'Серверная ссылка или URL подписки',
    'form.importValuePh': 'vless:// · vmess:// · trojan:// · ss:// · socks5:// · hy2:// · https://',
    'form.importHelp': 'Тип ссылки определяется автоматически. Из подписки будут добавлены все поддерживаемые серверы.',
    'form.importButton': 'Импортировать',
    'sec.subs': 'Подписки',
    'sec.servers': 'Серверы',
    'js.saving': 'Сохраняю...',
    'js.error': 'Ошибка: ',
    'js.notSaved': 'не сохранено',
    'js.saved': 'Сохранено. Обновляю список...',
    'js.loadingSub': 'Загружаю подписку...',
    'js.notLoaded': 'не загружено',
    'js.loaded1': 'Готово: импортировано ',
    'js.loaded2': ' профилей. Обновляю список...',
    'js.importing': 'Проверяю ссылку и импортирую...',
    'js.importedProfile': 'Профиль импортирован. Обновляю список...',
    'js.updatingAll': 'Обновляю все подписки...',
    'js.notUpdated': 'не обновлено',
    'js.updated': 'Готово. Обновляю список...',
    'js.confirmDelProfile': 'Удалить профиль?',
    'js.confirmDelSub': 'Удалить подписку и её профили?',
    'lang.auto': 'Авто'
  },
  en: {
    'err.needHttp': 'A valid http/https subscription URL is required',
    'err.tooManyRedirects': 'Too many redirects',
    'err.tooBig': 'Subscription is larger than 2 MB',
    'err.timeout': 'Subscription download timed out',
    'err.vlessOnly': 'Only VLESS links are supported',
    'err.hysteriaOnly': 'Only Hysteria2 links are supported',
    'err.protoOnly': 'Only VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2 are supported',
    'err.noUuidHost': 'user@host:port not found',
    'err.badVless': 'Invalid server link',
    'err.badHysteria': 'Invalid Hysteria2 link',
    'err.emptyLink': 'The link is empty',
    'err.acceptOnly': 'Alcyone accepts VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2 links',
    'err.linkTooLong': 'The link is too long',
    'err.importType': 'Paste a server link or an http/https subscription URL',
    'err.tooManyNested': 'The subscription contains too many nested links',
    'err.expandedTooBig': 'The subscription exceeds 4 MB after loading nested lists',
    'err.nestedFailed': 'A nested subscription could not be loaded completely: ',
    'err.rejectedMode': 'The subscription server rejected mode ',
    'err.noServersInSub': 'No supported servers found in the subscription. Alcyone tried the HAPP, sing-box, v2RayTun and Clash modes.',
    'err.subNotFound': 'Subscription not found',
    'err.profileNotFound': 'Profile not found',
    'sub.default': 'Subscription',
    'sub.neverUpdated': 'never updated',
    'sub.servers': 'Servers: ',
    'row.subscription': 'subscription',
    'row.manual': 'manual profile',
    'row.active': 'Active',
    'row.select': 'Select',
    'row.delete': 'Delete',
    'row.update': 'Update',
    'empty.profiles': 'No profiles yet. Add a server link or a subscription above.',
    'empty.subs': 'No subscriptions yet.',
    'hero.text': 'Add single VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2 links or a subscription URL. Alcyone will download the subscription, parse the servers and show them on the TV.',
    'hero.ips': 'TV addresses: ',
    'hero.noIp': 'IP not detected',
    'form.addProfile': 'Add server link',
    'form.name': 'Name',
    'form.namePh': 'E.g.: NL Reality',
    'form.link': 'Link',
    'form.linkPh': 'vless:// · vmess:// · trojan:// · ss:// · socks5://user:pass@ip:port · hy2://',
    'form.saveProfile': 'Save profile',
    'form.addSub': 'Add subscription',
    'form.subName': 'Subscription name',
    'form.subNamePh': 'E.g.: Epsiquad',
    'form.subUrl': 'Subscription URL',
    'form.subUrlPh': 'https://example.com/sub/... or a panel page',
    'form.loadSub': 'Load subscription',
    'form.updateAll': 'Update all subscriptions',
    'form.importTitle': 'Import server or subscription',
    'form.importName': 'Name (optional)',
    'form.importNamePh': 'E.g.: Home VPN',
    'form.importValue': 'Server link or subscription URL',
    'form.importValuePh': 'vless:// · vmess:// · trojan:// · ss:// · socks5:// · hy2:// · https://',
    'form.importHelp': 'The link type is detected automatically. All supported servers in a subscription will be added.',
    'form.importButton': 'Import',
    'sec.subs': 'Subscriptions',
    'sec.servers': 'Servers',
    'js.saving': 'Saving...',
    'js.error': 'Error: ',
    'js.notSaved': 'not saved',
    'js.saved': 'Saved. Refreshing the list...',
    'js.loadingSub': 'Loading subscription...',
    'js.notLoaded': 'not loaded',
    'js.loaded1': 'Done: imported ',
    'js.loaded2': ' profiles. Refreshing the list...',
    'js.importing': 'Checking the link and importing...',
    'js.importedProfile': 'Profile imported. Refreshing the list...',
    'js.updatingAll': 'Updating all subscriptions...',
    'js.notUpdated': 'not updated',
    'js.updated': 'Done. Refreshing the list...',
    'js.confirmDelProfile': 'Delete this profile?',
    'js.confirmDelSub': 'Delete this subscription and its profiles?',
    'lang.auto': 'Auto'
  }
};
function T(lang, key) { var l = MSG[lang] ? lang : 'ru'; var v = MSG[l][key]; if (v === undefined) v = MSG.ru[key]; return v === undefined ? key : v; }
function locErr(key, extra) { var e = new Error(String(MSG.ru[key] || key) + (extra || '')); e.i18nKey = key; e.i18nExtra = extra || ''; return e; }
function errText(err, lang) {
  if (err && err.i18nKey) return T(lang, err.i18nKey) + (err.i18nExtra || '');
  return err && err.message || String(err);
}
/* languages/regions where Russian is more widely understood than English */
var RU_LANGS = { ru: 1, be: 1, uk: 1, kk: 1, ky: 1, uz: 1, tg: 1, tk: 1, hy: 1, az: 1 };
var RU_REGIONS = { ru: 1, by: 1, kz: 1, kg: 1, uz: 1, tj: 1, tm: 1, am: 1, az: 1, md: 1, ua: 1, ge: 1 };
function langFromAcceptLanguage(al) {
  var parts = String(al || '').toLowerCase().split(','), i, tag, seg;
  for (i = 0; i < parts.length; i++) {
    tag = parts[i].split(';')[0].trim().replace(/_/g, '-');
    if (!tag || tag === '*') continue;
    seg = tag.split('-');
    if (RU_LANGS[seg[0]]) return 'ru';
    if (seg[1] && RU_REGIONS[seg[1]]) return 'ru';
    return 'en'; /* первый валидный тег решает */
  }
  return 'en';
}
function parseCookies(req) {
  var out = {}, raw = req.headers && req.headers.cookie || '', parts = raw.split(';'), i, idx, p;
  for (i = 0; i < parts.length; i++) {
    p = parts[i].trim(); idx = p.indexOf('=');
    if (idx > 0) out[p.slice(0, idx)] = p.slice(idx + 1);
  }
  return out;
}
function requestLang(req, query) {
  var q = query && query.lang;
  if (q === 'ru' || q === 'en') return q;
  if (q === 'auto') return langFromAcceptLanguage(req.headers['accept-language']);
  var c = parseCookies(req).alang;
  if (c === 'ru' || c === 'en') return c;
  return langFromAcceptLanguage(req.headers['accept-language']);
}
function requestLangSetting(req, query) {
  var q = query && query.lang;
  if (q === 'ru' || q === 'en' || q === 'auto') return q;
  var c = parseCookies(req).alang;
  if (c === 'ru' || c === 'en') return c;
  return 'auto';
}

function ensureDir() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR); } catch (e) {} }
function now() { return Date.now(); }
function defaultStore() { return { profiles: [], subscriptions: [], activeId: null, updatedAt: now() }; }

function normalizeStore(parsed) {
  var i;
  if (Object.prototype.toString.call(parsed) === '[object Array]') parsed = { profiles: parsed, subscriptions: [], activeId: parsed[0] && parsed[0].id || null };
  if (!parsed || typeof parsed !== 'object') parsed = defaultStore();
  if (Object.prototype.toString.call(parsed.profiles) !== '[object Array]') parsed.profiles = [];
  if (Object.prototype.toString.call(parsed.subscriptions) !== '[object Array]') parsed.subscriptions = [];
  for (i = parsed.profiles.length - 1; i >= 0; i--) if (!parsed.profiles[i] || !parsed.profiles[i].id || !parsed.profiles[i].link) parsed.profiles.splice(i, 1);
  for (i = 0; i < parsed.profiles.length; i++) {
    if (!parsed.profiles[i].protocol) parsed.profiles[i].protocol = 'vless';
    if (!parsed.profiles[i].sourceType) parsed.profiles[i].sourceType = parsed.profiles[i].subscriptionId ? 'subscription' : 'single';
    if (parsed.profiles[i].name) parsed.profiles[i].name = cleanServerLabel(parsed.profiles[i].name);
    if (!parsed.profiles[i].country) { var ccBF = detectCountryForProfile(parsed.profiles[i]); if (ccBF) parsed.profiles[i].country = ccBF; }
  }
  for (i = parsed.subscriptions.length - 1; i >= 0; i--) if (!parsed.subscriptions[i] || !parsed.subscriptions[i].id || !parsed.subscriptions[i].url) parsed.subscriptions.splice(i, 1);
  dedupeProfilesInStore(parsed);
  if (parsed.activeId) {
    var found = false;
    for (i = 0; i < parsed.profiles.length; i++) if (parsed.profiles[i].id === parsed.activeId) found = true;
    if (!found) parsed.activeId = parsed.profiles[0] && parsed.profiles[0].id || null;
  }
  if (!parsed.activeId && parsed.profiles[0]) parsed.activeId = parsed.profiles[0].id;
  return parsed;
}

function readStore() { ensureDir(); try { return normalizeStore(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))); } catch (e) { return defaultStore(); } }
function writeStore(store) { ensureDir(); store.updatedAt = now(); var tmp = STORE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store, null, 2)); fs.renameSync(tmp, STORE_FILE); }
function storeRevision() { try { var stat = fs.statSync(STORE_FILE); return String(stat.size) + '-' + String(stat.mtime.getTime()); } catch (e) { return 'missing'; } }
function makeId(prefix) { var rnd = 'x'; try { rnd = crypto.randomBytes(3).toString('hex'); } catch (e) { rnd = String(Math.random()).slice(2, 8); } return (prefix || 'p') + Date.now().toString(36) + rnd; }
function safeText(value, maxLen) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 4096); }
function decodeUrlPart(s) { try { return decodeURIComponent(String(s || '').replace(/\+/g, '%20')); } catch (e) { return String(s || ''); } }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function isHttpUrl(s) { return /^https?:\/\//i.test(String(s || '').trim()); }

var SUBSCRIPTION_CLIENT_PROFILES = [
  { name: 'Happ Android TV', ua: 'Happ/3.1.0/android', client: '', appVersion: '', os: 'Android', ver: '13', model: 'Android TV', locale: 'ru_RU', deviceHeaders: true },
  { name: 'Happ Desktop', ua: 'Happ/3.1.0/windows', client: '', appVersion: '', os: 'Windows', ver: '10.0', model: 'Windows amd64', locale: 'ru_RU', deviceHeaders: true },
  { name: 'v2RayTun Android', ua: 'v2RayTun/5.23.73', client: 'v2RayTun', appVersion: '5.23.73', os: 'Android', ver: '13', model: 'Android TV', locale: 'ru_RU' },
  { name: 'Clash Meta', ua: 'ClashMetaForAndroid/2.11.16.Meta', client: '', appVersion: '', os: '', ver: '', model: '', locale: '' },
  { name: 'Mihomo', ua: 'mihomo/1.19.0', client: '', appVersion: '', os: '', ver: '', model: '', locale: '' },
  { name: 'Browser', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36', client: '', appVersion: '', os: '', ver: '', model: '', locale: '' },
  { name: 'sing-box webOS', ua: 'singbox/1.12.0', client: '', appVersion: '', os: '', ver: '', model: '', locale: 'EN', singboxHeaders: true }
];
var HAPP_TV_PROFILE_INDEX = 0;
var HAPP_DESKTOP_PROFILE_INDEX = 1;
var V2RAY_PROFILE_INDEX = 2;
var CLASH_PROFILE_INDEX = 3;
var MIHOMO_PROFILE_INDEX = 4;
var BROWSER_PROFILE_INDEX = 5;
var SINGBOX_PROFILE_INDEX = SUBSCRIPTION_CLIENT_PROFILES.length - 1;
var STABLE_HWID = '';
var STABLE_HAPP_HWID = '';
var STABLE_SINGBOX_HWID = '';
var SUBSCRIPTION_DEVICE_MODEL = '';
var SUBSCRIPTION_KERNEL_VERSION = '';
function stableHwid() {
  if (STABLE_HWID) return STABLE_HWID;
  var seed = '';
  try { seed += os.hostname() || ''; } catch (e) {}
  try { seed += '|' + fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e2) {}
  try { seed += '|' + fs.readFileSync('/etc/hostname', 'utf8').trim(); } catch (e3) {}
  if (!seed) seed = 'lg-webos-tv';
  try { STABLE_HWID = crypto.createHash('sha256').update(seed).digest('hex'); } catch (e4) { STABLE_HWID = seed; }
  return STABLE_HWID;
}
function stableHappHwid() {
  if (STABLE_HAPP_HWID) return STABLE_HAPP_HWID;
  var h = stableHwid().replace(/[^A-Za-z0-9]/g, '0');
  while (h.length < 32) h += '0';
  STABLE_HAPP_HWID = h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32);
  return STABLE_HAPP_HWID;
}
function subscriptionDeviceModel() {
  if (SUBSCRIPTION_DEVICE_MODEL) return SUBSCRIPTION_DEVICE_MODEL;
  var paths = ['/tmp/sysinfo/model', '/proc/device-tree/model', '/sys/firmware/devicetree/base/model'], i, value = '';
  for (i = 0; i < paths.length && !value; i++) {
    try { value = safeText(fs.readFileSync(paths[i], 'utf8'), 120); } catch (e) {}
  }
  SUBSCRIPTION_DEVICE_MODEL = value || 'LG webOS TV';
  return SUBSCRIPTION_DEVICE_MODEL;
}
function subscriptionKernelVersion() {
  if (SUBSCRIPTION_KERNEL_VERSION) return SUBSCRIPTION_KERNEL_VERSION;
  try { SUBSCRIPTION_KERNEL_VERSION = safeText(os.release(), 80); } catch (e) {}
  if (!SUBSCRIPTION_KERNEL_VERSION) SUBSCRIPTION_KERNEL_VERSION = 'Linux';
  return SUBSCRIPTION_KERNEL_VERSION;
}
function stableSingboxHwid() {
  if (STABLE_SINGBOX_HWID) return STABLE_SINGBOX_HWID;
  var ifaces = {}, names = [], macs = [], i, j, rows, row, raw;
  try { ifaces = os.networkInterfaces() || {}; names = Object.keys(ifaces).sort(); } catch (e) {}
  for (i = 0; i < names.length; i++) {
    rows = ifaces[names[i]] || [];
    for (j = 0; j < rows.length; j++) {
      row = rows[j] || {};
      if (!row.internal && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(row.mac || '')) && row.mac !== '00:00:00:00:00:00') macs.push(String(row.mac).toLowerCase());
    }
  }
  macs.sort();
  try { raw = crypto.createHash('md5').update((macs[0] || stableHwid()) + '-' + subscriptionDeviceModel()).digest('hex').slice(0, 16); } catch (e2) { raw = stableHwid().replace(/[^A-Fa-f0-9]/g, '').slice(0, 16); }
  while (raw.length < 16) raw += '0';
  STABLE_SINGBOX_HWID = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);
  return STABLE_SINGBOX_HWID;
}
function subscriptionProfile(profileIndex) {
  var idx = Math.max(0, Math.min(SUBSCRIPTION_CLIENT_PROFILES.length - 1, profileIndex || 0));
  return SUBSCRIPTION_CLIENT_PROFILES[idx] || SUBSCRIPTION_CLIENT_PROFILES[0];
}
function subscriptionProfileLabel(profileIndex) {
  var p = subscriptionProfile(profileIndex);
  return p.name + ' / ' + p.ua;
}
function subscriptionRequestHeaders(profileIndex) {
  var p = subscriptionProfile(profileIndex);
  var h = {
    'User-Agent': p.ua,
    'Accept': '*/*',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
  };
  if (p.client) h['x-client'] = p.client;
  if (p.appVersion) h['x-app-version'] = p.appVersion;
  if (p.locale) h['x-device-locale'] = p.locale;
  if (p.singboxHeaders) h['x-hwid'] = stableSingboxHwid();
  else if (p.client) h['x-hwid'] = stableHwid();
  else if (p.deviceHeaders) h['x-hwid'] = stableHappHwid();
  if (p.singboxHeaders) {
    h['x-device-os'] = 'webOS Linux';
    h['x-ver-os'] = subscriptionKernelVersion();
    h['x-device-model'] = subscriptionDeviceModel();
  } else {
    if (p.os) h['x-device-os'] = p.os;
    if (p.ver) h['x-ver-os'] = p.ver;
    if (p.model) h['x-device-model'] = p.model;
  }
  return h;
}
function appendQueryParam(u, key, value) {
  var sep = String(u || '').indexOf('?') >= 0 ? '&' : '?';
  return String(u || '') + sep + encodeURIComponent(key) + '=' + encodeURIComponent(value);
}
function addUniqueAttempt(out, seen, url, profileIndex, primary) {
  var key = String(profileIndex) + '|' + String(url || '');
  if (!url || seen[key]) return;
  seen[key] = true;
  out.push({ url: url, profileIndex: profileIndex, primary: !!primary });
}
function buildSubscriptionAttempts(subUrl) {
  var out = [], seen = {}, parsed, root = '', token = '', path = '', i;
  function add(url, profileIndex, primary) { addUniqueAttempt(out, seen, url, profileIndex, primary); }
  add(subUrl, HAPP_TV_PROFILE_INDEX, true);
  add(subUrl, SINGBOX_PROFILE_INDEX, true);
  add(subUrl, HAPP_DESKTOP_PROFILE_INDEX);
  try {
    parsed = urlmod.parse(subUrl);
    root = parsed.protocol + '//' + parsed.host;
    path = String(parsed.pathname || '').replace(/^\/+|\/+$/g, '');
    token = path.split('/').pop();
  } catch (e) { token = ''; }
  if (root && token) {
    add(root + '/dl/happ-link/' + encodeURIComponent(token), HAPP_TV_PROFILE_INDEX);
    add(root + '/dl/happ-link/' + encodeURIComponent(token), HAPP_DESKTOP_PROFILE_INDEX);
    add(root + '/dl/v2raytun-link/' + encodeURIComponent(token), V2RAY_PROFILE_INDEX);
    add(root + '/dl/v2raytun-link/' + encodeURIComponent(token), HAPP_TV_PROFILE_INDEX);
    add(root + '/dl/clash-meta/' + encodeURIComponent(token), CLASH_PROFILE_INDEX);
    add(root + '/dl/clash-link/' + encodeURIComponent(token), CLASH_PROFILE_INDEX);
  }
  add(appendQueryParam(subUrl, 'app', 'happ'), HAPP_TV_PROFILE_INDEX);
  add(appendQueryParam(subUrl, 'client', 'happ'), HAPP_TV_PROFILE_INDEX);
  add(appendQueryParam(subUrl, 'format', 'vless'), SINGBOX_PROFILE_INDEX);
  add(subUrl, V2RAY_PROFILE_INDEX);
  add(subUrl, CLASH_PROFILE_INDEX);
  add(subUrl, MIHOMO_PROFILE_INDEX);
  add(subUrl, BROWSER_PROFILE_INDEX);
  return out;
}
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
function truthy(v) { v = String(v == null ? '' : v).toLowerCase(); return v === 'true' || v === '1' || v === 'yes' || v === 'on'; }
function bufferFrom(data, enc) { return Buffer.from ? Buffer.from(data, enc) : new Buffer(data, enc); }
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
  /* пустое имя локализуется при отображении (ТВ и веб) */
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
  if (!/^vless:\/\//i.test(link)) throw locErr('err.vlessOnly');
  var noScheme = link.replace(/^vless:\/\//i, '');
  var hashSplit = noScheme.split('#');
  var name = hashSplit[1] ? cleanServerName(hashSplit.slice(1).join('#')) : '';
  var main = hashSplit[0];
  var qIdx = main.indexOf('?');
  var authority = qIdx >= 0 ? main.slice(0, qIdx) : main;
  var query = qIdx >= 0 ? main.slice(qIdx + 1) : '';
  var at = authority.lastIndexOf('@');
  var uuid, hp, parsed;
  if (at < 0) throw locErr('err.noUuidHost');
  uuid = authority.slice(0, at);
  hp = authority.slice(at + 1);
  parsed = parseHostPort(hp, 443);
  if (!uuid || !parsed.host || !parsed.port) throw locErr('err.badVless');
  var params = parseQuery(query);
  name = bestName(name, params.name, params.remarks, params.remark, params.ps, params.title);
  return { protocol: 'vless', uuid: uuid, host: parsed.host, port: parsed.port, params: params, name: name };
}
function parseHysteria2(link) {
  link = safeText(link, 16000);
  if (!/^(hy2|hysteria2|hysteria):\/\//i.test(link)) throw locErr('err.hysteriaOnly');
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
  if (!parsed.host || !parsed.port || !password) throw locErr('err.badHysteria');
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
  if (!/^trojan:\/\//i.test(String(link || ''))) throw locErr('err.protoOnly');
  var parts = splitLinkParts(link, /^trojan:\/\//i);
  var at = parts.authority.lastIndexOf('@');
  if (at < 0) throw locErr('err.noUuidHost');
  var password = decodeUrlPart(parts.authority.slice(0, at));
  var hp = parseHostPort(parts.authority.slice(at + 1), 443);
  var params = parseQuery(parts.query);
  if (!password || !hp.host || !hp.port) throw locErr('err.badVless');
  var name = bestName(parts.name, params.name, params.remarks, params.remark, params.ps, hp.host);
  return { protocol: 'trojan', password: password, host: hp.host, port: hp.port, params: params, name: name };
}
function parseVmess(link) {
  if (!/^vmess:\/\//i.test(String(link || ''))) throw locErr('err.protoOnly');
  var parts = splitLinkParts(link, /^vmess:\/\//i);
  var o = null;
  try { o = JSON.parse(b64DecodeLoose(parts.authority)); } catch (e) { o = null; }
  if (o && (o.add || o.host) && o.id) {
    var net = String(o.net || 'tcp').toLowerCase();
    var isTls = String(o.tls || '').toLowerCase() === 'tls' || o.tls === true;
    var params = { security: isTls ? 'tls' : 'none', type: net, sni: String(o.sni || (isTls ? (o.host || '') : '')), path: String(o.path || ''), host: String(o.host || ''), alpn: String(o.alpn || ''), fp: String(o.fp || '') };
    if (net === 'grpc') params.serviceName = String(o.path || '');
    var port = parseInt(o.port, 10);
    if (!port || !(o.add || o.host)) throw locErr('err.badVless');
    return { protocol: 'vmess', uuid: String(o.id), host: String(o.add || o.host), port: port, aid: parseInt(o.aid, 10) || 0, scy: String(o.scy || o.security || 'auto'), params: params, name: bestName(String(o.ps || ''), parts.name, String(o.add || o.host)) };
  }
  var at = parts.authority.lastIndexOf('@');
  if (at < 0) throw locErr('err.noUuidHost');
  var uuid = decodeUrlPart(parts.authority.slice(0, at));
  var hp = parseHostPort(parts.authority.slice(at + 1), 443);
  var q = parseQuery(parts.query);
  if (!uuid || !hp.host || !hp.port) throw locErr('err.badVless');
  return { protocol: 'vmess', uuid: uuid, host: hp.host, port: hp.port, aid: parseInt(q.aid, 10) || 0, scy: String(q.scy || q.encryption || 'auto'), params: q, name: bestName(parts.name, q.name, q.remarks, hp.host) };
}
function parseSs(link) {
  if (!/^ss:\/\//i.test(String(link || ''))) throw locErr('err.protoOnly');
  var parts = splitLinkParts(link, /^ss:\/\//i);
  var authority = parts.authority.replace(/\/$/, '');
  var method = '', password = '', hp = null;
  var at = authority.lastIndexOf('@');
  if (at >= 0) {
    var ui = b64DecodeLoose(authority.slice(0, at));
    if (!ui || ui.indexOf(':') < 0) ui = decodeUrlPart(authority.slice(0, at));
    var c = ui.indexOf(':');
    if (c < 0) throw locErr('err.badVless');
    method = ui.slice(0, c); password = ui.slice(c + 1);
    hp = parseHostPort(authority.slice(at + 1), 8388);
  } else {
    var dec = b64DecodeLoose(authority);
    var at2 = dec.lastIndexOf('@');
    if (at2 < 0) throw locErr('err.badVless');
    var mp = dec.slice(0, at2);
    var c2 = mp.indexOf(':');
    if (c2 < 0) throw locErr('err.badVless');
    method = mp.slice(0, c2); password = mp.slice(c2 + 1);
    hp = parseHostPort(dec.slice(at2 + 1), 8388);
  }
  var params = parseQuery(parts.query);
  if (!method || !password || !hp.host || !hp.port) throw locErr('err.badVless');
  var name = bestName(parts.name, params.name, params.remarks, hp.host);
  return { protocol: 'ss', method: method.toLowerCase(), password: password, host: hp.host, port: hp.port, params: params, name: name };
}
function parseSocks(link) {
  if (!/^socks5?:\/\//i.test(String(link || ''))) throw locErr('err.protoOnly');
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
  if (!hp.host || !hp.port) throw locErr('err.badVless');
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
  throw locErr('err.protoOnly');
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
function validateLink(link) { if (!link) throw locErr('err.emptyLink'); if (!PROTO_RE.test(link)) throw locErr('err.acceptOnly'); if (link.length > 16000) throw locErr('err.linkTooLong'); parseProxyLink(link); }


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
    p = store.profiles[i]; if (!p || !p.link) continue;
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

/* ---------- country detection ---------- */
var ISO_CODES = {ae:1,al:1,am:1,ar:1,at:1,au:1,az:1,ba:1,be:1,bg:1,br:1,by:1,ca:1,ch:1,cl:1,cn:1,cy:1,cz:1,de:1,dk:1,ee:1,es:1,fi:1,fr:1,ge:1,gr:1,hk:1,hr:1,hu:1,id:1,ie:1,il:1,'in':1,is:1,it:1,jp:1,kg:1,kr:1,kz:1,lt:1,lu:1,lv:1,md:1,me:1,mk:1,mt:1,mx:1,my:1,nl:1,no:1,nz:1,ph:1,pl:1,pt:1,ro:1,rs:1,ru:1,se:1,sg:1,si:1,sk:1,th:1,tr:1,tw:1,ua:1,us:1,uz:1,vn:1};
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
    if (ISO_CODES[code]) return code;
  }
  var low = s.toLowerCase(), i;
  for (i = 0; i < COUNTRY_WORDS.length; i++) if (low.indexOf(COUNTRY_WORDS[i][0]) >= 0) return COUNTRY_WORDS[i][1];
  var re = /(^|[^A-Za-z0-9])([A-Z]{2})(?![A-Za-z])/g, mm, c;
  while ((mm = re.exec(s))) {
    c = mm[2].toLowerCase();
    if (c === 'gb') continue; /* GB почти всегда гигабайты, а не Британия */
    if (ISO_CODES[c]) return c;
  }
  return '';
}
function detectCountryForProfile(p) {
  var raw = '';
  try { raw = parseProxyLink(p.link).name || ''; } catch (e) {}
  return detectCountry(String(p && p.name || '') + ' ' + raw);
}
function flagEmoji(code) {
  code = String(code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) code = 'un';
  function sur(cp) { cp -= 0x10000; return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
  return sur(0x1F1E6 + code.charCodeAt(0) - 97) + sur(0x1F1E6 + code.charCodeAt(1) - 97);
}

function extractProxyLinks(content) {
  var decoded = safeBase64Decode(htmlEntityDecode(content));
  var decoded2 = safeBase64Decode(percentDecodeLoose(decoded));
  if (decoded2 && decoded2 !== decoded) decoded = decoded + '\n' + decoded2;
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

function isTlsCertError(err) {
  var code = err && (err.code || err.errno || '');
  var msg = String(err && err.message || '').toLowerCase();
  return code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'CERT_HAS_EXPIRED' || code === 'ERR_TLS_CERT_ALTNAME_INVALID' || msg.indexOf('certificate') >= 0 || msg.indexOf('issuer') >= 0;
}

function requestUrl(url, cb, redirects, insecureTls, uaIndex, deadline) {
  redirects = redirects || 0;
  insecureTls = !!insecureTls;
  if (deadline && now() >= deadline) return cb(locErr('err.timeout'));
  if (redirects > 5) return cb(locErr('err.tooManyRedirects'));
  var parsed = urlmod.parse(url);
  var mod = parsed.protocol === 'http:' ? http : https;
  var opts = { protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port, path: parsed.path, headers: subscriptionRequestHeaders(uaIndex || 0), agent: false };
  if (parsed.protocol === 'https:' && insecureTls) opts.rejectUnauthorized = false;
  var finished = false, deadlineTimer = null, req;
  function clearDeadlineTimer() { if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; } }
  function done(err, body, headers) {
    if (finished) return;
    finished = true;
    clearDeadlineTimer();
    cb(err || null, body, headers);
  }
  req = mod.get(opts, function (res) {
    var loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
      res.resume();
      if (!/^https?:\/\//i.test(loc)) loc = urlmod.resolve(url, loc);
      if (finished) return;
      finished = true;
      clearDeadlineTimer();
      return requestUrl(loc, cb, redirects + 1, insecureTls, uaIndex || 0, deadline);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return done(new Error('HTTP ' + res.statusCode)); }
    var bufs = [], len = 0;
    res.on('data', function (chunk) {
      if (finished) return;
      len += chunk.length;
      if (len > MAX_DOWNLOAD) {
        bufs = [];
        done(locErr('err.tooBig'));
        if (res.destroy) res.destroy(); else req.abort();
        return;
      }
      bufs.push(chunk);
    });
    res.on('end', function () {
      if (finished) return;
      var body = Buffer.concat(bufs).toString('utf8');
      bufs = [];
      done(null, body, res.headers || {});
    });
    res.on('aborted', function () { done(new Error('Subscription download aborted')); });
    res.on('error', function (e) { done(e); });
  });
  if (deadline) deadlineTimer = setTimeout(function () { done(locErr('err.timeout')); if (req.destroy) req.destroy(); else req.abort(); }, Math.max(1, deadline - now()));
  var requestTimeout = deadline ? Math.min(20000, Math.max(250, deadline - now())) : 20000;
  req.setTimeout(requestTimeout, function () { done(locErr('err.timeout')); if (req.destroy) req.destroy(); else req.abort(); });
  req.on('error', function (e) {
    if (finished) return;
    if (!insecureTls && parsed.protocol === 'https:' && isTlsCertError(e)) {
      finished = true;
      clearDeadlineTimer();
      return requestUrl(url, function (err2, body2, headers2) { if (headers2) headers2['alcyone-tls-warning'] = 'certificate verification disabled after ' + (e.code || e.message); cb(err2, body2, headers2); }, redirects, true, uaIndex || 0, deadline);
    }
    done(e);
  });
}

function fetchExpandedContent(url, cb, uaIndex, deadline) {
  requestUrl(url, function (err, body, headers) {
    if (err) return cb(err);
    var decoded = safeBase64Decode(body);
    var lines = decoded.split(/\r?\n/), jobs = [], active = 0, next = 0, done = false, fatalErr = null, i, line;
    var out = lines.slice(0);
    var totalBytes = Buffer.byteLength(out.join('\n'), 'utf8');
    function fail(e) { if (!fatalErr) fatalErr = e; next = jobs.length; out = []; }
    function finish() {
      if (done || active !== 0 || next < jobs.length) return;
      done = true;
      if (fatalErr) return cb(fatalErr);
      cb(null, out.join('\n'), headers || {});
    }
    function pump() {
      while (!done && !fatalErr && active < 4 && next < jobs.length) {
        (function (job) {
          active++;
          requestUrl(job.remote, function (e2, b2) {
            active--;
            if (done) return;
            if (e2 || !b2) fail(locErr('err.nestedFailed', safeText(e2 && e2.message || 'empty response', 120)));
            else if (!fatalErr) {
              var expanded = safeBase64Decode(b2);
              var expandedBytes = Buffer.byteLength(expanded, 'utf8');
              totalBytes = totalBytes - Buffer.byteLength(out[job.idx] || '', 'utf8') + expandedBytes;
              if (totalBytes > MAX_EXPANDED_DOWNLOAD) fail(locErr('err.expandedTooBig'));
              else out[job.idx] = expanded;
            }
            pump();
          }, 0, false, uaIndex || 0, deadline);
        })(jobs[next++]);
      }
      finish();
    }
    var meaningfulLines = 0;
    for (i = 0; i < lines.length; i++) {
      line = safeText(lines[i], 2048);
      if (!line || line.charAt(0) === '#' || line.indexOf('//') === 0) continue;
      meaningfulLines++;
      if (/^https?:\/\/[^\s]+$/i.test(line)) jobs.push({ idx: i, remote: line });
    }
    /* Only a pure URL list is a nested subscription. Mixed URLs are usually help/portal links. */
    if (!jobs.length || jobs.length !== meaningfulLines) return cb(null, decoded, headers || {});
    if (jobs.length > MAX_REMOTE_URLS) return cb(locErr('err.tooManyNested'));
    pump();
  }, 0, false, uaIndex || 0, deadline);
}

function fetchSubscriptionCandidate(attempt, cb, deadline) {
  fetchExpandedContent(attempt.url, function (err, content, remoteHeaders) {
    if (err) return cb(err);
    var contentHeaders = parseContentHeaders(content);
    var headers = {}, k, imported;
    for (k in remoteHeaders || {}) headers[String(k).toLowerCase()] = remoteHeaders[k];
    for (k in contentHeaders) if (!headers[k]) headers[k] = contentHeaders[k];
    headers['alcyone-user-agent'] = subscriptionProfileLabel(attempt.profileIndex);
    headers['alcyone-fetch-url'] = attempt.url;
    try { imported = extractSubscriptionProfiles(content); } catch (e) { return cb(e); }
    if (!imported.length) return cb(looksLikeUnsupportedSubscriptionPage(content) ? locErr('err.rejectedMode', headers['alcyone-user-agent']) : locErr('err.noServersInSub'));
    cb(null, { imported: imported, headers: headers, attempt: attempt });
  }, attempt.profileIndex, deadline);
}

function importSubscription(subUrl, displayName, cb) {
  subUrl = safeText(subUrl, 2048);
  displayName = safeText(displayName, 80);
  if (!isHttpUrl(subUrl)) return cb(locErr('err.needHttp'));
  var attempts = buildSubscriptionAttempts(subUrl), primary = [], fallback = [], i;
  var deadline = now() + IMPORT_TIMEOUT;
  for (i = 0; i < attempts.length; i++) {
    attempts[i].order = i;
    (attempts[i].primary ? primary : fallback).push(attempts[i]);
  }

  function saveCandidate(candidate) {
    var imported = candidate.imported, headers = candidate.headers;
    var store = readStore();
    var i, sub = null;
    for (i = 0; i < store.subscriptions.length; i++) if (store.subscriptions[i].url === subUrl) sub = store.subscriptions[i];
    if (!sub) { sub = { id: makeId('s'), url: subUrl, name: '', createdAt: now() }; store.subscriptions.push(sub); }
    sub.name = displayName || profileTitleFromHeaders(headers, sub.name || '');
    sub.lastUpdate = now();
    sub.count = imported.length;
    sub.error = '';
    sub.subscriptionUserinfo = headers['subscription-userinfo'] || '';
    sub.tlsWarning = headers['alcyone-tls-warning'] || '';
    sub.userAgent = headers['alcyone-user-agent'] || '';
    sub.fetchUrl = headers['alcyone-fetch-url'] || subUrl;
    var keep = [], previousByKey = {};
    for (i = 0; i < store.profiles.length; i++) {
      if (store.profiles[i].subscriptionId === sub.id) previousByKey[profileKey(store.profiles[i])] = store.profiles[i];
      else keep.push(store.profiles[i]);
    }
    store.profiles = keep;
    var importedKeys = {}, importedCount = 0;
    for (i = 0; i < imported.length; i++) {
      var descriptor = imported[i];
      var parsed = parseProxyLink(descriptor.link);
      var key = profileKey(descriptor);
      if (importedKeys[key]) continue;
      importedKeys[key] = true; importedCount++;
      var previous2 = previousByKey[key] || null;
      var rawName2 = cleanServerName(descriptor.name) || importedProfileName(parsed, previous2, sub.name, importedCount);
      var country2 = detectCountry(rawName2 + ' ' + (parsed.name || ''));
      var displayName2 = cleanServerLabel(rawName2);
      var storedProfile = { id: previous2 && previous2.id || makeId('p'), protocol: descriptor.protocol || parsed.protocol || 'vless', name: displayName2, country: country2 || previous2 && previous2.country || undefined, link: descriptor.link, sourceType: 'subscription', subscriptionId: sub.id, subscriptionName: sub.name, addedAt: previous2 && previous2.addedAt || now(), updatedAt: now() };
      if (descriptor.sourceKey) storedProfile.sourceKey = descriptor.sourceKey;
      if (descriptor.fullConfig) storedProfile.fullConfig = descriptor.fullConfig;
      store.profiles.push(storedProfile);
    }
    sub.count = importedCount;
    dedupeProfilesInStore(store);
    if (!store.activeId || !store.profiles.some(function (p) { return p.id === store.activeId; })) store.activeId = store.profiles[0] && store.profiles[0].id || null;
    writeStore(store);
    cb(null, { subscription: sub, count: importedCount, store: store, clientProfile: headers['alcyone-user-agent'] || '' });
  }

  function tryFallback(index, lastErr) {
    if (now() >= deadline) return cb(lastErr || locErr('err.timeout'));
    if (index >= fallback.length) return cb(lastErr || locErr('err.noServersInSub'));
    fetchSubscriptionCandidate(fallback[index], function (err, candidate) {
      if (err) return tryFallback(index + 1, err);
      saveCandidate(candidate);
    }, deadline);
  }

  var best = null, merged = [], mergedKeys = {}, mergedLabels = [];
  function mergePrimary(candidate) {
    var j, descriptor, key, label;
    if (!candidate) return;
    if (!best || candidate.imported.length > best.imported.length || (candidate.imported.length === best.imported.length && candidate.attempt.order < best.attempt.order)) best = candidate;
    label = candidate.headers && candidate.headers['alcyone-user-agent'] || '';
    if (label && mergedLabels.indexOf(label) < 0) mergedLabels.push(label);
    for (j = 0; j < candidate.imported.length; j++) {
      descriptor = candidate.imported[j];
      key = profileKey(descriptor);
      if (mergedKeys[key]) continue;
      mergedKeys[key] = true;
      merged.push(descriptor);
    }
  }
  function comparePrimary(index, lastErr) {
    if (index >= primary.length || now() >= deadline) {
      if (best) {
        best.imported = merged;
        best.headers['alcyone-user-agent'] = mergedLabels.join(' + ');
        return saveCandidate(best);
      }
      return tryFallback(0, lastErr);
    }
    fetchSubscriptionCandidate(primary[index], function (err, candidate) {
      if (!err && candidate) mergePrimary(candidate);
      comparePrimary(index + 1, err || lastErr);
    }, deadline);
  }
  comparePrimary(0, null);
}

function updateAllSubscriptions(cb) {
  var store = readStore();
  var subs = store.subscriptions.slice(0);
  var idx = 0, results = [];
  function next() {
    if (idx >= subs.length) return cb(null, results, readStore());
    var s = subs[idx++];
    importSubscription(s.url, s.name, function (err, result) {
      results.push({ id: s.id, name: s.name, url: s.url, ok: !err, error: err ? err.message : '', count: result && result.count || 0 });
      next();
    });
  }
  next();
}

function localIps() {
  var ifaces = os.networkInterfaces();
  var out = [];
  Object.keys(ifaces).forEach(function (name) { (ifaces[name] || []).forEach(function (addr) { if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address); }); });
  return out;
}

function profileRows(store, lang) {
  var rows = [], i, p, active, cc, proto;
  for (i = 0; i < store.profiles.length; i++) {
    p = store.profiles[i]; active = p.id === store.activeId;
    cc = p.country || detectCountryForProfile(p) || 'un';
    proto = PROTO_BADGE[String(p.protocol || 'vless').toLowerCase()] || String(p.protocol || 'vless').toUpperCase();
    rows.push('<article class="profile ' + (active ? 'active' : '') + '"><div class="profileMain"><span class="flag">' + flagEmoji(cc) + '</span><div><b>' + esc(profileDisplayName(p)) + '</b><small>' + esc(summary(p.link)) + '</small><em>' + esc(p.sourceType === 'subscription' ? (p.subscriptionName || T(lang, 'row.subscription')) : T(lang, 'row.manual')) + ' · <span class="proto">' + proto + '</span></em></div></div><div class="buttons"><button class="' + (active ? 'activeBtn' : '') + '" onclick="setActive(\'' + esc(p.id) + '\')">' + (active ? T(lang, 'row.active') : T(lang, 'row.select')) + '</button><button class="danger" onclick="delProfile(\'' + esc(p.id) + '\')">' + T(lang, 'row.delete') + '</button></div></article>');
  }
  return rows.join('') || '<div class="empty">' + T(lang, 'empty.profiles') + '</div>';
}

function subscriptionRows(store, lang) {
  var rows = [], i, s, when;
  for (i = 0; i < store.subscriptions.length; i++) {
    s = store.subscriptions[i]; when = s.lastUpdate ? new Date(s.lastUpdate).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB') : T(lang, 'sub.neverUpdated');
    rows.push('<article class="sub"><div><b>' + esc(s.name || T(lang, 'sub.default')) + '</b><small>' + esc(s.url) + '</small><em>' + T(lang, 'sub.servers') + esc(s.count || 0) + ' · ' + esc(when) + '</em></div><div class="buttons"><button onclick="updateOneSub(\'' + esc(s.id) + '\')">' + T(lang, 'row.update') + '</button><button class="danger" onclick="delSub(\'' + esc(s.id) + '\')">' + T(lang, 'row.delete') + '</button></div></article>');
  }
  return rows.join('') || '<div class="empty">' + T(lang, 'empty.subs') + '</div>';
}

function html(lang, langSetting) {
  var store = readStore();
  var ips = localIps();
  var ipText = ips.length ? ips.map(function (ip) { return 'http://' + ip + ':' + PORT; }).join('   ') : T(lang, 'hero.noIp');
  function langBtn(v, label) {
    var active = (langSetting || 'auto') === v;
    return '<button class="langBtn' + (active ? ' activeBtn' : '') + '" onclick="setLangUi(\'' + v + '\')">' + label + '</button>';
  }
  return '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' + esc(APP_TITLE) + '</title><link rel="icon" type="image/png" href="/favicon.png"><style>' +
    ':root{--bg:#0a0812;--panel:#141021;--panel2:#1c1433;--line:#2a2144;--lime:#b18cff;--green:#8b5cf6;--text:#e9e4f5;--muted:#9a92b3;--danger:#ff8fb8}' +
    '*{box-sizing:border-box}body{margin:0;background:#0a0812;color:var(--text);font-family:Montserrat,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;padding:18px;min-height:100vh}' +
    '.wrap{max-width:860px;margin:0 auto}' +
    '.hero,.card,.profile,.sub{background:var(--panel);border:1px solid var(--line);border-radius:16px}' +
    '.hero{padding:22px 24px;margin-bottom:16px}' +
    '.heroTop{display:flex;align-items:center;gap:14px;margin-bottom:8px}' +
    '.webLogo{width:54px;height:54px;border-radius:12px;flex:0 0 54px}' +
    '.tag{color:var(--green);text-transform:uppercase;font-size:12px;letter-spacing:.18em;font-weight:700}' +
    'h1{font-size:38px;margin:6px 0 8px;color:var(--lime);font-weight:700;letter-spacing:.04em}h1 small{font-size:14px;color:var(--muted);font-weight:600;letter-spacing:0;margin-left:8px}' +
    'h2{font-size:20px;margin:0 0 6px;color:#f2eefc;font-weight:600}' +
    'p,small,em{color:var(--muted);line-height:1.45;font-style:normal}' +
    '.card{padding:18px 20px;margin-bottom:16px}' +
    'label{display:block;color:var(--muted);font-size:14px;margin:12px 0 6px}' +
    'input,textarea{width:100%;border:1px solid var(--line);border-radius:12px;background:#0e0a1b;color:var(--text);padding:13px 14px;font-size:16px;outline:none;font-family:inherit}' +
    'input:focus,textarea:focus{border-color:var(--green)}' +
    'textarea{min-height:120px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}' +
    'button{border:1px solid var(--line);border-radius:11px;background:var(--panel2);color:#cfc5e8;padding:12px 15px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer}' +
    'button:hover{border-color:var(--green)}' +
    'button.primary{border:1px solid #8b5cf6;background:#b18cff;color:#170e2e;width:100%;margin-top:12px;font-weight:700}' +
    'button.activeBtn{background:#b18cff;border-color:#8b5cf6;color:#170e2e}' +
    '.danger{color:#ffd0e2;border-color:#5c2c4d;background:#241322}' +
    '.profile,.sub{padding:14px;margin-bottom:10px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}' +
    '.profile.active{border-color:#a78bfa;box-shadow:inset 0 0 0 1px #a78bfa;background:#1a1236}' +
    '.profileMain{display:flex;align-items:center;gap:12px;min-width:0}' +
    '.flag{font-size:26px;line-height:1;flex:0 0 auto}' +
    '.proto{color:var(--green);font-weight:700;font-size:11px;letter-spacing:.04em}' +
    '.profile b,.sub b{display:block;margin-bottom:4px;color:#efeaf8;font-weight:600}' +
    '.profile.active b{color:#e4d5ff}' +
    '.profile small,.sub small{display:block;word-break:break-all;font-size:12px}' +
    '.profile em,.sub em{display:block;font-size:12px;margin-top:4px}' +
    '.buttons{display:grid;gap:8px}' +
    '.empty{border:1px dashed var(--line);border-radius:14px;padding:16px;color:var(--muted)}' +
    '.msg{white-space:pre-wrap;color:#d9cdf0;margin-top:12px;font-size:14px}' +
    '.hint{display:block;margin-top:9px}.primary:disabled{opacity:.6;cursor:wait}' +
    '.ips{font-size:13px;color:var(--lime);font-weight:600;word-break:break-all;margin-top:8px}' +
    '.langRow{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}' +
    '.langBtn{padding:8px 16px;font-size:13px;border-radius:999px}' +
    '@media(max-width:720px){.profile,.sub{grid-template-columns:1fr}.buttons{grid-template-columns:1fr 1fr}h1{font-size:30px}body{padding:12px}.webLogo{width:46px;height:46px;flex-basis:46px}}' +
    '</style></head><body><div class="wrap"><section class="hero"><div class="heroTop"><img class="webLogo" src="/logo.png" alt=""><div><div class="tag">LG webOS VPN · ' + esc(EDITION_NAME) + '</div><h1>' + esc(APP_TITLE) + ' <small>v' + esc(APP_VERSION) + '</small></h1></div></div><p>' + T(lang, 'hero.text') + '</p><div class="ips">' + T(lang, 'hero.ips') + esc(ipText) + '</div><div class="langRow">' + langBtn('auto', T(lang, 'lang.auto')) + langBtn('ru', 'Русский') + langBtn('en', 'English') + '</div></section>' +
    '<section class="card"><h2>' + T(lang, 'form.importTitle') + '</h2><label>' + T(lang, 'form.importName') + '</label><input id="importName" maxlength="80" placeholder="' + T(lang, 'form.importNamePh') + '"><label>' + T(lang, 'form.importValue') + '</label><textarea id="importValue" maxlength="16000" placeholder="' + T(lang, 'form.importValuePh') + '"></textarea><small class="hint">' + T(lang, 'form.importHelp') + '</small><button id="importButton" class="primary" onclick="importValue()">' + T(lang, 'form.importButton') + '</button><button onclick="updateAll()" style="width:100%;margin-top:10px">' + T(lang, 'form.updateAll') + '</button><div id="importMsg" class="msg"></div></section>' +
    '<section class="card"><h2>' + T(lang, 'sec.subs') + ' (' + store.subscriptions.length + ')</h2>' + subscriptionRows(store, lang) + '</section>' +
    '<section class="card"><h2>' + T(lang, 'sec.servers') + ' (' + store.profiles.length + ')</h2>' + profileRows(store, lang) + '</section></div>' +
    '<script>var L=' + JSON.stringify({
      importing: T(lang, 'js.importing'), importedProfile: T(lang, 'js.importedProfile'), error: T(lang, 'js.error'), notLoaded: T(lang, 'js.notLoaded'), loaded1: T(lang, 'js.loaded1'), loaded2: T(lang, 'js.loaded2'),
      updatingAll: T(lang, 'js.updatingAll'), notUpdated: T(lang, 'js.notUpdated'), updated: T(lang, 'js.updated'),
      confirmDelProfile: T(lang, 'js.confirmDelProfile'), confirmDelSub: T(lang, 'js.confirmDelSub')
    }) + ';function msg(id,t){document.getElementById(id).textContent=t;}function xhr(method,path,data,cb){var x=new XMLHttpRequest(),finished=false;function done(status,j){if(finished)return;finished=true;cb(status,j||{});}x.open(method,path,true);x.setRequestHeader("Content-Type","application/json");x.onreadystatechange=function(){if(x.readyState===4){var j={};try{j=JSON.parse(x.responseText||"{}");}catch(e){}done(x.status,j);}};x.onerror=function(){done(0,{ok:false});};x.send(data?JSON.stringify(data):null);}function setLangUi(v){document.cookie="alang="+v+";path=/;max-age=31536000";location.href="/?lang="+v;}function setImportBusy(v){document.getElementById("importButton").disabled=!!v;}function importValue(){setImportBusy(true);msg("importMsg",L.importing);xhr("POST","/api/import",{name:document.getElementById("importName").value,value:document.getElementById("importValue").value},function(s,j){setImportBusy(false);if(!j.ok){msg("importMsg",L.error+(j.error||L.notLoaded));return;}msg("importMsg",j.kind==="subscription"?L.loaded1+j.count+L.loaded2:L.importedProfile);setTimeout(function(){location.reload();},j.kind==="subscription"?800:500);});}function updateAll(){msg("importMsg",L.updatingAll);xhr("POST","/api/subscriptions/update",{},function(s,j){if(!j.ok){msg("importMsg",L.error+(j.error||L.notUpdated));return;}msg("importMsg",L.updated);setTimeout(function(){location.reload();},800);});}function delProfile(id){if(!confirm(L.confirmDelProfile))return;xhr("DELETE","/api/profiles/"+encodeURIComponent(id),null,function(){location.reload();});}function setActive(id){xhr("POST","/api/active",{id:id},function(){location.reload();});}function updateOneSub(id){xhr("POST","/api/subscriptions/"+encodeURIComponent(id)+"/update",{},function(s,j){if(!j.ok){alert(L.error+(j.error||L.notUpdated));return;}location.reload();});}function delSub(id){if(!confirm(L.confirmDelSub))return;xhr("DELETE","/api/subscriptions/"+encodeURIComponent(id),null,function(){location.reload();});}</script></body></html>';
}

function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); }
function readBody(req, cb) { var data = '', size = 0, tooLarge = false; req.on('data', function (chunk) { if (tooLarge) return; size += chunk.length; if (size > MAX_BODY) { tooLarge = true; data = ''; try { req.destroy(); } catch (e) {} return; } data += chunk; }); req.on('end', function () { if (!tooLarge) cb(data); }); }
function sendAppAsset(res, name, contentType) {
  var file = path.join(__dirname, '..', name);
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}

function importSingleProfile(link, displayName) {
  link = safeText(link, 16000);
  displayName = safeText(displayName, 80);
  validateLink(link);
  var store = readStore();
  var key = profileKeyFromLink(link), profile = null, pi;
  for (pi = 0; pi < store.profiles.length; pi++) {
    if (!store.profiles[pi].subscriptionId && profileKeyFromLink(store.profiles[pi].link) === key) { profile = store.profiles[pi]; break; }
  }
  if (profile) {
    profile.name = cleanServerLabel(displayName || profile.name || inferName(link));
    profile.link = link;
    profile.protocol = parseProxyLink(link).protocol || profile.protocol || 'vless';
    profile.updatedAt = now();
  } else {
    var parsedManual = parseProxyLink(link);
    profile = { id: makeId('p'), protocol: parsedManual.protocol || 'vless', name: cleanServerLabel(displayName || inferName(link)), link: link, sourceType: 'single', addedAt: now(), updatedAt: now() };
    store.profiles.push(profile);
  }
  var ccM = detectCountry(displayName + ' ' + (function () { try { return parseProxyLink(link).name || ''; } catch (eCc) { return ''; } })());
  if (ccM) profile.country = ccM;
  store.activeId = profile.id;
  dedupeProfilesInStore(store);
  writeStore(store);
  return { kind: 'profile', count: 1, profile: profile, store: store };
}

function importInput(value, displayName, cb) {
  value = safeText(value, 16000);
  if (isHttpUrl(value)) return importSubscription(value, displayName, function (err, result) {
    if (err) return cb(err);
    result.kind = 'subscription';
    cb(null, result);
  });
  if (!PROTO_RE.test(value)) return cb(locErr('err.importType'));
  try { cb(null, importSingleProfile(value, displayName)); } catch (e) { cb(e); }
}

function handle(req, res) {
  var parsed = urlmod.parse(req.url || '/', true); var pathname = parsed.pathname || '/';
  var lang = requestLang(req, parsed.query);
  var langSetting = requestLangSetting(req, parsed.query);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  try {
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      var hdrs = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
      if (parsed.query && (parsed.query.lang === 'ru' || parsed.query.lang === 'en' || parsed.query.lang === 'auto')) hdrs['Set-Cookie'] = 'alang=' + parsed.query.lang + '; Path=/; Max-Age=31536000';
      res.writeHead(200, hdrs); return res.end(html(lang, langSetting));
    }
    if (req.method === 'GET' && pathname === '/favicon.ico') return sendAppAsset(res, 'favicon.png', 'image/png');
    if (req.method === 'GET' && pathname === '/favicon.png') return sendAppAsset(res, 'favicon.png', 'image/png');
    if (req.method === 'GET' && pathname === '/logo.png') return sendAppAsset(res, 'logo.png', 'image/png');
    if (req.method === 'GET' && pathname === '/api/info') return sendJson(res, 200, { ok: true, port: PORT, ips: localIps(), store: STORE_FILE });
    if (req.method === 'GET' && pathname === '/api/profiles/meta') return sendJson(res, 200, { ok: true, revision: storeRevision() });
    if (req.method === 'GET' && pathname === '/api/profiles') return sendJson(res, 200, { ok: true, store: readStore(), revision: storeRevision() });
    if (req.method === 'POST' && pathname === '/api/import') return readBody(req, function (body) { try { var dataI = JSON.parse(body || '{}'); var valueI = dataI.value || dataI.link || dataI.url || ''; importInput(valueI, dataI.name, function (err, result) { if (err) return sendJson(res, 400, { ok: false, error: errText(err, lang) }); result.ok = true; sendJson(res, 200, result); }); } catch (e) { sendJson(res, 400, { ok: false, error: errText(e, lang) }); } });
    if (req.method === 'POST' && pathname === '/api/profiles') return readBody(req, function (body) { try { var data = JSON.parse(body || '{}'); var resultP = importSingleProfile(data.link, data.name); resultP.ok = true; sendJson(res, 200, resultP); } catch (e) { sendJson(res, 400, { ok: false, error: errText(e, lang) }); } });
    if (req.method === 'POST' && pathname === '/api/subscriptions') return readBody(req, function (body) { try { var data = JSON.parse(body || '{}'); importSubscription(data.url, data.name, function (err, result) { if (err) return sendJson(res, 400, { ok: false, error: errText(err, lang) }); sendJson(res, 200, { ok: true, count: result.count, subscription: result.subscription, store: result.store }); }); } catch (e) { sendJson(res, 400, { ok: false, error: errText(e, lang) }); } });
    if (req.method === 'POST' && pathname === '/api/subscriptions/update') return updateAllSubscriptions(function (err, results, store) { if (err) return sendJson(res, 400, { ok: false, error: errText(err, lang) }); sendJson(res, 200, { ok: true, results: results, store: store }); });
    if (req.method === 'POST' && /^\/api\/subscriptions\/[^/]+\/update$/.test(pathname)) { var sidu = decodeURIComponent(pathname.split('/')[3]); var storesu = readStore(); var subu = null; for (var su = 0; su < storesu.subscriptions.length; su++) if (storesu.subscriptions[su].id === sidu) subu = storesu.subscriptions[su]; if (!subu) return sendJson(res, 404, { ok: false, error: T(lang, 'err.subNotFound') }); return importSubscription(subu.url, subu.name, function (err, result) { if (err) return sendJson(res, 400, { ok: false, error: errText(err, lang) }); sendJson(res, 200, { ok: true, count: result.count, subscription: result.subscription, store: result.store }); }); }
    if (req.method === 'DELETE' && pathname.indexOf('/api/subscriptions/') === 0) { var sid = decodeURIComponent(pathname.slice('/api/subscriptions/'.length)); var storeS = readStore(); var subs = [], profs = [], i; for (i = 0; i < storeS.subscriptions.length; i++) if (storeS.subscriptions[i].id !== sid) subs.push(storeS.subscriptions[i]); for (i = 0; i < storeS.profiles.length; i++) if (storeS.profiles[i].subscriptionId !== sid) profs.push(storeS.profiles[i]); storeS.subscriptions = subs; storeS.profiles = profs; if (!storeS.profiles.some(function (p) { return p.id === storeS.activeId; })) storeS.activeId = storeS.profiles[0] && storeS.profiles[0].id || null; writeStore(storeS); return sendJson(res, 200, { ok: true, store: storeS }); }
    if (req.method === 'DELETE' && pathname.indexOf('/api/profiles/') === 0) { var pid = decodeURIComponent(pathname.slice('/api/profiles/'.length)); var storeD = readStore(); var keep = [], j; for (j = 0; j < storeD.profiles.length; j++) if (storeD.profiles[j].id !== pid) keep.push(storeD.profiles[j]); storeD.profiles = keep; if (storeD.activeId === pid) storeD.activeId = storeD.profiles[0] && storeD.profiles[0].id || null; writeStore(storeD); return sendJson(res, 200, { ok: true, store: storeD }); }
    if (req.method === 'POST' && pathname === '/api/active') return readBody(req, function (body) { try { var dataA = JSON.parse(body || '{}'); var storeA = readStore(); var exists = false, k; for (k = 0; k < storeA.profiles.length; k++) if (storeA.profiles[k].id === dataA.id) exists = true; if (!exists) throw locErr('err.profileNotFound'); storeA.activeId = dataA.id; writeStore(storeA); sendJson(res, 200, { ok: true, store: storeA }); } catch (e) { sendJson(res, 400, { ok: false, error: errText(e, lang) }); } });
    if (req.method === 'POST' && pathname === '/api/settings') return readBody(req, function (body) { try { var dataSettings = JSON.parse(body || '{}'); var storeSettings = readStore(); if (dataSettings.lang !== 'ru' && dataSettings.lang !== 'en' && dataSettings.lang !== 'auto') throw new Error('Invalid language'); storeSettings.lang = dataSettings.lang; writeStore(storeSettings); sendJson(res, 200, { ok: true, store: storeSettings }); } catch (e) { sendJson(res, 400, { ok: false, error: errText(e, lang) }); } });
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
}

module.exports = { extractProxyLinks: extractProxyLinks, extractSubscriptionProfiles: extractSubscriptionProfiles, parseProxyLink: parseProxyLink, isGenericName: isGenericName, descriptiveName: descriptiveName, hostDisplayName: hostDisplayName, importedProfileName: importedProfileName, profileKey: profileKey };

if (require.main === module && process.argv.indexOf('--update-subscriptions') >= 0) {
  updateAllSubscriptions(function (err, results, store) {
    if (err) { console.error('ERROR: ' + err.message); process.exit(2); }
    var i; console.log('Subscriptions updated: ' + results.length); for (i = 0; i < results.length; i++) console.log((results[i].ok ? 'OK ' : 'ERR ') + (results[i].name || results[i].url) + ' count=' + results[i].count + (results[i].error ? ' error=' + results[i].error : ''));
    console.log('Profiles: ' + store.profiles.length);
    process.exit(0);
  });
} else if (require.main === module) {
  var server = http.createServer(handle);
  server.maxConnections = 24;
  server.maxHeadersCount = 50;
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 15000;
  server.requestTimeout = 300000;
  server.setTimeout(300000, function (socket) { socket.destroy(); });
  server.on('error', function (err) { console.error('Alcyone web listen error: ' + (err && err.stack || err)); process.exit(3); });
  server.listen(PORT, HOST, function () { console.log('Alcyone web import listening on ' + HOST + ':' + PORT); console.log('Store: ' + STORE_FILE); var ips = localIps(); if (!ips.length) console.log('Open: http://TV-IP:' + PORT); ips.forEach(function (ip) { console.log('Open: http://' + ip + ':' + PORT); }); });
}
