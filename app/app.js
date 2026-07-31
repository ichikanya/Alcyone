/* Alcyone for LG webOS rooted TVs.

   The frontend is a presentation layer only. It never builds a shell command,
   never touches the filesystem and never sees a proxy link, UUID, password or
   subscription URL: it calls narrowly scoped Luna methods on the Alcyone
   service and renders the sanitized metadata it gets back. */
(function () {
  'use strict';
  var EDITION = window.ALCYONE_EDITION || {
    appId: 'com.alcyone.vpn',
    serviceId: 'com.alcyone.vpn.service',
    core: 'xray',
    coreLabel: 'XRay',
    editionName: 'XRay Edition',
    title: 'Alcyone XRay',
    version: '4.0.3'
  };
  var APP_VERSION = EDITION.version;
  var CORE = EDITION.core;
  var SERVICE = 'luna://' + (EDITION.serviceId || (EDITION.appId + '.service'));
  var COUNTRIES = window.ALCYONE_COUNTRIES || {
    nativeSrc: function () { return 'flags/un.svg'; }
  };

  /* Sanitized view of the store, as returned by the service. */
  var state = { profiles: [], subscriptions: [], activeId: null, lang: 'auto' };
  var running = false;
  var statusKnown = false;
  var vpnActionBusy = false;
  var restartLabelTimer = null;
  var runtimeSyncBusy = false;
  var runtimeSyncPending = false;
  var runtimeLifecycleWired = false;
  var runtimePollTimer = null;
  var pairingTimer = null;
  var pairingInfo = null;
  var lastWebUrl = '';
  var storeRevision = '';
  var protoFilter = 'all';
  var storeLoaded = false;
  /* Elevation state, all derived from the service's sanitized getState. */
  var healthCode = '';
  var privilegeRoot = null;
  /* The Homebrew prerequisite is five distinct states, not a tri-state boolean.
     The distinction that matters is between "checkRoot completed and said no"
     and "we were unable to ask": only the first is a verdict. A transport
     failure, a timeout or an LS2 error produces no verdict at all, must stay
     retryable, and must never be cached as an unmet prerequisite. */
  var HB_UNKNOWN = 'unknown';
  var HB_CHECKING = 'checking';
  var HB_ROOT = 'root';
  var HB_UNSUPPORTED = 'unsupported';
  var HB_CHECK_FAILED = 'check-failed';
  var homebrewState = HB_UNKNOWN;
  var elevationBusy = false;
  var automaticElevationAttempted = false;
  var automaticElevationInProgress = false;
  var elevationPollTimer = null;
  var elevationMessage = '';
  var probeResults = {};
  var probePending = {};
  var probeBusy = false;
  var autostartOn = false;
  var autostartKnown = false;
  var logsBusy = false;
  var sortMode = 'name';
  var SORT_KEY = 'alcyone.serverSort';
  try {
    var savedSort = window.localStorage && localStorage.getItem(SORT_KEY);
    if (savedSort === 'name' || savedSort === 'ping') sortMode = savedSort;
  } catch (eSort) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

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
    if (wasNearBottom) el.scrollTop = el.scrollHeight; else el.scrollTop = oldTop;
  }

  function hasBridge() {
    return !!((window.webOS && webOS.service && webOS.service.request) ||
      window.PalmServiceBridge || window.WebOSServiceBridge);
  }

  /* Every Luna call must settle, always.

     Luna reports nothing when a service fails to launch, is refused by the bus
     or dies mid-request: the request simply never comes back. Without a
     deadline the callback never runs, so the button that was disabled on the
     way in stays disabled and its "Loading..." label never clears. That is
     exactly how the log viewer and the import row appeared frozen. */
  var LUNA_TIMEOUT_MS = 12000;

  /* PalmServiceBridge hands its reply to a native object. A bridge referenced
     only by a local variable can be collected before that reply arrives, which
     silently drops the response — the same visible symptom, but intermittent
     and worse under the memory pressure of a TV. Hold every in-flight bridge
     until it settles. */
  var pendingBridges = {};
  var bridgeSeq = 0;

  /* Single channel to the backend: a scoped Luna method with a JSON payload.
     There is no shell, no command string and no local HTTP client.

     `lunaAt` exists only so a second, fixed service URI can be addressed with
     the same transport and the same in-flight bridge accounting. The target is
     always a constant from this file — never anything derived from user input,
     a profile or a subscription. */
  function luna(method, params, cb) {
    lunaAt(SERVICE, method, params, LUNA_TIMEOUT_MS, cb);
  }

  function lunaAt(service, method, params, timeoutMs, cb) {
    var uri = service + '/' + method;
    var done = false;
    var timer = null;
    var key = '';
    function finish(error, result) {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (key) { delete pendingBridges[key]; key = ''; }
      if (cb) cb(error, result);
    }
    timer = setTimeout(function () {
      finish({ errorCode: 'SERVICE_TIMEOUT' }, null);
    }, timeoutMs || LUNA_TIMEOUT_MS);

    if (window.webOS && webOS.service && webOS.service.request) {
      webOS.service.request(service, {
        method: method,
        parameters: params || {},
        onSuccess: function (r) { finish(null, r); },
        onFailure: function (e) { finish(e || { errorCode: 'SERVICE_UNAVAILABLE' }, null); }
      });
      return;
    }
    var Bridge = window.PalmServiceBridge || window.WebOSServiceBridge;
    if (!Bridge) { finish({ errorCode: 'SERVICE_UNAVAILABLE' }, null); return; }
    var bridge = new Bridge();
    key = 'b' + (++bridgeSeq);
    pendingBridges[key] = bridge;
    bridge.onservicecallback = function (raw) {
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      if (!parsed || parsed.returnValue === false) return finish(parsed || { errorCode: 'SERVICE_UNAVAILABLE' }, null);
      finish(null, parsed);
    };
    try {
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      finish({ errorCode: 'SERVICE_UNAVAILABLE' }, null);
    }
  }

  /* Map a structured backend code to a localized message. Backend text is
     never shown directly: it is English diagnostics, not UI copy. */
  function errorText(error) {
    var code = (error && (error.errorCode || error.code)) || '';
    var key = 'err.' + code;
    var translated = tr(key);
    if (translated !== key) return translated;
    return tr('err.generic') + (code || 'UNKNOWN');
  }

  /* ---------- country flags (native bundled SVG assets) ---------- */
  function flagSrc(code) {
    return COUNTRIES.nativeSrc(code);
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

  /* ---------- i18n (RU / EN, auto by region) ---------- */
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
      'home.webOff': 'Выключен',
      'home.webHintOff': 'Включите импорт в Настройках, чтобы временно открыть доступ с телефона или ПК',
      'home.webHint': 'Откройте адрес в браузере телефона или ПК и введите код с экрана',
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
      'settings.checkIpSub': 'Показать текущий внешний IPv4-адрес',
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
      'logs.service': '--- Служба Alcyone ---',
      'logs.core': '--- Ядро VPN ---',
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
      'settings.lanImport': 'Импорт по сети',
      'settings.lanImportSub': 'Временный доступ с телефона или ПК',
      'pair.title': 'Импорт по локальной сети',
      'pair.sub': 'Откройте адрес в браузере и введите код',
      'pair.start': 'Разрешить на 5 минут',
      'pair.stop': 'Закрыть доступ',
      'pair.code': 'Код сопряжения',
      'pair.address': 'Адрес',
      'pair.expires': 'Действует ещё ',
      'pair.seconds': ' сек',
      'pair.closed': 'Доступ закрыт',
      'pair.warning': 'Соединение по локальной сети не шифруется. Используйте только доверенную домашнюю сеть.',
      'elev.title': 'Нужны права root',
      'elev.text': 'Служба Alcyone запущена без прав root. Это происходит после каждой установки или обновления пакета. Нажмите «Выдать права» — служба перезапустится сама.',
      'elev.grant': 'Выдать права',
      'elev.preparingTitle': 'Подготовка разрешений',
      'elev.preparing': 'Подготавливаем разрешения. Это займёт немного времени.',
      'elev.working': 'Выдаю права...',
      'elev.restarting': 'Перезапускаю службу...',
      'elev.waiting': 'Жду перезапуск службы...',
      'elev.done': 'Права выданы, служба перезапущена',
      'elev.failed': 'Не удалось выдать права. Убедитесь, что Homebrew Channel установлен и запущен с правами root, затем попробуйте ещё раз.',
      'elev.timeout': 'Служба не перезапустилась с правами root за отведённое время. Попробуйте ещё раз.',
      'hb.title': 'Требуется root-доступ на телевизоре',
      'hb.text': 'Alcyone работает только на телевизорах LG с root-доступом, где установлен Homebrew Channel и запущен с правами root. Включение VPN недоступно, пока это условие не выполнено.',
      'hb.checkTitle': 'Проверка требований',
      'hb.checkText': 'Проверяем Homebrew Channel. Включение VPN станет доступно, когда проверка завершится.',
      'err.NO_ACTIVE_PROFILE': 'Сервер не выбран',
      'err.HOMEBREW_REQUIRED': 'Нужен телевизор с root-доступом и Homebrew Channel, запущенным с правами root',
      'err.ELEVATION_REQUIRED': 'Служба Alcyone запущена без прав root — нажмите «Выдать права» на главном экране',
      'err.ELEVATION_FAILED': 'Не удалось выдать права службе Alcyone',
      'err.PACKAGE_INCOMPLETE': 'Пакет приложения установлен не полностью',
      'err.CORE_MISSING': 'Ядро VPN не найдено в пакете',
      'err.CORE_INTEGRITY_FAILED': 'Ядро VPN повреждено или собрано для другой архитектуры',
      'err.ASSET_MISSING': 'Не найден обязательный файл данных XRay',
      'err.ASSET_CORRUPT': 'Повреждён обязательный файл данных XRay',
      'err.ASSET_INTEGRITY_FAILED': 'Обязательный файл данных XRay не прошёл проверку целостности',
      'err.CORE_START_FAILED': 'Не удалось запустить ядро VPN',
      'err.ENDPOINT_RESOLUTION_FAILED': 'Не удалось разрешить адрес выбранного VPN-сервера',
      'err.ENDPOINT_UNREACHABLE': 'Выбранный VPN-сервер недоступен',
      'err.TUN_NOT_READY': 'Интерфейс tun0 не был создан',
      'err.ROUTE_FAILED': 'Не удалось настроить маршруты',
      'err.HEALTH_CHECK_FAILED': 'Маршрут через туннель не активен',
      'err.NETWORK_CHANGED': 'Сеть изменилась, VPN отключён для восстановления маршрута',
      'err.TUNNEL_OWNED_BY_OTHER_EDITION': 'Туннелем управляет другая редакция Alcyone',
      'err.TLS_CERTIFICATE_INVALID': 'Неверный сертификат сервера подписки',
      'err.BLOCKED_ADDRESS': 'Адрес подписки запрещён',
      'err.BLOCKED_SCHEME': 'Поддерживаются только http и https',
      'err.HTTPS_DOWNGRADE_REJECTED': 'Сервер подписки попытался перенаправить защищённое соединение на HTTP',
      'err.URL_CREDENTIALS_REJECTED': 'Ссылка с логином и паролем не поддерживается',
      'err.TIMEOUT': 'Таймаут запроса',
      'err.NETWORK_ERROR': 'Ошибка сети',
      'err.NO_SERVERS_FOUND': 'В подписке не найдено серверов',
      'err.RESPONSE_TOO_LARGE': 'Ответ слишком большой',
      'err.UNSUPPORTED_TRANSPORT': 'Транспорт не поддерживается этой редакцией',
      'err.SERVICE_UNAVAILABLE': 'Служба Alcyone недоступна',
      'err.SERVICE_TIMEOUT': 'Служба Alcyone не отвечает. Проверьте, что служба запущена с правами root (elevate-service).',
      'err.generic': 'Ошибка: ',
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
      'home.webOff': 'Off',
      'home.webHintOff': 'Enable import in Settings to open temporary access from a phone or PC',
      'home.webHint': 'Open this address in your phone or PC browser and enter the code shown on screen',
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
      'settings.checkIpSub': 'Show the current external IPv4 address',
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
      'logs.service': '--- Alcyone service ---',
      'logs.core': '--- VPN core ---',
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
      'settings.lanImport': 'Network import',
      'settings.lanImportSub': 'Temporary access from a phone or PC',
      'pair.title': 'Local network import',
      'pair.sub': 'Open the address in a browser and enter the code',
      'pair.start': 'Allow for 5 minutes',
      'pair.stop': 'Close access',
      'pair.code': 'Pairing code',
      'pair.address': 'Address',
      'pair.expires': 'Valid for another ',
      'pair.seconds': ' s',
      'pair.closed': 'Access closed',
      'pair.warning': 'The LAN connection is not encrypted. Use only on a trusted home network.',
      'elev.title': 'Root permissions required',
      'elev.text': 'The Alcyone service is running without root. This happens after every package install or upgrade. Press Grant permissions — the service restarts itself.',
      'elev.grant': 'Grant permissions',
      'elev.preparingTitle': 'Preparing permissions',
      'elev.preparing': 'Preparing permissions. This will only take a moment.',
      'elev.working': 'Granting permissions...',
      'elev.restarting': 'Restarting the service...',
      'elev.waiting': 'Waiting for the service to restart...',
      'elev.done': 'Permissions granted, service restarted',
      'elev.failed': 'Could not grant permissions. Check that Homebrew Channel is installed and running as root, then try again.',
      'elev.timeout': 'The service did not come back as root in time. Please try again.',
      'hb.title': 'A rooted TV is required',
      'hb.text': 'Alcyone runs only on rooted LG TVs with Homebrew Channel installed and running as root. VPN activation stays unavailable until that requirement is met.',
      'hb.checkTitle': 'Checking requirements',
      'hb.checkText': 'Checking Homebrew Channel. VPN activation becomes available once the check completes.',
      'err.NO_ACTIVE_PROFILE': 'No server selected',
      'err.HOMEBREW_REQUIRED': 'A rooted TV with Homebrew Channel running as root is required',
      'err.ELEVATION_REQUIRED': 'The Alcyone service is not running as root — press Grant permissions on the Home screen',
      'err.ELEVATION_FAILED': 'Could not grant root permissions to the Alcyone service',
      'err.PACKAGE_INCOMPLETE': 'The application package is not fully installed',
      'err.CORE_MISSING': 'The VPN core is missing from the package',
      'err.CORE_INTEGRITY_FAILED': 'The VPN core is damaged or built for a different architecture',
      'err.ASSET_MISSING': 'A required XRay data file is missing',
      'err.ASSET_CORRUPT': 'A required XRay data file is corrupt',
      'err.ASSET_INTEGRITY_FAILED': 'A required XRay data file failed its integrity check',
      'err.CORE_START_FAILED': 'The VPN core failed to start',
      'err.ENDPOINT_RESOLUTION_FAILED': 'Could not resolve the selected VPN server',
      'err.ENDPOINT_UNREACHABLE': 'The selected VPN server is unreachable',
      'err.TUN_NOT_READY': 'The tun0 interface was not created',
      'err.ROUTE_FAILED': 'Could not configure routes',
      'err.HEALTH_CHECK_FAILED': 'The tunnel route is not active',
      'err.NETWORK_CHANGED': 'The network changed; VPN was disconnected to restore routing',
      'err.TUNNEL_OWNED_BY_OTHER_EDITION': 'Another Alcyone edition controls the tunnel',
      'err.TLS_CERTIFICATE_INVALID': 'Invalid subscription server certificate',
      'err.BLOCKED_ADDRESS': 'The subscription address is not allowed',
      'err.BLOCKED_SCHEME': 'Only http and https are supported',
      'err.HTTPS_DOWNGRADE_REJECTED': 'The subscription server tried to downgrade a secure connection to HTTP',
      'err.URL_CREDENTIALS_REJECTED': 'URLs with a username and password are not supported',
      'err.TIMEOUT': 'Request timed out',
      'err.NETWORK_ERROR': 'Network error',
      'err.NO_SERVERS_FOUND': 'No servers found in the subscription',
      'err.RESPONSE_TOO_LARGE': 'The response is too large',
      'err.UNSUPPORTED_TRANSPORT': 'This transport is not supported by this edition',
      'err.SERVICE_UNAVAILABLE': 'The Alcyone service is unavailable',
      'err.SERVICE_TIMEOUT': 'The Alcyone service is not responding. Check that it runs elevated (elevate-service).',
      'err.generic': 'Error: ',
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
    els = document.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < els.length; i++) { k = els[i].getAttribute('data-i18n-aria'); if (k) els[i].setAttribute('aria-label', tr(k)); }
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
    updateProbeButton();
    renderElevation();
    updateHome();
    renderServers();
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
    if (storeLoaded) luna('setLanguage', { lang: v }, function () {});
    updateLangUi();
  }
  function fetchSystemLocale() {
    if (!(window.webOS && webOS.service && webOS.service.request)) return;
    webOS.service.request('luna://com.webos.settingsservice', {
      method: 'getSystemSettings',
      parameters: { keys: ['localeInfo'] },
      onSuccess: function (r) {
        var loc = '';
        try {
          var li = r && r.settings && r.settings.localeInfo;
          if (li) loc = (li.locales && (li.locales.UI || li.locales.TV)) || li.locale || '';
        } catch (e) {}
        if (typeof loc !== 'string') loc = '';
        if (loc && loc !== sysLocale) { sysLocale = loc; if (langSetting === 'auto') updateLangUi(); }
      },
      onFailure: function () {}
    });
  }

  var SUB_OF = { logs: 'settings', about: 'settings', donate: 'settings', pair: 'settings' };
  var RETURN_FOCUS = { logs: 'rowLogs', about: 'rowAbout', donate: 'rowDonate', pair: 'rowPair' };
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

  /* ---------- rendering ---------- */

  function selectedProfile() {
    var i;
    for (i = 0; i < state.profiles.length; i++) if (state.profiles[i].id === state.activeId) return state.profiles[i];
    return null;
  }
  function profileDisplayName(p) { return (p && p.name) || 'VPN'; }
  function profileCountry(p) { return (p && p.country) || ''; }
  function profileMeta(p) {
    if (!p) return '';
    var parts = [];
    if (p.endpoint) parts.push(p.endpoint);
    if (p.protocol) parts.push(p.protocol);
    if (p.security && p.security !== 'none') parts.push(p.security);
    if (p.transport && p.transport !== 'tcp') parts.push(p.transport);
    return parts.join(' · ');
  }

  function updateHome() {
    var cur = selectedProfile();
    $('stateText').textContent = statusKnown ? (running ? tr('home.vpnOn') : tr('home.vpnOff')) : tr('common.checking');
    $('stateText').className = 'homeState ' + (statusKnown && running ? 'on' : '');
    var homeStage = $('homeStage');
    if (homeStage) homeStage.className = 'homeStage ' + (statusKnown && running ? 'connected' : '');
    $('hint').textContent = statusKnown ? (running ? tr('home.tapDisconnect') : tr('home.tapConnect')) : tr('common.checking');
    $('power').className = 'power ' + (running ? 'on' : '');
    /* An unmet hard prerequisite makes VPN activation unavailable outright.
       This is not a degraded mode with a workaround: the control is disabled
       and the banner states the requirement. */
    $('power').disabled = !statusKnown || vpnActionBusy || !vpnActivationAllowed();
    renderElevation();
    var curEl = $('current');
    if (cur) {
      curEl.className = 'currentCard';
      curEl.innerHTML = '<span class="currentServer"><span class="currentFlagFrame">' +
        flagImgHtml(profileCountry(cur)) + '</span><span class="currentServerBody"><b>' +
        esc(profileDisplayName(cur)) + '</b></span></span>';
      bindFlagFallback(curEl);
    } else {
      curEl.className = 'currentCard empty';
      curEl.textContent = tr('home.noServer');
    }
    renderPairing();
  }

  function matchesFilters(p, q) {
    if (protoFilter !== 'all' && String(p.protocol) !== protoFilter) return false;
    if (!q) return true;
    var src = p.sourceType === 'subscription' ? (p.subscriptionName || tr('servers.subscription')) : tr('servers.manual');
    return (profileDisplayName(p) + ' ' + profileMeta(p) + ' ' + src).toLowerCase().indexOf(q) >= 0;
  }

  var PROTO_BADGE = { vless: 'VLESS', hysteria2: 'HYSTERIA2', trojan: 'TROJAN', vmess: 'VMESS', ss: 'SS', socks: 'SOCKS5' };
  function probeKey(id) { return '$' + String(id || ''); }
  function probeCellHtml(p) {
    var key = probeKey(p.id), value = probeResults[key], cls;
    if (probePending[key]) return '<span class="pingCell pending"><span class="pingDot"></span>...</span>';
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
      var av = probeResults[probeKey(a.id)], bv = probeResults[probeKey(b.id)];
      var am = typeof av === 'number', bm = typeof bv === 'number';
      if (am && bm && av !== bv) return av - bv;
      if (am !== bm) return am ? -1 : 1;
    }
    return compareProfileNames(a, b);
  }
  function cardHtml(p) {
    return '<div tabindex="0" class="card ' + (p.id === state.activeId ? 'active' : '') + '" data-id="' + esc(p.id) + '">' +
      flagImgHtml(profileCountry(p)) +
      '<div class="cardBody"><div class="serverTitle">' + esc(profileDisplayName(p)) +
      '</div><div class="meta">' + esc(profileMeta(p)) + '</div></div>' +
      '<span class="badge">' + (PROTO_BADGE[p.protocol] || String(p.protocol).toUpperCase()) + '</span>' +
      probeCellHtml(p) +
      '<div class="rowActions"><button data-act="select" data-id="' + esc(p.id) + '">' +
      (p.id === state.activeId ? tr('servers.selected') : tr('servers.select')) +
      '</button><button data-act="delete" data-id="' + esc(p.id) + '">' + tr('servers.delete') + '</button></div>' +
      '</div>';
  }
  function captureServerListFocus(list) {
    var active = document.activeElement;
    if (!active || !list.contains(active)) return null;
    var card = active;
    var scroller = scrollContainerFor(list);
    while (card && card !== list && !card.classList.contains('card')) card = card.parentNode;
    return {
      id: (active.getAttribute && active.getAttribute('data-id')) || (card && card.getAttribute('data-id')) || '',
      act: (active.getAttribute && active.getAttribute('data-act')) || '',
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
    var i, p, html = '';
    var groups = [], groupIdx = {}, manual = [], orphan = {};
    for (i = 0; i < state.subscriptions.length; i++) {
      groupIdx[state.subscriptions[i].id] = groups.length;
      groups.push({ name: state.subscriptions[i].name || tr('servers.subscriptionCap'), items: [] });
    }
    for (i = 0; i < state.profiles.length; i++) {
      p = state.profiles[i];
      if (!matchesFilters(p, q)) continue;
      if (p.sourceType === 'subscription' && p.subscriptionId && groupIdx[p.subscriptionId] !== undefined) {
        groups[groupIdx[p.subscriptionId]].items.push(p);
      } else if (p.sourceType === 'subscription') {
        if (orphan[p.subscriptionName || ''] === undefined) {
          orphan[p.subscriptionName || ''] = groups.length;
          groups.push({ name: p.subscriptionName || tr('servers.subscriptionCap'), items: [] });
        }
        groups[orphan[p.subscriptionName || '']].items.push(p);
      } else {
        manual.push(p);
      }
    }
    for (i = 0; i < groups.length; i++) {
      if (!groups[i].items.length) continue;
      groups[i].items.sort(compareProfiles);
      html += '<div class="group"><div class="groupHead"><span class="gname">' + esc(groups[i].name) +
        '</span><span class="gcount">' + groups[i].items.length + ' ' + trn(groups[i].items.length, 'plural.servers') +
        '</span></div>' + groups[i].items.map(cardHtml).join('') + '</div>';
    }
    if (manual.length) {
      manual.sort(compareProfiles);
      html += '<div class="group"><div class="groupHead"><span class="gname">' + tr('servers.manualGroup') +
        '</span><span class="gcount">' + manual.length + ' ' + trn(manual.length, 'plural.profiles') +
        '</span></div>' + manual.map(cardHtml).join('') + '</div>';
    }
    var nProf = state.profiles.length, nSub = state.subscriptions.length;
    $('count').textContent = nProf + ' ' + trn(nProf, 'plural.servers') +
      (nSub ? ' · ' + nSub + ' ' + trn(nSub, 'plural.subs') : '');
    updateProbeButton();
    if (!html) {
      html = state.profiles.length
        ? '<div class="empty-card"><b>' + tr('servers.nothingFound') + '</b><div class="meta">' + tr('servers.nothingFoundHint') + '</div></div>'
        : '<div class="empty-card"><b>' + tr('servers.noProfiles') + '</b><div class="meta">' + tr('servers.noProfilesHint') + '</div></div>';
    }
    list.innerHTML = html;
    bindFlagFallback(list);
    var buttons = list.querySelectorAll('button');
    for (i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function (ev) {
        var id = this.getAttribute('data-id'), act = this.getAttribute('data-act');
        ev.stopPropagation();
        if (act === 'select') selectProfile(id); else deleteProfile(id);
      };
    }
    var cards = list.querySelectorAll('.card');
    for (i = 0; i < cards.length; i++) {
      cards[i].onclick = function () { var id = this.getAttribute('data-id'); if (id) selectProfile(id); };
      cards[i].onkeydown = function (ev) {
        if ((ev.keyCode === 13 || ev.keyCode === 32) && ev.target === this) { ev.preventDefault(); this.onclick(); }
      };
    }
    restoreServerListFocus(list, focusToken);
  }

  /* ---------- store synchronization ---------- */

  function applyStore(result) {
    state.profiles = (result && result.profiles) || [];
    state.subscriptions = (result && result.subscriptions) || [];
    state.activeId = (result && result.activeId) || null;
    state.lang = (result && result.lang) || 'auto';
    if (result && result.revision) storeRevision = String(result.revision);
    storeLoaded = true;
    if (state.lang && !hasStoredLang && state.lang !== langSetting) {
      langSetting = state.lang;
      try { if (window.localStorage) localStorage.setItem(LANG_KEY, langSetting); } catch (e) {}
      hasStoredLang = true;
      updateLangUi();
    }
    renderServers();
    updateHome();
  }

  function loadStore(cb) {
    luna('getProfiles', {}, function (error, result) {
      if (error) { log(errorText(error)); cb && cb(); return; }
      applyStore(result);
      cb && cb();
    });
  }

  function refreshStoreIfChanged(cb) {
    if (!storeLoaded || !storeRevision) { loadStore(cb); return; }
    luna('getProfilesMeta', {}, function (error, result) {
      if (error || !result || !result.revision) { cb && cb(); return; }
      if (String(result.revision) !== storeRevision) { loadStore(cb); return; }
      cb && cb();
    });
  }

  /* Forward the read-only prerequisite verdict once we actually have one, so
     the service's ordered health gate stays authoritative. A boolean is the
     only thing ever sent, and it can only make that gate stricter. */
  function pollParams() {
    if (homebrewState === HB_ROOT) return { homebrewRoot: true };
    if (homebrewState === HB_UNSUPPORTED) return { homebrewRoot: false };
    /* Unknown, in flight, or a check that failed to complete: send nothing, so
       the service never caches a verdict that was never obtained. */
    return {};
  }

  function applyState(result) {
      running = !!(result.vpn && result.vpn.connected);
      statusKnown = true;
      autostartOn = !!result.autostart;
      autostartKnown = true;
      healthCode = (result.health && result.health.code) || '';
      privilegeRoot = result.privilege && result.privilege.root !== undefined
        ? result.privilege.root : null;
      var lanPort = (result.lan && result.lan.port) || (pairingInfo && pairingInfo.port) || 0;
      var lanAddrs = (result.lan && result.lan.addresses && result.lan.addresses.length)
        ? result.lan.addresses
        : ((pairingInfo && pairingInfo.addresses) || []);
      pairingInfo = result.lan && result.lan.pairingActive
        ? {
            secondsRemaining: result.lan.secondsRemaining,
            code: (pairingInfo && pairingInfo.code) || '',
            addresses: lanAddrs,
            port: lanPort
          }
        : null;
      var autostartEl = $('autostartState');
      if (autostartEl) {
        autostartEl.textContent = autostartOn ? tr('settings.on') : tr('settings.off');
        autostartEl.className = 'rState' + (autostartOn ? ' on' : '');
      }
      updateHome();
  }

  function refreshState(cb) {
    luna('getState', pollParams(), function (error, result) {
      if (error) { statusKnown = false; updateHome(); cb && cb(error); return; }
      applyState(result);
      /* Only ask Homebrew Channel anything once the service has told us it is
         not elevated. A healthy TV never touches that bus. */
      if (healthCode === 'ELEVATION_REQUIRED' &&
          (homebrewState === HB_UNKNOWN || homebrewState === HB_CHECK_FAILED)) {
        return checkHomebrewRoot(function () {
          maybeStartAutomaticElevation();
          updateHome();
          cb && cb(null, result);
        });
      }
      maybeStartAutomaticElevation();
      cb && cb(null, result);
    });
  }

  /* ---------- actions ---------- */

  function selectProfile(id) {
    if (vpnActionBusy) return;
    var reconnect = running && id !== state.activeId;
    luna('selectProfile', { profileId: id, reconnect: reconnect }, function (error) {
      if (error) { log(errorText(error)); return; }
      loadStore(function () {
        log(tr('servers.selectedLog') + profileDisplayName(selectedProfile()));
        if (reconnect) refreshState();
      });
    });
  }

  function deleteProfile(id) {
    luna('deleteProfile', { profileId: id }, function (error) {
      if (error) { log(errorText(error)); return; }
      loadStore(function () { log(tr('servers.deletedLog')); });
    });
  }

  function startVpn() {
    /* Belt and braces: the button is already disabled in this state, but a
       relaunch or a stale render must never be able to start a connection the
       environment cannot support. */
    if (!vpnActivationAllowed()) {
      log(tr(elevationCondition() === 'HOMEBREW_UNKNOWN' ? 'hb.checkText' : 'err.HOMEBREW_REQUIRED'));
      return;
    }
    vpnActionBusy = true;
    updateHome();
    log(tr('vpn.starting') + profileDisplayName(selectedProfile()));
    luna('connect', {}, function (error) {
      vpnActionBusy = false;
      if (error) log(errorText(error));
      refreshState();
    });
  }

  function stopVpn() {
    vpnActionBusy = true;
    updateHome();
    luna('disconnect', {}, function (error) {
      vpnActionBusy = false;
      if (error) log(errorText(error));
      refreshState();
    });
  }

  function restartVpn() {
    if (vpnActionBusy) return;
    vpnActionBusy = true;
    updateHome();
    luna('restart', {}, function (error) {
      vpnActionBusy = false;
      if (error) log(errorText(error));
      refreshState();
    });
  }

  function updateProbeButton() {
    var btn = $('pingServers');
    if (!btn) return;
    btn.disabled = probeBusy || !state.profiles.length;
    btn.textContent = probeBusy ? tr('servers.pinging') : tr('servers.ping');
  }

  function startProbes() {
    if (probeBusy || !state.profiles.length) return;
    var i;
    probeBusy = true;
    probeResults = {};
    probePending = {};
    for (i = 0; i < state.profiles.length; i++) probePending[probeKey(state.profiles[i].id)] = true;
    updateProbeButton();
    renderServers();
    luna('probeProfiles', {}, function (error, result) {
      var probes = (result && result.probes) || [], j;
      probePending = {};
      probeBusy = false;
      if (error) log(errorText(error));
      for (j = 0; j < probes.length; j++) {
        probeResults[probeKey(probes[j].id)] = typeof probes[j].latencyMs === 'number' ? probes[j].latencyMs : null;
      }
      updateProbeButton();
      renderServers();
      log(tr('servers.pingDone'));
    });
  }

  /* ---------- LAN pairing ---------- */

  function renderPairing() {
    var state1 = $('pairState');
    var box = $('pairBox');
    var urlEl = $('webUrl');
    var hintEl = $('webHint');
    var pairInfoEl = $('webPairInfo');
    var codeEl = $('webCode');
    var expiryEl = $('webExpiry');
    if (state1) {
      state1.textContent = pairingInfo ? tr('settings.on') : tr('settings.off');
      state1.className = 'rState' + (pairingInfo ? ' on' : '');
    }
    /* The home box must not advertise an address once the window has closed. */
    if (!pairingInfo) {
      lastWebUrl = '';
      if (urlEl) {
        urlEl.textContent = tr('home.webOff');
        urlEl.setAttribute('data-i18n', 'home.webOff');
      }
      if (hintEl) {
        hintEl.textContent = tr('home.webHintOff');
        hintEl.setAttribute('data-i18n', 'home.webHintOff');
      }
      if (pairInfoEl) pairInfoEl.style.display = 'none';
    } else {
      var addresses = pairingInfo.addresses || [];
      var portSuffix = pairingInfo.port ? ':' + pairingInfo.port : '';
      lastWebUrl = addresses.length ? 'http://' + addresses[0] + portSuffix : '';
      if (urlEl) {
        urlEl.textContent = lastWebUrl || tr('home.webStarting');
        urlEl.removeAttribute('data-i18n');
      }
      if (hintEl) {
        hintEl.textContent = tr('home.webHint');
        hintEl.setAttribute('data-i18n', 'home.webHint');
      }
      if (pairInfoEl) {
        pairInfoEl.style.display = 'block';
        if (codeEl) codeEl.textContent = pairingInfo.code || '';
        if (expiryEl) expiryEl.textContent = tr('pair.expires') + (pairingInfo.secondsRemaining || 0) + tr('pair.seconds');
      }
    }
    if (!box) return;
    if (!pairingInfo) {
      box.innerHTML = '<div class="pairClosed">' + esc(tr('pair.closed')) + '</div>';
      return;
    }
    var addresses2 = pairingInfo.addresses || [];
    var portSuffix2 = pairingInfo.port ? ':' + pairingInfo.port : '';
    box.innerHTML =
      '<div class="pairCode"><span class="pairLabel">' + esc(tr('pair.code')) + '</span>' +
      '<b>' + esc(pairingInfo.code || '') + '</b></div>' +
      '<div class="pairAddr"><span class="pairLabel">' + esc(tr('pair.address')) + '</span>' +
      esc(addresses2.map(function (a) { return 'http://' + a + portSuffix2; }).join('  ')) + '</div>' +
      '<div class="pairExpiry">' + esc(tr('pair.expires') + (pairingInfo.secondsRemaining || 0) + tr('pair.seconds')) + '</div>' +
      '<div class="pairWarn">' + esc(tr('pair.warning')) + '</div>';
  }

  function startPairing(opts) {
    opts = opts || {};
    luna('startPairing', { forceNew: !!opts.forceNew }, function (error, result) {
      if (error) { log(errorText(error)); return; }
      pairingInfo = {
        code: result.code,
        addresses: result.addresses || [],
        port: result.port,
        secondsRemaining: Math.max(0, Math.round(((result.expiresAt || 0) - Date.now()) / 1000))
      };
      renderPairing();
      if (pairingTimer) clearInterval(pairingTimer);
      pairingTimer = setInterval(function () {
        if (!pairingInfo) return;
        pairingInfo.secondsRemaining--;
        if (pairingInfo.secondsRemaining <= 0) {
          clearInterval(pairingTimer);
          pairingTimer = null;
          pairingInfo = null;
          refreshState();
        }
        renderPairing();
      }, 1000);
    });
  }

  function stopPairing() {
    luna('stopPairing', {}, function (error) {
      if (error) log(errorText(error));
      if (pairingTimer) { clearInterval(pairingTimer); pairingTimer = null; }
      pairingInfo = null;
      renderPairing();
      refreshState();
    });
  }

  /* ---------- runtime lifecycle ---------- */

  function synchronizeRuntime() {
    if (runtimeSyncBusy) { runtimeSyncPending = true; return; }
    runtimeSyncBusy = true;
    refreshState(function () {
      loadStore(function () {
        runtimeSyncBusy = false;
        if (runtimeSyncPending) { runtimeSyncPending = false; synchronizeRuntime(); }
      });
    });
  }
  function onRuntimeVisibility() {
    var hiddenProperty = typeof document.hidden !== 'undefined' ? 'hidden' : 'webkitHidden';
    if (!document[hiddenProperty]) synchronizeRuntime();
  }
  function cleanupRuntimeLifecycle() {
    if (runtimePollTimer) { clearInterval(runtimePollTimer); runtimePollTimer = null; }
    if (restartLabelTimer) { clearTimeout(restartLabelTimer); restartLabelTimer = null; }
    if (elevationPollTimer) { clearTimeout(elevationPollTimer); elevationPollTimer = null; }
    if (pairingTimer) { clearInterval(pairingTimer); pairingTimer = null; }
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

  function fetchTunnelLogs() {
    if (logsBusy) return;
    logsBusy = true;
    var btn = $('logsRefresh');
    if (btn) { btn.disabled = true; btn.textContent = tr('logs.loading'); }
    luna('getLogs', {}, function (error, result) {
      logsBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = tr('logs.refresh'); }
      if (error) { log(errorText(error), true); return; }
      var serviceLog = (result && result.log) || tr('logs.empty');
      var coreLog = (result && result.tunnelLog) || tr('logs.empty');
      log(tr('logs.header') + '\n' + tr('logs.service') + '\n' + serviceLog +
        '\n' + tr('logs.core') + '\n' + coreLog, true);
    });
  }

  /* ---------- elevation ---------- */

  /* Alcyone needs root for exactly two things: creating and configuring tun0,
     and editing the kernel routing table. The only supported way to obtain it
     is Homebrew Channel's elevateService, and the only supported environment
     is a rooted LG TV running Homebrew Channel as root.

     Every value this code sends to Homebrew Channel is a compile-time
     constant. The service URI is the literal below, the method names are
     literals at their call sites, and the target id comes from the generated
     edition table and is additionally matched against a fixed pattern before
     it is sent. No profile, subscription, search box or any other
     user-controlled value can reach the URI, the method name or the id.

     Both methods used here are narrowly scoped: `checkRoot` is read-only and
     `elevateService` takes one service id. Neither is an arbitrary-execution
     endpoint, no command string is built anywhere, and Alcyone never edits LS2
     configuration itself. */
  var HBCHANNEL = 'luna://org.webosbrew.hbchannel.service';
  var HBCHANNEL_TIMEOUT_MS = 15000;
  var ELEVATE_TIMEOUT_MS = 60000;
  var ELEVATION_POLL_INTERVAL_MS = 1000;
  var ELEVATION_POLL_LIMIT = 15;
  /* The only ids Alcyone ever asks to have elevated. A tampered or absent
     edition table can therefore never redirect elevation at a third party. */
  var ELEVATABLE_SERVICE_IDS = ['com.alcyone.vpn.service', 'com.alcyone.vpn.singbox.service'];

  function elevationTargetId() {
    var id = String((EDITION && EDITION.serviceId) || '');
    return ELEVATABLE_SERVICE_IDS.indexOf(id) >= 0 ? id : '';
  }

  /* Read-only prerequisite check.

     Runs only when the service has already reported that it is not elevated,
     so a healthy TV never talks to Homebrew Channel at all.

     Only a call that came back with a boolean `returnValue` is a verdict.
     Anything else — a transport failure, the timeout, or an LS2 error reply —
     leaves the prerequisite undetermined. Undetermined is not the same as
     unmet: it still withholds VPN activation and still withholds the Grant
     permissions action, but it is retried on the next refresh instead of being
     cached as a permanent HOMEBREW_REQUIRED. */
  function checkHomebrewRoot(cb) {
    if (homebrewState === HB_CHECKING) { if (cb) cb(homebrewState); return; }
    homebrewState = HB_CHECKING;
    renderElevation();
    lunaAt(HBCHANNEL, 'checkRoot', {}, HBCHANNEL_TIMEOUT_MS, function (error, result) {
      if (error || !result || result.errorCode !== undefined ||
          typeof result.returnValue !== 'boolean') {
        homebrewState = HB_CHECK_FAILED;
      } else {
        homebrewState = result.returnValue ? HB_ROOT : HB_UNSUPPORTED;
      }
      if (cb) cb(homebrewState);
    });
  }

  /* Which condition, if any, the banner should describe.

     HOMEBREW_REQUIRED outranks ELEVATION_REQUIRED: an unmet hard prerequisite
     has no in-app remedy, so offering the Grant permissions button there would
     be a button that can only fail.

     HOMEBREW_UNKNOWN is the third condition: the service says it is jailed but
     the prerequisite has not been established either way. It states that the
     check is in progress, offers no action, and resolves itself on a later
     refresh. */
  function elevationCondition() {
    if (healthCode === 'HOMEBREW_REQUIRED') return 'HOMEBREW_REQUIRED';
    if (healthCode !== 'ELEVATION_REQUIRED') return '';
    /* Only a completed check that confirmed non-root states the prerequisite
       as unmet, and only a completed check that confirmed root offers the
       in-app remedy. */
    if (homebrewState === HB_UNSUPPORTED) return 'HOMEBREW_REQUIRED';
    if (homebrewState === HB_ROOT) return 'ELEVATION_REQUIRED';
    return 'HOMEBREW_UNKNOWN';
  }

  /* VPN activation waits for a confirmed root prerequisite.

     An empty condition means the service itself reported no health problem,
     which on this platform it can only do while running as uid 0 — the
     prerequisite is satisfied by demonstration and Homebrew Channel is never
     consulted. ELEVATION_REQUIRED is reached only from HB_ROOT, so the
     prerequisite is confirmed there too; the button stays pressable and the
     service refuses the connection with an actionable code. Both the unmet and
     the undetermined prerequisite withhold activation. */
  function vpnActivationAllowed() {
    var condition = elevationCondition();
    return condition === '' || (condition === 'ELEVATION_REQUIRED' && !elevationBusy);
  }

  function renderElevation() {
    var banner = $('elevationBanner');
    var titleEl = $('elevationTitle');
    var textEl = $('elevationText');
    var action = $('grantPermissions');
    var condition = elevationCondition();

    if (!banner) return;
    if (!condition) {
      banner.style.display = 'none';
      if (action) action.style.display = 'none';
      return;
    }
    banner.style.display = 'block';
    if (condition === 'HOMEBREW_REQUIRED') {
      if (titleEl) titleEl.textContent = tr('hb.title');
      if (textEl) textEl.textContent = tr('hb.text');
      /* No action offered, and none exists: the requirement is stated and the
         app stops there. */
      if (action) action.style.display = 'none';
      return;
    }
    if (condition === 'HOMEBREW_UNKNOWN') {
      if (titleEl) titleEl.textContent = tr('hb.checkTitle');
      if (textEl) textEl.textContent = tr('hb.checkText');
      /* Nothing is offered until the check produces a verdict: Grant
         permissions here would be a button whose applicability is unknown. */
      if (action) action.style.display = 'none';
      return;
    }
    if (elevationBusy && automaticElevationInProgress) {
      if (titleEl) titleEl.textContent = tr('elev.preparingTitle');
      if (textEl) textEl.textContent = elevationMessage || tr('elev.preparing');
      if (action) action.style.display = 'none';
      return;
    }
    if (titleEl) titleEl.textContent = tr('elev.title');
    if (textEl) textEl.textContent = elevationMessage || tr('elev.text');
    if (action) {
      action.style.display = '';
      action.disabled = elevationBusy;
      action.textContent = elevationBusy ? tr('elev.working') : tr('elev.grant');
    }
  }

  function setElevationMessage(text) {
    elevationMessage = text || '';
    renderElevation();
  }

  function finishElevation(messageKey) {
    elevationBusy = false;
    automaticElevationInProgress = false;
    if (elevationPollTimer) { clearTimeout(elevationPollTimer); elevationPollTimer = null; }
    setElevationMessage(messageKey ? tr(messageKey) : '');
  }

  /* Startup gets one automatic attempt per app process. A failure deliberately
     leaves this latch set so visibility changes, polling and relaunch events
     cannot create an elevation loop; the visible button remains the fallback. */
  function maybeStartAutomaticElevation() {
    if (automaticElevationAttempted || elevationBusy) return;
    if (elevationCondition() !== 'ELEVATION_REQUIRED') return;
    automaticElevationAttempted = true;
    grantPermissions(true);
  }

  /* Poll until the replacement service reports uid 0, or give up.

     uid 0 is the authoritative condition and the only thing accepted here.
     Filesystem readability is never substituted for it: a service that can
     suddenly read its data directory is not necessarily elevated, and one that
     cannot is not necessarily jailed. Polling is bounded on both sides — a
     fixed attempt limit and a per-call timeout — so no failure mode leaves a
     timer running forever. */
  function pollForRoot(attempts) {
    elevationPollTimer = setTimeout(function () {
      elevationPollTimer = null;
      luna('getState', pollParams(), function (error, result) {
        var priv = result && result.privilege;
        if (!error && priv && priv.uid === 0) {
          applyState(result);
          finishElevation('elev.done');
          synchronizeRuntime();
          return;
        }
        if (!error && result) applyState(result);
        if (attempts + 1 >= ELEVATION_POLL_LIMIT) return finishElevation('elev.timeout');
        pollForRoot(attempts + 1);
      });
    }, ELEVATION_POLL_INTERVAL_MS);
  }

  /* The proven three-step sequence from Phase 0.

     elevateService rewrites the LS2 service file but never restarts the
     target, so a running jailed process keeps its old identity until it exits.
     restartService is that missing third step; LS2 then relaunches the service
     with the rewritten configuration in effect. */
  function grantPermissions(automatic) {
    if (elevationBusy) return;
    if (elevationCondition() !== 'ELEVATION_REQUIRED') return;
    var id = elevationTargetId();
    if (!id) return finishElevation('elev.failed');

    elevationBusy = true;
    automaticElevationInProgress = automatic === true;
    setElevationMessage(tr(automaticElevationInProgress ? 'elev.preparing' : 'elev.working'));
    lunaAt(HBCHANNEL, 'elevateService', { id: id }, ELEVATE_TIMEOUT_MS, function (error, result) {
      if (error || !result || result.returnValue !== true) {
        /* Nothing from the bus is shown verbatim: a failure renders one
           localized sentence, never a raw LS2 payload or a path. */
        return finishElevation('elev.failed');
      }
      setElevationMessage(tr('elev.restarting'));
      luna('restartService', {}, function (restartError) {
        if (restartError) return finishElevation('elev.failed');
        setElevationMessage(tr('elev.waiting'));
        pollForRoot(0);
      });
    });
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
      refreshState(function (error) {
        if (error) return;
        if (running) stopVpn(); else startVpn();
      });
    };
    if ($('pingServers')) $('pingServers').onclick = startProbes;
    if ($('refresh')) $('refresh').onclick = function () { loadStore(function () { refreshState(); }); };
    if ($('subUpdate')) $('subUpdate').onclick = function () {
      var btn = $('subUpdate');
      btn.disabled = true;
      btn.textContent = tr('servers.subUpdating');
      log(tr('servers.subUpdatingLog'));
      luna('updateSubscriptions', {}, function (error, result) {
        btn.disabled = false;
        btn.textContent = tr('servers.subUpdate');
        if (error) log(errorText(error));
        else if (result && result.failed) log(tr('err.generic') + result.failures.map(function (f) { return f.errorCode; }).join(', '));
        loadStore();
      });
    };
    if ($('search')) $('search').oninput = renderServers;

    if ($('rowRestart')) $('rowRestart').onclick = function () {
      if (vpnActionBusy) return;
      var sub = $('restartSub');
      if (sub) sub.textContent = tr('settings.restarting');
      restartVpn();
      if (restartLabelTimer) clearTimeout(restartLabelTimer);
      restartLabelTimer = setTimeout(function () {
        restartLabelTimer = null;
        if (sub) sub.textContent = tr('settings.restartSub');
      }, 15000);
    };
    if ($('rowCheckIp')) $('rowCheckIp').onclick = function () {
      var sub = $('checkIpSub');
      if (sub) sub.textContent = tr('settings.checking');
      luna('checkExternalIp', {}, function (error, result) {
        if (!sub) return;
        if (error || !result || !result.address) { sub.textContent = tr('settings.ipFail'); return; }
        sub.textContent = (result.viaVpn ? tr('settings.viaVpn') : tr('settings.direct')) + result.address;
      });
    };
    if ($('rowLang')) $('rowLang').onclick = function () {
      setLang(langSetting === 'auto' ? 'ru' : (langSetting === 'ru' ? 'en' : 'auto'));
    };
    if ($('rowAutostart')) $('rowAutostart').onclick = function () {
      var el = $('autostartState');
      if (el) el.textContent = '...';
      luna('setAutostart', { enabled: !autostartOn }, function (error) {
        if (error) log(errorText(error));
        refreshState();
      });
    };
    if ($('rowPair')) $('rowPair').onclick = function () { nav('pair'); renderPairing(); };
    if ($('pairStart')) $('pairStart').onclick = function () { startPairing({ forceNew: true }); };
    if ($('pairStop')) $('pairStop').onclick = stopPairing;

    /* The action is hidden during the one automatic startup attempt and becomes
       the explicit fallback only if that attempt fails. */
    if ($('grantPermissions')) $('grantPermissions').onclick = function () { grantPermissions(false); };

    if ($('rowLogs')) $('rowLogs').onclick = function () { nav('logs'); fetchTunnelLogs(); };
    if ($('rowAbout')) $('rowAbout').onclick = function () { nav('about'); };
    if ($('rowDonate')) $('rowDonate').onclick = function () { nav('donate'); };
    if ($('rowDonate2')) $('rowDonate2').onclick = function () { nav('donate'); };
    var backs = document.querySelectorAll('.backBtn');
    for (i = 0; i < backs.length; i++) backs[i].onclick = function () {
      var from = this.parentNode && this.parentNode.parentNode && this.parentNode.parentNode.id;
      nav(this.getAttribute('data-back') || 'settings', RETURN_FOCUS[from]);
    };

    document.addEventListener('keydown', function (ev) {
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
      if (ev.keyCode === 461 || ev.keyCode === 27) {
        var active = document.querySelector('.page.active');
        if (active && SUB_OF[active.id]) { ev.preventDefault(); nav('settings', RETURN_FOCUS[active.id]); }
      }
    });

    if ($('logsRefresh')) $('logsRefresh').onclick = fetchTunnelLogs;
    if ($('clearLog')) $('clearLog').onclick = function () {
      if (logsBusy) return;
      logsBusy = true;
      var btn = $('clearLog');
      if (btn) btn.disabled = true;
      luna('clearLogs', {}, function (error) {
        logsBusy = false;
        if (btn) btn.disabled = false;
        if (error) { log(tr('logs.clearFailed'), true); return; }
        if ($('log')) $('log').textContent = '';
        lastLogText = '';
        log(tr('logs.cleared'), true);
      });
    };
    if ($('freezeLog')) $('freezeLog').onclick = function () { log(tr('logs.frozen'), true); };
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyEditionUi();
    applyI18n();
    var langEl = $('langState');
    if (langEl) langEl.textContent = langLabel();
    fetchSystemLocale();
    wire();
    wireRuntimeLifecycle();
    if (!hasBridge()) log(tr('app.noBridge'));
    synchronizeRuntime();
    startPairing();
    runtimePollTimer = setInterval(function () {
      if (!document.hidden && !document.webkitHidden) refreshStoreIfChanged(function () { refreshState(); });
    }, 15000);
    if (window.addEventListener) window.addEventListener('unload', cleanupRuntimeLifecycle, false);
  });
})();
