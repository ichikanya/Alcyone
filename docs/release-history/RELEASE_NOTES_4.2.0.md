# Alcyone 4.2.0

Alcyone 4.2.0 focuses on long-running tunnel safety and webOS generation compatibility.

## Highlights

- Added passive TUN traffic monitoring and low-frequency active liveness checks after 30 seconds of inactivity.
- Added bounded file-descriptor and combined RSS/available-memory pressure detection without treating low free memory alone as a fault.
- Added fail-open recovery: tunnel policy is removed and the physical route is verified before native cores are stopped or a reconnect is attempted.
- Added policy routing with explicit physical-table rules for proxy endpoints and a legacy routing fallback for older webOS kernels.
- Added a 12 KiB static ARM `alcyone-exec` launcher that closes inherited descriptors, applies per-core `RLIMIT_NOFILE`, and terminates children with their parent.
- Added ConnectionManager API variants plus kernel-route fallback for webOS 4 through webOS 9+ and ACG-denied environments.
- Made autostart a persistent setting independent of the previous session, with DHCP-aware readiness waits and Quick Start+/Instant On wake handling.
- Fixed D-Pad focus ownership in autostart settings and exact Back focus restoration from the server picker.
- Reworked subscription compatibility negotiation to prevent request storms: 429 and redirect loops stop immediately, alternate client profiles are tried only after an explicit client rejection, and HWID is sent only after an HTTPS provider explicitly requests it.

## Packages

- `Alcyone-XRay_4.2.0.ipk`
- `Alcyone-sing-box_4.2.0.ipk`

Both editions require a rooted LG webOS TV. Only one edition may own the system tunnel at a time.

## Qualification

Automated JavaScript, Node 0.12 compatibility, native-launcher, asset, and edition-packaging tests pass. Physical long-duration and cross-version webOS qualification remains a release gate; see `docs/TV-TEST-CHECKLIST.md`.
