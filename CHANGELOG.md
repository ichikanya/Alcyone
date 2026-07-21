# Changelog

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
