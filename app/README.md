# Alcyone application source

This directory contains the shared LG webOS UI, subscription importer, routing controller, and web interface used by both editions. `build_ipk.py` injects the edition-specific identity, storage paths, web port, and core binaries at build time.

| Setting | XRay Edition | sing-box Edition |
| --- | --- | --- |
| Application ID | `com.alcyone.vpn` | `com.alcyone.vpn.singbox` |
| Application data | `/var/lib/alcyone` | `/var/lib/alcyone-singbox` |
| Web interface | `http://TV_IP:8080` | `http://TV_IP:8081` |
| Core path | `bin/xray` + `bin/tun2socks` | `bin/sing-box` |
| Tunnel | XRay SOCKS inbound through tun2socks | Native sing-box system TUN |

The XRay identity and data directory are unchanged, so existing profiles, subscriptions, settings, core backups, and upgrades remain compatible. On first installation, the sing-box edition copies the XRay profile store into its own data directory when one exists; subsequent changes are independent.

The shared importer supports VLESS, VMess, Trojan, Shadowsocks, SOCKS5, and Hysteria2. XRay also preserves complete XRay configurations, including routing and balancers, and supports XHTTP. The sing-box edition converts the selected standard link into a compact native configuration; unsupported XHTTP links are rejected before startup with a clear UI error.

Release history is maintained in [docs/release-history](../docs/release-history/README.md).
