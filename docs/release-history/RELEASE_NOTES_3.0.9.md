# Alcyone 3.0.9

[Download Alcyone 3.0.9 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.0.9_all.ipk)

This reliability update fixes large subscription imports and improves tunnel stability under heavy connection load.

### Large Subscription Fix

- Fixed subscriptions that appeared to import successfully in the web interface but did not appear in the LG TV app.
- The TV interface now synchronizes `profiles.json` through the local HTTP API instead of transporting the entire file through bounded Homebrew exec output.
- Active-server selection, language changes, and profile deletion now use atomic local API updates.
- A truncated or malformed fallback read no longer clears the visible server list.

### Tunnel Reliability

- Xray, tun2socks, and the web importer now inherit a raised open-files limit, addressing repeated `accept4: too many open files` warnings during heavy connection activity.
- In-place upgrades stop the previous web importer process so the updated API is loaded on the next application launch.

### Validation

- Added a 1.43 MB stress fixture with 700 profiles, covering full store loading, active-server selection, language updates, and deletion.
- Verified subscription parsing, JavaScript syntax, shell syntax, package metadata, archive structure, and executable permissions.

Root access is required. Existing profiles, subscriptions, settings, and user data in `/var/lib/alcyone` are preserved during the update.
