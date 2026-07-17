# Changelog

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
