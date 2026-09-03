# Alcyone

Alcyone is a VPN client for rooted LG webOS TVs. Version 4.2.0 is available in two independently installable editions that share the same TV UI, subscription importer, routing controls, and web interface.

| Edition | Best for | Core and identity |
| --- | --- | --- |
| **Alcyone XRay** | Large subscriptions, many configurations, XHTTP, and complete XRay configs with routing or balancers | Xray 26.3.27 (native-TUN mode behind an edition flag); existing `com.alcyone.vpn` identity and `/var/lib/alcyone` data |
| **Alcyone sing-box** | Low-powered TVs, low process and descriptor use, stability, and fast startup | Trimmed sing-box 1.13.14 with one native system-TUN process; separate `com.alcyone.vpn.singbox` identity and `/var/lib/alcyone-singbox` data |

Both editions support VLESS, VMess, Trojan, Shadowsocks, SOCKS5, and Hysteria2 links, unified subscription import, server selection and ping, subscription updates, VPN autostart, external-IP checks, tunnel logs, Russian/English UI, and LG remote navigation. Root access is required.

Privileged work runs in a per-edition Luna service; the TV interface only calls
scoped Luna methods and never builds a shell command or handles stored secrets.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/SECURITY.md](docs/SECURITY.md).

## Installation

For Homebrew Channel, open **Settings → Add repository** and add:

```text
https://ichikanya.github.io/Alcyone/r.json
```

The feed lists both editions. For manual installation:

- [Alcyone XRay 4.2.0](https://github.com/ichikanya/Alcyone/releases/download/v4.2.0/Alcyone-XRay_4.2.0.ipk)
- [Alcyone sing-box 4.2.0](https://github.com/ichikanya/Alcyone/releases/download/v4.2.0/Alcyone-sing-box_4.2.0.ipk)

Install an IPK with webOS Dev Manager, `ares-install`, or the Homebrew Channel installation service.

The bundled Luna service needs root for TUN and routing only. Grant it once per
edition with Homebrew Channel's elevation:

```sh
/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service com.alcyone.vpn.service
/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service com.alcyone.vpn.singbox.service
```

## Build

Git, Go 1.26.1, Python 3, Node.js and npm are required. Install the pinned
official webOS CLI, build the ARM cores, then package either edition:

```sh
npm ci
tools/build-cores.sh
python build_ipk.py --edition xray
python build_ipk.py --edition sing-box
```

Build both:

```sh
python build_ipk.py --edition all
```

Artifacts are written to:

```text
release-assets/Alcyone-XRay_4.2.2.ipk
release-assets/Alcyone-sing-box_4.2.2.ipk
```

The builder stages edition-specific metadata, service identifiers and pinned
binaries, then delegates IPK creation to the official `ares-package` command
from `@webos-tools/cli`. It verifies the generated webOS control fields before
accepting an artifact. Core provenance, build flags and hashes are recorded in
[cores/provenance.json](cores/provenance.json); rebuild them from pinned
sources with [tools/build-cores.sh](tools/build-cores.sh).

## Validation

```sh
node --check app/app.js
find app/service -name '*.js' -print0 | xargs -0 -n1 node --check
for test_file in tests/*.test.js; do node "$test_file"; done
for test_file in tests/*.test.py; do python "$test_file"; done
```

The suite covers the Luna method contract, SSRF and TLS policy, LAN pairing and
CSRF, route rollback on every failure path, cross-edition tunnel locking,
migration safety, packaging, and binary provenance. `tests/repo-guards.test.py`
fails the build if an insecure pattern reappears.

GitHub Actions runs the same checks, builds each edition in a separate matrix job, and attaches both artifacts to tagged releases.

## Notes

- The XRay edition is the in-place upgrade path for existing Alcyone installations and preserves `/var/lib/alcyone`.
- The sing-box edition uses its own app ID, storage, port 8081, and autostart entry. On first install it can seed its profile store from XRay without sharing later changes.
- Both editions may be installed together. A cross-edition lock enforces that only one owns the VPN diversion at a time; the second edition refuses to connect while the first holds it. Each edition uses its own TUN device (`alx0` for XRay, `als0` for sing-box), so neither can tear down the other's interface.
- XHTTP and full XRay routing/balancer semantics remain XRay-only; sing-box rejects XHTTP before startup.
- After turning on the TV, wait for its network connection before starting VPN. Disabling Quick Start is recommended for predictable autostart.

**This build has not been tested on a real television.** The manual validation
procedure is in [docs/TV-TEST-CHECKLIST.md](docs/TV-TEST-CHECKLIST.md) and is
still unperformed.

The complete changelog and every historical release note are in [docs/release-history](docs/release-history/README.md).

Feedback and bug reports: [@AlcyoneVPN](https://t.me/AlcyoneVPN)

---

## По-русски

Alcyone 4.2.0 выпускается в двух вариантах: **XRay** для больших подписок, XHTTP и полных конфигураций XRay; **sing-box** для маломощных телевизоров, быстрого запуска и минимального количества процессов. Оба варианта имеют прежний интерфейс и устанавливаются независимо. Одновременно запускайте только один VPN-туннель.
