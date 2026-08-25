!(function () {
  "use strict";
  var e = window.ALCYONE_EDITION || {
      appId: "com.alcyone.vpn",
      serviceId: "com.alcyone.vpn.service",
      core: "xray",
      coreLabel: "XRay",
      editionName: "XRay Edition",
      title: "Alcyone XRay",
      version: "4.2.0",
    },
    t = e.version,
    r = e.core,
    n = "luna://" + (e.serviceId || e.appId + ".service"),
    o = window.ALCYONE_COUNTRIES || {
      nativeSrc: function () {
        return "flags/un.png";
      },
    },
    s = {
      profiles: [],
      subscriptions: [],
      activeId: null,
      autostartProfileId: null,
      dnsServer: null,
      lang: "auto",
      connectionMode: "tun",
    },
    i = !1,
    a = !1,
    l = "",
    c = "",
    u = "idle",
    d = !1,
    p = 0,
    v = null,
    g = 0,
    f = null,
    h = !1,
    m = !1,
    S = !1,
    b = null,
    E = null,
    T = null,
    y = "",
    N = "",
    I = "all",
    C = !1,
    A = "",
    R = "unknown",
    P = !1,
    w = !1,
    O = !1,
    L = null,
    D = "",
    _ = {},
    k = {},
    x = !1,
    V = 0,
    U = null,
    H = null,
    M = null,
    q = !1,
    B = !1,
    F = "",
    stateError = "",
    Y = null,
    G = 0,
    X = !1,
    W = "name";
  try {
    var K = window.localStorage && localStorage.getItem("alcyone.serverSort");
    ("name" !== K && "ping" !== K) || (W = K);
  } catch (e) {}
  function Q(e) {
    return document.getElementById(e);
  }
  function z(e) {
    return String(null == e ? "" : e).replace(/[&<>"']/g, function (e) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[e];
    });
  }
  var j = "";
  function J(e, t) {
    var r = Q("log");
    if (r) {
      var n = String(null == e ? "" : e).replace(/\s+$/g, "");
      if (n && (t || n !== j)) {
        j = n;
        var o = r.scrollHeight - r.scrollTop - r.clientHeight < 24,
          s = r.scrollTop,
          i = "[" + new Date().toLocaleTimeString() + "] " + n + "\n",
          a = r.textContent || "";
        if (a.length + i.length > 32768) {
          var l = (a = a.slice(
            Math.max(0, a.length + i.length - 32768),
          )).indexOf("\n");
          l >= 0 && (a = a.slice(l + 1));
        }
        ((r.textContent = a + i), (r.scrollTop = o ? r.scrollHeight : s));
      }
    }
  }
  var $ = {},
    Z = 0;
  function ee(e, t, r, o) {
    te(n, e, t, o || 12e3, r);
  }
  function te(e, t, r, n, o) {
    var s = e + "/" + t,
      i = !1,
      a = null,
      l = "";
    function c(e, t) {
      i ||
        ((i = !0),
        a && (clearTimeout(a), (a = null)),
        l && (delete $[l], (l = "")),
        o && o(e, t));
    }
    if (
      ((a = setTimeout(function () {
        c({ errorCode: "SERVICE_TIMEOUT" }, null);
      }, n || 12e3)),
      window.webOS && webOS.service && webOS.service.request)
    )
      webOS.service.request(e, {
        method: t,
        parameters: r || {},
        onSuccess: function (e) {
          c(null, e);
        },
        onFailure: function (e) {
          c(e || { errorCode: "SERVICE_UNAVAILABLE" }, null);
        },
      });
    else {
      var u = window.PalmServiceBridge || window.WebOSServiceBridge;
      if (u) {
        var d = new u();
        ((l = "b" + ++Z),
          ($[l] = d),
          (d.onservicecallback = function (e) {
            var t = null;
            try {
              t = JSON.parse(e);
            } catch (e) {
              t = null;
            }
            if (!t || !1 === t.returnValue)
              return c(t || { errorCode: "SERVICE_UNAVAILABLE" }, null);
            c(null, t);
          }));
        try {
          d.call(s, JSON.stringify(r || {}));
        } catch (e) {
          c({ errorCode: "SERVICE_UNAVAILABLE" }, null);
        }
      } else c({ errorCode: "SERVICE_UNAVAILABLE" }, null);
    }
  }
  function re(e) {
    var t = (e && (e.errorCode || e.code)) || "",
      r = "err." + t,
      n = ge(r);
    return n !== r ? n : ge("err.generic") + (t || "UNKNOWN");
  }
  function ne(e) {
    return o.nativeSrc(e);
  }
  function oe(e) {
    return '<img class="flag" src="' + ne(e) + '" alt="">';
  }
  function se(e) {
    var t,
      r = e.querySelectorAll("img.flag");
    for (t = 0; t < r.length; t++)
      r[t].onerror = function () {
        ((this.onerror = null), (this.src = "flags/un.png"));
      };
  }
  var ie = {
    ru: {
      "common.checking": "Проверка...",
      "common.back": "‹ Назад",
      "common.done": "Команда выполнена",
      "nav.home": "Главная",
      "nav.servers": "Сервера",
      "nav.settings": "Настройки",
      "home.title": "VPN",
      "home.subtitle": "Защищённое подключение телевизора",
      "home.tapConnect": "Нажмите для подключения",
      "home.tapDisconnect": "Нажмите для отключения",
      "home.tapCancel": "Нажмите для отмены подключения",
      "home.waiting": "Подождите",
      "home.noServer": "Сервер не выбран",
      "home.webTitle": "Веб-импорт подписок",
      "home.webStarting": "запускается...",
      "home.webOff": "Выключен",
      "home.webHintOff":
        "Включите импорт в Настройках, чтобы временно открыть доступ с телефона или ПК",
      "home.webHint":
        "Откройте адрес в браузере телефона или ПК и введите код с экрана",
      "home.vpnOff": "VPN выключен",
      "servers.count0": "0 серверов",
      "servers.search": "Поиск серверов...",
      "servers.ping": "Пинг серверов",
      "servers.pinging": "Проверяю...",
      "servers.pingDone": "Проверка серверов завершена",
      "servers.refresh": "Обновить",
      "servers.subUpdate": "Обновить подписки",
      "servers.subUpdating": "Обновляю...",
      "servers.subUpdatingLog": "Обновляю подписки...",
      "servers.subImported": " серверов импортировано",
      "servers.xhttpSkippedPrefix": " · ",
      "servers.xhttpSkippedSuffix":
        " серверов XHTTP пропущено — используйте редакцию XRay.",
      "servers.all": "Все",
      "servers.sort": "Сортировка",
      "servers.sortName": "Имя",
      "servers.sortPing": "Пинг",
      "servers.manualGroup": "Ручные профили",
      "servers.manual": "ручной",
      "servers.subscription": "подписка",
      "servers.subscriptionCap": "Подписка",
      "servers.select": "Выбрать",
      "servers.selected": "Выбран",
      "servers.delete": "Удалить",
      "servers.nothingFound": "Ничего не найдено",
      "servers.nothingFoundHint": "Измени запрос поиска или фильтр протокола.",
      "servers.noProfiles": "Профилей нет",
      "servers.noProfilesHint":
        "Добавь серверную ссылку или подписку через веб-интерфейс — адрес на главной.",
      "servers.selectedLog": "Выбран сервер: ",
      "servers.autostartTitle": "Выберите сервер автозапуска",
      "servers.autostartSub": "Выбор не подключает VPN",
      "servers.autostartUse": "Использовать для автозапуска",
      "servers.autostartSaved": "Сервер автозапуска сохранён",
      "servers.deletedLog": "Профиль удалён",
      "servers.storeError": "Не удалось синхронизировать список серверов",
      "plural.servers": ["сервер", "сервера", "серверов"],
      "plural.profiles": ["профиль", "профиля", "профилей"],
      "plural.subs": ["подписка", "подписки", "подписок"],
      "settings.sub": "Управление приложением",
      "settings.restart": "Перезапустить VPN",
      "settings.restartSub": "Переподключить текущий сервер",
      "settings.checkIp": "Проверить внешний IP",
      "settings.checkIpSub": "Показать текущий внешний IPv4-адрес",
      "settings.vpnDns": "DNS для VPN",
      "settings.vpnDnsSub":
        "По умолчанию — DNS роутера; можно указать свой сервер",
      "settings.vpnDnsTitle": "DNS для VPN",
      "settings.vpnDnsIntro":
        "Выберите автоматический DNS или один публичный IPv4-сервер.",
      "settings.vpnDnsHint":
        "Введите публичный IPv4-адрес или оставьте пустым для DNS роутера",
      "settings.vpnDnsCurrentMode": "Текущий режим",
      "settings.vpnDnsAutomatic": "Автоматический — DNS ТВ/роутера",
      "settings.vpnDnsCustom": "Свой — ",
      "settings.vpnDnsModeHint": "VPN использует только сохранённые настройки.",
      "settings.vpnDnsField": "DNS-сервер",
      "settings.vpnDnsHelper":
        "Оставьте пустым для DNS ТВ/роутера. Только публичный IPv4.",
      "settings.vpnDnsSave": "Сохранить",
      "settings.vpnDnsDefault": "Использовать автоматический",
      "settings.vpnDnsAuto": "Автоматический",
      "settings.vpnDnsSaved": "Настройки DNS сохранены",
      "settings.vpnDnsReconnectFailed":
        "Адрес сохранён, но VPN не удалось переподключить",
      "settings.vpnDnsInvalid":
        "Введите публичный IPv4-адрес без нулей в начале",
      "settings.checking": "Проверяю...",
      "settings.viaVpn": "Через VPN: ",
      "settings.direct": "Напрямую: ",
      "settings.unavailable": "Недоступно",
      "settings.ipFail": "Не удалось проверить — подробности в логах туннеля",
      "settings.autostart": "Автозапуск VPN",
      "settings.autostartSub": "Подключаться при включении телевизора",
      "settings.on": "Включён",
      "settings.off": "Выключен",
      "settings.setup": "Настроить",
      "autostart.title": "Автозапуск VPN",
      "autostart.intro":
        "Выберите сервер, который подключится при включении ТВ",
      "autostart.saved": "Состояние автозапуска",
      "autostart.noServer": "Сервер для автозапуска не выбран",
      "autostart.independent": "Выбор не меняет сервер на главном экране.",
      "autostart.serverLabel": "Сервер автозапуска",
      "autostart.toggle": "Подключаться при включении ТВ",
      "autostart.offline": "Настройку можно изменить, когда VPN выключен.",
      "autostart.choose": "Выбрать сервер",
      "autostart.helper":
        "Выбор сервера сохраняется для следующего запуска и не подключает VPN сейчас.",
      "autostart.pickerHint":
        "Выберите строку, чтобы сохранить сервер автозапуска.",
      "autostart.noProfiles": "Сначала добавьте сервер в список.",
      "settings.web": "Веб-интерфейс",
      "settings.webSub": "Импорт подписок с телефона или ПК",
      "settings.webOn": "Запущен",
      "settings.webOff": "Остановлен",
      "settings.secInterface": "Интерфейс",
      "settings.lang": "Язык",
      "settings.langSub": "Русский · English · авто по региону",
      "settings.langAuto": "Авто",
      "settings.secLog": "Журнал",
      "logs.title": "Логи туннеля",
      "logs.sub": "Терминальный просмотрщик логов",
      "logs.refresh": "Обновить логи",
      "logs.loading": "Загружаю...",
      "logs.clear": "Очистить",
      "logs.cleared": "Файлы логов очищены",
      "logs.clearFailed": "Не удалось очистить файлы логов",
      "logs.freeze": "Зафиксировать",
      "logs.frozen": "Лог зафиксирован для фото",
      "logs.header": "=== Логи туннеля ===",
      "logs.service": "--- Служба Alcyone ---",
      "logs.core": "--- Ядро VPN ---",
      "logs.empty": "пусто",
      "about.title": "О приложении",
      "about.rowSub": e.title + " " + t + " · описание и связь",
      "about.text":
        "sing-box" === r
          ? "VPN-клиент для телевизоров LG webOS с root-доступом. Импортирует подписки VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и направляет трафик телевизора через нативный TUN-туннель sing-box."
          : "VPN-клиент для телевизоров LG webOS с root-доступом. Импортирует подписки VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и направляет трафик телевизора через TUN-туннель XRay и tun2socks.",
      "about.tgSub": "Группа для связи, новостей и поддержки",
      "donate.title": "Поддержать приложение",
      "donate.rowSub": "QR-код для доната",
      "donate.thanks": "Спасибо, что пользуешься Alcyone!",
      "donate.text1":
        "Приложение бесплатное и развивается на энтузиазме. Если оно тебе полезно — отсканируй QR-код камерой телефона и поддержи разработку.",
      "donate.text2": "Пожелания и вопросы — в Telegram-группе.",
      "vpn.noServer": "Нет выбранного сервера",
      "vpn.profileError": "Ошибка профиля: ",
      "vpn.starting": "Запускаю VPN: ",
      "vpn.connectingState": "Подключение к ",
      "vpn.connectedState": "Подключено",
      "err.emptyLink": "Пустая ссылка",
      "err.protoOnly":
        "Alcyone поддерживает VLESS, VMess, Trojan, Shadowsocks, SOCKS5 и Hysteria2",
      "err.xhttpCore": "Транспорт XHTTP поддерживается только в XRay Edition",
      "err.unsupportedTransport": "Этот транспорт не поддерживается sing-box: ",
      "err.noUuidHost": "Не найден user@host:port",
      "err.badHost": "Некорректная серверная ссылка",
      "err.badHysteria": "Некорректный Hysteria2",
      "err.badProfile": "Некорректный профиль",
      "settings.lanImport": "Импорт по сети",
      "settings.lanImportSub": "Временный доступ с телефона или ПК",
      "pair.title": "Импорт по локальной сети",
      "pair.sub": "Откройте адрес в браузере и введите код",
      "pair.start": "Разрешить на 5 минут",
      "pair.stop": "Закрыть доступ",
      "pair.code": "Код сопряжения",
      "pair.address": "Адрес",
      "pair.expires": "Действует ещё ",
      "pair.seconds": " сек",
      "pair.closed": "Доступ закрыт",
      "pair.warning":
        "Соединение по локальной сети не шифруется. Используйте только доверенную домашнюю сеть.",
      "elev.title": "Нужны права root",
      "elev.text":
        "Служба Alcyone запущена без прав root. Это происходит после каждой установки или обновления пакета. Нажмите «Выдать права» — служба перезапустится сама.",
      "elev.grant": "Выдать права",
      "elev.preparingTitle": "Подготовка разрешений",
      "elev.preparing":
        "Подготавливаем разрешения. Это займёт немного времени.",
      "elev.working": "Выдаю права...",
      "elev.restarting": "Перезапускаю службу...",
      "elev.waiting": "Жду перезапуск службы...",
      "elev.done": "Права выданы, служба перезапущена",
      "elev.failed":
        "Не удалось выдать права. Убедитесь, что Homebrew Channel установлен и запущен с правами root, затем попробуйте ещё раз.",
      "elev.timeout":
        "Служба не перезапустилась с правами root за отведённое время. Попробуйте ещё раз.",
      "hb.title": "Требуется root-доступ на телевизоре",
      "hb.text":
        "Alcyone работает только на телевизорах LG с root-доступом, где установлен Homebrew Channel и запущен с правами root. Включение VPN недоступно, пока это условие не выполнено.",
      "hb.checkTitle": "Проверка требований",
      "hb.checkText":
        "Проверяем Homebrew Channel. Включение VPN станет доступно, когда проверка завершится.",
      "err.NO_ACTIVE_PROFILE": "Сервер не выбран",
      "err.NO_AUTOSTART_PROFILE": "Сначала выберите сервер для автозапуска",
      "err.CONNECTION_TIMEOUT":
        "Сервер не ответил вовремя. Проверьте его доступность и попробуйте снова.",
      "err.INVALID_DNS_SERVER": "Нужен публичный IPv4-адрес DNS-сервера",
      "err.HOMEBREW_REQUIRED":
        "Нужен телевизор с root-доступом и Homebrew Channel, запущенным с правами root",
      "err.ELEVATION_REQUIRED":
        "Служба Alcyone запущена без прав root — нажмите «Выдать права» на главном экране",
      "err.ELEVATION_FAILED": "Не удалось выдать права службе Alcyone",
      "err.SHARED_DIRECTORY_REPAIR_FAILED":
        "Не удалось безопасно восстановить разрешения общих папок системы",
      "err.PACKAGE_INCOMPLETE": "Пакет приложения установлен не полностью",
      "err.CORE_MISSING": "Ядро VPN не найдено в пакете",
      "err.CORE_INTEGRITY_FAILED":
        "Ядро VPN повреждено или собрано для другой архитектуры",
      "err.ASSET_MISSING": "Не найден обязательный файл данных XRay",
      "err.ASSET_CORRUPT": "Повреждён обязательный файл данных XRay",
      "err.ASSET_INTEGRITY_FAILED":
        "Обязательный файл данных XRay не прошёл проверку целостности",
      "err.CORE_START_FAILED": "Не удалось запустить ядро VPN",
      "err.ENDPOINT_RESOLUTION_FAILED":
        "Не удалось разрешить адрес выбранного VPN-сервера",
      "err.ENDPOINT_UNREACHABLE": "Выбранный VPN-сервер недоступен",
      "err.TUN_NOT_READY": "TUN-интерфейс не был создан",
      "err.ROUTE_FAILED": "Не удалось настроить маршруты",
      "err.HEALTH_CHECK_FAILED": "Маршрут через туннель не активен",
      "err.NETWORK_CHANGED":
        "Сеть изменилась, VPN отключён для восстановления маршрута",
      "err.TUNNEL_OWNED_BY_OTHER_EDITION":
        "Туннелем управляет другая редакция Alcyone",
      "err.TLS_CERTIFICATE_INVALID": "Неверный сертификат сервера подписки",
      "err.BLOCKED_ADDRESS": "Адрес подписки запрещён",
      "err.BLOCKED_SCHEME": "Поддерживаются только http и https",
      "err.HTTPS_DOWNGRADE_REJECTED":
        "Сервер подписки попытался перенаправить защищённое соединение на HTTP",
      "err.URL_CREDENTIALS_REJECTED":
        "Ссылка с логином и паролем не поддерживается",
      "err.TIMEOUT": "Таймаут запроса",
      "err.NETWORK_ERROR": "Ошибка сети",
      "err.RATE_LIMITED":
        "Сервис подписки временно ограничил запросы. Повторите позже",
      "err.TOO_MANY_REDIRECTS":
        "Сервис подписки вернул циклическое перенаправление",
      "err.PROVIDER_AUTH_FAILED": "Ссылка подписки недействительна или истекла",
      "err.PROVIDER_REJECTED": "Сервис подписки отклонил запрос",
      "err.NO_SERVERS_FOUND": "В подписке не найдено серверов",
      "err.RESPONSE_TOO_LARGE": "Ответ слишком большой",
      "err.UNSUPPORTED_TRANSPORT": "Транспорт не поддерживается этой редакцией",
      "err.SERVICE_UNAVAILABLE": "Служба Alcyone недоступна",
      "err.SERVICE_TIMEOUT":
        "Служба Alcyone не отвечает. Проверьте, что служба запущена с правами root (elevate-service).",
      "err.generic": "Ошибка: ",
      "app.noBridge":
        "Luna bridge недоступен: приложение должно быть запущено на ТВ.",
      "mode.tun": "TUN",
      "mode.systemProxy": "Системный прокси",
      "mode.connection": "Режим подключения",
      "mode.proxyHint":
        "Системный прокси покрывает TCP-трафик приложений, которые его поддерживают; UDP и некоторые приложения могут обходить прокси.",
      "mode.locked": "Сначала отключите VPN, чтобы сменить режим",
      "mode.unavailable": "Режим недоступен: ",
      "mode.reason.root": "Требуются права root",
      "mode.reason.tun": "Устройство TUN недоступно",
      "mode.reason.binary": "Бинарные файлы TUN недоступны",
      "mode.reason.connection": "Служба управления соединением недоступна",
      "mode.reason.network": "Не удалось однозначно определить сеть",
      "mode.reason.storage": "Защищённое хранилище восстановления недоступно",
      "mode.reason.lookup": "Проверка системного прокси не пройдена",
      "mode.reason.generic": "Проверка возможностей не пройдена",
      "err.INVALID_CONNECTION_MODE": "Неизвестный режим подключения",
      "err.MODE_UNSUPPORTED": "Выбранный режим недоступен на этом телевизоре",
      "err.MODE_CHANGE_REQUIRES_DISCONNECT":
        "Сначала отключите VPN, чтобы сменить режим",
      "err.SYSTEM_PROXY_UNAVAILABLE":
        "Системный прокси недоступен на этом телевизоре",
      "err.SYSTEM_PROXY_SET_FAILED": "Не удалось включить системный прокси",
      "err.SYSTEM_PROXY_VERIFY_FAILED": "Не удалось проверить системный прокси",
      "err.SYSTEM_PROXY_RESTORE_FAILED":
        "Не удалось восстановить настройки прокси",
      "err.SYSTEM_PROXY_RESTORE_PENDING":
        "Восстановление прокси ожидает возвращения исходной сети",
      "err.SYSTEM_PROXY_RESTORE_CONFLICT":
        "Прокси изменён другим приложением; настройки не перезаписаны",
      "err.CONNECTION_OWNED_BY_OTHER_EDITION":
        "Подключением управляет другая редакция Alcyone",
    },
    en: {
      "common.checking": "Checking...",
      "common.back": "‹ Back",
      "common.done": "Command executed",
      "nav.home": "Home",
      "nav.servers": "Servers",
      "nav.settings": "Settings",
      "home.title": "VPN",
      "home.subtitle": "Protected connection for your TV",
      "home.tapConnect": "Press to connect",
      "home.tapDisconnect": "Press to disconnect",
      "home.tapCancel": "Press to cancel connection",
      "home.waiting": "Please wait",
      "home.noServer": "No server selected",
      "home.webTitle": "Web subscription import",
      "home.webStarting": "starting...",
      "home.webOff": "Off",
      "home.webHintOff":
        "Enable import in Settings to open temporary access from a phone or PC",
      "home.webHint":
        "Open this address in your phone or PC browser and enter the code shown on screen",
      "home.vpnOff": "VPN is off",
      "servers.count0": "0 servers",
      "servers.search": "Search servers...",
      "servers.ping": "Ping servers",
      "servers.pinging": "Pinging...",
      "servers.pingDone": "Server ping completed",
      "servers.refresh": "Refresh",
      "servers.subUpdate": "Update subscriptions",
      "servers.subUpdating": "Updating...",
      "servers.subUpdatingLog": "Updating subscriptions...",
      "servers.subImported": " servers imported",
      "servers.xhttpSkippedPrefix": " · ",
      "servers.xhttpSkippedSuffix": " XHTTP servers skipped — use XRay Edition",
      "servers.all": "All",
      "servers.sort": "Sort by",
      "servers.sortName": "Name",
      "servers.sortPing": "Ping",
      "servers.manualGroup": "Manual profiles",
      "servers.manual": "manual",
      "servers.subscription": "subscription",
      "servers.subscriptionCap": "Subscription",
      "servers.select": "Select",
      "servers.selected": "Selected",
      "servers.delete": "Delete",
      "servers.nothingFound": "Nothing found",
      "servers.nothingFoundHint": "Change the search query or protocol filter.",
      "servers.noProfiles": "No profiles yet",
      "servers.noProfilesHint":
        "Add a server link or a subscription via the web interface — the address is on the Home page.",
      "servers.selectedLog": "Server selected: ",
      "servers.autostartTitle": "Choose autostart server",
      "servers.autostartSub": "Selecting here does not connect the VPN",
      "servers.autostartUse": "Use for autostart",
      "servers.autostartSaved": "Autostart server saved",
      "servers.deletedLog": "Profile deleted",
      "servers.storeError": "Could not synchronize the server list",
      "plural.servers": ["server", "servers"],
      "plural.profiles": ["profile", "profiles"],
      "plural.subs": ["subscription", "subscriptions"],
      "settings.sub": "App management",
      "settings.restart": "Restart VPN",
      "settings.restartSub": "Reconnect the current server",
      "settings.checkIp": "Check external IP",
      "settings.checkIpSub": "Show the current external IPv4 address",
      "settings.vpnDns": "VPN DNS",
      "settings.vpnDnsSub":
        "Uses the TV/router DNS by default; choose a custom server if needed",
      "settings.vpnDnsTitle": "VPN DNS",
      "settings.vpnDnsIntro": "Choose automatic DNS or one public IPv4 server.",
      "settings.vpnDnsHint":
        "Enter a public IPv4 DNS address, or leave empty for the TV/router DNS",
      "settings.vpnDnsCurrentMode": "Current mode",
      "settings.vpnDnsAutomatic": "Automatic — TV/router DNS",
      "settings.vpnDnsCustom": "Custom — ",
      "settings.vpnDnsModeHint": "Only saved settings are used by the VPN.",
      "settings.vpnDnsField": "DNS server",
      "settings.vpnDnsHelper":
        "Leave empty to use the TV/router DNS. Public IPv4 only.",
      "settings.vpnDnsSave": "Save",
      "settings.vpnDnsDefault": "Use automatic",
      "settings.vpnDnsAuto": "Automatic",
      "settings.vpnDnsSaved": "DNS settings saved",
      "settings.vpnDnsReconnectFailed":
        "The address was saved, but VPN reconnect failed",
      "settings.vpnDnsInvalid":
        "Enter a public IPv4 address without leading zeroes",
      "settings.checking": "Checking...",
      "settings.viaVpn": "Via VPN: ",
      "settings.direct": "Direct: ",
      "settings.unavailable": "Unavailable",
      "settings.ipFail": "Check failed — see tunnel logs for details",
      "settings.autostart": "VPN autostart",
      "settings.autostartSub": "Connect when the TV turns on",
      "settings.on": "On",
      "settings.off": "Off",
      "settings.setup": "Set up",
      "autostart.title": "VPN autostart",
      "autostart.intro": "Choose the server that connects when the TV starts",
      "autostart.saved": "Autostart status",
      "autostart.noServer": "No autostart server selected",
      "autostart.independent":
        "This choice does not change the server on Home.",
      "autostart.serverLabel": "Autostart server",
      "autostart.toggle": "Connect at TV startup",
      "autostart.offline": "You can change this while the VPN is off.",
      "autostart.choose": "Choose from Servers",
      "autostart.helper":
        "The server is saved for the next startup and does not connect now.",
      "autostart.pickerHint": "Choose a row to save the autostart server.",
      "autostart.noProfiles": "Add a server before enabling autostart.",
      "settings.web": "Web interface",
      "settings.webSub": "Import subscriptions from your phone or PC",
      "settings.webOn": "Running",
      "settings.webOff": "Stopped",
      "settings.secInterface": "Interface",
      "settings.lang": "Language",
      "settings.langSub": "Русский · English · auto by region",
      "settings.langAuto": "Auto",
      "settings.secLog": "Log",
      "logs.title": "Tunnel logs",
      "logs.sub": "Terminal log viewer",
      "logs.refresh": "Refresh logs",
      "logs.loading": "Loading...",
      "logs.clear": "Clear",
      "logs.cleared": "Log files cleared",
      "logs.clearFailed": "Could not clear log files",
      "logs.freeze": "Freeze",
      "logs.frozen": "Log frozen for a photo",
      "logs.header": "=== Tunnel logs ===",
      "logs.service": "--- Alcyone service ---",
      "logs.core": "--- VPN core ---",
      "logs.empty": "empty",
      "about.title": "About",
      "about.rowSub": e.title + " " + t + " · info and contact",
      "about.text":
        "sing-box" === r
          ? "A VPN client for rooted LG webOS TVs using sing-box TUN mode."
          : "A VPN client for rooted LG webOS TVs using XRay TUN mode.",
      "about.tgSub": "Group for contact, news and support",
      "donate.title": "Support the app",
      "donate.rowSub": "Donation QR code",
      "donate.thanks": "Thank you for using Alcyone!",
      "donate.text1":
        "The app is free and developed out of enthusiasm. If you find it useful, scan the QR code with your phone camera and support the development.",
      "donate.text2": "Suggestions and questions — in the Telegram group.",
      "vpn.noServer": "No server selected",
      "vpn.profileError": "Profile error: ",
      "vpn.starting": "Starting VPN: ",
      "vpn.connectingState": "Connecting to ",
      "vpn.connectedState": "Connected",
      "err.emptyLink": "Empty link",
      "err.protoOnly":
        "Alcyone supports VLESS, VMess, Trojan, Shadowsocks, SOCKS5 and Hysteria2",
      "err.xhttpCore": "XHTTP transport is available only in XRay Edition",
      "err.unsupportedTransport": "Unsupported sing-box transport: ",
      "err.noUuidHost": "user@host:port not found",
      "err.badHost": "Invalid server link",
      "err.badHysteria": "Invalid Hysteria2 link",
      "err.badProfile": "Invalid profile",
      "settings.lanImport": "Network import",
      "settings.lanImportSub": "Temporary access from a phone or PC",
      "pair.title": "Local network import",
      "pair.sub": "Open the address in a browser and enter the code",
      "pair.start": "Allow for 5 minutes",
      "pair.stop": "Close access",
      "pair.code": "Pairing code",
      "pair.address": "Address",
      "pair.expires": "Valid for another ",
      "pair.seconds": " s",
      "pair.closed": "Access closed",
      "pair.warning":
        "The LAN connection is not encrypted. Use only on a trusted home network.",
      "elev.title": "Root permissions required",
      "elev.text":
        "The Alcyone service is running without root. This happens after every package install or upgrade. Press Grant permissions — the service restarts itself.",
      "elev.grant": "Grant permissions",
      "elev.preparingTitle": "Preparing permissions",
      "elev.preparing": "Preparing permissions. This will only take a moment.",
      "elev.working": "Granting permissions...",
      "elev.restarting": "Restarting the service...",
      "elev.waiting": "Waiting for the service to restart...",
      "elev.done": "Permissions granted, service restarted",
      "elev.failed":
        "Could not grant permissions. Check that Homebrew Channel is installed and running as root, then try again.",
      "elev.timeout":
        "The service did not come back as root in time. Please try again.",
      "hb.title": "A rooted TV is required",
      "hb.text":
        "Alcyone runs only on rooted LG TVs with Homebrew Channel installed and running as root. VPN activation stays unavailable until that requirement is met.",
      "hb.checkTitle": "Checking requirements",
      "hb.checkText":
        "Checking Homebrew Channel. VPN activation becomes available once the check completes.",
      "err.NO_ACTIVE_PROFILE": "No server selected",
      "err.NO_AUTOSTART_PROFILE": "Choose an autostart server first",
      "err.CONNECTION_TIMEOUT":
        "The server did not respond in time. Check it and try again.",
      "err.INVALID_DNS_SERVER": "A public IPv4 DNS address is required",
      "err.HOMEBREW_REQUIRED":
        "A rooted TV with Homebrew Channel running as root is required",
      "err.ELEVATION_REQUIRED":
        "The Alcyone service is not running as root — press Grant permissions on the Home screen",
      "err.ELEVATION_FAILED":
        "Could not grant root permissions to the Alcyone service",
      "err.SHARED_DIRECTORY_REPAIR_FAILED":
        "Could not safely repair shared system directory permissions",
      "err.PACKAGE_INCOMPLETE":
        "The application package is not fully installed",
      "err.CORE_MISSING": "The VPN core is missing from the package",
      "err.CORE_INTEGRITY_FAILED":
        "The VPN core is damaged or built for a different architecture",
      "err.ASSET_MISSING": "A required XRay data file is missing",
      "err.ASSET_CORRUPT": "A required XRay data file is corrupt",
      "err.ASSET_INTEGRITY_FAILED":
        "A required XRay data file failed its integrity check",
      "err.CORE_START_FAILED": "The VPN core failed to start",
      "err.ENDPOINT_RESOLUTION_FAILED":
        "Could not resolve the selected VPN server",
      "err.ENDPOINT_UNREACHABLE": "The selected VPN server is unreachable",
      "err.TUN_NOT_READY": "The TUN interface was not created",
      "err.ROUTE_FAILED": "Could not configure routes",
      "err.HEALTH_CHECK_FAILED": "The tunnel route is not active",
      "err.NETWORK_CHANGED":
        "The network changed; VPN was disconnected to restore routing",
      "err.TUNNEL_OWNED_BY_OTHER_EDITION":
        "Another Alcyone edition controls the tunnel",
      "err.TLS_CERTIFICATE_INVALID": "Invalid subscription server certificate",
      "err.BLOCKED_ADDRESS": "The subscription address is not allowed",
      "err.BLOCKED_SCHEME": "Only http and https are supported",
      "err.HTTPS_DOWNGRADE_REJECTED":
        "The subscription server tried to downgrade a secure connection to HTTP",
      "err.URL_CREDENTIALS_REJECTED":
        "URLs with a username and password are not supported",
      "err.TIMEOUT": "Request timed out",
      "err.NETWORK_ERROR": "Network error",
      "err.RATE_LIMITED":
        "The subscription service temporarily limited requests. Try again later",
      "err.TOO_MANY_REDIRECTS":
        "The subscription service returned a redirect loop",
      "err.PROVIDER_AUTH_FAILED": "The subscription link is invalid or expired",
      "err.PROVIDER_REJECTED": "The subscription service rejected the request",
      "err.NO_SERVERS_FOUND": "No servers found in the subscription",
      "err.RESPONSE_TOO_LARGE": "The response is too large",
      "err.UNSUPPORTED_TRANSPORT":
        "This transport is not supported by this edition",
      "err.SERVICE_UNAVAILABLE": "The Alcyone service is unavailable",
      "err.SERVICE_TIMEOUT":
        "The Alcyone service is not responding. Check that it runs elevated (elevate-service).",
      "err.generic": "Error: ",
      "mode.tun": "TUN",
      "mode.systemProxy": "System Proxy",
      "mode.connection": "Connection mode",
      "mode.proxyHint":
        "System Proxy covers TCP traffic from proxy-aware apps; UDP and some apps may bypass it.",
      "mode.locked": "Disconnect VPN before changing mode",
      "mode.unavailable": "Mode unavailable: ",
      "mode.reason.root": "Root privileges are required",
      "mode.reason.tun": "The TUN device is unavailable",
      "mode.reason.binary": "The TUN binaries are unavailable",
      "mode.reason.connection": "The connection-manager service is unavailable",
      "mode.reason.network":
        "The active network could not be identified safely",
      "mode.reason.storage": "Protected recovery storage is unavailable",
      "mode.reason.lookup": "The System Proxy capability probe did not pass",
      "mode.reason.generic": "The capability probe did not pass",
      "err.INVALID_CONNECTION_MODE": "Unknown connection mode",
      "err.MODE_UNSUPPORTED": "The selected mode is unavailable on this TV",
      "err.MODE_CHANGE_REQUIRES_DISCONNECT":
        "Disconnect VPN before changing mode",
      "err.SYSTEM_PROXY_UNAVAILABLE": "System Proxy is unavailable on this TV",
      "err.SYSTEM_PROXY_SET_FAILED": "Could not enable System Proxy",
      "err.SYSTEM_PROXY_VERIFY_FAILED": "Could not verify System Proxy",
      "err.SYSTEM_PROXY_RESTORE_FAILED":
        "Could not restore the original proxy settings",
      "err.SYSTEM_PROXY_RESTORE_PENDING":
        "Proxy restoration is waiting for the original network",
      "err.SYSTEM_PROXY_RESTORE_CONFLICT":
        "The proxy was changed by another app; it was not overwritten",
      "err.CONNECTION_OWNED_BY_OTHER_EDITION":
        "Another Alcyone edition controls the connection",
      "app.noBridge": "Luna bridge unavailable: the app must run on the TV.",
    },
  };
  ((ie.ru["about.text"] =
    "VPN-клиент для телевизоров LG webOS с root-доступом и режимом TUN."),
    (ie.en["about.text"] =
      "A VPN client for rooted LG webOS TVs using TUN mode."));
  var ae = "auto",
    le = !1,
    ce = "";
  try {
    var ue = window.localStorage && localStorage.getItem("alcyone.lang");
    ("ru" !== ue && "en" !== ue && "auto" !== ue) || ((ae = ue), (le = !0));
  } catch (e) {}
  var de = {
      ru: 1,
      be: 1,
      uk: 1,
      kk: 1,
      ky: 1,
      uz: 1,
      tg: 1,
      tk: 1,
      hy: 1,
      az: 1,
    },
    pe = {
      ru: 1,
      by: 1,
      kz: 1,
      kg: 1,
      uz: 1,
      tj: 1,
      tm: 1,
      am: 1,
      az: 1,
      md: 1,
      ua: 1,
      ge: 1,
    };
  function ve() {
    return "auto" === ae
      ? (function () {
          var e,
            t,
            r,
            n = [];
          ce && n.push(ce);
          try {
            navigator.languages &&
              navigator.languages.length &&
              (n = n.concat(navigator.languages));
          } catch (e) {}
          for (
            navigator.language && n.push(navigator.language),
              navigator.userLanguage && n.push(navigator.userLanguage),
              e = 0;
            e < n.length;
            e++
          )
            if (
              (t = String(n[e] || "")
                .toLowerCase()
                .replace(/_/g, "-"))
            ) {
              if (((r = t.split("-")), de[r[0]])) return "ru";
              if (r[1] && pe[r[1]]) return "ru";
              if (r[0]) return "en";
            }
          return "en";
        })()
      : ae;
  }
  function ge(e) {
    var t = ve(),
      r = ie[t] && ie[t][e];
    return (void 0 === r && (r = ie.ru[e]), void 0 === r ? e : r);
  }
  function fe(e, t) {
    var r = ve(),
      n = (ie[r] && ie[r][t]) || ie.ru[t] || [];
    return "ru" === r
      ? (function (e, t, r, n) {
          var o = Math.abs(e) % 100,
            s = o % 10;
          return o > 10 && o < 20 ? n : s > 1 && s < 5 ? r : 1 === s ? t : n;
        })(e, n[0], n[1], n[2])
      : 1 === e
        ? n[0]
        : n[1];
  }
  function he() {
    var e,
      t,
      r = document.querySelectorAll("[data-i18n]");
    for (e = 0; e < r.length; e++)
      (t = r[e].getAttribute("data-i18n")) && (r[e].textContent = ge(t));
    for (
      r = document.querySelectorAll("[data-i18n-ph]"), e = 0;
      e < r.length;
      e++
    )
      (t = r[e].getAttribute("data-i18n-ph")) &&
        r[e].setAttribute("placeholder", ge(t));
    for (
      r = document.querySelectorAll("[data-i18n-aria]"), e = 0;
      e < r.length;
      e++
    )
      (t = r[e].getAttribute("data-i18n-aria")) &&
        r[e].setAttribute("aria-label", ge(t));
  }
  function me() {
    return "ru" === ae
      ? "Русский"
      : "en" === ae
        ? "English"
        : ge("settings.langAuto") + " · " + ("ru" === ve() ? "RU" : "EN");
  }
  function Se() {
    (he(), ut(), It(), Be(), Je(), Ve());
    var e = Q("langState");
    (e && (e.textContent = me()), $e());
  }
  var be = {
      logs: "settings",
      about: "settings",
      donate: "settings",
      pair: "settings",
      dns: "settings",
      autostart: "settings",
    },
    Ee = {
      logs: "rowLogs",
      about: "rowAbout",
      donate: "rowDonate",
      pair: "rowPair",
      dns: "rowVpnDns",
      autostart: "rowAutostart",
    },
    Te = !1;
  function ye(e) {
    if (!e || e.disabled) return !1;
    var t = e.getBoundingClientRect();
    return t.width > 0 && t.height > 0;
  }
  function Ne(e) {
    var t = Q("serverList"),
      r = e;
    if (!t) return !1;
    for (; r && r !== document.body;) {
      if (r === t) return !0;
      r = r.parentNode;
    }
    return !1;
  }
  function Ie() {
    var e = document.querySelector(".page.active");
    if (!e) return [];
    var t,
      r = e.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
      n = [];
    for (t = 0; t < r.length; t++) Ne(r[t]) || (ye(r[t]) && n.push(r[t]));
    return n;
  }
  function Ce(e, t) {
    if (!ye(e) || !e.focus) return !1;
    var r = (function (e) {
        for (var t = e && e.parentNode; t && t !== document.body;) {
          if (t.classList && t.classList.contains("page")) return t;
          t = t.parentNode;
        }
        return null;
      })(e),
      n = r ? r.scrollTop : 0;
    try {
      e.focus({ preventScroll: !0 });
    } catch (t) {
      e.focus();
    }
    return (
      r && (r.scrollTop = n),
      t ||
        (function (e, t) {
          if (t && e && e.getBoundingClientRect) {
            var r = e.getBoundingClientRect(),
              n = t.getBoundingClientRect();
            r.top < n.top
              ? (t.scrollTop -= n.top - r.top)
              : r.bottom > n.bottom && (t.scrollTop += r.bottom - n.bottom);
          }
        })(e, r),
      !0
    );
  }
  function Ae(e, t, r) {
    return r
      ? Math.max(0, Math.min(e.bottom, t.bottom) - Math.max(e.top, t.top))
      : Math.max(0, Math.min(e.right, t.right) - Math.max(e.left, t.left));
  }
  function Re(e, t) {
    var r,
      n = (function () {
        var e,
          t = document.querySelectorAll(
            '.nav,.page.active button:not([disabled]),.page.active input:not([disabled]),.page.active [tabindex]:not([tabindex="-1"])',
          ),
          r = [];
        for (e = 0; e < t.length; e++) Ne(t[e]) || (ye(t[e]) && r.push(t[e]));
        return r;
      })(),
      o = e.getBoundingClientRect(),
      s = (o.left + o.right) / 2,
      i = (o.top + o.bottom) / 2,
      a = null,
      l = 1 / 0;
    for (r = 0; r < n.length; r++) {
      var c = n[r];
      if (c !== e) {
        var u,
          d,
          p,
          v = c.getBoundingClientRect(),
          g = (v.left + v.right) / 2 - s,
          f = (v.top + v.bottom) / 2 - i;
        if (37 === t && g < -4) ((u = -g), (d = Math.abs(f)), (p = !0));
        else if (39 === t && g > 4) ((u = g), (d = Math.abs(f)), (p = !0));
        else if (38 === t && f < -4) ((u = -f), (d = Math.abs(g)), (p = !1));
        else {
          if (!(40 === t && f > 4)) continue;
          ((u = f), (d = Math.abs(g)), (p = !1));
        }
        var h = u + d * (Ae(o, v, p) > 0 ? 0.35 : 2.5);
        h < l && ((l = h), (a = c));
      }
    }
    return a;
  }
  function Pe(e, t, r) {
    var n,
      o = document.querySelectorAll(".page"),
      s = document.querySelectorAll(".nav"),
      i = Q(e);
    if (i) {
      for ("servers" !== e && B && ((B = !1), ze()), n = 0; n < o.length; n++)
        o[n].classList.remove("active");
      for (n = 0; n < s.length; n++) s[n].classList.remove("active");
      i.classList.add("active");
      var a = be[e] || e,
        l = document.querySelector('[data-page="' + a + '"]');
      if ((l && l.classList.add("active"), Te && !1 !== r)) {
        var c = t && Q(t);
        if (!c && !ye(document.activeElement)) c = Ie()[0] || l;
        c && Ce(c);
      }
    }
  }
  function we(e) {
    I = e;
    var t,
      r = document.querySelectorAll(".chip");
    for (t = 0; t < r.length; t++)
      r[t].className =
        "chip" + (r[t].getAttribute("data-proto") === e ? " active" : "");
    Je();
  }
  function Oe(e) {
    if ("name" === e || "ping" === e) {
      W = e;
      try {
        window.localStorage && localStorage.setItem("alcyone.serverSort", e);
      } catch (e) {}
      var t,
        r = document.querySelectorAll(".sortBtn");
      for (t = 0; t < r.length; t++)
        r[t].className =
          "sortBtn" + (r[t].getAttribute("data-sort") === e ? " active" : "");
      Je();
    }
  }
  function Le() {
    var e;
    for (e = 0; e < s.profiles.length; e++)
      if (s.profiles[e].id === s.activeId) return s.profiles[e];
    return null;
  }
  function De() {
    var e;
    for (e = 0; e < s.profiles.length; e++)
      if (s.profiles[e].id === s.autostartProfileId) return s.profiles[e];
    return null;
  }
  function _e(e) {
    return (e && e.name) || "VPN";
  }
  function ke(e) {
    return (e && e.country) || "";
  }
  function xe(e) {
    if (!e) return "";
    var t = [];
    return (
      e.endpoint && t.push(e.endpoint),
      e.protocol && t.push(e.protocol),
      e.security && "none" !== e.security && t.push(e.security),
      e.transport && "tcp" !== e.transport && t.push(e.transport),
      t.join(" · ")
    );
  }
  function Ve() {
    var e,
      t = De(),
      r = Q("autostartState"),
      n = Q("autostartPageState"),
      o = Q("autostartServerSummary"),
      i = Q("autostartToggle"),
      a = Q("autostartStatus"),
      l = Q("autostartHelper");
    (r &&
      ((e = ge(q ? "settings.on" : t ? "settings.off" : "settings.setup")),
      (r.textContent = e),
      (r.className = "rState" + (q ? " on" : ""))),
      n &&
        ((n.textContent = ge(q ? "settings.on" : "settings.off")),
        (n.className = "statePill" + (q ? " on" : ""))),
      o &&
        (o.innerHTML = t
          ? '<span class="autostartServerName">' + z(_e(t)) + "</span>"
          : '<span class="autostartServerEmpty">' +
            z(ge("autostart.noServer")) +
            "</span>"),
      i &&
        (i.setAttribute("aria-checked", q ? "true" : "false"),
        (i.disabled = !t && !q),
        i.setAttribute("aria-disabled", t || q ? "false" : "true")));
    var c = Q("autostartChoose");
    (c && (c.disabled = !s.profiles.length),
      l &&
        (l.textContent = s.profiles.length
          ? ge("autostart.helper")
          : ge("autostart.noProfiles")),
      a && !a.textContent && (a.textContent = ""));
  }
  function Ue() {
    return (
      l ||
      ("starting" === u
        ? "connecting"
        : "stopping" === u
          ? "disconnecting"
          : "")
    );
  }
  function He() {
    return !!Ue();
  }
  function Me(e, t) {
    ((l = e || ""),
      "connecting" === e || "restarting" === e
        ? ((stateError = ""), (c = String(t || _e(Le()))))
        : e || (c = ""),
      Be());
  }
  function qe(e, t) {
    nt(
      function (r, n) {
        (void 0 !== t && t !== G) ||
          ((l = ""), (c = ""), Be(), e && e(r || null, n || null));
      },
      { suppressHomeRender: !0 },
    );
  }
  function Be() {
    var e,
      t = Le(),
      r = Ue(),
      n =
        ((e = Ue()),
        e
          ? "connecting" === e || "restarting" === e
            ? "connecting"
            : "disconnecting" === e || i
              ? "connected"
              : "off"
          : a
            ? i
              ? "connected"
              : "off"
            : ""),
      o = !!r,
      s = "connected" === n,
      l = Q("stateText"),
      u = Q("hint");
    function f(e) {
      l.textContent !== e && (l.textContent = e);
    }
    (r || a
      ? "connecting" === n
        ? (f(ge("vpn.connectingState") + (c || _e(Le()))),
          (u.textContent = ge("home.tapCancel")))
        : "connected" === n
          ? (f(ge("vpn.connectedState")),
            (u.textContent = ge(o ? "home.waiting" : "home.tapDisconnect")))
          : (f(ge("home.vpnOff")),
            (u.textContent = o
              ? ge("home.waiting")
              : F || ge("home.tapConnect")))
      : (f(stateError || ge("common.checking")),
        (u.textContent = stateError ? "" : ge("home.waiting"))),
      (l.className = "homeState " + (s ? "on" : "")));
    var h = Q("homeStage");
    h && (h.className = "homeStage " + (s ? "connected" : ""));
    var m,
      S = Q("power"),
      b = !a || !Nt(),
      E = Date.now() < g;
    (d &&
      !o &&
      ((p = Date.now() + 260),
      v && clearTimeout(v),
      (v = setTimeout(function () {
        ((v = null), He() || Be());
      }, 260))),
      o && ((p = 0), v && (clearTimeout(v), (v = null))),
      (d = o),
      (m = !o && Date.now() < p),
      (S.className =
        "power " +
        (s ? "on " : "") +
        (o ? "busy " + r + " " : "") +
        (E ? "pressed " : "") +
        (m ? "settling" : "")),
      (S.disabled = b),
      S.setAttribute("aria-busy", o ? "true" : "false"),
      S.setAttribute("aria-disabled", b || o ? "true" : "false"),
      It());
    var T = Q("current");
    (t
      ? ((T.className = "currentCard"),
        (T.innerHTML =
          '<span class="currentServer"><span class="currentFlagFrame">' +
          oe(ke(t)) +
          '</span><span class="currentServerBody"><b>' +
          z(_e(t)) +
          "</b></span></span>"),
        se(T))
      : ((T.className = "currentCard empty"),
        (T.textContent = ge("home.noServer"))),
      vt());
  }
  function Fe(e, t) {
    if ("all" !== I && String(e.protocol) !== I) return !1;
    if (!t) return !0;
    var r =
      "subscription" === e.sourceType
        ? e.subscriptionName || ge("servers.subscription")
        : ge("servers.manual");
    return (_e(e) + " " + xe(e) + " " + r).toLowerCase().indexOf(t) >= 0;
  }
  var Ye = {
    vless: "VLESS",
    hysteria2: "HYSTERIA2",
    trojan: "TROJAN",
    vmess: "VMESS",
    ss: "SS",
    socks: "SOCKS5",
  };
  function Ge(e) {
    return "$" + String(e || "");
  }
  function Xe(e) {
    var t = Ge(e.id),
      r = _[t];
    return k[t]
      ? '<span class="pingCell pending">...</span>'
      : null === r
        ? '<span class="pingCell unavailable">n/a</span>'
        : "number" != typeof r
          ? ""
          : '<span class="pingCell ' +
            (r <= 100 ? "good" : r <= 300 ? "average" : "poor") +
            '"><span class="pingDot"></span>' +
            r +
            " ms</span>";
  }
  function We(e, t) {
    if ("ping" === W) {
      var r = _[Ge(e.id)],
        n = _[Ge(t.id)],
        o = "number" == typeof r,
        s = "number" == typeof n;
      if (o && s && r !== n) return r - n;
      if (o !== s) return o ? -1 : 1;
    }
    return (function (e, t) {
      var r = _e(e).toLocaleLowerCase(),
        n = _e(t).toLocaleLowerCase(),
        o = r.localeCompare(n);
      return o || String(e.id || "").localeCompare(String(t.id || ""));
    })(e, t);
  }
  function Ke(e, t) {
    var r, n, o, i, a, l, c;
    if (e && t) {
      if ("group" === t.kind) {
        var u = e.querySelector(".gname"),
          d = e.querySelector(".gcount");
        return (
          u && (u.textContent = t.name || ""),
          void (
            d &&
            (d.textContent =
              t.count + " " + fe(t.count, t.pluralKey || "plural.servers"))
          )
        );
      }
      "card" === t.kind &&
        ((r = t.profile || {}),
        e.setAttribute("data-id", String(r.id || "")),
        (n = e.querySelector(".serverTitle")),
        (o = e.querySelector(".meta")),
        (i = e.querySelector(".badge")),
        (a = e.querySelector(".flag")),
        (l = e.querySelector(".pingCell")),
        (c = e.querySelector('button[data-act="select"]')),
        n && (n.textContent = _e(r)),
        o && (o.textContent = xe(r)),
        i &&
          (i.textContent =
            Ye[r.protocol] || String(r.protocol || "").toUpperCase()),
        a && a.setAttribute("src", ne(ke(r))),
        l && (l.outerHTML = Xe(r)),
        c &&
          (c.textContent = B
            ? r.id === s.autostartProfileId
              ? ge("servers.autostartSaved")
              : ge("servers.autostartUse")
            : r.id === s.activeId
              ? ge("servers.selected")
              : ge("servers.select")));
    }
  }
  function Qe(e, t) {
    var r =
      e && e.querySelector && e.querySelector('button[data-act="select"]');
    r &&
      (r.textContent = ge(
        B
          ? t
            ? "servers.autostartSaved"
            : "servers.autostartUse"
          : t
            ? "servers.selected"
            : "servers.select",
      ));
  }
  function ze() {
    var e = Q("servers"),
      t = Q("serversHeaderTitle"),
      r = Q("serversHeaderSub"),
      n = Q("serverPickerBack"),
      o = Q("serverPickerHint"),
      i = s.profiles.length;
    (e &&
      e.classList &&
      (B
        ? e.classList.add("autostartPicker")
        : e.classList.remove("autostartPicker")),
      t && (t.textContent = ge(B ? "servers.autostartTitle" : "nav.servers")),
      r &&
        (r.textContent = B
          ? ge("servers.autostartSub")
          : i + " " + fe(i, "plural.servers")),
      n && (n.style.display = B ? "" : "none"),
      o && (o.style.display = B ? "" : "none"));
  }
  function je(e, t) {
    return "group" === e.kind
      ? '<div class="groupHead" data-list-index="' +
          t +
          '"><span class="gname">' +
          z(e.name) +
          '</span><span class="gcount">' +
          e.count +
          " " +
          fe(e.count, e.pluralKey || "plural.servers") +
          "</span></div>"
      : "empty" === e.kind
        ? '<div class="empty-card" data-list-index="' +
          t +
          '"><b>' +
          ge(e.titleKey) +
          '</b><div class="meta">' +
          ge(e.hintKey) +
          "</div></div>"
        : (function (e, t) {
            var r = B ? s.autostartProfileId : s.activeId,
              n = e.id === r;
            if (B)
              return (
                '<div tabindex="0" class="card autostartPickCard ' +
                (n ? "active" : "") +
                '" data-id="' +
                z(e.id) +
                '" data-list-index="' +
                t +
                '">' +
                oe(ke(e)) +
                '<div class="cardBody"><div class="serverTitle">' +
                z(_e(e)) +
                '</div></div><span class="pickerMark" aria-hidden="true"><span></span></span></div>'
              );
            var o =
              '<button data-act="select" data-id="' +
              z(e.id) +
              '">' +
              ge(n ? "servers.selected" : "servers.select") +
              '</button><button data-act="delete" data-id="' +
              z(e.id) +
              '">' +
              ge("servers.delete") +
              "</button>";
            return (
              '<div tabindex="0" class="card ' +
              (n ? "active" : "") +
              '" data-id="' +
              z(e.id) +
              '" data-list-index="' +
              t +
              '">' +
              oe(ke(e)) +
              '<div class="cardBody"><div class="serverTitle">' +
              z(_e(e)) +
              '</div><div class="meta">' +
              z(xe(e)) +
              '</div></div><span class="badge">' +
              (Ye[e.protocol] || String(e.protocol).toUpperCase()) +
              "</span>" +
              Xe(e) +
              '<div class="rowActions">' +
              o +
              "</div></div>"
            );
          })(e.profile, t);
  }
  function Je() {
    var e = Q("serverList");
    if (e) {
      var t,
        r,
        n = String((Q("search") && Q("search").value) || "").toLowerCase(),
        o = "",
        i = [];
      ze();
      var a = [],
        l = {},
        c = [],
        u = {};
      for (t = 0; t < s.subscriptions.length; t++)
        ((l[s.subscriptions[t].id] = a.length),
          a.push({
            name: s.subscriptions[t].name || ge("servers.subscriptionCap"),
            items: [],
          }));
      for (t = 0; t < s.profiles.length; t++)
        Fe((r = s.profiles[t]), n) &&
          ("subscription" === r.sourceType &&
          r.subscriptionId &&
          void 0 !== l[r.subscriptionId]
            ? a[l[r.subscriptionId]].items.push(r)
            : "subscription" === r.sourceType
              ? (void 0 === u[r.subscriptionName || ""] &&
                  ((u[r.subscriptionName || ""] = a.length),
                  a.push({
                    name: r.subscriptionName || ge("servers.subscriptionCap"),
                    items: [],
                  })),
                a[u[r.subscriptionName || ""]].items.push(r))
              : c.push(r));
      for (t = 0; t < a.length; t++)
        if (a[t].items.length) {
          (a[t].items.sort(We),
            i.push({
              kind: "group",
              name: a[t].name,
              count: a[t].items.length,
              pluralKey: "plural.servers",
            }));
          for (var d = 0; d < a[t].items.length; d++)
            i.push({ kind: "card", profile: a[t].items[d] });
        }
      if (c.length) {
        (c.sort(We),
          i.push({
            kind: "group",
            name: ge("servers.manualGroup"),
            count: c.length,
            pluralKey: "plural.profiles",
          }));
        for (var p = 0; p < c.length; p++)
          i.push({ kind: "card", profile: c[p] });
      }
      var v = s.profiles.length,
        g = s.subscriptions.length,
        f =
          v +
          " " +
          fe(v, "plural.servers") +
          (g ? " · " + g + " " + fe(g, "plural.subs") : ""),
        h = Q("count");
      h && (h.textContent = f);
      var m = Q("serversHeaderSub");
      if (
        (!B && m && (m.textContent = f),
        ut(),
        i.length ||
          i.push({
            kind: "empty",
            titleKey: s.profiles.length
              ? "servers.nothingFound"
              : "servers.noProfiles",
            hintKey: s.profiles.length
              ? "servers.nothingFoundHint"
              : "servers.noProfilesHint",
          }),
        M)
      )
        M.setModel(i);
      else {
        for (t = 0; t < i.length; t++) o += je(i[t], t);
        ((e.innerHTML = o), se(e));
      }
    }
  }
  function $e() {
    var e = s.dnsServer || "",
      t = Q("vpnDnsState"),
      r = Q("dnsInput"),
      n = Q("dnsModeValue");
    (t && (t.textContent = s.dnsServer || ge("settings.vpnDnsAuto")),
      n &&
        ((n.textContent = s.dnsServer
          ? ge("settings.vpnDnsCustom") + s.dnsServer
          : ge("settings.vpnDnsAutomatic")),
        s.dnsServer
          ? n.removeAttribute("data-i18n")
          : n.setAttribute("data-i18n", "settings.vpnDnsAutomatic")),
      r && document.activeElement !== r && (r.value = e));
  }
  function Ze(e) {
    var t = Q("dnsStatus");
    t &&
      ((t.textContent = e || ""),
      (t.className = "dnsStatus" + (e ? " is-visible" : "")));
  }
  function et(e) {
    ee("getProfiles", {}, function (t, r) {
      if (t) return (J(re(t)), void (e && e()));
      (!(function (e) {
        var t = s.activeId,
          r = s.autostartProfileId;
        if (
          ((s.profiles = (e && e.profiles) || []),
          (s.subscriptions = (e && e.subscriptions) || []),
          (s.activeId = (e && e.activeId) || null),
          e &&
            Object.prototype.hasOwnProperty.call(e, "autostartProfileId") &&
            (s.autostartProfileId = e.autostartProfileId || null),
          (s.dnsServer = (e && e.dnsServer) || null),
          (s.connectionMode = "tun"),
          "tun",
          (s.lang = (e && e.lang) || "auto"),
          e && e.revision && (N = String(e.revision)),
          (C = !0),
          s.lang && !le && s.lang !== ae)
        ) {
          ae = s.lang;
          try {
            window.localStorage && localStorage.setItem("alcyone.lang", ae);
          } catch (e) {}
          ((le = !0), Se());
        }
        ($e(),
          Je(),
          M &&
            M.setSelectedProfile &&
            M.setSelectedProfile(
              B ? r : t,
              B ? s.autostartProfileId : s.activeId,
            ),
          Ve(),
          Be());
      })(r),
        e && e());
    });
  }
  function tt() {
    return "root" === R
      ? { homebrewRoot: !0 }
      : "unsupported" === R
        ? { homebrewRoot: !1 }
        : {};
  }
  function rt(e, t) {
    ((i = !(!e.vpn || !e.vpn.connected)),
      (u = (e.vpn && e.vpn.state) || (i ? "connected" : "idle")),
      "tun",
      (s.connectionMode = "tun"),
      e.vpn && e.vpn.activeMode ? e.vpn.activeMode : "",
      (a = !0),
      (stateError = ""),
      (q = !!e.autostart),
      !0,
      (A = (e.health && e.health.code) || ""),
      e.privilege && void 0 !== e.privilege.root ? e.privilege.root : null);
    var r = (e.lan && e.lan.port) || (T && T.port) || 0,
      n =
        e.lan && e.lan.addresses && e.lan.addresses.length
          ? e.lan.addresses
          : (T && T.addresses) || [];
    ((T =
      e.lan && e.lan.pairingActive
        ? {
            secondsRemaining: e.lan.secondsRemaining,
            code: (T && T.code) || "",
            addresses: n,
            port: r,
          }
        : null),
      Ve(),
      t || Be());
  }
  function nt(e, t) {
    ((t = t || {}),
      ee("getState", tt(), function (r, n) {
        return r
          ? ((a = !1),
            (stateError = re(r)),
            t.suppressHomeRender || Be(),
            void (e && e(r)))
          : (rt(n, t.suppressHomeRender),
            "ELEVATION_REQUIRED" !== A ||
            ("unknown" !== R && "check-failed" !== R)
              ? (Rt(), void (e && e(null, n)))
              : (function (e) {
                  if ("checking" === R) return void (e && e(R));
                  ((R = "checking"),
                    It(),
                    te(Et, "checkRoot", {}, 15e3, function (t, r) {
                      ((R =
                        t ||
                        !r ||
                        void 0 !== r.errorCode ||
                        "boolean" != typeof r.returnValue
                          ? "check-failed"
                          : r.returnValue
                            ? "root"
                            : "unsupported"),
                        e && e(R));
                    }));
                })(function () {
                  (Rt(), t.suppressHomeRender || Be(), e && e(null, n));
                }));
      }));
  }
  function ot(e) {
    if (
      ((B = !1),
      ze(),
      Pe(
        "autostart",
        e && "dpad" === e.input ? "autostartChoose" : null,
        e && "dpad" === e.input,
      ),
      Je(),
      M && M.render(!e || "dpad" !== e.input),
      e && "dpad" === e.input)
    ) {
      var t = Q("autostartChoose");
      t && Ce(t, !0);
    }
  }
  function st() {
    var e = De(),
      t = Q("autostartStatus");
    q || e
      ? (t && (t.textContent = ""),
        ee("setAutostart", { enabled: !q }, function (e, r) {
          if (e) return (t && (t.textContent = re(e)), void J(re(e)));
          ((q = !(!r || !r.enabled)),
            !0,
            r &&
              Object.prototype.hasOwnProperty.call(r, "profileId") &&
              (s.autostartProfileId = r.profileId || null),
            Ve());
        }))
      : t &&
        (t.textContent = s.profiles.length
          ? ge("autostart.noServer")
          : ge("autostart.noProfiles"));
  }
  function it(e, t) {
    if (B)
      return (function (e, t) {
        var r = Q("autostartStatus");
        ee("setAutostartProfile", { profileId: e }, function (n, o) {
          if (n) return (r && (r.textContent = re(n)), void J(re(n)));
          ((s.autostartProfileId = (o && o.profileId) || e),
            o && void 0 !== o.enabled && ((q = !!o.enabled), !0),
            r && (r.textContent = ge("servers.autostartSaved")),
            Ve(),
            ot(t || { input: "pointer" }));
        });
      })(e, t);
    if (!He()) {
      var r = s.activeId,
        n = i && e !== s.activeId;
      ee("selectProfile", { profileId: e, reconnect: n }, function (t, o) {
        t
          ? J(re(t))
          : ((s.activeId = (o && o.profileId) || e),
            M && M.setSelectedProfile && M.setSelectedProfile(r, s.activeId),
            Be(),
            et(function () {
              (J(ge("servers.selectedLog") + _e(Le())), n && nt());
            }));
      });
    }
  }
  function at() {
    var e,
      t = Le();
    return Nt()
      ? t
        ? ((F = ""),
          (e = ++G),
          "connecting" !== l && Me("connecting", _e(t)),
          J(ge("vpn.starting") + _e(t)),
          void ee(
            "connect",
            {},
            function (t) {
              var r;
              e === G &&
                (t &&
                  ((r = re(t)),
                  (F = String(r || "")),
                  Y && clearTimeout(Y),
                  (Y = null),
                  F &&
                    (Y = setTimeout(function () {
                      ((Y = null), (F = ""), Be());
                    }, 9e3)),
                  Be(),
                  "SERVICE_TIMEOUT" === t.errorCode &&
                    ee("disconnect", {}, function () {})),
                qe(null, e));
            },
            4e4,
          ))
        : (J(ge("vpn.noServer")), void Me(""))
      : (J(
          ge(
            "HOMEBREW_UNKNOWN" === yt()
              ? "hb.checkText"
              : "err.HOMEBREW_REQUIRED",
          ),
        ),
        void Me(""));
  }
  function lt() {
    var e = ++G;
    ((F = ""),
      Me("disconnecting"),
      ee("disconnect", {}, function (t) {
        e === G && (t && J(re(t)), qe(null, e));
      }));
  }
  function ct(e) {
    if (He()) e && e({ errorCode: "BUSY" });
    else {
      var t = ++G;
      (Me("restarting", _e(Le())),
        ee("restart", {}, function (r) {
          t === G &&
            (r && J(re(r)),
            qe(function () {
              e && e(r || null);
            }, t));
        }));
    }
  }
  function ut() {
    var e = Q("pingServers");
    e &&
      ((e.disabled = !x && !s.profiles.length),
      e.classList && (x ? e.classList.add("busy") : e.classList.remove("busy")),
      e.setAttribute && e.setAttribute("aria-busy", x ? "true" : "false"),
      (e.textContent =
        x && U
          ? ge("servers.pinging") + " " + U.done + "/" + U.total
          : ge("servers.ping")));
  }
  function dt() {
    var e, t, r, o, i;
    if (x)
      return (
        V++,
        (x = !1),
        (U = null),
        (k = {}),
        ut(),
        void (M && M.refresh())
      );
    if (s.profiles.length) {
      for (
        t = ++V, r = M ? M.visibleProfileIds() : [], o = [], e = 0;
        e < r.length;
        e++
      )
        o.push(r[e]);
      for (e = 0; e < s.profiles.length; e++)
        o.indexOf(s.profiles[e].id) < 0 && o.push(s.profiles[e].id);
      for (i = [], e = 0; e < o.length; e += 12) i.push(o.slice(e, e + 12));
      for (x = !0, _ = {}, k = {}, e = 0; e < s.profiles.length; e++)
        k[Ge(s.profiles[e].id)] = !0;
      ((U = { batches: i, index: 0, done: 0, total: o.length, generation: t }),
        ut(),
        M ? M.refresh() : Je(),
        (function e() {
          var r, o, s;
          if (x && t === V && U && U.generation === t) {
            if (U.index >= U.batches.length)
              return (
                (x = !1),
                (k = {}),
                ut(),
                "ping" === W ? Je() : M ? M.refresh() : Je(),
                void J(ge("servers.pingDone"))
              );
            ((r = U.batches[U.index++]),
              te(n, "probeProfiles", { profileIds: r }, 2e4, function (n, i) {
                var a = (i && i.probes) || [];
                if (x && t === V) {
                  for (n && J(re(n)), o = 0; o < r.length; o++)
                    ((s = Ge(r[o])), (k[s] = !1), n && (_[s] = null));
                  for (o = 0; o < a.length; o++)
                    ((s = Ge(a[o].id)),
                      (_[s] =
                        "number" == typeof a[o].latencyMs
                          ? a[o].latencyMs
                          : null),
                      (k[s] = !1),
                      M && M.patchProfile(a[o].id, Xe({ id: a[o].id })));
                  ((U.done += r.length), ut(), e());
                }
              }));
          }
        })());
    }
  }
  function pt(e) {
    var t = s.dnsServer || null,
      r = (function (e) {
        var t, r, n;
        if (!(e = String(e || "").trim())) return null;
        if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(e)) return "";
        for (t = e.split("."), r = 0; r < t.length; r++) {
          if (t[r].length > 1 && "0" === t[r].charAt(0)) return "";
          if (!((n = parseInt(t[r], 10)) >= 0 && n <= 255)) return "";
        }
        return 0 === (n = parseInt(t[0], 10)) ||
          10 === n ||
          127 === n ||
          n >= 224 ||
          (100 === n &&
            parseInt(t[1], 10) >= 64 &&
            parseInt(t[1], 10) <= 127) ||
          (169 === n && 254 === parseInt(t[1], 10)) ||
          (172 === n && parseInt(t[1], 10) >= 16 && parseInt(t[1], 10) <= 31) ||
          (192 === n &&
            (168 === parseInt(t[1], 10) || 0 === parseInt(t[1], 10))) ||
          (198 === n &&
            (18 === parseInt(t[1], 10) ||
              19 === parseInt(t[1], 10) ||
              51 === parseInt(t[1], 10))) ||
          (203 === n && 0 === parseInt(t[1], 10) && 113 === parseInt(t[2], 10))
          ? ""
          : t
              .map(function (e) {
                return String(parseInt(e, 10));
              })
              .join(".");
      })(e);
    "" !== r
      ? (Ze(ge("common.checking")),
        ee("setDnsServer", { dnsServer: r }, function (e, r) {
          var n = r && r.dnsServer ? r.dnsServer : null;
          e
            ? Ze(re(e))
            : ((s.dnsServer = n),
              $e(),
              n !== t && i
                ? ct(function (e) {
                    Ze(
                      ge(
                        e
                          ? "settings.vpnDnsReconnectFailed"
                          : "settings.vpnDnsSaved",
                      ),
                    );
                  })
                : Ze(ge("settings.vpnDnsSaved")));
        }))
      : Ze(ge("settings.vpnDnsInvalid"));
  }
  function vt() {
    var e = Q("pairState"),
      t = Q("pairBox"),
      r = Q("webUrl"),
      n = Q("webHint"),
      o = Q("webPairInfo"),
      s = Q("webCode"),
      i = Q("webExpiry");
    if (
      (e &&
        ((e.textContent = ge(T ? "settings.on" : "settings.off")),
        (e.className = "rState" + (T ? " on" : ""))),
      T)
    ) {
      var a = T.addresses || [],
        l = T.port ? ":" + T.port : "";
      ((y = a.length ? "http://" + a[0] + l : ""),
        r &&
          ((r.textContent = y || ge("home.webStarting")),
          r.removeAttribute("data-i18n")),
        n &&
          ((n.textContent = ge("home.webHint")),
          n.setAttribute("data-i18n", "home.webHint")),
        o &&
          ((o.style.display = "block"),
          s && (s.textContent = T.code || ""),
          i &&
            (i.textContent =
              ge("pair.expires") +
              (T.secondsRemaining || 0) +
              ge("pair.seconds"))));
    } else
      ((y = ""),
        r &&
          ((r.textContent = ge("home.webOff")),
          r.setAttribute("data-i18n", "home.webOff")),
        n &&
          ((n.textContent = ge("home.webHintOff")),
          n.setAttribute("data-i18n", "home.webHintOff")),
        o && (o.style.display = "none"));
    if (t)
      if (T) {
        var c = T.addresses || [],
          u = T.port ? ":" + T.port : "";
        t.innerHTML =
          '<div class="pairCode"><span class="pairLabel">' +
          z(ge("pair.code")) +
          "</span><b>" +
          z(T.code || "") +
          '</b></div><div class="pairAddr"><span class="pairLabel">' +
          z(ge("pair.address")) +
          "</span>" +
          z(
            c
              .map(function (e) {
                return "http://" + e + u;
              })
              .join("  "),
          ) +
          '</div><div class="pairExpiry">' +
          z(
            ge("pair.expires") + (T.secondsRemaining || 0) + ge("pair.seconds"),
          ) +
          '</div><div class="pairWarn">' +
          z(ge("pair.warning")) +
          "</div>";
      } else
        t.innerHTML =
          '<div class="pairClosed">' + z(ge("pair.closed")) + "</div>";
  }
  function gt(e) {
    ee("startPairing", { forceNew: !!(e = e || {}).forceNew }, function (e, t) {
      e
        ? J(re(e))
        : ((T = {
            code: t.code,
            addresses: t.addresses || [],
            port: t.port,
            secondsRemaining: Math.max(
              0,
              Math.round(((t.expiresAt || 0) - Date.now()) / 1e3),
            ),
          }),
          vt(),
          E && clearInterval(E),
          (E = setInterval(function () {
            T &&
              (T.secondsRemaining--,
              T.secondsRemaining <= 0 &&
                (clearInterval(E), (E = null), (T = null), nt()),
              vt());
          }, 1e3)));
    });
  }
  function ft() {
    ee("stopPairing", {}, function (e) {
      (e && J(re(e)),
        E && (clearInterval(E), (E = null)),
        (T = null),
        vt(),
        nt());
    });
  }
  function ht() {
    h
      ? (m = !0)
      : ((h = !0),
        nt(function () {
          et(function () {
            ((h = !1), m && ((m = !1), ht()));
          });
        }));
  }
  function mt() {
    var e = void 0 !== document.hidden ? "hidden" : "webkitHidden";
    document[e] || ht();
  }
  function St() {
    if (
      (b && (clearInterval(b), (b = null)),
      L && (clearTimeout(L), (L = null)),
      E && (clearInterval(E), (E = null)),
      S && document.removeEventListener)
    ) {
      var e =
        void 0 !== document.hidden
          ? "visibilitychange"
          : "webkitvisibilitychange";
      (document.removeEventListener(e, mt, !0),
        document.removeEventListener("webOSRelaunch", ht, !0),
        (S = !1));
    }
  }
  function bt() {
    if (!X) {
      X = !0;
      var e = Q("logsRefresh");
      (e && ((e.disabled = !0), (e.textContent = ge("logs.loading"))),
        ee("getLogs", {}, function (t, r) {
          if (
            ((X = !1),
            e && ((e.disabled = !1), (e.textContent = ge("logs.refresh"))),
            t)
          )
            J(re(t), !0);
          else {
            var n = (r && r.log) || ge("logs.empty"),
              o = (r && r.tunnelLog) || ge("logs.empty");
            J(
              ge("logs.header") +
                "\n" +
                ge("logs.service") +
                "\n" +
                n +
                "\n" +
                ge("logs.core") +
                "\n" +
                o,
              !0,
            );
          }
        }));
    }
  }
  var Et = "luna://org.webosbrew.hbchannel.service",
    Tt = ["com.alcyone.vpn.service", "com.alcyone.vpn.singbox.service"];
  function yt() {
    return "HOMEBREW_REQUIRED" === A
      ? "HOMEBREW_REQUIRED"
      : "ELEVATION_REQUIRED" !== A
        ? ""
        : "unsupported" === R
          ? "HOMEBREW_REQUIRED"
          : "root" === R
            ? "ELEVATION_REQUIRED"
            : "HOMEBREW_UNKNOWN";
  }
  function Nt() {
    var e = yt();
    return "" === e || ("ELEVATION_REQUIRED" === e && !P);
  }
  function It() {
    var e = Q("elevationBanner"),
      t = Q("elevationTitle"),
      r = Q("elevationText"),
      n = Q("grantPermissions"),
      o = yt();
    if (e) {
      if (!o)
        return (
          (e.style.display = "none"),
          void (n && (n.style.display = "none"))
        );
      if (((e.style.display = "block"), "HOMEBREW_REQUIRED" === o))
        return (
          t && (t.textContent = ge("hb.title")),
          r && (r.textContent = ge("hb.text")),
          void (n && (n.style.display = "none"))
        );
      if ("HOMEBREW_UNKNOWN" === o)
        return (
          t && (t.textContent = ge("hb.checkTitle")),
          r && (r.textContent = ge("hb.checkText")),
          void (n && (n.style.display = "none"))
        );
      if (P && O)
        return (
          t && (t.textContent = ge("elev.preparingTitle")),
          r && (r.textContent = D || ge("elev.preparing")),
          void (n && (n.style.display = "none"))
        );
      (t && (t.textContent = ge("elev.title")),
        r && (r.textContent = D || ge("elev.text")),
        n &&
          ((n.style.display = ""),
          (n.disabled = P),
          (n.textContent = ge(P ? "elev.working" : "elev.grant"))));
    }
  }
  function Ct(e) {
    ((D = e || ""), It());
  }
  function At(e) {
    ((P = !1),
      (O = !1),
      L && (clearTimeout(L), (L = null)),
      Ct(e ? ge(e) : ""));
  }
  function Rt() {
    w || P || ("ELEVATION_REQUIRED" === yt() && ((w = !0), Pt(!0)));
  }
  function Pt(t) {
    if (!P && "ELEVATION_REQUIRED" === yt()) {
      var r = (function () {
        var t = String((e && e.serviceId) || "");
        return Tt.indexOf(t) >= 0 ? t : "";
      })();
      if (!r) return At("elev.failed");
      ((P = !0),
        Ct(ge((O = !0 === t) ? "elev.preparing" : "elev.working")),
        te(Et, "elevateService", { id: r }, 6e4, function (e, t) {
          if (e || !t || !0 !== t.returnValue) return At("elev.failed");
          (Ct(ge("elev.restarting")),
            ee("restartService", {}, function (e) {
              if (e) return At("elev.failed");
              (Ct(ge("elev.waiting")),
                (function e(t) {
                  L = setTimeout(function () {
                    ((L = null),
                      ee("getState", tt(), function (r, n) {
                        var o = n && n.privilege;
                        return !r && o && 0 === o.uid
                          ? (rt(n), At("elev.done"), void ht())
                          : (!r && n && rt(n),
                            t + 1 >= 15 ? At("elev.timeout") : void e(t + 1));
                      }));
                  }, 1e3);
                })(0));
            }));
        }));
    }
  }
  function wt() {
    var e,
      t = document.querySelectorAll(".nav");
    for (
      window.AlcyoneServerList &&
        Q("serverList") &&
        (M = window.AlcyoneServerList.create({
          list: Q("serverList"),
          focusElement: Ce,
          renderItem: je,
          updateItem: Ke,
          updateSelection: Qe,
          onRendered: se,
          onAction: function (e, t, r, n) {
            "delete" === e
              ? (function (e) {
                  ee("deleteProfile", { profileId: e }, function (e) {
                    e
                      ? J(re(e))
                      : et(function () {
                          J(ge("servers.deletedLog"));
                        });
                  });
                })(t)
              : it(t, n);
          },
        })),
        e = 0;
      e < t.length;
      e++
    )
      t[e].onclick = function () {
        var e = this.getAttribute("data-page");
        "servers" === e && B ? ot({ input: "pointer" }) : Pe(e);
      };
    var r = document.querySelectorAll(".chip");
    for (e = 0; e < r.length; e++)
      r[e].onclick = function () {
        we(this.getAttribute("data-proto"));
      };
    var n = document.querySelectorAll(".sortBtn");
    for (e = 0; e < n.length; e++)
      n[e].onclick = function () {
        Oe(this.getAttribute("data-sort"));
      };
    (Oe(W),
      (Q("power").onclick = function () {
        var e;
        "starting" !== u && "connecting" !== l
          ? He() ||
            ((g = Date.now() + 160),
            f && clearTimeout(f),
            (f = setTimeout(function () {
              ((f = null), (g = 0), Be());
            }, 160)),
            Be(),
            (e = Le()),
            i || e
              ? (Me(i ? "disconnecting" : "connecting", _e(e)),
                nt(function (e) {
                  if (e) {
                    stateError = re(e);
                    J(stateError, !0);
                    return void Me("");
                  }
                  "starting" !== u && "stopping" !== u
                    ? i
                      ? lt()
                      : at()
                    : Me("");
                }))
              : J(ge("vpn.noServer")))
          : lt();
      }),
      Q("pingServers") && (Q("pingServers").onclick = dt),
      Q("refresh") &&
        (Q("refresh").onclick = function () {
          et(function () {
            nt();
          });
        }),
      Q("subUpdate") &&
        (Q("subUpdate").onclick = function () {
          var e = Q("subUpdate");
          ((e.disabled = !0),
            (e.textContent = ge("servers.subUpdating")),
            J(ge("servers.subUpdatingLog")),
            ee("updateSubscriptions", {}, function (t, r) {
              ((e.disabled = !1),
                (e.textContent = ge("servers.subUpdate")),
                t
                  ? J(re(t))
                  : (((r && r.results) || []).forEach(function (e) {
                      J(
                        (function (e) {
                          var t = parseInt(e && e.count, 10) || 0,
                            r = parseInt(e && e.skippedCount, 10) || 0,
                            n = t + ge("servers.subImported");
                          return (
                            r &&
                              (n +=
                                ge("servers.xhttpSkippedPrefix") +
                                r +
                                ge("servers.xhttpSkippedSuffix")),
                            n
                          );
                        })(e),
                      );
                    }),
                    r &&
                      r.failed &&
                      J(
                        ge("err.generic") +
                          r.failures
                            .map(function (e) {
                              return e.errorCode;
                            })
                            .join(", "),
                      )),
                et());
            }));
        }),
      Q("search") &&
        (Q("search").oninput = function () {
          (H && clearTimeout(H),
            (H = setTimeout(function () {
              ((H = null), Je());
            }, 120)));
        }),
      Q("rowRestart") &&
        (Q("rowRestart").onclick = function () {
          He() || ct();
        }),
      Q("rowCheckIp") &&
        (Q("rowCheckIp").onclick = function () {
          var e = Q("checkIpSub");
          (e && (e.textContent = ge("settings.checking")),
            ee("checkExternalIp", {}, function (t, r) {
              e &&
                (!t && r && r.address
                  ? (e.textContent =
                      (r.viaVpn
                        ? ge("settings.viaVpn")
                        : ge("settings.direct")) + r.address)
                  : (e.textContent = ge("settings.ipFail")));
            }));
        }),
      Q("rowVpnDns") &&
        (Q("rowVpnDns").onclick = function () {
          (Pe("dns"), $e(), Ze(""));
        }),
      Q("dnsSave") &&
        (Q("dnsSave").onclick = function () {
          pt(Q("dnsInput") && Q("dnsInput").value);
        }),
      Q("dnsDefault") &&
        (Q("dnsDefault").onclick = function () {
          (Q("dnsInput") && (Q("dnsInput").value = ""), pt(""));
        }),
      Q("rowLang") &&
        (Q("rowLang").onclick = function () {
          !(function (e) {
            ae = e;
            try {
              window.localStorage && localStorage.setItem("alcyone.lang", e);
            } catch (e) {}
            ((le = !0),
              (s.lang = e),
              C && ee("setLanguage", { lang: e }, function () {}),
              Se());
          })("auto" === ae ? "ru" : "ru" === ae ? "en" : "auto");
        }),
      Q("rowAutostart") &&
        (Q("rowAutostart").onclick = function () {
          (Pe("autostart", "autostartToggle", Te),
            Ve(),
            Te &&
              Q("autostartToggle") &&
              Q("autostartToggle").disabled &&
              Ce(Q("autostartChoose")));
        }),
      Q("autostartToggle") && (Q("autostartToggle").onclick = st),
      Q("autostartChoose") &&
        (Q("autostartChoose").onclick = function () {
          !(function (e) {
            if (
              ((B = !0),
              ze(),
              Pe("servers", null, !e || "dpad" === e.input),
              Je(),
              M ? M.render(!e || "dpad" !== e.input) : se(Q("serverList")),
              e && "dpad" === e.input)
            ) {
              var t =
                document.querySelector("#serverList .card.active") ||
                document.querySelector("#serverList .card");
              t && Ce(t, !0);
            }
          })({ input: Te ? "dpad" : "pointer" });
        }),
      Q("serverPickerBack") &&
        (Q("serverPickerBack").onclick = function () {
          ot({ input: Te ? "dpad" : "pointer" });
        }),
      Q("rowPair") &&
        (Q("rowPair").onclick = function () {
          (Pe("pair"), vt());
        }),
      Q("pairStart") &&
        (Q("pairStart").onclick = function () {
          gt({ forceNew: !0 });
        }),
      Q("pairStop") && (Q("pairStop").onclick = ft),
      Q("grantPermissions") &&
        (Q("grantPermissions").onclick = function () {
          Pt(!1);
        }),
      Q("rowLogs") &&
        (Q("rowLogs").onclick = function () {
          (Pe("logs"), bt());
        }),
      Q("rowAbout") &&
        (Q("rowAbout").onclick = function () {
          Pe("about");
        }),
      Q("rowDonate") &&
        (Q("rowDonate").onclick = function () {
          Pe("donate");
        }),
      Q("rowDonate2") &&
        (Q("rowDonate2").onclick = function () {
          Pe("donate");
        }));
    var o = document.querySelectorAll(".backBtn");
    for (e = 0; e < o.length; e++)
      o[e].onclick = function () {
        var e =
          this.parentNode &&
          this.parentNode.parentNode &&
          this.parentNode.parentNode.id;
        Pe(this.getAttribute("data-back") || "settings", Ee[e]);
      };
    (document.addEventListener("keydown", function (e) {
      if (e.keyCode >= 37 && e.keyCode <= 40)
        return (
          (Te = !0),
          document.body.classList.add("dpad-mode"),
          void (
            (function (e) {
              var t,
                r = document.activeElement,
                n = document.querySelector(".nav.active");
              if (!ye(r) || r === document.body) {
                if (!Ce(n)) return !1;
                r = n;
              }
              var settingsNav = document.querySelector('.nav[data-page="settings"]');
              if (
                B &&
                37 === e &&
                Q("servers") &&
                Q("servers").contains(r) &&
                "INPUT" !== r.tagName
              )
                return Ce(settingsNav);
              if (
                M &&
                Q("serverList") &&
                Q("serverList").contains(r) &&
                M.moveFocus(r, e)
              )
                return !0;
              if ("autostartToggle" === r.id) {
                if (38 === e)
                  return Ce(document.querySelector("#autostart .backBtn"));
                if (40 === e) return Ce(Q("autostartChoose"));
                if (37 === e) return Ce(settingsNav);
                if (39 === e) return !0;
              }
              if ("autostartChoose" === r.id) {
                if (((t = Q("autostartToggle")), 38 === e))
                  return Ce(
                    !t || t.disabled
                      ? document.querySelector("#autostart .backBtn")
                      : t,
                  );
                if (37 === e) return Ce(settingsNav);
                if (39 === e || 40 === e) return !0;
              }
              if (
                r.classList &&
                r.classList.contains("backBtn") &&
                r.parentNode &&
                r.parentNode.parentNode &&
                "autostart" === r.parentNode.parentNode.id
              ) {
                if (((t = Q("autostartToggle")), 40 === e))
                  return Ce(!t || t.disabled ? Q("autostartChoose") : t);
                if (37 === e) return Ce(settingsNav);
                if (38 === e) return !0;
              }
              if ("search" === r.id) {
                if (40 === e)
                  return Ce(
                    document.querySelector(".chip.active") ||
                      document.querySelector(".chip"),
                  );
                if (
                  39 === e &&
                  (void 0 === r.selectionStart ||
                    r.selectionStart === r.value.length)
                )
                  return Ce(Q("pingServers"));
                if (
                  37 === e &&
                  (void 0 === r.selectionStart || 0 === r.selectionStart)
                )
                  return Ce(n);
                if (37 === e || 39 === e) return !1;
              }
              if ("pingServers" === r.id) {
                if (37 === e) return Ce(Q("search"));
                if (39 === e) return Ce(Q("refresh"));
                if (40 === e)
                  return Ce(
                    document.querySelector(".chip.active") ||
                      document.querySelector(".chip"),
                  );
              }
              if ("refresh" === r.id) {
                if (37 === e) return Ce(Q("pingServers"));
                if (39 === e) return Ce(Q("subUpdate"));
                if (40 === e)
                  return Ce(
                    document.querySelector(".chip.active") ||
                      document.querySelector(".chip"),
                  );
              }
              if ("subUpdate" === r.id) {
                if (37 === e) return Ce(Q("refresh"));
                if (40 === e)
                  return Ce(
                    document.querySelector(".chip.active") ||
                      document.querySelector(".chip"),
                  );
              }
              if ("dnsInput" === r.id) {
                if (38 === e)
                  return Ce(document.querySelector("#dns .backBtn"));
                if (40 === e) return Ce(Q("dnsSave"));
                if (37 === e || 39 === e) return !1;
              }
              if ("dnsSave" === r.id) {
                if (38 === e) return Ce(Q("dnsInput"));
                if (40 === e) return Ce(Q("dnsDefault"));
                if (39 === e) return Ce(Q("dnsDefault"));
                if (37 === e) return Ce(Q("dnsInput"));
              }
              if ("dnsDefault" === r.id) {
                if (38 === e) return Ce(Q("dnsSave"));
                if (37 === e) return Ce(Q("dnsSave"));
                if (39 === e) return !0;
              }
              if (r.classList && r.classList.contains("chip")) {
                var o,
                  s = document.querySelectorAll(".chip"),
                  i = -1;
                for (o = 0; o < s.length; o++) s[o] === r && (i = o);
                if (37 === e && i > 0) return Ce(s[i - 1]);
                if (39 === e && i >= 0 && i < s.length - 1) return Ce(s[i + 1]);
                if (39 === e && i === s.length - 1)
                  return Ce(document.querySelector(".sortBtn"));
                if (38 === e) return Ce(Q("search"));
                if (40 === e)
                  return Ce(document.querySelector("#serverList .card"));
              }
              if (r.classList && r.classList.contains("sortBtn")) {
                var a,
                  l = document.querySelectorAll(".sortBtn"),
                  c = document.querySelectorAll(".chip"),
                  u = -1;
                for (a = 0; a < l.length; a++) l[a] === r && (u = a);
                if (37 === e && u > 0) return Ce(l[u - 1]);
                if (37 === e && 0 === u) return Ce(c[c.length - 1]);
                if (39 === e && u >= 0 && u < l.length - 1) return Ce(l[u + 1]);
                if (39 === e && u === l.length - 1) return !0;
                if (38 === e) return Ce(Q("subUpdate"));
                if (40 === e)
                  return Ce(document.querySelector("#serverList .card"));
              }
              if (r.classList && r.classList.contains("card")) {
                if (B && 37 === e) return Ce(Q("serverPickerBack"));
                if (37 === e) return Ce(n);
                if (39 === e && B) return !0;
                if (39 === e)
                  return Ce(r.querySelector('button[data-act="select"]'));
              }
              if (r.getAttribute && r.getAttribute("data-act")) {
                var d = r.getAttribute("data-act"),
                  p = r.parentNode && r.parentNode.parentNode;
                if (37 === e && "select" === d) return Ce(p);
                if (37 === e && "delete" === d)
                  return Ce(p.querySelector('button[data-act="select"]'));
                if (39 === e && "select" === d)
                  return Ce(p.querySelector('button[data-act="delete"]'));
                if (39 === e && "delete" === d) return !0;
              }
              if ("INPUT" === r.tagName && (37 === e || 39 === e)) return !1;
              if ("PRE" === r.tagName && (38 === e || 40 === e)) {
                var v = 38 === e ? -96 : 96;
                if (
                  38 === e
                    ? r.scrollTop > 0
                    : r.scrollTop + r.clientHeight < r.scrollHeight
                )
                  return ((r.scrollTop += v), !0);
              }
              if (r.classList && r.classList.contains("nav")) {
                var g,
                  f = document.querySelectorAll(".nav"),
                  h = -1;
                for (g = 0; g < f.length; g++) f[g] === r && (h = g);
                if (38 === e && h > 0) return Ce(f[h - 1]);
                if (40 === e && h >= 0 && h < f.length - 1) return Ce(f[h + 1]);
                if (39 === e) {
                  var m = Ie();
                  return !!m.length && Ce(m[0]);
                }
                if (37 === e) return !0;
              }
              var S = Re(r, e);
              return (S || 37 !== e || (S = n), Ce(S));
            })(e.keyCode) && e.preventDefault()
          )
        );
      if (13 === e.keyCode && Te && !e.defaultPrevented) {
        var t = document.activeElement;
        if (
          t &&
          ("BUTTON" === t.tagName ||
            (t.classList && t.classList.contains("card")))
        )
          return (e.preventDefault(), void t.click());
      }
      if (461 === e.keyCode || 27 === e.keyCode) {
        var r = document.querySelector(".page.active");
        if (r && "servers" === r.id && B)
          return (e.preventDefault(), void ot({ input: "dpad" }));
        r && be[r.id] && (e.preventDefault(), Pe("settings", Ee[r.id]));
      }
    }),
      document.addEventListener(
        "mousedown",
        function () {
          ((Te = !1), document.body.classList.remove("dpad-mode"));
        },
        !0,
      ),
      document.addEventListener(
        "touchstart",
        function () {
          ((Te = !1), document.body.classList.remove("dpad-mode"));
        },
        !0,
      ),
      Q("logsRefresh") && (Q("logsRefresh").onclick = bt),
      Q("clearLog") &&
        (Q("clearLog").onclick = function () {
          if (!X) {
            X = !0;
            var e = Q("clearLog");
            (e && (e.disabled = !0),
              ee("clearLogs", {}, function (t) {
                ((X = !1),
                  e && (e.disabled = !1),
                  t
                    ? J(ge("logs.clearFailed"), !0)
                    : (Q("log") && (Q("log").textContent = ""),
                      (j = ""),
                      J(ge("logs.cleared"), !0)));
              }));
          }
        }),
      Q("freezeLog") &&
        (Q("freezeLog").onclick = function () {
          J(ge("logs.frozen"), !0);
        }));
  }
  document.addEventListener("DOMContentLoaded", function () {
    ((document.title = e.title),
      Q("editionBrand") && (Q("editionBrand").textContent = e.coreLabel),
      Q("editionVersion") &&
        (Q("editionVersion").textContent = e.coreLabel + " · v" + t),
      Q("aboutVersion") &&
        (Q("aboutVersion").textContent = e.coreLabel + " · v" + t),
      he());
    var r = Q("langState");
    (r && (r.textContent = me()),
      window.webOS &&
        webOS.service &&
        webOS.service.request &&
        webOS.service.request("luna://com.webos.settingsservice", {
          method: "getSystemSettings",
          parameters: { keys: ["localeInfo"] },
          onSuccess: function (e) {
            var t = "";
            try {
              var r = e && e.settings && e.settings.localeInfo;
              r &&
                (t =
                  (r.locales && (r.locales.UI || r.locales.TV)) ||
                  r.locale ||
                  "");
            } catch (e) {}
            ("string" != typeof t && (t = ""),
              t && t !== ce && ((ce = t), "auto" === ae && Se()));
          },
          onFailure: function () {},
        }),
      wt(),
      (function () {
        if (!S) {
          var e =
            "hidden" ===
            (void 0 !== document.hidden ? "hidden" : "webkitHidden")
              ? "visibilitychange"
              : "webkitvisibilitychange";
          (document.addEventListener(e, mt, !0),
            document.addEventListener("webOSRelaunch", ht, !0),
            (S = !0));
        }
      })(),
      (window.webOS && webOS.service && webOS.service.request) ||
        window.PalmServiceBridge ||
        window.WebOSServiceBridge ||
        J(ge("app.noBridge")),
      ht(),
      gt(),
      (b = setInterval(function () {
        var e;
        document.hidden ||
          document.webkitHidden ||
          ((e = function () {
            nt();
          }),
          C && N
            ? ee("getProfilesMeta", {}, function (t, r) {
                !t && r && r.revision
                  ? String(r.revision) === N
                    ? e && e()
                    : et(e)
                  : e && e();
              })
            : et(e));
      }, 15e3)),
      window.addEventListener && window.addEventListener("unload", St, !1));
  });
})();
