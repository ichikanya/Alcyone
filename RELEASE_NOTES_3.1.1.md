# Alcyone 3.1.1

[Download Alcyone 3.1.1 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.1_all.ipk)

This update refines TV navigation and makes VPN shutdown restore a clean, usable network state after long sessions.

### TV Interface

- The selected server name is now centered independently, with the country flag positioned immediately to its left.
- Selecting a visible server no longer moves the list. D-pad navigation scrolls only when focus leaves the viewport and only by the distance needed to reveal it.

### Reliable Disconnect

- Disconnect now terminates remaining Xray and tun2socks processes and removes all routes, addresses, and persistent devices associated with the TUN interface.
- The local web control process is restarted after network cleanup, so the TV web interface remains available after disconnecting from a long VPN session.
- The TV UI refreshes from the completed disconnect state instead of reporting success before cleanup and control-interface recovery finish.

### Validation

- Added focused regression coverage for minimal D-pad scrolling and complete shutdown control flow.
- Verified JavaScript and shell syntax, VPN lifecycle behavior, store API behavior, subscription parsing, 1080p and 720p layout rendering, and the final IPK build.

Root access is required. Existing profiles, subscriptions, settings, and user data in `/var/lib/alcyone` are preserved during the update.
