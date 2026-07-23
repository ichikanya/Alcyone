# Alcyone 3.1.7

[Download Alcyone 3.1.7 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.7_all.ipk)

This release fixes gradual connection-resource exhaustion that could slow down applications, fill the tunnel log with `accept4: too many open files`, and eventually freeze the TV.

### VPN reliability and performance

- Added XHTTP XMUX defaults with 16–32 concurrent requests per physical connection when a provider does not supply its own values. Provider-defined XMUX settings remain unchanged.
- Reduced stale connection retention with bounded handshake, idle, and half-closed connection timeouts.
- Raised only the Xray descriptor ceiling from 2048 to 4096; tun2socks remains at 2048 and the web service at 256.
- Added current open-file counts for Xray, tun2socks, and the web service to log diagnostics.

### Controls

- Selecting a different server while VPN is active now fully disconnects the old tunnel and starts the selected profile.
- Clear logs now truncates the core, tunnel, and web log files instead of clearing only the on-screen viewer.

### Validation

- Passed JavaScript and shell syntax checks plus unified-import, subscription-parser, large-store, resource-safety, active-server-switch, TV UI, VPN lifecycle, and VPN shutdown tests.
- Verified the production IPK structure and package metadata. SHA-256: `88a077fb46dfac636fc6d9a51511c198a059a6d316ae3f158a34015b1d1d5d89`.

Root access is required. Existing profiles, subscriptions, settings, and data in `/var/lib/alcyone` are preserved during the update.

---

В Alcyone 3.1.7 исправлено постепенное исчерпание файловых дескрипторов Xray, из-за которого появлялись ошибки `too many open files`, приложения замедлялись, а телевизор мог зависнуть. Для XHTTP включено безопасное мультиплексирование, сокращено время жизни простаивающих соединений и добавлен ограниченный запас дескрипторов только для Xray. При выборе другого сервера активный VPN теперь полностью переподключается, а кнопка очистки логов физически очищает файлы журналов.
