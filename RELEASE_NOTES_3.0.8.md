# Alcyone 3.0.8

[Download Alcyone 3.0.8 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.0.8_all.ipk)

This update polishes server-list alignment and refreshes the bundled VPN core.

### What's Fixed

- **Consistent Server Columns**: Protocol badges, ping values, and action buttons now stay perfectly aligned across rows regardless of protocol name or latency length.
- **Stable Ping Layout**: Latency uses a fixed, left-anchored column with tabular numbers, preventing two-, three-, and four-digit results from shifting neighboring elements.
- **Compact Before Testing**: Untested rows still omit the ping column, avoiding the empty gap that appeared before a ping check.
- **Balanced Home Card**: The country badge now sits closer to the selected server name for a more cohesive layout.

### Core Update

- Updated the bundled Linux ARMv7 Xray core from 25.8.3 to **26.3.27**.
- Updated the pinned online recovery download to the same Xray release.

Root access is required. Existing profiles, subscriptions, settings, and user data in `/var/lib/alcyone` are preserved during the update.
