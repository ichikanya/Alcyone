# Alcyone

Official releases and Homebrew feed for Alcyone, a VPN client for rooted LG webOS TVs.

Alcyone is named after the brightest star in the Pleiades. The application runs the VPN tunnel directly on the TV through xray and tun2socks, so a separate router, phone, or PC is not required as a gateway.

## Features

- VLESS/XHTTP, VMess, Trojan, Shadowsocks, SOCKS5, and Hysteria2 profiles.
- Subscription import through a built-in web interface.
- Compatibility headers and User-Agent profiles for subscriptions intended for specific VPN clients.
- On-demand server ping checks with latency indicators and sorting by ping or name.
- Server selection, subscription updates, VPN autostart, external IP checks, and tunnel logs.
- Russian and English interfaces with full D-pad navigation for LG remotes with or without a pointer.

Root access is required.

## Install from Homebrew Channel

Open Homebrew Channel, go to **Settings**, select **Add repository**, and enter:

```text
https://ichikanya.github.io/Alcyone/r.json
```

Return to the application list and install Alcyone from the added repository.

## Manual installation

Download [com.alcyone.vpn_3.1.1_all.ipk](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.1_all.ipk) and install it with webOS Dev Manager, `ares-install`, or the Homebrew Channel installation service.

## Notes

- After turning on the TV, wait until the network connection is established before starting the VPN.
- Disconnecting VPN also restores the TV network state and restarts the local web control interface.
- Disabling Quick Start in the TV settings is recommended for more predictable VPN autostart.
- When reporting a problem, include the TV model and webOS version.

Feedback and bug reports: [@AlcyoneVPN](https://t.me/AlcyoneVPN)

---

# Alcyone на русском

Alcyone — VPN-клиент для телевизоров LG webOS с root-доступом. Приложение запускает VPN непосредственно на телевизоре и позволяет импортировать подписки через удобный веб-интерфейс.

Для установки через Homebrew Channel добавьте указанный выше адрес `repository.json` в разделе **Settings → Add repository**.

При сообщении об ошибке указывайте модель телевизора и версию webOS.
