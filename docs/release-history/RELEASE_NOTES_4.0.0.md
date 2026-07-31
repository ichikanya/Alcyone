# Alcyone 4.0.0

Unreleased local rewrite.

- Replaced privileged frontend shell execution with per-edition Luna services.
- Kept independent XRay and sing-box editions with ARM-specific IPKs.
- Fixed webOS 4 DNS/runtime compatibility and the LAN listener lifecycle.
- Corrected XRay tun2socks startup for the verified v1.16.11 upstream binary.
- Added caller authorization, bounded downloads/logs, IPv6 leak blocking,
  migration rollback, and autostart retry.
- Removed native executables from Git; release jobs build or checksum-verify
  pinned upstream inputs before producing both IPKs.
