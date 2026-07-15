# Alcyone 3.0.7

[Download Alcyone 3.0.7 for LG webOS](https://raw.githubusercontent.com/ichikanya/Alcyone/main/packages/com.alcyone.vpn_3.0.7_all.ipk)

This patch release improves the server-list layout for a cleaner, more compact TV interface.

### What's Fixed

- **No Empty Ping Gap**: Untested servers no longer reserve a blank latency column between the protocol badge and the **Select**/**Delete** buttons.
- **Ping Space When Needed**: The latency area still appears while a ping check is running and remains visible for measured values or `n/a` results.
- **Balanced Server Rows**: Protocol badges and actions now sit closer together before testing, keeping every row compact and visually consistent without affecting ping functionality.

Root access is required. Existing profiles, subscriptions, settings, and ping behavior are unchanged, and user data in `/var/lib/alcyone` is preserved during the update.

For bugs and suggestions, contact [@AlcyoneVPN](https://t.me/AlcyoneVPN). Include the TV model and webOS version when reporting a problem.
