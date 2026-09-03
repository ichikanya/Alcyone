# Changelog

## 4.2.2 (unreleased)

Stabilization line from the August 2026 audit. No user-visible feature
changes; every item below removes a proven failure mode.

- Upgrade safety: profile stores are raw-backed up before any migration;
  a corrupt store now blocks the upgrade (`STORE_UNRECOVERABLE`) instead
  of being silently replaced by an empty list; sing-box-incompatible
  profiles are marked, never deleted; network recovery runs before data
  migration on boot.
- Independent network guardian (ALCYONE_NETGUARD=1): a root-level
  rtnetlink watchdog removes only the leased diversion objects when the
  service dies, hangs or is SIGSTOP-ed, restoring ordinary internet
  without any Node code. Armed before the route takeover, disarmed only
  after the physical path is verified.
- Routing: policy verification is table-aware (healthy policy sessions
  no longer fall back to legacy); rollback without owned state issues no
  destructive commands; each edition owns its own TUN device (`alx0` /
  `als0`), so one edition can never destroy the other's tunnel. Legacy
  endpoint escape routes now fail closed and are reverified after route
  takeover, data-plane verification and by the live network guard, preventing
  a proxy-endpoint loop through the TUN. Imported XRay `freedom` outbounds are
  pinned to the discovered physical interface, closing the separate
  `freedom -> TUN -> tun2socks -> XRay` recursion exposed by provider direct
  rules under YouTube traffic. Policy tables also copy and verify the real
  on-link routes of the physical NIC before activation; this keeps LAN/SSH
  replies direct instead of hairpinning them through the router, while older
  kernels that cannot prove those routes fall back to legacy routing.
- Core shutdown: SIGKILL is only a request; the service retains STOPPING and
  the tunnel lock until the kernel confirms `exit`. Process-control errors no
  longer impersonate an exit, and exact `/proc/<pid>/exe` orphan checks
  (including upgraded `(deleted)` executables) block duplicate core startup.
- Watchdog: only bidirectional traffic counts as liveness evidence;
  failed public probe sites remain a visible warning while fresh bidirectional
  TUN traffic proves the user's connection is working, rather than tearing
  down an active YouTube session. Three failed probes without that traffic
  evidence, or sustained near-limit descriptors, open incidents that trigger
  recovery. TV-safe absolute
  and one-tick FD-growth guards now bypass the post-connect grace window, so a
  recursive socket storm is stopped hundreds of descriptors in rather than at
  95% of a process limit sized far above the TV's memory budget.
- Recovery budget: at most three automatic reconnects per rolling 30
  minutes with 0/60 s/5 min steps and a 30 minute breaker, persisted
  across service restarts; ten minutes of healthy session forgives the
  oldest attempt. This persistent budget is now the sole restart-storm guard;
  the duplicate in-memory "second incident" latch no longer strands the VPN
  off after a recoverable second failure.
- Data plane: optional single-process XRay native TUN mode
  (edition `dataPlane: "native-tun"`, hardware-spike gated); TUN MTU is
  policy-driven (clamp to 1280–1400) instead of hardcoded 1500.
- Release tooling: `build_ipk.py` defaults to `build/dist` and emits an
  artifacts manifest; new release-metadata guard proves feed files,
  manifests and shipped IPK hashes/sizes agree (repository.json drift
  found and fixed).
- Hardware qualification: the final XRay IPK passed instrumented YouTube
  testing plus multi-hour real sessions on the target webOS 4.x and 5.x TVs
  without watchdog recovery, descriptor runaway or a stuck core. A reboot
  with a persisted route journal was also verified to recover to an idle,
  physical-network-only state without changing profiles, root or installed
  developer apps.

## 4.2.0 (2026-08-19)

- Added resource-aware tunnel liveness monitoring, route-first fail-open recovery, a single delayed reconnect, and a repeated-incident circuit breaker.
- Added an optional static ARM launcher with inherited-FD cleanup, parent-death signaling, and per-core descriptor limits.
- Added policy routing with explicit proxy-endpoint escape rules and safe fallback to the legacy route backend.
- Added ConnectionManager API negotiation and kernel fallback across webOS generations.
- Reworked autostart around persistent intent, DHCP readiness, ActivityManager wake triggers, ConnectionManager subscriptions, and Quick Start timer-gap detection.
- Fixed D-Pad focus escape and server-picker Back focus in autostart settings.
- Fixed subscription imports that escalated redirects or provider errors into request storms and eventual HTTP 429 responses; client-profile and HWID retries are now explicit, bounded, and demand-driven.

## 4.0.4 (2026-08-06)

- Replaced the custom IPK archive writer with the official webOS
  `@webos-tools/cli` `ares-package` tool and added release-gate checks for its
  required control metadata.
- Removed the LAN importer HWID checkbox. Provider identity headers are now
  mandatory for HTTPS subscription requests and remain forbidden on HTTP.
- Kept the legacy `compatMode` request and stored-data fields accepted so
  existing importer clients and profiles continue to work.
- Corrected the XRay provenance hash to the output of the canonical Ubuntu
  Go 1.26.1 build used by the release workflow.

## 4.0.3 (2026-07-31)

- Added checksum-verified runtime staging for every native core and verified
  XRay routing assets.
- Added endpoint DNS bootstrap, crash-safe route rollback, direct-range bypass
  routes, data-plane verification, and bounded recovery of owned core orphans.
- Corrected Hysteria2 Salamander configuration for XRay and retained only the
  documented supported obfuscation form.
- Removed historical `_all.ipk` archives that contained ARM binaries and
  hardened the release workflow around reproducible ARM package inputs.

## 4.0.0 (unreleased)

- Moved privileged VPN lifecycle and networking into per-edition Luna services.
- Added independent ARM XRay and sing-box builds from pinned native inputs.
- Hardened Luna authorization, LAN pairing, downloads, migration and rollback.
- Added exact Node.js 0.12.2 compatibility and deterministic IPK checks.

## 3.2.1

- Added the standard webOS `packageinfo.json` metadata to both edition IPKs so Homebrew compatibility verification can inspect them.
- Kept the VPN cores, application behavior, identities, storage paths, and UI unchanged.

## 3.2.0

- Added independently buildable and installable XRay and sing-box editions from one shared application source.
- Preserved the existing XRay 26.3.27 core, app ID, data directory, full-config behavior, XHTTP support, and all existing functionality.
- Added a separate sing-box 1.13.14 edition with its own app ID, data directory, web port, and autostart entry.
- Reduced sing-box to the required QUIC/uTLS feature set and a single native system-TUN process with bounded descriptors and UDP state.
- Added deterministic per-edition IPK builds, package structure tests, sing-box configuration validation, and edition-matrix GitHub Actions.
- Consolidated the full changelog and every release note under `docs/release-history`.

## 3.1.7

- Fixed gradual Xray descriptor exhaustion that could end in `accept4: too many open files`, connection failures, UI slowdown, and a frozen TV.
- Added bounded XHTTP request multiplexing and shorter idle/half-closed connection lifetimes while preserving provider-defined XMUX settings.
- Gave Xray limited descriptor headroom without raising the tun2socks or web-service limits, and added live descriptor counts to log diagnostics.
- Made Clear logs physically truncate every managed log file instead of clearing only the viewer.
- Made selecting a different server while VPN is active perform a complete disconnect and start with the new profile.

## 3.1.6

- Removed INCY impersonation from subscription requests and reduced the canonical request set to HAPP Android TV plus sing-box.
- Merged unique supported nodes from both canonical responses instead of discarding one entire response by server count, fixing XHTTP and other nodes that were exposed by only one format.
- Stopped treating third-party public-IP service failures as VPN startup failures, eliminating false error notifications and unnecessary tunnel restart loops.
- Made the on-demand external-IP check compare the active VPN route with a temporary direct route and clean up its bypass routes afterward.

## 3.1.5

- Added a canonical sing-box subscription request profile with deterministic HWID and webOS/Linux device headers for providers that otherwise return a protocol-filtered server list.
- Compared INCY, HAPP, and sing-box responses and kept the fullest supported result without changing the existing protocol parsers or fallback request modes.

## 3.1.4

- Combined individual-server and subscription import into one auto-detecting web form while preserving the existing import APIs and all supported protocols.
- Fixed missing or broken nodes caused by encoded URI delimiters, incomplete transport deduplication, nested Clash YAML, gRPC/WS/ALPN fields, JSON aliases, and single-node base64 SOCKS lists.
- Added a HAPP-style device header set and valid User-Agent structure, preserved INCY compatibility, and selected the fuller supported result when the two representations differ.
- Made nested subscription refreshes atomic and bounded by child-count, aggregate-size, concurrency, and wall-clock limits; duplicate endpoints now retain ownership per subscription.

## 3.1.3

- Fixed gradual webOS slowdown and freezes by stopping per-connection tunnel logging, bounding retained logs and descriptors, and expiring inactive UDP/Xray connections.
- Bounded web-control sockets, request bodies, subscription download concurrency, and download buffers on timeout or failure.
- Reduced TV CPU and allocation churn with lightweight store revision polling, a slower status cadence, and a bounded in-app log.
- Made VPN restart wait for complete disconnect cleanup and added lifecycle cleanup for timers, the log guard, sockets, and stale web processes.

## 3.1.2

- Redesigned the Home screen around one clear TV connection flow with a prominent VPN control and readable state.
- Replaced the oversized selected-server area with a compact country flag and location badge that adapts to short and long names.
- Centered the connection glow on the VPN control and kept the 1280×720 and 1366×768 layouts free of horizontal overflow.

## 3.1.1

- Kept the selected server name exactly centered on Home while positioning the country flag immediately to its left.
- Preserved the server-list scroll position when selecting an already visible server, with minimal scrolling only when focus leaves the viewport.
- Made explicit disconnects remove all TUN routes, addresses, devices, and VPN processes, then restart the local web control interface on the restored network.

## 3.1.0

- Simplified the Home selected-server card to show only the centered country flag and server name.
- Aligned the shared Back button and centered page title across Settings subpages.
- Restored the real VPN service state and control interface on startup, foreground resume, and webOS relaunch so an existing tunnel remains visible and controllable.

## 3.0.9

- Fixed large subscriptions disappearing from the LG TV app after a successful web import by synchronizing `profiles.json` through the local HTTP API instead of bounded Homebrew exec output.
- Made active-server, language, and profile-delete updates atomic, and prevented truncated fallback reads from clearing the visible server list.
- Raised the inherited open-files limit for Xray, tun2socks, and the web importer to address `accept4: too many open files` warnings under heavy connection load.
- Stopped the previous web importer during in-place upgrades so the updated local API starts cleanly on the next app launch.
- Added a 1.43 MB, 700-profile store stress test covering load, selection, settings, and deletion.

## 3.0.8

- Aligned fixed-width protocol and ping columns across all measured server rows, including different protocol names and latency lengths.
- Reduced the country badge spacing beside the selected server on the Home screen.
- Updated the bundled Linux ARMv7 Xray core and pinned online recovery build to 26.3.27.

## 3.0.7

- Removed the empty reserved ping column from server rows before latency has been measured.
- Kept the protocol badge, measured ping value, and Select/Delete controls compact and balanced without fixed-width gaps.

## 3.0.6

- Added an on-demand server ping button that measures latency from the LG TV.
- Added green, yellow, and red latency indicators and `n/a` for unavailable servers.
- Added sorting by measured ping or server name, with unavailable servers placed last when sorting by ping.
- Added full D-pad navigation for the new ping and sorting controls.
- Polished the ping refresh button and made the sorting control divider consistent in both selected states.

## 3.0.5

- Fixed a crash during VPN connection by automatically copying or downloading `geosite.dat` and `geoip.dat` routing database files when they are required by the active profile.
- Restored support for importing and executing full Xray configurations, including balancers, routing tables, and server names.
- Automatically configured bypass routes to balancer server addresses when launching Xray.

## 3.0.2

- Added full D-pad navigation for LG remotes without a pointer, including predictable focus movement, OK activation, Back handling, and automatic scrolling.
- Preserved focus after selecting, deleting, or refreshing servers.
- Fixed long server names being truncated, including missing closing brackets.

## 3.0.1

- Added VMess, Trojan, Shadowsocks, and SOCKS5 profile support alongside VLESS/XHTTP and Hysteria2.
- Fixed alignment of log-viewer controls.
- Added Russian and English interface support.
- Removed the custom splash artwork; webOS now shows the application's solid background during startup.
- Published a standalone Homebrew repository and release feed.
