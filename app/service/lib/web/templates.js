'use strict';

var countries = require('../../countries');

/* HTML and localized strings for the LAN importer.

   Kept separate from the HTTP layer so templates hold no request state and no
   secrets. The importer page never renders a proxy link, UUID, password or
   subscription URL: it shows display metadata and accepts new input. */

var STRINGS = {
  ru: {
    'title': 'Импорт серверов',
    'pair.title': 'Введите код с телевизора',
    'pair.help': 'Код показан на экране телевизора. Он действует ограниченное время и используется один раз.',
    'pair.code': 'Код сопряжения',
    'pair.submit': 'Подключиться',
    'pair.failed': 'Неверный или просроченный код',
    'pair.limited': 'Слишком много попыток. Попробуйте позже.',
    'hero.text': 'Добавьте ссылку сервера (VLESS, VMess, Trojan, Shadowsocks, SOCKS5, Hysteria2) или ссылку подписки. Список серверов на телевизоре обновится автоматически.',
    'form.name': 'Название (необязательно)',
    'form.value': 'Ссылка сервера или подписки',
    'form.compatMode': 'Режим совместимости (передавать HWID по HTTPS)',
    'form.submit': 'Импортировать',
    'form.updateAll': 'Обновить все подписки',
    'sec.subs': 'Подписки',
    'sec.servers': 'Серверы',
    'empty.subs': 'Подписок пока нет.',
    'empty.profiles': 'Профилей пока нет.',
    'row.selected': 'Выбран',
    'row.select': 'Выбрать',
    'row.delete': 'Удалить',
    'row.update': 'Обновить',
    'msg.working': 'Выполняю...',
    'msg.done': 'Готово. Обновляю список...',
    'msg.imported': 'Импортировано серверов: ',
    'notice.privacy': 'В целях безопасности сохранённые ссылки и ключи не отображаются и не выдаются по сети.',
    'notice.http': 'Соединение по локальной сети не зашифровано. Используйте только доверенную домашнюю сеть.',
    'session.expired': 'Сессия истекла. Включите импорт на телевизоре ещё раз.'
  },
  en: {
    'title': 'Server import',
    'pair.title': 'Enter the code from your TV',
    'pair.help': 'The code is shown on the TV screen. It is valid for a short time and can be used once.',
    'pair.code': 'Pairing code',
    'pair.submit': 'Connect',
    'pair.failed': 'Invalid or expired code',
    'pair.limited': 'Too many attempts. Try again later.',
    'hero.text': 'Add a server link (VLESS, VMess, Trojan, Shadowsocks, SOCKS5, Hysteria2) or a subscription URL. The TV server list updates automatically.',
    'form.name': 'Name (optional)',
    'form.value': 'Server link or subscription URL',
    'form.compatMode': 'Provider compatibility mode (send HWID over HTTPS)',
    'form.submit': 'Import',
    'form.updateAll': 'Update all subscriptions',
    'sec.subs': 'Subscriptions',
    'sec.servers': 'Servers',
    'empty.subs': 'No subscriptions yet.',
    'empty.profiles': 'No profiles yet.',
    'row.selected': 'Selected',
    'row.select': 'Select',
    'row.delete': 'Delete',
    'row.update': 'Update',
    'msg.working': 'Working...',
    'msg.done': 'Done. Refreshing the list...',
    'msg.imported': 'Servers imported: ',
    'notice.privacy': 'For security, stored links and keys are never displayed or served over the network.',
    'notice.http': 'This LAN connection is not encrypted. Use only on a trusted home network.',
    'session.expired': 'Session expired. Enable import on the TV again.'
  }
};

var RU_LANGS = { ru: 1, be: 1, uk: 1, kk: 1, ky: 1, uz: 1, tg: 1, tk: 1, hy: 1, az: 1 };
var RU_REGIONS = { ru: 1, by: 1, kz: 1, kg: 1, uz: 1, tj: 1, tm: 1, am: 1, az: 1, md: 1, ua: 1, ge: 1 };

function langFromAcceptLanguage(header) {
  var parts = String(header || '').toLowerCase().split(',');
  var i, tag, segments;
  for (i = 0; i < parts.length; i++) {
    tag = parts[i].split(';')[0].trim().replace(/_/g, '-');
    if (!tag || tag === '*') continue;
    segments = tag.split('-');
    if (RU_LANGS[segments[0]]) return 'ru';
    if (segments[1] && RU_REGIONS[segments[1]]) return 'ru';
    return 'en';
  }
  return 'en';
}

function t(lang, key) {
  var table = STRINGS[lang] ? STRINGS[lang] : STRINGS.en;
  var value = table[key];
  if (value === undefined) value = STRINGS.en[key];
  return value === undefined ? key : value;
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var STYLE = ':root{--bg:#0a0812;--panel:#141021;--panel2:#1c1433;--line:#2a2144;--lime:#b18cff;--green:#8b5cf6;--text:#e9e4f5;--muted:#9a92b3}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;padding:18px}' +
  '.wrap{max-width:820px;margin:0 auto}.hero,.card,.row{background:var(--panel);border:1px solid var(--line);border-radius:16px}' +
  '.hero{padding:20px;margin-bottom:16px}h1{font-size:30px;margin:4px 0 10px;color:var(--lime)}' +
  'h2{font-size:19px;margin:0 0 10px}p,small,em{color:var(--muted);line-height:1.45;font-style:normal}' +
  '.card{padding:16px 18px;margin-bottom:16px}label{display:block;color:var(--muted);font-size:14px;margin:12px 0 6px}' +
  'input,textarea{width:100%;border:1px solid var(--line);border-radius:12px;background:#0e0a1b;color:var(--text);padding:12px 14px;font-size:16px;font-family:inherit}' +
  'textarea{min-height:110px;font-family:ui-monospace,Consolas,monospace}' +
  'button{border:1px solid var(--line);border-radius:11px;background:var(--panel2);color:#cfc5e8;padding:11px 15px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer}' +
  'button.primary{border-color:var(--green);background:var(--lime);color:#170e2e;width:100%;margin-top:12px;font-weight:700}' +
  '.row{padding:13px;margin-bottom:9px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}' +
  '.row.active{border-color:#a78bfa;background:#1a1236}.row b{display:block;margin-bottom:3px}' +
  '.row small{display:block;font-size:12px}.countryFlag{font-size:20px;line-height:1;margin-right:7px}.buttons{display:grid;gap:7px}' +
  '.empty{border:1px dashed var(--line);border-radius:14px;padding:15px;color:var(--muted)}' +
  '.msg{white-space:pre-wrap;color:#d9cdf0;margin-top:11px;font-size:14px}' +
  '.notice{font-size:12px;color:var(--muted);margin-top:10px}' +
  '.codeInput{letter-spacing:.35em;text-transform:uppercase;font-size:22px;text-align:center;font-family:ui-monospace,Consolas,monospace}' +
  '@media(max-width:720px){.row{grid-template-columns:1fr}.buttons{grid-template-columns:1fr 1fr}}';

/* Pairing gate: the only page served to an unauthenticated client. */
function pairingPage(lang, options) {
  options = options || {};
  return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="same-origin">' +
    '<title>' + esc(t(lang, 'title')) + '</title><style>' + STYLE + '</style></head><body><div class="wrap">' +
    '<section class="hero"><h1>' + esc(t(lang, 'title')) + '</h1>' +
    '<p>' + esc(t(lang, 'pair.help')) + '</p></section>' +
    '<section class="card"><h2>' + esc(t(lang, 'pair.title')) + '</h2>' +
    '<form method="POST" action="/pair" autocomplete="off">' +
    '<label for="code">' + esc(t(lang, 'pair.code')) + '</label>' +
    '<input class="codeInput" id="code" name="code" maxlength="12" required autocomplete="one-time-code" inputmode="latin">' +
    '<button class="primary" type="submit">' + esc(t(lang, 'pair.submit')) + '</button></form>' +
    (options.error ? '<div class="msg">' + esc(options.error) + '</div>' : '') +
    '<div class="notice">' + esc(t(lang, 'notice.http')) + '</div>' +
    '</section></div></body></html>';
}

/* Authenticated importer page. Rendered from sanitized data only. */
function importerPage(lang, data) {
  var profiles = (data && data.profiles) || [];
  var subscriptions = (data && data.subscriptions) || [];
  var csrf = (data && data.csrf) || '';
  var rows = [], i, p, s;

  for (i = 0; i < subscriptions.length; i++) {
    s = subscriptions[i];
    rows.push('<div class="row"><div><b>' + esc(s.name || s.host || 'Subscription') + '</b>' +
      '<small>' + esc(s.host) + ' &middot; ' + esc(String(s.count)) + '</small></div>' +
      '<div class="buttons">' +
      '<button onclick="updateSub(\'' + esc(s.id) + '\')">' + esc(t(lang, 'row.update')) + '</button>' +
      '<button onclick="delSub(\'' + esc(s.id) + '\')">' + esc(t(lang, 'row.delete')) + '</button>' +
      '</div></div>');
  }
  var subsHtml = rows.length ? rows.join('') : '<div class="empty">' + esc(t(lang, 'empty.subs')) + '</div>';

  rows = [];
  for (i = 0; i < profiles.length; i++) {
    p = profiles[i];
    rows.push('<div class="row' + (p.selected ? ' active' : '') + '"><div><b><span class="countryFlag">' +
      esc(countries.emoji(p.country)) + '</span>' + esc(p.name) + '</b>' +
      '<small>' + esc(p.endpoint) + ' &middot; ' + esc(p.protocol) + '</small></div>' +
      '<div class="buttons">' +
      '<button onclick="setActive(\'' + esc(p.id) + '\')">' +
      esc(p.selected ? t(lang, 'row.selected') : t(lang, 'row.select')) + '</button>' +
      '<button onclick="delProfile(\'' + esc(p.id) + '\')">' + esc(t(lang, 'row.delete')) + '</button>' +
      '</div></div>');
  }
  var profilesHtml = rows.length ? rows.join('') : '<div class="empty">' + esc(t(lang, 'empty.profiles')) + '</div>';

  var labels = {
    working: t(lang, 'msg.working'),
    done: t(lang, 'msg.done'),
    imported: t(lang, 'msg.imported'),
    expired: t(lang, 'session.expired')
  };

  return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="same-origin">' +
    '<title>' + esc(t(lang, 'title')) + '</title><style>' + STYLE + '</style></head><body><div class="wrap">' +
    '<section class="hero"><h1>' + esc(t(lang, 'title')) + '</h1><p>' + esc(t(lang, 'hero.text')) + '</p>' +
    '<div class="notice">' + esc(t(lang, 'notice.privacy')) + '</div>' +
    '<div class="notice">' + esc(t(lang, 'notice.http')) + '</div></section>' +
    '<section class="card"><h2>' + esc(t(lang, 'form.submit')) + '</h2>' +
    '<label for="name">' + esc(t(lang, 'form.name')) + '</label><input id="name" maxlength="80">' +
    '<label for="value">' + esc(t(lang, 'form.value')) + '</label><textarea id="value" maxlength="16000"></textarea>' +
    '<label for="compatMode" style="display:flex;align-items:center;margin:12px 0 6px;color:var(--text);font-size:14px;cursor:pointer"><input type="checkbox" id="compatMode" style="width:auto;margin:0 8px 0 0;cursor:pointer"><span>' + esc(t(lang, 'form.compatMode')) + '</span></label>' +
    '<button class="primary" onclick="doImport()">' + esc(t(lang, 'form.submit')) + '</button>' +
    '<button style="width:100%;margin-top:9px" onclick="updateAll()">' + esc(t(lang, 'form.updateAll')) + '</button>' +
    '<div id="msg" class="msg"></div></section>' +
    '<section class="card"><h2>' + esc(t(lang, 'sec.subs')) + ' (' + subscriptions.length + ')</h2>' + subsHtml + '</section>' +
    '<section class="card"><h2>' + esc(t(lang, 'sec.servers')) + ' (' + profiles.length + ')</h2>' + profilesHtml + '</section>' +
    '</div><script>var CSRF=' + JSON.stringify(csrf) + ';var L=' + JSON.stringify(labels) + ';' +
    'function msg(t){document.getElementById("msg").textContent=t;}' +
    'function api(method,path,body,cb){var x=new XMLHttpRequest();x.open(method,path,true);' +
    'x.setRequestHeader("Content-Type","application/json");x.setRequestHeader("X-Alcyone-CSRF",CSRF);' +
    'x.onreadystatechange=function(){if(x.readyState===4){var j={};try{j=JSON.parse(x.responseText||"{}");}catch(e){}' +
    'if(x.status===401||x.status===403){msg(L.expired);return;}cb(x.status,j);}};' +
    'x.send(body?JSON.stringify(body):null);}' +
    'function doImport(){msg(L.working);var c=document.getElementById("compatMode");api("POST","/api/import",{name:document.getElementById("name").value,' +
    'value:document.getElementById("value").value,compatMode:!!(c&&c.checked)},function(s,j){if(!j.ok){msg(j.errorCode||"error");return;}' +
    'msg(j.count?L.imported+j.count:L.done);setTimeout(function(){location.reload();},700);});}' +
    'function updateAll(){msg(L.working);api("POST","/api/subscriptions/update",{},function(s,j){' +
    'if(!j.ok){msg(j.errorCode||"error");return;}msg(L.done);setTimeout(function(){location.reload();},700);});}' +
    'function updateSub(id){msg(L.working);api("POST","/api/subscriptions/update",{id:id},function(s,j){' +
    'if(!j.ok){msg(j.errorCode||"error");return;}location.reload();});}' +
    'function delSub(id){api("POST","/api/subscriptions/delete",{id:id},function(){location.reload();});}' +
    'function delProfile(id){api("POST","/api/profiles/delete",{id:id},function(){location.reload();});}' +
    'function setActive(id){api("POST","/api/active",{id:id},function(){location.reload();});}' +
    '</script></body></html>';
}

module.exports = {
  STRINGS: STRINGS,
  t: t,
  esc: esc,
  langFromAcceptLanguage: langFromAcceptLanguage,
  pairingPage: pairingPage,
  importerPage: importerPage
};
