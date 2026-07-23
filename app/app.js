/* Alcyone 3.2.0 for LG webOS rooted TVs */
(function () {
  'use strict';
  var EDITION = window.ALCYONE_EDITION || {
    appId: 'com.alcyone.vpn',
    autostart: 'alcyone-vpn',
    core: 'xray',
    coreLabel: 'XRay',
    dataDir: '/var/lib/alcyone',
    editionName: 'XRay Edition',
    title: 'Alcyone XRay',
    version: '3.2.0',
    webPort: 8080
  };
  var APP_ID = EDITION.appId;
  var APP_VERSION = EDITION.version;
  var CORE = EDITION.core;
  var DATA_DIR = EDITION.dataDir;
  var APP_DIR = '/media/developer/apps/usr/palm/applications/' + APP_ID;
  var HB = 'luna://org.webosbrew.hbchannel.service';
  var STORE_FILE = DATA_DIR + '/profiles.json';
  var STORE_API = 'http://127.0.0.1:' + EDITION.webPort + '/api';
  var CONFIG_FILE = DATA_DIR + '/config.json';
  var ROUTE_ENV_FILE = DATA_DIR + '/route.env';
  var AUTOSTART_FILE = '/var/lib/webosbrew/init.d/' + EDITION.autostart;
  var state = { profiles: [], subscriptions: [], activeId: null };
  var running = false;
  var statusKnown = false;
  var vpnActionBusy = false;
  var vpnActionTimer = null;
  var restartLabelTimer = null;
  var webRunning = false;
  var runtimeSyncBusy = false;
  var runtimeSyncPending = false;
  var runtimeLifecycleWired = false;
  var runtimePollTimer = null;
  var lastStatus = '';
  var lastWebUrl = '';
  var storeRevision = '';
  var protoFilter = 'all';
  var storeLoaded = false;
  var pingResults = {};
  var pingPending = {};
  var pingBusy = false;
  var sortMode = 'name';
  var SORT_KEY = 'alcyone.serverSort';
  try {
    var savedSort = window.localStorage && localStorage.getItem(SORT_KEY);
    if (savedSort === 'name' || savedSort === 'ping') sortMode = savedSort;
  } catch (eSort) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function safeDecode(s) { try { return decodeURIComponent(String(s || '').replace(/\+/g, '%20')); } catch (e) { return String(s || ''); } }
  var lastLogText = '';
  var UI_LOG_LIMIT = 32768;
  function log(msg, force) {
    var el = $('log'); if (!el) return;
    var text = String(msg == null ? '' : msg).replace(/\s+$/g, '');
    if (!text) return;
    if (!force && text === lastLogText) return;
    lastLogText = text;
    var wasNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 24;
    var oldTop = el.scrollTop;
    var t = new Date().toLocaleTimeString();
    var entry = '[' + t + '] ' + text + '\n';
    var current = el.textContent || '';
    if (current.length + entry.length > UI_LOG_LIMIT) {
      current = current.slice(Math.max(0, current.length + entry.length - UI_LOG_LIMIT));
      var firstLine = current.indexOf('\n');
      if (firstLine >= 0) current = current.slice(firstLine + 1);
    }
    el.textContent = current + entry;
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
    else el.scrollTop = oldTop;
  }
  function hasBridge() { return !!((window.webOS && webOS.service && webOS.service.request) || window.PalmServiceBridge || window.WebOSServiceBridge); }
  function decodeB64Utf8(s) {
    try { return decodeURIComponent(escape(atob(s || ''))); } catch (e) { try { return atob(s || ''); } catch (e2) { return ''; } }
  }
  function resField(res, name) {
    if (!res) return '';
    if (typeof res[name] === 'string') return res[name];
    if (typeof res[name + 'String'] === 'string') return res[name + 'String'];
    if (typeof res[name + 'Bytes'] === 'string') return decodeB64Utf8(res[name + 'Bytes']);
    return '';
  }
  function exec(cmd, cb) {
    cb = cb || function () {};
    function done(err, res) {
      var out = '';
      if (typeof res === 'string') out = res;
      else out = resField(res, 'stdout') + resField(res, 'stderr');
      if (err && !out) out = 'ERROR: ' + (err.errorText || err.error || err.message || JSON.stringify(err));
      cb(err || null, out);
    }
    if (window.webOS && webOS.service && webOS.service.request) {
      webOS.service.request(HB + '/exec', { parameters: { command: cmd }, onSuccess: function (r) { done(null, r); }, onFailure: function (e) { done(e, e); } });
      return;
    }
    var Bridge = window.PalmServiceBridge || window.WebOSServiceBridge;
    if (!Bridge) { done(new Error('Luna bridge unavailable'), null); return; }
    var br = new Bridge();
    br.onservicecallback = function (msg) { try { done(null, JSON.parse(msg)); } catch (e) { done(null, msg); } };
    br.call(HB + '/exec', JSON.stringify({ command: cmd }));
  }
  function ctl(arg, cb) { exec(APP_DIR + '/scripts/alcyonectl.sh ' + arg, function (e, out) { cb && cb(out || (e ? String(e.message || e) : '')); }); }
  function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function b64EncodeUtf8(s) { return btoa(unescape(encodeURIComponent(s))); }
  function storeApi(method, path, data, cb) {
    var xhr = new XMLHttpRequest(), finished = false, timer;
    function done(err, response) {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      var callback = cb;
      cb = null;
      if (callback) callback(err, response);
    }
    try {
      var url = STORE_API + path + (method === 'GET' ? (path.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now() : '');
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var response = null;
        try { response = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && response && response.ok) done(null, response);
        else done(new Error(response && response.error || 'Store API unavailable'), response);
      };
      xhr.onerror = function () { done(new Error('Store API unavailable')); };
      timer = setTimeout(function () { done(new Error('Store API timeout')); try { xhr.abort(); } catch (e) {} }, 5000);
      xhr.send(data === undefined || data === null ? null : JSON.stringify(data));
    } catch (e2) { done(e2); }
  }
  function storeApiRetry(method, path, data, cb) {
    storeApi(method, path, data, function (err, response) {
      if (!err) { cb && cb(null, response); return; }
      ctl('web-start', function () { storeApi(method, path, data, cb); });
    });
  }

  /* ---------- country flags (local SVG, minimal practical set) ---------- */
  var FLAG_FILES = {ae:1,al:1,am:1,ar:1,at:1,au:1,az:1,ba:1,be:1,bg:1,br:1,by:1,ca:1,ch:1,cl:1,cn:1,cy:1,cz:1,de:1,dk:1,ee:1,es:1,fi:1,fr:1,gb:1,ge:1,gr:1,hk:1,hr:1,hu:1,id:1,ie:1,il:1,'in':1,is:1,it:1,jp:1,kg:1,kr:1,kz:1,lt:1,lu:1,lv:1,md:1,me:1,mk:1,mt:1,mx:1,my:1,nl:1,no:1,nz:1,ph:1,pl:1,pt:1,ro:1,rs:1,ru:1,se:1,sg:1,si:1,sk:1,th:1,tr:1,tw:1,ua:1,us:1,uz:1,vn:1,un:1};
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
    ['грузия','ge'],['тбилиси','ge'],['tbilisi','ge'],
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
    ['китай','cn'],['china','cn'],
    ['georgia','ge']
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
  function profileCountry(p) {
    if (p && p.country && ISO_CODES[String(p.country).toLowerCase()]) return String(p.country).toLowerCase();
    var raw = '';
    try { raw = parseProxyLink(p.link).name || ''; } catch (e) {}
    return detectCountry((p && p.name || '') + ' ' + raw);
  }
  function flagSrc(code) {
    if (code && FLAG_FILES[code]) return 'flags/' + code + '.svg';
    return 'flags/un.svg';
  }
  function flagImgHtml(code) {
    return '<img class="flag" src="' + flagSrc(code) + '" alt="">';
  }
  function bindFlagFallback(root) {
    var imgs = root.querySelectorAll('img.flag'), i;
    for (i = 0; i < imgs.length; i++) {
      imgs[i].onerror = function () { this.onerror = null; this.src = 'flags/un.svg'; };
    }
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ---------- i18n (RU / EN, авто по региону) ---------- */
  var I18N = {
    ru: {
      'common.checking': 'Проверка...',
      'common.back': '‹ Назад',
      'common.done': 'Команда выполнена',
      'nav.home': 'Главная',
      'nav.servers': 'Сервера',
      'nav.settings': 'Настройки',
      'home.title': 'VPN',
      'home.subtitle': 'Защищённое подключение телевизора',
      'home.tapConnect': 'Нажмите для подключения',
      'home.tapDisconnect': 'Нажмите для отключения',
      'home.noServer': 'Сервер не выбран',
      'home.webTitle': 'Веб-импорт подписок',
      'home.webStarting': 'запускается...',
      'home.webHint': 'Открой адрес в браузере телефона или ПК, чтобы добавить подписки и серверы',
      'home.vpnOn': 'VPN включён',
      'home.vpnOff': 'VPN выключен',
      'servers.count0': '0 серверов',
      'servers.search': 'Поиск серверов...',
      'servers.ping': 'Пинг серверов',
      'servers.pinging': 'Проверяю...',
      'servers.pingDone': 'Проверка серверов завершена',
      'servers.refresh': 'Обновить',
      'servers.subUpdate': 'Обновить подписки',
      'servers.subUpdating': 'Обновляю...',
      'servers.subUpdatingLog': 'Обновляю подписки...',
      'servers.all': 'Все',
      'servers.sort': 'Сортировка',
      'servers.sortName': 'Имя',
      'servers.sortPing': 'Пинг',
      'servers.manualGroup': 'Ручные профили',
      'servers.manual': 'ручной',
      'servers.subscription': 'подписка',
      'servers.subscriptionCap': 'Подписка',
      'servers.select': 'Выбрать',
      'servers.selected': 'Выбран',
      'servers.delete': 'Удалить',
      'servers.nothingFound': 'Ничего не найдено',
      'servers.nothingFoundHint': 'Измени запрос поиска или фильтр протокола.',
      'servers.noProfiles': 'Профилей нет',
      'servers.noProfilesHint': 'Добавь серверную ссылку или подписку через веб-интерфейс — адрес на главной.',
      'servers.selectedLog': 'Выбран сервер: ',
      'servers.deletedLog': 'Профиль удалён',
      'servers.storeError': 'Не удалось синхронизировать список серверов',
      'plural.servers': ['сервер', 'сервера', 'серверов'],
      'plural.profiles': ['профиль', 'профиля', 'профилей'],
      'plural.subs': ['подписка', 'подписки', 'подписок'],
      'settings.sub': 'Управление приложением',
      'settings.restart': 'Перезапустить VPN',
      'settings.restartSub': 'Переподключить текущий сервер',
      'settings.restarting': 'Перезапускаю VPN...',
      'settings.checkIp': 'Проверить внешний IP',
      'settings.checkIpSub': 'Показать адрес напрямую и через VPN',
      'settings.checking': 'Проверяю...',
      'settings.viaVpn': 'Через VPN: ',
      'settings.direct': 'Напрямую: ',
      'settings.unavailable': 'Недоступно',
      'settings.ipFail': 'Не удалось проверить — подробности в логах туннеля',
      'settings.autostart': 'Автозапуск VPN',
      'settings.autostartSub': 'Подключаться при включении телевизора',
      'settings.on': 'Включён',
      'settings.off': 'Выключен',
      'settings.web': 'Веб-интерфейс',
      'settings.webSub': 'Импорт подписок с телефона или ПК',
      'settings.webOn': 'Запущен',
      'settings.webOff': 'Остановлен',
      'settings.secInterface': 'Интерфейс',
      'settings.lang': 'Язык',
      'settings.langSub': 'Русский · English · авто по региону',
      'settings.langAuto': 'Авто',
      'settings.secLog': 'Журнал',
      'logs.title': 'Логи туннеля',
      'logs.sub': 'Терминальный просмотрщик логов',
      'logs.refresh': 'Обновить логи',
      'logs.loading': 'Загружаю...',
      'logs.clear': 'Очистить',
      'logs.cleared': 'Файлы логов очищены',
      'logs.clearFailed': 'Не удалось очистить файлы логов',
      'logs.freeze': 'Зафиксировать',
      'logs.frozen': 'Лог зафиксирован для фото',
      'logs.header': '=== Логи туннеля ===',
      'logs.empty': 'пусто',
      'about.title': 'О приложении',
      'about.rowSub': EDITION.title + ' ' + APP_VERSION + ' · описание и связь',
      'about.text': CORE === 'sing-box'
        ? 'VPN-клиент для телевизоров LG webOS с root-доступом. Импортирует подписки VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2, поднимает нативный TUN-туннель через sing-box и направляет трафик телевизора через выбранный сервер. Подписки и серверы добавляются через веб-интерфейс с телефона или ПК.'
        : 'VPN-клиент для телевизоров LG webOS с root-доступом. Импортирует подписки VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2, поднимает туннель через XRay и tun2socks и направляет весь трафик телевизора через выбранный сервер. Подписки и серверы добавляются через веб-интерфейс с телефона или ПК.',
      'about.tgSub': 'Группа для связи, новостей и поддержки',
      'donate.title': 'Поддержать приложение',
      'donate.rowSub': 'QR-код для доната',
      'donate.thanks': 'Спасибо, что пользуешься Alcyone!',
      'donate.text1': 'Приложение бесплатное и развивается на энтузиазме. Если оно тебе полезно — отсканируй QR-код камерой телефона и поддержи разработку.',
      'donate.text2': 'Пожелания и вопросы — в Telegram-группе.',
      'vpn.noServer': 'Нет выбранного сервера',
      'vpn.profileError': 'Ошибка профиля: ',
      'vpn.starting': 'Запускаю VPN: ',
      'err.emptyLink': 'Пустая ссылка',
      'err.protoOnly': 'Alcyone поддерживает VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2',
      'err.xhttpCore': 'Транспорт XHTTP поддерживается только в XRay Edition',
      'err.unsupportedTransport': 'Этот транспорт не поддерживается sing-box: ',
      'err.noUuidHost': 'Не найден user@host:port',
      'err.badHost': 'Некорректная серверная ссылка',
      'err.badHysteria': 'Некорректный Hysteria2',
      'err.badProfile': 'Некорректный профиль',
      'app.noBridge': 'Luna bridge недоступен: приложение должно быть запущено на ТВ.'
    },
    en: {
      'common.checking': 'Checking...',
      'common.back': '‹ Back',
      'common.done': 'Command executed',
      'nav.home': 'Home',
      'nav.servers': 'Servers',
      'nav.settings': 'Settings',
      'home.title': 'VPN',
      'home.subtitle': 'Protected connection for your TV',
      'home.tapConnect': 'Press to connect',
      'home.tapDisconnect': 'Press to disconnect',
      'home.noServer': 'No server selected',
      'home.webTitle': 'Web subscription import',
      'home.webStarting': 'starting...',
      'home.webHint': 'Open this address in your phone or PC browser to add subscriptions and servers',
      'home.vpnOn': 'VPN is on',
      'home.vpnOff': 'VPN is off',
      'servers.count0': '0 servers',
      'servers.search': 'Search servers...',
      'servers.ping': 'Ping servers',
      'servers.pinging': 'Pinging...',
      'servers.pingDone': 'Server ping completed',
      'servers.refresh': 'Refresh',
      'servers.subUpdate': 'Update subscriptions',
      'servers.subUpdating': 'Updating...',
      'servers.subUpdatingLog': 'Updating subscriptions...',
      'servers.all': 'All',
      'servers.sort': 'Sort by',
      'servers.sortName': 'Name',
      'servers.sortPing': 'Ping',
      'servers.manualGroup': 'Manual profiles',
      'servers.manual': 'manual',
      'servers.subscription': 'subscription',
      'servers.subscriptionCap': 'Subscription',
      'servers.select': 'Select',
      'servers.selected': 'Selected',
      'servers.delete': 'Delete',
      'servers.nothingFound': 'Nothing found',
      'servers.nothingFoundHint': 'Change the search query or protocol filter.',
      'servers.noProfiles': 'No profiles yet',
      'servers.noProfilesHint': 'Add a server link or a subscription via the web interface — the address is on the Home page.',
      'servers.selectedLog': 'Server selected: ',
      'servers.deletedLog': 'Profile deleted',
      'servers.storeError': 'Could not synchronize the server list',
      'plural.servers': ['server', 'servers'],
      'plural.profiles': ['profile', 'profiles'],
      'plural.subs': ['subscription', 'subscriptions'],
      'settings.sub': 'App management',
      'settings.restart': 'Restart VPN',
      'settings.restartSub': 'Reconnect the current server',
      'settings.restarting': 'Restarting VPN...',
      'settings.checkIp': 'Check external IP',
      'settings.checkIpSub': 'Show address directly and via VPN',
      'settings.checking': 'Checking...',
      'settings.viaVpn': 'Via VPN: ',
      'settings.direct': 'Direct: ',
      'settings.unavailable': 'Unavailable',
      'settings.ipFail': 'Check failed — see tunnel logs for details',
      'settings.autostart': 'VPN autostart',
      'settings.autostartSub': 'Connect when the TV turns on',
      'settings.on': 'On',
      'settings.off': 'Off',
      'settings.web': 'Web interface',
      'settings.webSub': 'Import subscriptions from your phone or PC',
      'settings.webOn': 'Running',
      'settings.webOff': 'Stopped',
      'settings.secInterface': 'Interface',
      'settings.lang': 'Language',
      'settings.langSub': 'Русский · English · auto by region',
      'settings.langAuto': 'Auto',
      'settings.secLog': 'Log',
      'logs.title': 'Tunnel logs',
      'logs.sub': 'Terminal log viewer',
      'logs.refresh': 'Refresh logs',
      'logs.loading': 'Loading...',
      'logs.clear': 'Clear',
      'logs.cleared': 'Log files cleared',
      'logs.clearFailed': 'Could not clear log files',
      'logs.freeze': 'Freeze',
      'logs.frozen': 'Log frozen for a photo',
      'logs.header': '=== Tunnel logs ===',
      'logs.empty': 'empty',
      'about.title': 'About',
      'about.rowSub': EDITION.title + ' ' + APP_VERSION + ' · info and contact',
      'about.text': CORE === 'sing-box'
        ? 'A VPN client for rooted LG webOS TVs. It imports VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2 subscriptions, creates a native TUN tunnel with sing-box, and routes TV traffic through the selected server. Subscriptions and servers are added via the web interface from your phone or PC.'
        : 'A VPN client for rooted LG webOS TVs. It imports VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2 subscriptions, brings up a tunnel via XRay and tun2socks, and routes all TV traffic through the selected server. Subscriptions and servers are added via the web interface from your phone or PC.',
      'about.tgSub': 'Group for contact, news and support',
      'donate.title': 'Support the app',
      'donate.rowSub': 'Donation QR code',
      'donate.thanks': 'Thank you for using Alcyone!',
      'donate.text1': 'The app is free and developed out of enthusiasm. If you find it useful, scan the QR code with your phone camera and support the development.',
      'donate.text2': 'Suggestions and questions — in the Telegram group.',
      'vpn.noServer': 'No server selected',
      'vpn.profileError': 'Profile error: ',
      'vpn.starting': 'Starting VPN: ',
      'err.emptyLink': 'Empty link',
      'err.protoOnly': 'Alcyone supports VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2',
      'err.xhttpCore': 'XHTTP transport is available only in XRay Edition',
      'err.unsupportedTransport': 'Unsupported sing-box transport: ',
      'err.noUuidHost': 'user@host:port not found',
      'err.badHost': 'Invalid server link',
      'err.badHysteria': 'Invalid Hysteria2 link',
      'err.badProfile': 'Invalid profile',
      'app.noBridge': 'Luna bridge unavailable: the app must run on the TV.'
    }
  };
  var LANG_KEY = 'alcyone.lang';
  var langSetting = 'auto'; /* 'auto' | 'ru' | 'en' */
  var hasStoredLang = false;
  var sysLocale = '';
  try {
    var savedLang = window.localStorage && localStorage.getItem(LANG_KEY);
    if (savedLang === 'ru' || savedLang === 'en' || savedLang === 'auto') { langSetting = savedLang; hasStoredLang = true; }
  } catch (eLs) {}
  /* языки и регионы, где русский понятнее английского */
  var RU_LANGS = { ru: 1, be: 1, uk: 1, kk: 1, ky: 1, uz: 1, tg: 1, tk: 1, hy: 1, az: 1 };
  var RU_REGIONS = { ru: 1, by: 1, kz: 1, kg: 1, uz: 1, tj: 1, tm: 1, am: 1, az: 1, md: 1, ua: 1, ge: 1 };
  function autoLang() {
    var cands = [], i, c, parts;
    if (sysLocale) cands.push(sysLocale);
    try { if (navigator.languages && navigator.languages.length) cands = cands.concat(navigator.languages); } catch (e) {}
    if (navigator.language) cands.push(navigator.language);
    if (navigator.userLanguage) cands.push(navigator.userLanguage);
    for (i = 0; i < cands.length; i++) {
      c = String(cands[i] || '').toLowerCase().replace(/_/g, '-');
      if (!c) continue;
      parts = c.split('-');
      if (RU_LANGS[parts[0]]) return 'ru';
      if (parts[1] && RU_REGIONS[parts[1]]) return 'ru';
      if (parts[0]) return 'en';
    }
    return 'en';
  }
  function curLang() { return langSetting === 'auto' ? autoLang() : langSetting; }
  function tr(key) {
    var l = curLang();
    var v = I18N[l] && I18N[l][key];
    if (v === undefined) v = I18N.ru[key];
    return v === undefined ? key : v;
  }
  function trn(n, key) {
    var l = curLang();
    var forms = (I18N[l] && I18N[l][key]) || I18N.ru[key] || [];
    if (l === 'ru') return plural(n, forms[0], forms[1], forms[2]);
    return n === 1 ? forms[0] : forms[1];
  }
  function applyI18n() {
    var els = document.querySelectorAll('[data-i18n]'), i, k;
    for (i = 0; i < els.length; i++) { k = els[i].getAttribute('data-i18n'); if (k) els[i].textContent = tr(k); }
    els = document.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < els.length; i++) { k = els[i].getAttribute('data-i18n-ph'); if (k) els[i].setAttribute('placeholder', tr(k)); }
  }
  function applyEditionUi() {
    document.title = EDITION.title;
    if ($('editionBrand')) $('editionBrand').textContent = EDITION.coreLabel;
    if ($('editionVersion')) $('editionVersion').textContent = EDITION.coreLabel + ' · v' + APP_VERSION;
    if ($('aboutVersion')) $('aboutVersion').textContent = EDITION.coreLabel + ' · v' + APP_VERSION;
  }
  function langLabel() {
    if (langSetting === 'ru') return 'Русский';
    if (langSetting === 'en') return 'English';
    return tr('settings.langAuto') + ' · ' + (curLang() === 'ru' ? 'RU' : 'EN');
  }
  function updateLangUi() {
    applyI18n();
    updatePingButton();
    updateHome(lastStatus);
    renderServers();
    if (lastWebUrl) { if ($('webUrl')) $('webUrl').textContent = lastWebUrl; if ($('webSub')) $('webSub').textContent = lastWebUrl; }
    var a = $('autostartState');
    if (a && autostartKnown) { a.textContent = autostartOn ? tr('settings.on') : tr('settings.off'); a.className = 'rState' + (autostartOn ? ' on' : ''); }
    var el = $('langState');
    if (el) el.textContent = langLabel();
  }
  function setLang(v) {
    langSetting = v;
    try { if (window.localStorage) localStorage.setItem(LANG_KEY, v); } catch (e) {}
    hasStoredLang = true;
    state.lang = v;
    if (storeLoaded) storeApiRetry('POST', '/settings', { lang: v }, function () {}); /* до загрузки store не пишем, чтобы не затереть профили */
    updateLangUi();
  }
  function lunaCall(uri, params, cb) {
    if (window.webOS && webOS.service && webOS.service.request) {
      webOS.service.request(uri, { parameters: params || {}, onSuccess: function (r) { cb && cb(null, r); }, onFailure: function (e) { cb && cb(e, null); } });
      return;
    }
    var Bridge = window.PalmServiceBridge || window.WebOSServiceBridge;
    if (!Bridge) { cb && cb(new Error('no bridge'), null); return; }
    var br = new Bridge();
    br.onservicecallback = function (msg) { var r = null; try { r = JSON.parse(msg); } catch (e) {} cb && cb(null, r); };
    br.call(uri, JSON.stringify(params || {}));
  }
  function fetchSystemLocale() {
    lunaCall('luna://com.webos.settingsservice/getSystemSettings', { keys: ['localeInfo'] }, function (e, r) {
      var loc = '';
      try {
        var li = r && r.settings && r.settings.localeInfo;
        if (li) loc = (li.locales && (li.locales.UI || li.locales.TV)) || li.locale || '';
      } catch (e2) {}
      if (typeof loc !== 'string') loc = '';
      if (loc && loc !== sysLocale) { sysLocale = loc; if (langSetting === 'auto') updateLangUi(); }
    });
  }

  function normalizeStore(raw) {
    var store = raw, i, cc;
    if (Object.prototype.toString.call(store) === '[object Array]') store = { profiles: store, subscriptions: [], activeId: store[0] && store[0].id || null };
    if (!store || typeof store !== 'object') store = { profiles: [], subscriptions: [], activeId: null };
    if (store.lang !== 'ru' && store.lang !== 'en' && store.lang !== 'auto') store.lang = undefined;
    if (Object.prototype.toString.call(store.profiles) !== '[object Array]') store.profiles = [];
    if (Object.prototype.toString.call(store.subscriptions) !== '[object Array]') store.subscriptions = [];
    for (i = store.profiles.length - 1; i >= 0; i--) if (!store.profiles[i] || !store.profiles[i].id || !store.profiles[i].link) store.profiles.splice(i, 1);
    for (i = 0; i < store.profiles.length; i++) {
      if (store.profiles[i].name) store.profiles[i].name = cleanServerLabel(store.profiles[i].name);
      if (!store.profiles[i].country) {
        cc = profileCountry(store.profiles[i]);
        if (cc) store.profiles[i].country = cc;
      }
    }
    dedupeProfilesInStore(store);
    if (store.activeId) {
      var found = false;
      for (i = 0; i < store.profiles.length; i++) if (store.profiles[i].id === store.activeId) found = true;
      if (!found) store.activeId = store.profiles[0] && store.profiles[0].id || null;
    }
    if (!store.activeId && store.profiles[0]) store.activeId = store.profiles[0].id;
    return store;
  }
  function selectedProfile() { var i; for (i = 0; i < state.profiles.length; i++) if (state.profiles[i].id === state.activeId) return state.profiles[i]; return null; }
  function useStore(raw, cb, revision) {
    state = normalizeStore(raw);
    if (revision) storeRevision = String(revision);
    storeLoaded = true;
    if (state.lang && !hasStoredLang && state.lang !== langSetting) {
      langSetting = state.lang;
      try { if (window.localStorage) localStorage.setItem(LANG_KEY, langSetting); } catch (e) {}
      hasStoredLang = true;
      updateLangUi();
    }
    renderServers();
    updateHome();
    cb && cb();
  }
  function selectProfile(id) {
    var reconnect = running && id !== state.activeId;
    if (vpnActionBusy) return;
    storeApiRetry('POST', '/active', { id: id }, function (err, response) {
      if (!err && response && response.store) {
        useStore(response.store, function () {
          log(tr('servers.selectedLog') + profileDisplayName(selectedProfile()));
          if (reconnect) restartVpn();
        });
        return;
      }
      log(tr('servers.storeError'));
      loadStore();
    });
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
    link = String(link || '').trim();
    if (!link) throw new Error(tr('err.emptyLink'));
    if (!/^vless:\/\//i.test(link)) throw new Error(tr('err.protoOnly'));
    var noScheme = link.replace(/^vless:\/\//i, '');
    var hashSplit = noScheme.split('#');
    var name = hashSplit[1] ? safeDecode(hashSplit.slice(1).join('#')) : '';
    var main = hashSplit[0];
    var qIdx = main.indexOf('?');
    var authority = qIdx >= 0 ? main.slice(0, qIdx) : main;
    var query = qIdx >= 0 ? main.slice(qIdx + 1) : '';
    var at = authority.lastIndexOf('@');
    if (at < 0) throw new Error(tr('err.noUuidHost'));
    var uuid = authority.slice(0, at);
    var parsedHp = parseHostPort(authority.slice(at + 1), 443);
    var params = parseQuery(query);
    if (!uuid || !parsedHp.host || !parsedHp.port) throw new Error(tr('err.badHost'));
    return { protocol:'vless', uuid:uuid, host:parsedHp.host, port:parsedHp.port, params:params, name:name };
  }
  function parseHysteria2(link) {
    link = String(link || '').trim();
    if (!/^(hy2|hysteria2|hysteria):\/\//i.test(link)) throw new Error(tr('err.protoOnly'));
    var noScheme = link.replace(/^(hy2|hysteria2|hysteria):\/\//i, '');
    var hashSplit = noScheme.split('#');
    var name = hashSplit[1] ? safeDecode(hashSplit.slice(1).join('#')) : '';
    var main = hashSplit[0];
    var qIdx = main.indexOf('?');
    var authority = qIdx >= 0 ? main.slice(0, qIdx) : main;
    var query = qIdx >= 0 ? main.slice(qIdx + 1) : '';
    var at = authority.lastIndexOf('@');
    var password = '', hp = authority;
    if (at >= 0) { password = safeDecode(authority.slice(0, at)); hp = authority.slice(at + 1); }
    var parsedHp = parseHostPort(hp, 443);
    var params = parseQuery(query);
    password = password || params.auth || params.password || params['auth-str'] || '';
    if (!password || !parsedHp.host || !parsedHp.port) throw new Error(tr('err.badHysteria'));
    return { protocol:'hysteria2', password:password, host:parsedHp.host, port:parsedHp.port, params:params, name:name };
  }
  function b64DecodeLoose(s) {
    s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    while (s.length % 4) s += '=';
    return decodeB64Utf8(s);
  }
  function splitLinkParts(link, schemeRe) {
    var noScheme = String(link || '').trim().replace(schemeRe, '');
    var hashSplit = noScheme.split('#');
    var name = hashSplit[1] ? safeDecode(hashSplit.slice(1).join('#')) : '';
    var main = hashSplit[0];
    var qIdx = main.indexOf('?');
    return { name: name, authority: qIdx >= 0 ? main.slice(0, qIdx) : main, query: qIdx >= 0 ? main.slice(qIdx + 1) : '' };
  }
  function parseTrojan(link) {
    if (!/^trojan:\/\//i.test(String(link || ''))) throw new Error(tr('err.protoOnly'));
    var parts = splitLinkParts(link, /^trojan:\/\//i);
    var at = parts.authority.lastIndexOf('@');
    if (at < 0) throw new Error(tr('err.badHost'));
    var password = safeDecode(parts.authority.slice(0, at));
    var hp = parseHostPort(parts.authority.slice(at + 1), 443);
    var params = parseQuery(parts.query);
    if (!password || !hp.host || !hp.port) throw new Error(tr('err.badHost'));
    return { protocol:'trojan', password:password, host:hp.host, port:hp.port, params:params, name:parts.name };
  }
  function parseVmess(link) {
    if (!/^vmess:\/\//i.test(String(link || ''))) throw new Error(tr('err.protoOnly'));
    var parts = splitLinkParts(link, /^vmess:\/\//i);
    var o = null;
    try { o = JSON.parse(b64DecodeLoose(parts.authority)); } catch (e) { o = null; }
    if (o && (o.add || o.host) && o.id) {
      /* стандартная форма v2rayN: vmess://base64(JSON) */
      var net = String(o.net || 'tcp').toLowerCase();
      var isTls = String(o.tls || '').toLowerCase() === 'tls' || o.tls === true;
      var params = { security: isTls ? 'tls' : 'none', type: net, sni: String(o.sni || (isTls ? (o.host || '') : '')), path: String(o.path || ''), host: String(o.host || ''), alpn: String(o.alpn || ''), fp: String(o.fp || '') };
      if (net === 'grpc') params.serviceName = String(o.path || '');
      var port = parseInt(o.port, 10);
      if (!port) throw new Error(tr('err.badHost'));
      return { protocol:'vmess', uuid:String(o.id), host:String(o.add || o.host), port:port, aid:parseInt(o.aid, 10) || 0, scy:String(o.scy || o.security || 'auto'), params:params, name:String(o.ps || parts.name || '') };
    }
    /* URI-форма: vmess://uuid@host:port?...#name */
    var at = parts.authority.lastIndexOf('@');
    if (at < 0) throw new Error(tr('err.badHost'));
    var uuid = safeDecode(parts.authority.slice(0, at));
    var hp = parseHostPort(parts.authority.slice(at + 1), 443);
    var q = parseQuery(parts.query);
    if (!uuid || !hp.host || !hp.port) throw new Error(tr('err.badHost'));
    return { protocol:'vmess', uuid:uuid, host:hp.host, port:hp.port, aid:parseInt(q.aid, 10) || 0, scy:String(q.scy || q.encryption || 'auto'), params:q, name:parts.name };
  }
  function parseSs(link) {
    if (!/^ss:\/\//i.test(String(link || ''))) throw new Error(tr('err.protoOnly'));
    var parts = splitLinkParts(link, /^ss:\/\//i);
    var authority = parts.authority.replace(/\/$/, '');
    var method = '', password = '', hp = null;
    var at = authority.lastIndexOf('@');
    if (at >= 0) {
      /* SIP002: ss://base64url(method:password)@host:port */
      var ui = b64DecodeLoose(authority.slice(0, at));
      if (!ui || ui.indexOf(':') < 0) ui = safeDecode(authority.slice(0, at));
      var c = ui.indexOf(':');
      if (c < 0) throw new Error(tr('err.badHost'));
      method = ui.slice(0, c); password = ui.slice(c + 1);
      hp = parseHostPort(authority.slice(at + 1), 8388);
    } else {
      /* старая форма: ss://base64(method:password@host:port) */
      var dec = b64DecodeLoose(authority);
      var at2 = dec.lastIndexOf('@');
      if (at2 < 0) throw new Error(tr('err.badHost'));
      var mp = dec.slice(0, at2);
      var c2 = mp.indexOf(':');
      if (c2 < 0) throw new Error(tr('err.badHost'));
      method = mp.slice(0, c2); password = mp.slice(c2 + 1);
      hp = parseHostPort(dec.slice(at2 + 1), 8388);
    }
    var params = parseQuery(parts.query);
    if (!method || !password || !hp.host || !hp.port) throw new Error(tr('err.badHost'));
    return { protocol:'ss', method:method.toLowerCase(), password:password, host:hp.host, port:hp.port, params:params, name:parts.name };
  }
  function parseSocks(link) {
    if (!/^socks5?:\/\//i.test(String(link || ''))) throw new Error(tr('err.protoOnly'));
    var parts = splitLinkParts(link, /^socks5?:\/\//i);
    var user = '', pass = '', authority = parts.authority;
    var at = authority.lastIndexOf('@');
    if (at >= 0) {
      var cred = authority.slice(0, at);
      if (cred.indexOf(':') < 0) { var dec = b64DecodeLoose(cred); if (dec && dec.indexOf(':') >= 0) cred = dec; }
      var c = cred.indexOf(':');
      user = safeDecode(c >= 0 ? cred.slice(0, c) : cred);
      pass = c >= 0 ? safeDecode(cred.slice(c + 1)) : '';
      authority = authority.slice(at + 1);
    }
    var hp = parseHostPort(authority, 1080);
    if (!hp.host || !hp.port) throw new Error(tr('err.badHost'));
    return { protocol:'socks', user:user, pass:pass, host:hp.host, port:hp.port, params:parseQuery(parts.query), name:parts.name };
  }
  function parseProxyLink(link) {
    var s = String(link || '');
    if (/^vless:\/\//i.test(s)) return parseVless(link);
    if (/^(hy2|hysteria2|hysteria):\/\//i.test(s)) return parseHysteria2(link);
    if (/^trojan:\/\//i.test(s)) return parseTrojan(link);
    if (/^vmess:\/\//i.test(s)) return parseVmess(link);
    if (/^ss:\/\//i.test(s)) return parseSs(link);
    if (/^socks5?:\/\//i.test(s)) return parseSocks(link);
    throw new Error(tr('err.protoOnly'));
  }
  function truthy(v) { v = String(v == null ? '' : v).toLowerCase(); return v === '1' || v === 'true' || v === 'yes' || v === 'on'; }
  function profileName(p) { try { var parsed = parseProxyLink(p.link); return p.name || parsed.name || parsed.host || 'VPN'; } catch (e) { return p.name || 'VPN'; } }
  function profileMeta(p) {
    try {
      var v = parseProxyLink(p.link);
      var hp = v.host + ':' + v.port;
      if (v.protocol === 'hysteria2') return hp + ' · hysteria2';
      if (v.protocol === 'trojan') return hp + ' · trojan · ' + (v.params.type || v.params.network || 'tcp');
      if (v.protocol === 'vmess') return hp + ' · vmess · ' + (v.params.security || 'none') + ' · ' + (v.params.type || 'tcp');
      if (v.protocol === 'ss') return hp + ' · shadowsocks · ' + v.method;
      if (v.protocol === 'socks') return hp + ' · socks5' + (v.user ? ' · auth' : '');
      return hp + ' · ' + (v.params.security || 'none') + ' · ' + (v.params.type || v.params.network || 'tcp');
    } catch (e) { return tr('err.badProfile'); }
  }
  function profileProto(p) {
    if (p && p.protocol) return String(p.protocol).toLowerCase();
    try { return parseProxyLink(p.link).protocol; } catch (e) { return 'vless'; }
  }
  function xrayOutbound(profile) {
    var parsed = parseProxyLink(profile.link);
    if (parsed.protocol === 'hysteria2') {
      var hp = parsed.params || {};
      var tls = { serverName: hp.sni || hp.peer || hp.serverName || hp.servername || parsed.host, allowInsecure: truthy(hp.insecure || hp.allowInsecure || hp['skip-cert-verify']) };
      var alpn = hp.alpn ? String(hp.alpn).split(',').filter(Boolean) : ['h3'];
      if (alpn.length) tls.alpn = alpn;
      if (hp.fp || hp.fingerprint) tls.fingerprint = hp.fp || hp.fingerprint;
      var hyst = { version: 2, auth: parsed.password };
      if (hp.obfs) {
        hyst.obfs = { type: hp.obfs };
        if (hp['obfs-password'] || hp.obfsPassword || hp.obfs_password) hyst.obfs.password = hp['obfs-password'] || hp.obfsPassword || hp.obfs_password;
      }
      var settings = { version: 2, address: parsed.host, port: parsed.port };
      return { protocol:'hysteria', tag:'proxy', settings:settings, streamSettings:{ network:'hysteria', security:'tls', hysteriaSettings:hyst, tlsSettings:tls } };
    }
    if (parsed.protocol === 'ss') {
      return { protocol:'shadowsocks', tag:'proxy', settings:{ servers:[{ address:parsed.host, port:parsed.port, method:parsed.method, password:parsed.password }] } };
    }
    if (parsed.protocol === 'socks') {
      var srv = { address: parsed.host, port: parsed.port };
      if (parsed.user) srv.users = [{ user: parsed.user, pass: parsed.pass || '' }];
      return { protocol:'socks', tag:'proxy', settings:{ servers:[srv] } };
    }
    if (parsed.protocol === 'trojan') {
      /* trojan по спецификации всегда в TLS, если явно не сказано иное */
      return { protocol:'trojan', tag:'proxy', settings:{ servers:[{ address:parsed.host, port:parsed.port, password:parsed.password }] }, streamSettings: buildStreamSettings(parsed.params, parsed.host, 'tls') };
    }
    if (parsed.protocol === 'vmess') {
      var vu = { id: parsed.uuid, alterId: parsed.aid || 0, security: parsed.scy || 'auto' };
      return { protocol:'vmess', tag:'proxy', settings:{ vnext:[{ address:parsed.host, port:parsed.port, users:[vu] }] }, streamSettings: buildStreamSettings(parsed.params, parsed.host, 'none') };
    }
    var p = parsed.params;
    var user = { id: parsed.uuid, encryption: 'none' };
    if (p.flow) user.flow = p.flow;
    return { protocol:'vless', tag:'proxy', settings:{ vnext:[{ address:parsed.host, port:parsed.port, users:[user] }] }, streamSettings: buildStreamSettings(p, parsed.host, 'none') };
  }
  function buildStreamSettings(p, fallbackHost, defSecurity) {
    var security = String(p.security || defSecurity || 'none').toLowerCase();
    var network = String(p.type || p.network || 'tcp').toLowerCase();
    if (network === 'h2') network = 'http';
    if (network === 'xhttp' || network === 'splithttp') network = 'xhttp';
    var stream = { network: network, security: security === 'reality' ? 'reality' : (security === 'tls' ? 'tls' : 'none') };
    if (stream.security === 'reality') {
      stream.realitySettings = { serverName: p.sni || p.serverName || fallbackHost, fingerprint: p.fp || 'chrome', publicKey: p.pbk || '', shortId: p.sid || '', spiderX: p.spx || '/' };
    } else if (stream.security === 'tls') {
      stream.tlsSettings = { serverName: p.sni || p.serverName || fallbackHost, allowInsecure: p.allowInsecure === '1' || p.allowInsecure === 'true' || truthy(p.insecure) };
      if (p.alpn) stream.tlsSettings.alpn = String(p.alpn).split(',').filter(Boolean);
      if (p.fp) stream.tlsSettings.fingerprint = p.fp;
    }
    if (network === 'ws') { stream.wsSettings = { path: p.path || '/', headers: {} }; if (p.host) stream.wsSettings.headers.Host = p.host; }
    else if (network === 'grpc') { stream.grpcSettings = { serviceName: p.serviceName || '' }; }
    else if (network === 'http') { stream.httpSettings = {}; if (p.host) stream.httpSettings.host = String(p.host).split(',').filter(Boolean); if (p.path) stream.httpSettings.path = p.path; }
    else if (network === 'xhttp') { stream.xhttpSettings = { path: p.path || '/', mode: p.mode || 'auto' }; if (p.host) stream.xhttpSettings.host = p.host; if (p.extra) { try { stream.xhttpSettings.extra = JSON.parse(p.extra); } catch (e) {} } if (p.noGRPCHeader === '1' || p.noGRPCHeader === 'true') stream.xhttpSettings.noGRPCHeader = true; }
    else if (network === 'httpupgrade') { stream.httpupgradeSettings = { path: p.path || '/', headers: {} }; if (p.host) stream.httpupgradeSettings.headers.Host = p.host; }
    return stream;
  }
  function singBoxTls(p, fallbackHost, enabledByDefault) {
    p = p || {};
    var security = String(p.security || (enabledByDefault ? 'tls' : 'none')).toLowerCase();
    if (security !== 'tls' && security !== 'reality') return null;
    var tls = {
      enabled: true,
      server_name: p.sni || p.serverName || p.servername || p.peer || fallbackHost,
      insecure: truthy(p.allowInsecure || p.insecure || p['skip-cert-verify'])
    };
    if (p.alpn) tls.alpn = String(p.alpn).split(',').filter(Boolean);
    if (p.fp || p.fingerprint) tls.utls = { enabled:true, fingerprint:p.fp || p.fingerprint };
    if (security === 'reality') {
      tls.reality = {
        enabled: true,
        public_key: p.pbk || p.publicKey || p.public_key || '',
        short_id: p.sid || p.shortId || p.short_id || ''
      };
    }
    return tls;
  }
  function singBoxTransport(p) {
    p = p || {};
    var network = String(p.type || p.network || 'tcp').toLowerCase();
    if (network === 'h2') network = 'http';
    if (network === 'xhttp' || network === 'splithttp') throw new Error(tr('err.xhttpCore'));
    if (network === 'tcp' || network === 'raw' || network === 'none') return null;
    if (network === 'ws' || network === 'websocket') {
      var ws = { type:'ws', path:p.path || '/', headers:{} };
      if (p.host) ws.headers.Host = p.host;
      if (parseInt(p.ed || p.maxEarlyData, 10) > 0) ws.max_early_data = parseInt(p.ed || p.maxEarlyData, 10);
      if (p.eh || p.earlyDataHeaderName) ws.early_data_header_name = p.eh || p.earlyDataHeaderName;
      return ws;
    }
    if (network === 'grpc') {
      return { type:'grpc', service_name:p.serviceName || p.service_name || p.service || '' };
    }
    if (network === 'http') {
      return {
        type:'http',
        host:p.host ? String(p.host).split(',').filter(Boolean) : [],
        path:p.path || '/'
      };
    }
    if (network === 'httpupgrade') {
      return { type:'httpupgrade', host:p.host || '', path:p.path || '/', headers:{} };
    }
    if (network === 'quic') return { type:'quic' };
    throw new Error(tr('err.unsupportedTransport') + network);
  }
  function singBoxOutbound(profile) {
    var parsed = parseProxyLink(profile.link);
    var p = parsed.params || {};
    var outbound = {
      type: parsed.protocol === 'ss' ? 'shadowsocks' : parsed.protocol,
      tag: 'proxy',
      server: parsed.host,
      server_port: parsed.port
    };
    var transport, tls, value;
    if (parsed.protocol === 'hysteria2') {
      outbound.type = 'hysteria2';
      outbound.password = parsed.password;
      tls = singBoxTls({
        security:'tls',
        sni:p.sni || p.peer || p.serverName || p.servername,
        insecure:p.insecure || p.allowInsecure || p['skip-cert-verify'],
        alpn:p.alpn,
        fp:p.fp || p.fingerprint
      }, parsed.host, true);
      outbound.tls = tls;
      if (p.obfs) {
        outbound.obfs = { type:p.obfs };
        value = p['obfs-password'] || p.obfsPassword || p.obfs_password;
        if (value) outbound.obfs.password = value;
      }
      value = parseInt(p.upmbps || p.up_mbps, 10);
      if (value > 0) outbound.up_mbps = value;
      value = parseInt(p.downmbps || p.down_mbps, 10);
      if (value > 0) outbound.down_mbps = value;
      return outbound;
    }
    if (parsed.protocol === 'ss') {
      outbound.method = parsed.method;
      outbound.password = parsed.password;
      if (p.plugin) outbound.plugin = p.plugin;
      if (p.plugin_opts || p.pluginOpts) outbound.plugin_opts = p.plugin_opts || p.pluginOpts;
      return outbound;
    }
    if (parsed.protocol === 'socks') {
      outbound.type = 'socks';
      outbound.version = '5';
      if (parsed.user) outbound.username = parsed.user;
      if (parsed.pass) outbound.password = parsed.pass;
      return outbound;
    }
    if (parsed.protocol === 'trojan') {
      outbound.password = parsed.password;
      outbound.tls = singBoxTls(p, parsed.host, true);
    } else if (parsed.protocol === 'vmess') {
      outbound.uuid = parsed.uuid;
      outbound.security = parsed.scy || 'auto';
      outbound.alter_id = parsed.aid || 0;
      tls = singBoxTls(p, parsed.host, false);
      if (tls) outbound.tls = tls;
    } else {
      outbound.type = 'vless';
      outbound.uuid = parsed.uuid;
      if (p.flow) outbound.flow = p.flow;
      tls = singBoxTls(p, parsed.host, false);
      if (tls) outbound.tls = tls;
    }
    transport = singBoxTransport(p);
    if (transport) outbound.transport = transport;
    return outbound;
  }
  function buildSingBoxConfig(profile) {
    return {
      log: { level:'warn', timestamp:false },
      inbounds: [{
        type:'tun',
        tag:'tun-in',
        interface_name:'tun0',
        address:['198.18.0.1/30'],
        mtu:1500,
        auto_route:false,
        stack:'system',
        udp_timeout:'30s'
      }],
      outbounds: [singBoxOutbound(profile), { type:'direct', tag:'direct' }],
      route: {
        auto_detect_interface:true,
        final:'proxy',
        rules:[{ ip_is_private:true, action:'route', outbound:'direct' }]
      }
    };
  }
  function isObject(value) {
    return !!value && typeof value === 'object' && Object.prototype.toString.call(value) !== '[object Array]';
  }
  function applyXhttpLimits(settings) {
    if (!isObject(settings)) return;
    var target = isObject(settings.extra) ? settings.extra : settings;
    if (!isObject(target.xmux)) {
      target.xmux = {
        maxConcurrency: '16-32',
        cMaxReuseTimes: '128-256',
        hMaxRequestTimes: '600-900',
        hMaxReusableSecs: '300-600'
      };
    }
    var download = isObject(target.downloadSettings) ? target.downloadSettings : (isObject(settings.downloadSettings) ? settings.downloadSettings : null);
    if (download) applyXhttpLimits(download.xhttpSettings || download.splitHTTPSettings || download.splithttpSettings);
  }
  function boundedPolicyValue(level, key, fallback, maximum) {
    var value = level[key];
    if (typeof value !== 'number' || !isFinite(value) || value <= 0) level[key] = fallback;
    else if (value > maximum) level[key] = maximum;
  }
  function applyResourcePolicy(cfg) {
    if (!cfg.log || typeof cfg.log !== 'object' || Object.prototype.toString.call(cfg.log) === '[object Array]') cfg.log = {};
    cfg.log.access = 'none';
    cfg.log.error = '';
    cfg.log.dnsLog = false;
    if (cfg.log.loglevel !== 'warning' && cfg.log.loglevel !== 'error' && cfg.log.loglevel !== 'none') cfg.log.loglevel = 'warning';
    if (!cfg.policy || typeof cfg.policy !== 'object' || Object.prototype.toString.call(cfg.policy) === '[object Array]') cfg.policy = {};
    if (!cfg.policy.levels || typeof cfg.policy.levels !== 'object' || Object.prototype.toString.call(cfg.policy.levels) === '[object Array]') cfg.policy.levels = {};
    if (!cfg.policy.levels['0'] || typeof cfg.policy.levels['0'] !== 'object') cfg.policy.levels['0'] = {};
    boundedPolicyValue(cfg.policy.levels['0'], 'handshake', 5, 8);
    boundedPolicyValue(cfg.policy.levels['0'], 'connIdle', 60, 60);
    boundedPolicyValue(cfg.policy.levels['0'], 'uplinkOnly', 5, 10);
    boundedPolicyValue(cfg.policy.levels['0'], 'downlinkOnly', 5, 10);
    var outbounds = Object.prototype.toString.call(cfg.outbounds) === '[object Array]' ? cfg.outbounds : [];
    var i, stream, xhttp;
    for (i = 0; i < outbounds.length; i++) {
      stream = outbounds[i] && outbounds[i].streamSettings;
      if (!isObject(stream)) continue;
      xhttp = stream.xhttpSettings || stream.splitHTTPSettings || stream.splithttpSettings;
      if (String(stream.network || '').toLowerCase() === 'xhttp' || String(stream.network || '').toLowerCase() === 'splithttp' || xhttp) applyXhttpLimits(xhttp);
    }
    return cfg;
  }
  function buildConfig(profile) {
    if (CORE === 'sing-box') return buildSingBoxConfig(profile);
    if (profile && profile.fullConfig) return buildFullConfig(profile.fullConfig);
    return applyResourcePolicy({ log:{ loglevel:'warning' }, inbounds:[{ tag:'socks-in', listen:'127.0.0.1', port:10801, protocol:'socks', settings:{ auth:'noauth', udp:true }, sniffing:{ enabled:true, destOverride:['http','tls','quic'] } }], outbounds:[xrayOutbound(profile), { protocol:'freedom', tag:'direct' }, { protocol:'blackhole', tag:'block' }], routing:{ domainStrategy:'AsIs', rules:[{ type:'field', ip:['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','224.0.0.0/4','240.0.0.0/4','::1/128','fc00::/7','fe80::/10'], outboundTag:'direct' }] } });
  }
  function buildFullConfig(source) {
    var cfg = JSON.parse(JSON.stringify(source));
    var originalInbounds = Object.prototype.toString.call(cfg.inbounds) === '[object Array]' ? cfg.inbounds : [];
    var inboundTag = originalInbounds[0] && originalInbounds[0].tag || 'socks-in';
    var outbounds = Object.prototype.toString.call(cfg.outbounds) === '[object Array]' ? cfg.outbounds : [];
    var directTag = '', i;
    for (i = 0; i < outbounds.length; i++) if (String(outbounds[i] && outbounds[i].protocol || '').toLowerCase() === 'freedom') { directTag = outbounds[i].tag || 'direct'; break; }
    if (!directTag) { directTag = 'alcyone-direct'; outbounds.push({ protocol:'freedom', tag:directTag }); }
    cfg.inbounds = [{ tag:inboundTag, listen:'127.0.0.1', port:10801, protocol:'socks', settings:{ auth:'noauth', udp:true }, sniffing:{ enabled:true, destOverride:['http','tls','quic'] } }];
    cfg.outbounds = outbounds;
    if (!cfg.log) cfg.log = { loglevel:'warning' };
    if (!cfg.routing || typeof cfg.routing !== 'object') cfg.routing = { domainStrategy:'AsIs', rules:[] };
    if (Object.prototype.toString.call(cfg.routing.rules) !== '[object Array]') cfg.routing.rules = [];
    cfg.routing.rules.unshift({ type:'field', ip:['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','224.0.0.0/4','240.0.0.0/4','::1/128','fc00::/7','fe80::/10'], outboundTag:directTag });
    delete cfg.remarks;
    delete cfg.meta;
    return applyResourcePolicy(cfg);
  }
  function fullConfigEndpoints(config) {
    var result = [], seen = {}, outbounds = config && config.outbounds || [], i, j, item, settings, nodes;
    function add(host, port) { host = String(host || '').trim(); if (!host || seen[host.toLowerCase()]) return; seen[host.toLowerCase()] = true; result.push({ host:host, port:port || '' }); }
    for (i = 0; i < outbounds.length; i++) {
      item = outbounds[i] || {}; settings = item.settings || {};
      nodes = settings.vnext || settings.servers || [];
      for (j = 0; j < nodes.length; j++) add(nodes[j] && (nodes[j].address || nodes[j].server), nodes[j] && nodes[j].port);
      add(settings.address || item.address || item.server, settings.port || item.port || item.server_port);
    }
    return result;
  }
  function routeEnv(profile) {
    var endpoints, v, hosts = [], ports = [], i;
    if (profile && profile.fullConfig && CORE !== 'sing-box') endpoints = fullConfigEndpoints(profile.fullConfig);
    else { v = parseProxyLink(profile.link); endpoints = [{ host:v.host, port:v.port }]; }
    for (i = 0; i < endpoints.length; i++) { hosts.push(endpoints[i].host); if (endpoints[i].port) ports.push(endpoints[i].port); }
    return 'SERVER_HOST=' + shQuote(hosts[0] || '') + '\nSERVER_HOSTS=' + shQuote(hosts.join(' ')) + '\nSERVER_PORT=' + shQuote(ports[0] || '') + '\nPROFILE_ID=' + shQuote(profile.id) + '\nPROFILE_NAME=' + shQuote(profileName(profile)) + '\n';
  }


  function paramsIdentity(params) {
    var skip = { name:1, remarks:1, remark:1, ps:1, title:1 }, keys = [], out = [], k, i;
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
      if (v.protocol === 'hysteria2') return ['hysteria2', String(v.password || ''), String(v.host || '').toLowerCase(), String(v.port || ''), paramsIdentity(p)].join('|');
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
  function cleanServerLabel(text) {
    return String(text || '').replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '').replace(/^[\s·|:-]+|[\s·|:-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  function profileDisplayName(p) { return cleanServerLabel(profileName(p)); }
  function cleanSourceLabel(s) {
    var t = cleanServerLabel(s || '').replace(/\s*[|·]+\s*[|·]+\s*/g, ' | ').replace(/^[\s|·:-]+|[\s|·:-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    return t || tr('servers.subscription');
  }

  function updateHome(statusText) {
    var cur = selectedProfile();
    $('stateText').textContent = statusKnown ? (running ? tr('home.vpnOn') : tr('home.vpnOff')) : tr('common.checking');
    $('stateText').className = 'homeState ' + (statusKnown && running ? 'on' : '');
    var homeStage = $('homeStage');
    if (homeStage) homeStage.className = 'homeStage ' + (statusKnown && running ? 'connected' : '');
    $('hint').textContent = statusKnown ? (running ? tr('home.tapDisconnect') : tr('home.tapConnect')) : tr('common.checking');
    $('power').className = 'power ' + (running ? 'on' : '');
    $('power').disabled = !statusKnown || vpnActionBusy;
    var curEl = $('current');
    if (cur) {
      curEl.className = 'currentCard';
      curEl.innerHTML = '<span class="currentServer"><span class="currentFlagFrame">' + flagImgHtml(profileCountry(cur)) + '</span><span class="currentServerBody"><b>' + esc(profileDisplayName(cur)) + '</b></span></span>';
      bindFlagFallback(curEl);
    } else {
      curEl.className = 'currentCard empty';
      curEl.textContent = tr('home.noServer');
    }
    if (statusText) {
      var m = statusText.match(/Web UI: running[^\n]*url=([^\s]+)/) || statusText.match(/Web URL:\s*([^\s]+)/);
      if (m) { lastWebUrl = m[1]; $('webUrl').textContent = m[1]; }
      if (statusText.indexOf('Web UI:') >= 0 || statusText.indexOf('Web UI started') >= 0 || statusText.indexOf('Web UI already running') >= 0) {
        webRunning = statusText.indexOf('Web UI: running') >= 0 || statusText.indexOf('Web UI started') >= 0 || statusText.indexOf('Web UI already running') >= 0;
        var ws = $('webState');
        if (ws) { ws.textContent = webRunning ? tr('settings.webOn') : tr('settings.webOff'); ws.className = 'rState' + (webRunning ? ' on' : ''); }
        if (m && $('webSub')) $('webSub').textContent = m[1];
      }
    }
  }
  function matchesFilters(p, q) {
    if (protoFilter !== 'all' && profileProto(p) !== protoFilter) return false;
    if (!q) return true;
    var name = profileDisplayName(p), meta = profileMeta(p);
    var src = p.sourceType === 'subscription' ? cleanSourceLabel(p.subscriptionName || tr('servers.subscription')) : tr('servers.manual');
    return (name + ' ' + meta + ' ' + src).toLowerCase().indexOf(q) >= 0;
  }
  var PROTO_BADGE = { vless: 'VLESS', hysteria2: 'HYSTERIA2', trojan: 'TROJAN', vmess: 'VMESS', ss: 'SS', socks: 'SOCKS5' };
  function pingKey(id) { return '$' + String(id || ''); }
  function pingCellHtml(p) {
    var key = pingKey(p.id), value = pingResults[key], cls;
    if (pingPending[key]) return '<span class="pingCell pending"><span class="pingDot"></span>...</span>';
    if (value === null) return '<span class="pingCell unavailable">n/a</span>';
    if (typeof value !== 'number') return '';
    cls = value <= 100 ? 'good' : (value <= 300 ? 'average' : 'poor');
    return '<span class="pingCell ' + cls + '"><span class="pingDot"></span>' + value + ' ms</span>';
  }
  function compareProfileNames(a, b) {
    var an = profileDisplayName(a).toLocaleLowerCase(), bn = profileDisplayName(b).toLocaleLowerCase();
    var cmp = an.localeCompare(bn);
    if (cmp) return cmp;
    return String(a.id || '').localeCompare(String(b.id || ''));
  }
  function compareProfiles(a, b) {
    if (sortMode === 'ping') {
      var av = pingResults[pingKey(a.id)], bv = pingResults[pingKey(b.id)];
      var am = typeof av === 'number', bm = typeof bv === 'number';
      if (am && bm && av !== bv) return av - bv;
      if (am !== bm) return am ? -1 : 1;
    }
    return compareProfileNames(a, b);
  }
  function cardHtml(p) {
    var name = profileDisplayName(p), meta = profileMeta(p), proto = profileProto(p);
    return '<div tabindex="0" class="card ' + (p.id === state.activeId ? 'active' : '') + '" data-id="' + esc(p.id) + '">' +
      flagImgHtml(profileCountry(p)) +
      '<div class="cardBody"><div class="serverTitle">' + esc(name) + '</div><div class="meta">' + esc(meta) + '</div></div>' +
      '<span class="badge">' + (PROTO_BADGE[proto] || String(proto).toUpperCase()) + '</span>' +
      pingCellHtml(p) +
      '<div class="rowActions"><button data-act="select" data-id="' + esc(p.id) + '">' + (p.id === state.activeId ? tr('servers.selected') : tr('servers.select')) + '</button><button data-act="delete" data-id="' + esc(p.id) + '">' + tr('servers.delete') + '</button></div>' +
      '</div>';
  }
  function captureServerListFocus(list) {
    var active = document.activeElement;
    if (!active || !list.contains(active)) return null;
    var card = active;
    var scroller = scrollContainerFor(list);
    while (card && card !== list && !card.classList.contains('card')) card = card.parentNode;
    return {
      id: active.getAttribute && active.getAttribute('data-id') || (card && card.getAttribute('data-id')) || '',
      act: active.getAttribute && active.getAttribute('data-act') || '',
      card: active.classList && active.classList.contains('card'),
      scrollTop: scroller ? scroller.scrollTop : 0
    };
  }
  function restoreServerListFocus(list, token) {
    if (!token) return;
    var items = list.querySelectorAll(token.act ? 'button[data-act]' : '.card'), i, target = null;
    for (i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-id') !== token.id) continue;
      if (token.act && items[i].getAttribute('data-act') !== token.act) continue;
      target = items[i];
      break;
    }
    if (!target) target = list.querySelector('.card');
    var scroller = scrollContainerFor(list);
    if (scroller) scroller.scrollTop = token.scrollTop;
    focusTvElement(target);
  }
  function renderServers() {
    var list = $('serverList');
    if (!list) return;
    var focusToken = captureServerListFocus(list);
    var q = String(($('search') && $('search').value) || '').toLowerCase();
    var i, p, html = '', shown = 0;
    var groups = [], groupIdx = {}, manual = [];
    for (i = 0; i < state.subscriptions.length; i++) {
      groupIdx[state.subscriptions[i].id] = groups.length;
      groups.push({ name: cleanSourceLabel(state.subscriptions[i].name || tr('servers.subscriptionCap')), items: [] });
    }
    var orphan = {};
    for (i = 0; i < state.profiles.length; i++) {
      p = state.profiles[i];
      if (!matchesFilters(p, q)) continue;
      shown++;
      if (p.sourceType === 'subscription' && p.subscriptionId !== undefined && groupIdx[p.subscriptionId] !== undefined) {
        groups[groupIdx[p.subscriptionId]].items.push(p);
      } else if (p.sourceType === 'subscription') {
        if (orphan[p.subscriptionName || ''] === undefined) {
          orphan[p.subscriptionName || ''] = groups.length;
          groups.push({ name: cleanSourceLabel(p.subscriptionName || tr('servers.subscriptionCap')), items: [] });
        }
        groups[orphan[p.subscriptionName || '']].items.push(p);
      } else {
        manual.push(p);
      }
    }
    for (i = 0; i < groups.length; i++) {
      if (!groups[i].items.length) continue;
      groups[i].items.sort(compareProfiles);
      html += '<div class="group"><div class="groupHead"><span class="gname">' + esc(groups[i].name) + '</span><span class="gcount">' + groups[i].items.length + ' ' + trn(groups[i].items.length, 'plural.servers') + '</span></div>';
      html += groups[i].items.map(cardHtml).join('');
      html += '</div>';
    }
    if (manual.length) {
      manual.sort(compareProfiles);
      html += '<div class="group"><div class="groupHead"><span class="gname">' + tr('servers.manualGroup') + '</span><span class="gcount">' + manual.length + ' ' + trn(manual.length, 'plural.profiles') + '</span></div>';
      html += manual.map(cardHtml).join('');
      html += '</div>';
    }
    var nProf = state.profiles.length, nSub = state.subscriptions.length;
    $('count').textContent = nProf + ' ' + trn(nProf, 'plural.servers') + (nSub ? ' · ' + nSub + ' ' + trn(nSub, 'plural.subs') : '');
    updatePingButton();
    if (!html) {
      if (state.profiles.length) html = '<div class="empty-card"><b>' + tr('servers.nothingFound') + '</b><div class="meta">' + tr('servers.nothingFoundHint') + '</div></div>';
      else html = '<div class="empty-card"><b>' + tr('servers.noProfiles') + '</b><div class="meta">' + tr('servers.noProfilesHint') + '</div></div>';
    }
    list.innerHTML = html;
    bindFlagFallback(list);
    var buttons = list.querySelectorAll('button');
    for (i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function (ev) {
        var id = this.getAttribute('data-id'); var act = this.getAttribute('data-act'); ev.stopPropagation();
        if (act === 'select') selectProfile(id);
        else { deleteProfile(id); }
      };
    }
    var cards = list.querySelectorAll('.card');
    for (i = 0; i < cards.length; i++) {
      cards[i].onclick = function () { var id = this.getAttribute('data-id'); if (id) selectProfile(id); };
      cards[i].onkeydown = function (ev) { if ((ev.keyCode === 13 || ev.keyCode === 32) && ev.target === this) { ev.preventDefault(); this.onclick(); } };
    }
    restoreServerListFocus(list, focusToken);
  }
  function profilePingHost(p) {
    var endpoints, host = '';
    try {
      if (p && p.fullConfig) {
        endpoints = fullConfigEndpoints(p.fullConfig);
        host = endpoints[0] && endpoints[0].host || '';
      } else {
        host = parseProxyLink(p.link).host;
      }
    } catch (e) { host = ''; }
    host = String(host || '').trim();
    if (host.charAt(0) === '[' && host.charAt(host.length - 1) === ']') host = host.slice(1, -1);
    if (!host || host.charAt(0) === '-' || !/^[A-Za-z0-9_.:%-]+$/.test(host)) return '';
    return host;
  }
  function updatePingButton() {
    var btn = $('pingServers');
    if (!btn) return;
    btn.disabled = pingBusy || !state.profiles.length;
    btn.textContent = pingBusy ? tr('servers.pinging') : tr('servers.ping');
  }
  function startServerPings() {
    if (pingBusy || !state.profiles.length) return;
    var lines = [], expected = [], i, p, host, encodedId, key;
    pingBusy = true;
    pingResults = {};
    pingPending = {};
    for (i = 0; i < state.profiles.length; i++) {
      p = state.profiles[i]; key = pingKey(p.id); host = profilePingHost(p);
      if (!host) { pingResults[key] = null; continue; }
      encodedId = encodeURIComponent(String(p.id));
      lines.push(encodedId + '|' + host);
      expected.push({ encodedId: encodedId, id: p.id });
      pingPending[key] = true;
    }
    updatePingButton();
    renderServers();
    if (!lines.length) { pingBusy = false; updatePingButton(); log(tr('servers.pingDone')); return; }
    ctl('ping-servers ' + shQuote(b64EncodeUtf8(lines.join('\n') + '\n')), function (out) {
      var seen = {}, rows = String(out || '').split(/\r?\n/), j, match, id, value;
      for (j = 0; j < rows.length; j++) {
        match = rows[j].match(/^PING\t([^\t]+)\t([0-9]+|n\/a)$/);
        if (!match) continue;
        try { id = decodeURIComponent(match[1]); } catch (e) { continue; }
        value = match[2] === 'n/a' ? null : parseInt(match[2], 10);
        pingResults[pingKey(id)] = value;
        seen[match[1]] = true;
      }
      for (j = 0; j < expected.length; j++) if (!seen[expected[j].encodedId]) pingResults[pingKey(expected[j].id)] = null;
      pingPending = {};
      pingBusy = false;
      updatePingButton();
      renderServers();
      log(tr('servers.pingDone'));
    });
  }
  function deleteProfile(id) {
    storeApiRetry('DELETE', '/profiles/' + encodeURIComponent(id), null, function (err, response) {
      if (!err && response && response.store) { useStore(response.store, function () { log(tr('servers.deletedLog')); }); return; }
      log(tr('servers.storeError'));
      loadStore();
    });
  }
  function loadStore(cb) {
    storeApi('GET', '/profiles', null, function (apiErr, response) {
      if (!apiErr && response && response.store) { useStore(response.store, cb, response.revision); return; }
      /* Compatibility fallback for first launch while the local web service starts.
         Never replace an existing list when the command output is truncated. */
      exec('cat ' + shQuote(STORE_FILE) + ' 2>/dev/null', function (e, out) {
        var parsed;
        try { parsed = JSON.parse(out || '{}'); }
        catch (err) { cb && cb(); return; }
        useStore(parsed, cb);
      });
    });
  }
  function refreshStoreIfChanged(cb) {
    if (!storeLoaded || !storeRevision) { loadStore(cb); return; }
    storeApi('GET', '/profiles/meta', null, function (err, response) {
      if (err || !response || !response.revision) { cb && cb(); return; }
      if (String(response.revision) !== storeRevision) { loadStore(cb); return; }
      cb && cb();
    });
  }
  function refreshStatus(cb, silent) {
    ctl('status', function (out) {
      var prev = lastStatus;
      lastStatus = out;
      var isRunning = out.indexOf('Alcyone: running') >= 0;
      var isStopped = out.indexOf('Alcyone: stopped') >= 0;
      if (isRunning || isStopped) {
        running = isRunning;
        statusKnown = true;
      }
      updateHome(out);
      if (!silent && $('log') && out && out !== prev) log(out);
      cb && cb(out, isRunning || isStopped);
    });
  }
  function finishVpnAction(delay) {
    if (vpnActionTimer) clearTimeout(vpnActionTimer);
    vpnActionTimer = setTimeout(function () {
      vpnActionTimer = null;
      refreshStatus(function () { vpnActionBusy = false; updateHome(); }, true);
    }, delay);
  }
  function startVpn() {
    var p = selectedProfile();
    vpnActionBusy = true;
    if (!p) { vpnActionBusy = false; log(tr('vpn.noServer')); updateHome(); return; }
    var cfg;
    try { cfg = JSON.stringify(buildConfig(p), null, 2); } catch (e) { vpnActionBusy = false; log(tr('vpn.profileError') + e.message); updateHome(); return; }
    var cmd = 'mkdir -p ' + shQuote(DATA_DIR) + ' && printf %s ' + shQuote(b64EncodeUtf8(cfg)) + ' | base64 -d > ' + shQuote(CONFIG_FILE) + ' && printf %s ' + shQuote(b64EncodeUtf8(routeEnv(p))) + ' | base64 -d > ' + shQuote(ROUTE_ENV_FILE) + ' && chmod +x ' + shQuote(APP_DIR + '/scripts/alcyonectl.sh') + ' && ' + shQuote(APP_DIR + '/scripts/alcyonectl.sh') + ' start';
    log(tr('vpn.starting') + profileName(p));
    updateHome();
    exec(cmd, function (e, out) { running = out.indexOf('Started') >= 0 || out.indexOf('Routing:') >= 0 || out.indexOf('running') >= 0; log(out || tr('common.done')); updateHome(out); finishVpnAction(1500); });
  }
  function stopVpn() { vpnActionBusy = true; updateHome(); ctl('disconnect', function (out) { running = false; log(out); updateHome(out); finishVpnAction(800); }); }
  function restartVpn() {
    if (vpnActionBusy) return;
    vpnActionBusy = true;
    updateHome();
    ctl('disconnect', function (out) {
      running = false;
      log(out);
      updateHome(out);
      vpnActionBusy = false;
      startVpn();
    });
  }
  function synchronizeRuntime() {
    if (runtimeSyncBusy) { runtimeSyncPending = true; return; }
    runtimeSyncBusy = true;
    refreshStatus(function () {
      ctl('web-start', function (out) {
        log(out);
        updateHome(out);
        loadStore(function () {
          refreshStatus(function () {
            runtimeSyncBusy = false;
            refreshAutostart();
            if (runtimeSyncPending) { runtimeSyncPending = false; synchronizeRuntime(); }
          }, true);
        });
      });
    }, true);
  }
  function onRuntimeVisibility() {
    var hiddenProperty = typeof document.hidden !== 'undefined' ? 'hidden' : 'webkitHidden';
    if (!document[hiddenProperty]) synchronizeRuntime();
  }
  function cleanupRuntimeLifecycle() {
    if (runtimePollTimer) { clearInterval(runtimePollTimer); runtimePollTimer = null; }
    if (vpnActionTimer) { clearTimeout(vpnActionTimer); vpnActionTimer = null; }
    if (restartLabelTimer) { clearTimeout(restartLabelTimer); restartLabelTimer = null; }
    if (!runtimeLifecycleWired || !document.removeEventListener) return;
    var visibilityEvent = typeof document.hidden !== 'undefined' ? 'visibilitychange' : 'webkitvisibilitychange';
    document.removeEventListener(visibilityEvent, onRuntimeVisibility, true);
    document.removeEventListener('webOSRelaunch', synchronizeRuntime, true);
    runtimeLifecycleWired = false;
  }
  function wireRuntimeLifecycle() {
    if (runtimeLifecycleWired) return;
    var hiddenProperty = typeof document.hidden !== 'undefined' ? 'hidden' : 'webkitHidden';
    var visibilityEvent = hiddenProperty === 'hidden' ? 'visibilitychange' : 'webkitvisibilitychange';
    document.addEventListener(visibilityEvent, onRuntimeVisibility, true);
    document.addEventListener('webOSRelaunch', synchronizeRuntime, true);
    runtimeLifecycleWired = true;
  }
  /* подстраницы настроек: в сайдбаре остаётся подсвеченным пункт Настройки */
  var SUB_OF = { logs: 'settings', about: 'settings', donate: 'settings' };
  var RETURN_FOCUS = { logs: 'rowLogs', about: 'rowAbout', donate: 'rowDonate' };
  var dpadMode = false;
  function isTvFocusable(el) {
    if (!el || el.disabled) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function activePageFocusables() {
    var page = document.querySelector('.page.active');
    if (!page) return [];
    var nodes = page.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])');
    var result = [], i;
    for (i = 0; i < nodes.length; i++) if (isTvFocusable(nodes[i])) result.push(nodes[i]);
    return result;
  }
  function allTvFocusables() {
    var nodes = document.querySelectorAll('.nav,.page.active button:not([disabled]),.page.active input:not([disabled]),.page.active [tabindex]:not([tabindex="-1"])');
    var result = [], i;
    for (i = 0; i < nodes.length; i++) if (isTvFocusable(nodes[i])) result.push(nodes[i]);
    return result;
  }
  function scrollContainerFor(el) {
    var node = el && el.parentNode;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('page')) return node;
      node = node.parentNode;
    }
    return null;
  }
  function revealTvElement(el, scroller) {
    if (!scroller || !el || !el.getBoundingClientRect) return;
    var rect = el.getBoundingClientRect();
    var viewport = scroller.getBoundingClientRect();
    if (rect.top < viewport.top) scroller.scrollTop -= viewport.top - rect.top;
    else if (rect.bottom > viewport.bottom) scroller.scrollTop += rect.bottom - viewport.bottom;
  }
  function focusTvElement(el) {
    if (!isTvFocusable(el) || !el.focus) return false;
    var scroller = scrollContainerFor(el);
    var oldTop = scroller ? scroller.scrollTop : 0;
    try { el.focus({ preventScroll: true }); }
    catch (e) { el.focus(); }
    if (scroller) scroller.scrollTop = oldTop;
    revealTvElement(el, scroller);
    return true;
  }
  function perpendicularOverlap(a, b, horizontal) {
    if (horizontal) return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  }
  function directionalFocus(current, keyCode) {
    var items = allTvFocusables(), from = current.getBoundingClientRect();
    var fx = (from.left + from.right) / 2, fy = (from.top + from.bottom) / 2;
    var best = null, bestScore = Infinity, i;
    for (i = 0; i < items.length; i++) {
      var candidate = items[i];
      if (candidate === current) continue;
      var rect = candidate.getBoundingClientRect();
      var cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
      var dx = cx - fx, dy = cy - fy, primary, cross, horizontal;
      if (keyCode === 37 && dx < -4) { primary = -dx; cross = Math.abs(dy); horizontal = true; }
      else if (keyCode === 39 && dx > 4) { primary = dx; cross = Math.abs(dy); horizontal = true; }
      else if (keyCode === 38 && dy < -4) { primary = -dy; cross = Math.abs(dx); horizontal = false; }
      else if (keyCode === 40 && dy > 4) { primary = dy; cross = Math.abs(dx); horizontal = false; }
      else continue;
      var overlap = perpendicularOverlap(from, rect, horizontal);
      var score = primary + cross * (overlap > 0 ? 0.35 : 2.5);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }
  function moveTvFocus(keyCode) {
    var current = document.activeElement;
    var activeNav = document.querySelector('.nav.active');
    if (!isTvFocusable(current) || current === document.body) {
      if (!focusTvElement(activeNav)) return false;
      current = activeNav;
    }
    if (current.id === 'search') {
      if (keyCode === 40) return focusTvElement(document.querySelector('.chip.active') || document.querySelector('.chip'));
      if (keyCode === 39 && (current.selectionStart === undefined || current.selectionStart === current.value.length)) return focusTvElement($('pingServers'));
      if (keyCode === 37 && (current.selectionStart === undefined || current.selectionStart === 0)) return focusTvElement(activeNav);
      if (keyCode === 37 || keyCode === 39) return false;
    }
    if (current.id === 'pingServers') {
      if (keyCode === 37) return focusTvElement($('search'));
      if (keyCode === 39) return focusTvElement($('refresh'));
      if (keyCode === 40) return focusTvElement(document.querySelector('.chip.active') || document.querySelector('.chip'));
    }
    if (current.id === 'refresh') {
      if (keyCode === 37) return focusTvElement($('pingServers'));
      if (keyCode === 39) return focusTvElement($('subUpdate'));
      if (keyCode === 40) return focusTvElement(document.querySelector('.chip.active') || document.querySelector('.chip'));
    }
    if (current.id === 'subUpdate') {
      if (keyCode === 37) return focusTvElement($('refresh'));
      if (keyCode === 40) return focusTvElement(document.querySelector('.chip.active') || document.querySelector('.chip'));
    }
    if (current.classList && current.classList.contains('chip')) {
      var chips = document.querySelectorAll('.chip'), ci = -1, c;
      for (c = 0; c < chips.length; c++) if (chips[c] === current) ci = c;
      if (keyCode === 37 && ci > 0) return focusTvElement(chips[ci - 1]);
      if (keyCode === 39 && ci >= 0 && ci < chips.length - 1) return focusTvElement(chips[ci + 1]);
      if (keyCode === 39 && ci === chips.length - 1) return focusTvElement(document.querySelector('.sortBtn'));
      if (keyCode === 38) return focusTvElement($('search'));
      if (keyCode === 40) return focusTvElement(document.querySelector('#serverList .card'));
    }
    if (current.classList && current.classList.contains('sortBtn')) {
      var sortButtons = document.querySelectorAll('.sortBtn'), sortChips = document.querySelectorAll('.chip'), si = -1, s;
      for (s = 0; s < sortButtons.length; s++) if (sortButtons[s] === current) si = s;
      if (keyCode === 37 && si > 0) return focusTvElement(sortButtons[si - 1]);
      if (keyCode === 37 && si === 0) return focusTvElement(sortChips[sortChips.length - 1]);
      if (keyCode === 39 && si >= 0 && si < sortButtons.length - 1) return focusTvElement(sortButtons[si + 1]);
      if (keyCode === 39 && si === sortButtons.length - 1) return true;
      if (keyCode === 38) return focusTvElement($('subUpdate'));
      if (keyCode === 40) return focusTvElement(document.querySelector('#serverList .card'));
    }
    if (current.classList && current.classList.contains('card')) {
      if (keyCode === 37) return focusTvElement(activeNav);
      if (keyCode === 39) return focusTvElement(current.querySelector('button[data-act="select"]'));
    }
    if (current.getAttribute && current.getAttribute('data-act')) {
      var action = current.getAttribute('data-act');
      var parentCard = current.parentNode && current.parentNode.parentNode;
      if (keyCode === 37 && action === 'select') return focusTvElement(parentCard);
      if (keyCode === 37 && action === 'delete') return focusTvElement(parentCard.querySelector('button[data-act="select"]'));
      if (keyCode === 39 && action === 'select') return focusTvElement(parentCard.querySelector('button[data-act="delete"]'));
      if (keyCode === 39 && action === 'delete') return true;
    }
    if (current.tagName === 'INPUT' && (keyCode === 37 || keyCode === 39)) return false;
    if (current.tagName === 'PRE' && (keyCode === 38 || keyCode === 40)) {
      var delta = keyCode === 38 ? -96 : 96;
      var canScroll = keyCode === 38 ? current.scrollTop > 0 : current.scrollTop + current.clientHeight < current.scrollHeight;
      if (canScroll) { current.scrollTop += delta; return true; }
    }
    if (current.classList && current.classList.contains('nav')) {
      var navs = document.querySelectorAll('.nav'), ni = -1, i;
      for (i = 0; i < navs.length; i++) if (navs[i] === current) ni = i;
      if (keyCode === 38 && ni > 0) return focusTvElement(navs[ni - 1]);
      if (keyCode === 40 && ni >= 0 && ni < navs.length - 1) return focusTvElement(navs[ni + 1]);
      if (keyCode === 39) {
        var pageItems = activePageFocusables();
        return pageItems.length ? focusTvElement(pageItems[0]) : false;
      }
      if (keyCode === 37) return true;
    }
    var next = directionalFocus(current, keyCode);
    if (!next && keyCode === 37) next = activeNav;
    return focusTvElement(next);
  }
  function nav(page, returnFocusId) {
    var i, pages = document.querySelectorAll('.page'), navs = document.querySelectorAll('.nav');
    for (i = 0; i < pages.length; i++) pages[i].classList.remove('active');
    for (i = 0; i < navs.length; i++) navs[i].classList.remove('active');
    $(page).classList.add('active');
    var hl = SUB_OF[page] || page;
    var btn = document.querySelector('[data-page="' + hl + '"]'); if (btn) btn.classList.add('active');
    if (dpadMode) {
      var target = returnFocusId && $(returnFocusId);
      if (!target && !isTvFocusable(document.activeElement)) {
        var pageItems = activePageFocusables();
        target = pageItems[0] || btn;
      }
      if (target) focusTvElement(target);
    }
  }
  function setProtoFilter(proto) {
    protoFilter = proto;
    var chips = document.querySelectorAll('.chip'), i;
    for (i = 0; i < chips.length; i++) chips[i].className = 'chip' + (chips[i].getAttribute('data-proto') === proto ? ' active' : '');
    renderServers();
  }
  function setSortMode(mode) {
    if (mode !== 'name' && mode !== 'ping') return;
    sortMode = mode;
    try { if (window.localStorage) localStorage.setItem(SORT_KEY, mode); } catch (e) {}
    var buttons = document.querySelectorAll('.sortBtn'), i;
    for (i = 0; i < buttons.length; i++) buttons[i].className = 'sortBtn' + (buttons[i].getAttribute('data-sort') === mode ? ' active' : '');
    renderServers();
  }
  function wire() {
    var i, navs = document.querySelectorAll('.nav');
    for (i = 0; i < navs.length; i++) navs[i].onclick = function () { nav(this.getAttribute('data-page')); };
    var chips = document.querySelectorAll('.chip');
    for (i = 0; i < chips.length; i++) chips[i].onclick = function () { setProtoFilter(this.getAttribute('data-proto')); };
    var sortButtons = document.querySelectorAll('.sortBtn');
    for (i = 0; i < sortButtons.length; i++) sortButtons[i].onclick = function () { setSortMode(this.getAttribute('data-sort')); };
    setSortMode(sortMode);
    $('power').onclick = function () {
      if (vpnActionBusy) return;
      vpnActionBusy = true;
      updateHome();
      refreshStatus(function (out, valid) {
        if (!valid) { vpnActionBusy = false; updateHome(); return; }
        if (running) stopVpn(); else startVpn();
      }, true);
    };
    if ($('pingServers')) $('pingServers').onclick = startServerPings;
    if ($('refresh')) $('refresh').onclick = function(){ loadStore(refreshStatus); };
    if ($('subUpdate')) $('subUpdate').onclick = function(){
      var btn = $('subUpdate'); btn.disabled = true; btn.textContent = tr('servers.subUpdating');
      log(tr('servers.subUpdatingLog'));
      ctl('sub-update', function(out){ btn.disabled = false; btn.textContent = tr('servers.subUpdate'); log(out); loadStore(); });
    };
    if ($('search')) $('search').oninput = renderServers;
    /* --- настройки: строки-действия --- */
    if ($('rowRestart')) $('rowRestart').onclick = function(){
      if (vpnActionBusy) return;
      var s = $('restartSub'); if (s) s.textContent = tr('settings.restarting');
      restartVpn();
      if (restartLabelTimer) clearTimeout(restartLabelTimer);
      restartLabelTimer = setTimeout(function(){ restartLabelTimer = null; if (s) s.textContent = tr('settings.restartSub'); }, 15000);
    };
    if ($('rowCheckIp')) $('rowCheckIp').onclick = function(){
      var s = $('checkIpSub'); if (s) s.textContent = tr('settings.checking');
      ctl('ip-test', function(out){
        log(out);
        var tun = String(out || '').match(/IP (?:via VPN|via tun0):\s*(\S+)/);
        var direct = String(out || '').match(/IP (?:direct|default route):\s*(\S+)/);
        function shownIp(match) { return match && match[1] !== 'failed' ? match[1] : tr('settings.unavailable'); }
        if (!s) return;
        if (tun || direct) s.textContent = (tun ? tr('settings.viaVpn') + shownIp(tun) : '') + (tun && direct ? ' · ' : '') + (direct ? tr('settings.direct') + shownIp(direct) : '');
        else s.textContent = tr('settings.ipFail');
      });
    };
    if ($('rowLang')) $('rowLang').onclick = function(){
      setLang(langSetting === 'auto' ? 'ru' : (langSetting === 'ru' ? 'en' : 'auto'));
    };
    if ($('rowAutostart')) $('rowAutostart').onclick = function(){
      var el = $('autostartState'); if (el) el.textContent = '...';
      ctl(autostartOn ? 'remove-autostart' : 'install-autostart', function(out){ log(out); refreshAutostart(); });
    };
    if ($('rowWeb')) $('rowWeb').onclick = function(){
      var el = $('webState'); if (el) el.textContent = '...';
      ctl(webRunning ? 'web-stop' : 'web-start', function(out){ log(out); refreshStatus(null, true); });
    };
    /* --- подстраницы --- */
    if ($('rowLogs')) $('rowLogs').onclick = function(){ nav('logs'); fetchTunnelLogs(); };
    if ($('rowAbout')) $('rowAbout').onclick = function(){ nav('about'); };
    if ($('rowDonate')) $('rowDonate').onclick = function(){ nav('donate'); };
    if ($('rowDonate2')) $('rowDonate2').onclick = function(){ nav('donate'); };
    var backs = document.querySelectorAll('.backBtn');
    for (i = 0; i < backs.length; i++) backs[i].onclick = function(){
      var from = this.parentNode && this.parentNode.parentNode && this.parentNode.parentNode.id;
      nav(this.getAttribute('data-back') || 'settings', RETURN_FOCUS[from]);
    };
    document.addEventListener('keydown', function(ev){
      if (ev.keyCode >= 37 && ev.keyCode <= 40) {
        dpadMode = true;
        document.body.classList.add('dpad-mode');
        if (moveTvFocus(ev.keyCode)) ev.preventDefault();
        return;
      }
      if (ev.keyCode === 13 && dpadMode && !ev.defaultPrevented) {
        var focused = document.activeElement;
        if (focused && (focused.tagName === 'BUTTON' || (focused.classList && focused.classList.contains('card')))) {
          ev.preventDefault();
          focused.click();
          return;
        }
      }
      if (ev.keyCode === 461 || ev.keyCode === 27) { /* BACK на пульте LG / Esc */
        var active = document.querySelector('.page.active');
        if (active && SUB_OF[active.id]) { ev.preventDefault(); nav('settings', RETURN_FOCUS[active.id]); }
      }
    });
    /* --- логи --- */
    if ($('logsRefresh')) $('logsRefresh').onclick = fetchTunnelLogs;
    if ($('clearLog')) $('clearLog').onclick = function(){
      if (logsBusy) return;
      logsBusy = true;
      var btn = $('clearLog'); if (btn) btn.disabled = true;
      ctl('clear-logs', function(out){
        logsBusy = false;
        if (btn) btn.disabled = false;
        if (String(out || '').indexOf('ERROR:') >= 0) { log(tr('logs.clearFailed') + '\n' + out, true); return; }
        if ($('log')) $('log').textContent = '';
        lastLogText = '';
        log(tr('logs.cleared'), true);
      });
    };
    if ($('freezeLog')) $('freezeLog').onclick = function(){ log(tr('logs.frozen'), true); };
  }
  var autostartOn = false;
  var autostartKnown = false;
  function refreshAutostart() {
    exec('[ -f ' + shQuote(AUTOSTART_FILE) + ' ] && echo autostart-on || echo autostart-off', function (e, out) {
      autostartOn = String(out || '').indexOf('autostart-on') >= 0;
      autostartKnown = true;
      var el = $('autostartState');
      if (el) { el.textContent = autostartOn ? tr('settings.on') : tr('settings.off'); el.className = 'rState' + (autostartOn ? ' on' : ''); }
    });
  }
  var logsBusy = false;
  function fetchTunnelLogs() {
    if (logsBusy) return;
    logsBusy = true;
    var btn = $('logsRefresh'); if (btn) { btn.disabled = true; btn.textContent = tr('logs.loading'); }
    ctl('logs', function (out) {
      logsBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = tr('logs.refresh'); }
      log(tr('logs.header') + '\n' + (out || tr('logs.empty')), true);
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    applyEditionUi();
    applyI18n();
    var langEl0 = $('langState'); if (langEl0) langEl0.textContent = langLabel();
    fetchSystemLocale();
    wire();
    wireRuntimeLifecycle();
    if (!hasBridge()) log(tr('app.noBridge'));
    synchronizeRuntime();
    runtimePollTimer = setInterval(function(){ if (!document.hidden && !document.webkitHidden) refreshStoreIfChanged(function(){ refreshStatus(null, true); }); }, 15000);
    if (window.addEventListener) window.addEventListener('unload', cleanupRuntimeLifecycle, false);
  });
})();
