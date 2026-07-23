# Alcyone 3.2.0

Alcyone now ships as two production editions with the same TV interface and compatible subscription workflow:

- [Download Alcyone XRay 3.2.0](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/Alcyone-XRay_3.2.0_all.ipk)
- [Download Alcyone sing-box 3.2.0](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/Alcyone-sing-box_3.2.0_all.ipk)

## XRay Edition

- Keeps the existing `com.alcyone.vpn` identity and `/var/lib/alcyone` data, so upgrades retain profiles, subscriptions, settings, core backups, and autostart.
- Keeps the current working Xray 26.3.27 and tun2socks binaries unchanged.
- Preserves XHTTP, large subscriptions, many configurations, full XRay routing and balancers, and all 3.1.7 behavior.

## sing-box Edition

- Uses the separate `com.alcyone.vpn.singbox` identity, `/var/lib/alcyone-singbox` data, port 8081, and its own autostart entry.
- Uses sing-box 1.13.14 with only the required QUIC/uTLS features and the native system TUN stack.
- Runs one VPN process with a 1024-descriptor ceiling, 30-second inactive UDP timeout, warning-only logs, and no gVisor or optional service/API modules.
- Supports standard VLESS, VMess, Trojan, Shadowsocks, SOCKS5, and Hysteria2 links. XHTTP remains XRay-only and is rejected before startup.

## Build and validation

- Added deterministic independent builds: `python build_ipk.py --edition xray` and `python build_ipk.py --edition sing-box`.
- Added edition-specific package-structure and reproducibility tests.
- Validated representative sing-box configurations for every supported protocol with sing-box 1.13.14.
- Added GitHub Actions matrix builds and tagged-release publishing for both artifacts.
- Moved the changelog and all standalone release notes into `docs/release-history` without removing historical content.

Root access is required. Both editions can be installed together, but only one VPN tunnel should run at a time because both control the TV-wide TUN route.
