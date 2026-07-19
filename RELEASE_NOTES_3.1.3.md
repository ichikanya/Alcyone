# Alcyone 3.1.3

[Download Alcyone 3.1.3 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.3_all.ipk)

This maintenance release fixes gradual slowdown and system freezes during long VPN sessions on resource-constrained LG TVs.

### Stability and resource fixes

- Disabled per-connection Xray/tun2socks access logging and added a 2 MB managed tunnel-log cap.
- Shortened inactive UDP session lifetime and bounded Xray idle connections and process file descriptors.
- Bounded local web-control sockets, headers, request bodies, subscription-download concurrency, and timeout/failure buffers.
- Replaced frequent full profile-store reloads with lightweight revision polling and capped the TV application's in-memory log.
- Made Restart wait for complete VPN teardown and added cleanup for timers, the log guard, sockets, and stale web processes.

### Validation

- Passed JavaScript and shell syntax checks, all VPN lifecycle/shutdown/UI/subscription/store/resource regression tests, and a reproducible IPK build.

Root access is required. Existing profiles, subscriptions, settings, and data in `/var/lib/alcyone` are preserved during the update.

---

Исправлено постепенное замедление и зависание LG webOS при длительной работе VPN: ограничены логи, сокеты, файловые дескрипторы, неактивные UDP/Xray-соединения, фоновые опросы и буферы. Перезапуск VPN теперь ждёт полного завершения очистки сети и процессов.
