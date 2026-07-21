# Alcyone 3.1.5

[Download Alcyone 3.1.5 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.5_all.ipk)

This release fixes subscriptions that returned only part of their server list when the provider expected a sing-box-compatible client request.

### Subscription compatibility

- Added a canonical `singbox/` request profile alongside the existing INCY and HAPP profiles.
- Added deterministic provider-compatible HWID, `X-Device-OS`, `X-Device-Model`, `X-Ver-OS`, and locale headers without transmitting the TV's raw MAC address.
- Compared all three canonical responses and imported the fullest supported server set, so a protocol-filtered response no longer hides other valid servers.
- Preserved every existing protocol parser, HAPP/INCY compatibility mode, panel fallback, redirect limit, download cap, and 60-second import deadline.

### Validation

- Added an integration case where non-sing-box requests receive only Hysteria while the sing-box request receives the complete mixed-protocol subscription.
- Passed JavaScript and shell syntax checks, all parser/import/store/resource/UI/VPN lifecycle regression tests, package metadata validation, and a reproducible production IPK build.

Root access is required. Existing profiles, subscriptions, settings, and data in `/var/lib/alcyone` are preserved during the update.

---

В Alcyone 3.1.5 исправлен неполный импорт подписок у провайдеров, которые формируют список серверов по типу VPN-клиента. Добавлен совместимый профиль `singbox/` со стабильным HWID и заголовками LG webOS/Linux. Приложение сравнивает ответы INCY, HAPP и sing-box и сохраняет самый полный поддерживаемый набор серверов. Все прежние протоколы и режимы импорта сохранены.
