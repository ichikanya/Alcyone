# Alcyone 3.1.0

[Download Alcyone 3.1.0 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.1.0_all.ipk)

This update improves the TV interface and restores reliable VPN controls after reopening or resuming the app.

### TV Interface

- The selected-server card on Home now shows only the country flag and server name, centered as one balanced visual group.
- Settings subpages now share a consistently aligned header with a vertically aligned Back button and visually centered title.

### VPN Lifecycle

- Startup, foreground resume, and webOS relaunch now query the live VPN service instead of relying on stale local UI state.
- An already-running tunnel is shown as active and can be stopped without restarting the TV.
- Service status listeners and the local control interface are restored when the app becomes active, keeping repeated enable and disable operations functional.

### Validation

- Verified VPN lifecycle restoration, large-store API behavior, subscription parsing, JavaScript syntax, shell syntax, and the final IPK build.

Root access is required. Existing profiles, subscriptions, settings, and user data in `/var/lib/alcyone` are preserved during the update.
