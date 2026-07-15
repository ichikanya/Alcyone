# Alcyone 3.0.6

[Download Alcyone 3.0.6 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.0.6_all.ipk)

This update makes it easier to choose the best VPN server directly on an LG TV.

### What's New

- **Server Ping**: Use the new **Ping servers** button to measure every server from the TV's current network connection.
- **Clear Latency Status**: Each tested server shows its latency in milliseconds. Green indicates good latency (up to 100 ms), yellow indicates average latency (101-300 ms), and red indicates poor latency (over 300 ms).
- **Unavailable Servers**: Servers that do not answer the ping check are marked `n/a`. Some working VPN servers may block ICMP ping and can still connect normally.
- **Sorting**: Sort each server group alphabetically by name or from lowest to highest measured ping. Unavailable and untested servers stay at the end of ping-sorted groups.
- **TV-Friendly Controls**: The new controls support LG remote D-pad navigation and match the existing Alcyone interface.
- **UI Polish**: The ping refresh button now matches the neighboring controls, and the Name/Ping selector divider stays equally clear in either selected state.

Root access is required. Existing profiles, subscriptions, and settings in `/var/lib/alcyone` are preserved during the update.

For bugs and suggestions, contact [@AlcyoneVPN](https://t.me/AlcyoneVPN). Include the TV model and webOS version when reporting a problem.
