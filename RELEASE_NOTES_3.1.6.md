# Alcyone 3.1.6

[Download Alcyone 3.1.6 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.6_all.ipk)

This release fixes missing XHTTP nodes in client-dependent subscriptions and prevents a working VPN from being reported as failed when an external IP service is unavailable.

### Subscription import

- Removed INCY impersonation from subscription requests.
- Uses HAPP Android TV and sing-box as the two canonical compatibility profiles, while retaining the existing low-risk fallback modes and every supported protocol.
- Merges unique supported nodes from both canonical responses instead of choosing one response only by count. Servers with the same display name remain separate when their transport or connection parameters differ.

### VPN reliability and performance

- Startup health now checks the VPN processes and TUN route locally; third-party public-IP outages no longer trigger a false failure toast or a wasteful stop/start retry loop.
- The manual external-IP check uses the active VPN route for the VPN address and a temporary direct route for the ISP address, removing its bypass routes afterward.
- Reduced canonical subscription requests from three to two and removed external network probing from startup.

### Validation

- Passed JavaScript and shell syntax checks plus parser, unified-import, large-store, resource-safety, TV UI, VPN lifecycle, and VPN shutdown regression tests.
- Verified a reproducible production IPK build and package metadata. SHA-256: `10de0626a3bc074f49a0eb1711b416f8735f7dd09c2b83b417a89e4e2a984e08`.

Root access is required. Existing profiles, subscriptions, settings, and data in `/var/lib/alcyone` are preserved during the update.

---

В Alcyone 3.1.6 убрана маскировка под INCY. Результаты HAPP и sing-box теперь объединяются без дубликатов, поэтому XHTTP и другие серверы, доступные только в одном варианте подписки, больше не теряются. Проверка стороннего сервиса IP исключена из запуска VPN: рабочий туннель не будет ошибочно остановлен и перезапущен. Ручная проверка IP теперь отдельно показывает адрес через VPN и напрямую.
