# Alcyone 3.0.5

[Download Alcyone 3.0.5 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.0.5_all.ipk)

This update resolves a major connection issue where the VPN tunnel failed to start because Xray could not open required routing databases (`geosite.dat` and `geoip.dat`).

### What's New:
- **On-Demand Routing Databases**: The application now dynamically copies or downloads `geosite.dat` and `geoip.dat` databases whenever they are required by the active VPN configuration. To conserve TV storage, these files are only fetched if a configuration profile actually references `geosite:` or `geoip:` rules.
- **Robust Xray Config Import**: Full Xray configurations (including custom routing tables, server names, and balancers) are now imported and handled properly.
- **Automatic Balancer Bypass**: The startup process now automatically detects balancer endpoints and sets up routing bypasses to ensure they can connect.

Root access is required.

After turning on the TV, wait for its internet connection before starting the VPN. Disabling Quick Start in the TV settings is recommended. VPN shutdown may be unstable on some devices; restarting Alcyone can restore the expected state.

For bugs and suggestions, contact [@AlcyoneVPN](https://t.me/AlcyoneVPN). Include the TV model and webOS version when reporting a problem.
