# Changelog

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
