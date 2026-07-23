# Alcyone 3.1.4

[Download Alcyone 3.1.4 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.4_all.ipk)

This release unifies server and subscription import and fixes several cases where valid servers were missing or imported with incomplete transport settings.

### Import and compatibility

- Replaced the separate server and subscription forms with one auto-detecting importer.
- Preserved VLESS/XHTTP, VMess, Trojan, Shadowsocks, SOCKS5, Hysteria2, complete Xray configurations, and the legacy import APIs.
- Added a HAPP-style device header set and valid User-Agent structure based on the reference installation while keeping the existing INCY request profile.
- Compared canonical INCY and HAPP responses and imported the fuller supported server set.

### Parsing and reliability

- Preserved encoded URI credentials and query values instead of decoding their reserved delimiters too early.
- Fixed Clash nested lists, gRPC service names, WebSocket Host headers, ALPN values, JSON protocol aliases, SIP008 records, and single-node base64 SOCKS subscriptions.
- Prevented distinct transport configurations and matching endpoints owned by different subscriptions from being incorrectly merged.
- Made nested subscription refreshes atomic and bounded by a 64-child limit, 4 MB aggregate cap, four concurrent requests, and a 60-second wall-clock deadline.

### Validation

- Passed JavaScript and shell syntax checks, all parser/import/store/resource/UI/VPN lifecycle regression tests, package metadata validation, and a reproducible production IPK build.

Root access is required. Existing profiles, subscriptions, settings, and data in `/var/lib/alcyone` are preserved during the update.

---

В версии 3.1.4 серверы и подписки импортируются через одну форму с автоматическим определением типа ссылки. Исправлены пропуски серверов и потеря параметров в кодированных ссылках, Clash/JSON, gRPC, WebSocket, ALPN, SOCKS и вложенных подписках. Добавлена совместимость запросов с HAPP при сохранении INCY; обновление подписок остаётся атомарным и ограниченным по памяти, времени и числу запросов.
