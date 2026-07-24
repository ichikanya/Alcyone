# Alcyone

Alcyone is a VPN client for rooted LG webOS TVs. Version 3.2.0 is available in two independently installable editions that share the same TV UI, subscription importer, routing controls, and web interface.

| Edition | Best for | Core and identity |
| --- | --- | --- |
| **Alcyone XRay** | Large subscriptions, many configurations, XHTTP, and complete XRay configs with routing or balancers | Xray 26.3.27 + tun2socks; existing `com.alcyone.vpn` identity and `/var/lib/alcyone` data |
| **Alcyone sing-box** | Low-powered TVs, low process and descriptor use, stability, and fast startup | Trimmed sing-box 1.13.14 with one native system-TUN process; separate `com.alcyone.vpn.singbox` identity and `/var/lib/alcyone-singbox` data |

Both editions support VLESS, VMess, Trojan, Shadowsocks, SOCKS5, and Hysteria2 links, unified subscription import, server selection and ping, subscription updates, VPN autostart, external-IP checks, tunnel logs, Russian/English UI, and LG remote navigation. Root access is required.

## Installation

For Homebrew Channel, open **Settings → Add repository** and add:

```text
https://ichikanya.github.io/Alcyone/r.json
```

The feed lists both editions. For manual installation:

- [Alcyone XRay 3.2.0](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/Alcyone-XRay_3.2.0_all.ipk)
- [Alcyone sing-box 3.2.0](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/Alcyone-sing-box_3.2.0_all.ipk)

Install an IPK with webOS Dev Manager, `ares-install`, or the Homebrew Channel installation service.

## Build

Python 3 is the only build-time requirement. Each edition can be built independently:

```sh
python build_ipk.py --edition xray
python build_ipk.py --edition sing-box
```

Build both:

```sh
python build_ipk.py --edition all
```

Artifacts are written to:

```text
dist/Alcyone-XRay_3.2.0_all.ipk
dist/Alcyone-sing-box_3.2.0_all.ipk
```

The builder is deterministic and injects edition-specific metadata and binaries into the shared `app/` source. Core provenance and hashes are documented in [cores/README.md](cores/README.md).

## Validation

```sh
node --check app/app.js
node --check app/web/alcyone-web.js
sh -n app/scripts/alcyonectl.sh
for test_file in tests/*.test.js; do node "$test_file"; done
python tests/build-editions.test.py
```

GitHub Actions runs the same checks, builds each edition in a separate matrix job, and attaches both artifacts to tagged releases.

## Notes

- The XRay edition is the in-place upgrade path for existing Alcyone installations and preserves `/var/lib/alcyone`.
- The sing-box edition uses its own app ID, storage, port 8081, and autostart entry. On first install it can seed its profile store from XRay without sharing later changes.
- Both editions may be installed together, but only one VPN tunnel should run at a time because both manage the TV-wide `tun0` route.
- XHTTP and full XRay routing/balancer semantics remain XRay-only; sing-box rejects XHTTP before startup.
- After turning on the TV, wait for its network connection before starting VPN. Disabling Quick Start is recommended for predictable autostart.

The complete changelog and every historical release note are in [docs/release-history](docs/release-history/README.md).

Feedback and bug reports: [@AlcyoneVPN](https://t.me/AlcyoneVPN)

---

## По-русски

Alcyone 3.2.0 выпускается в двух вариантах: **XRay** для больших подписок, XHTTP и полных конфигураций XRay; **sing-box** для маломощных телевизоров, быстрого запуска и минимального количества процессов. Оба варианта имеют прежний интерфейс и устанавливаются независимо. Одновременно запускайте только один VPN-туннель.
