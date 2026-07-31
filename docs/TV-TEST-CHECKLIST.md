# Manual TV validation checklist

**Status: PARTIALLY PERFORMED - see `docs/MAINTAINER-AUDIT-FINAL.md`.** The
authorized physical TV previously passed the root, TUN, routing, traffic,
descriptor, status, rollback, and UI checks for the maintainer build. The final
canonical-package replay reached clean data-preserving installation, but the
TV's webOS service registry remained locked and prevented service startup.
The remaining physical rows are therefore not claimed as final-package passes.

Target hardware for this round:

- LG 55UK6200PLA
- webOS release 4.4.3-22
- both editions, installed and exercised independently

Record the result and any log excerpt for each row. Logs come from the TV UI
(Settings → Tunnel logs) or `<dataDir>/service.log`.

## Preconditions

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 0.1 | TV is rooted with Homebrew Channel present | `org.webosbrew.hbchannel` installed | |
| 0.2 | Note the pre-existing default route | `ip route show default` recorded for comparison | |
| 0.3 | Back up `/var/lib/alcyone` and `/var/lib/alcyone-singbox` | copies stored off-device | |

## 1. Installation and service registration

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 1.1 | Install `Alcyone-XRay_<v>_arm.ipk` | installs without error; `Architecture: arm` is accepted by the installer | |
| 1.2 | Confirm the service is registered | `com.alcyone.vpn.service` appears on the bus (`ls-monitor` or a `getState` call) | |
| 1.3 | Elevate the service | `elevate-service com.alcyone.vpn.service`; service restarts as root | |
| 1.4 | Launch the app | UI loads, no "Luna bridge unavailable" message | |
| 1.5 | `getState` responds | Home screen leaves "Checking..." and shows VPN off | |
| 1.6 | Install the sing-box edition too | both apps present, separate tiles, no ID collision | |
| 1.7 | Elevate `com.alcyone.vpn.singbox.service` | succeeds independently | |

## 2. Upgrade and data migration

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 2.1 | Starting from 3.2.1 with existing profiles, install this build over it | no profile lost; count matches the pre-upgrade count | |
| 2.2 | Active server after upgrade | the previously selected server is still selected | |
| 2.3 | Subscriptions after upgrade | present, with their names and counts | |
| 2.4 | A full-config XRay profile after upgrade | still present and still connects (XHTTP retained) | |
| 2.5 | Language setting after upgrade | preserved | |
| 2.6 | Relaunch the app twice | migration is idempotent; nothing duplicates | |
| 2.7 | Stale files from the old build | `alcyone-web.pid`, `xray.pid`, `route.env` removed from the data directory | |

## 3. VPN connect and disconnect (each edition)

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 3.1 | Select a server, press power | connects; state shows VPN on | |
| 3.2 | `ip addr show tun0` | interface exists and is up | |
| 3.3 | `ip route get 9.9.9.9` | routes via `tun0` | |
| 3.4 | Check external IP from the UI | reports the VPN exit address, not the ISP address | |
| 3.5 | Play a video / open a streaming app | traffic works through the tunnel | |
| 3.6 | Press power to disconnect | state shows VPN off | |
| 3.7 | `ip route show default` after disconnect | **identical to the value recorded in 0.2** | |
| 3.8 | `ip link show tun0` after disconnect | interface is gone | |
| 3.9 | Normal internet works after disconnect | streaming apps still reach the network | |
| 3.10 | Repeat 3.1–3.9 on the sing-box edition | same behaviour, single `sing-box` process | |

## 4. Route restoration under failure

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 4.1 | Select a server with an unreachable address, connect | fails with a clear localized message | |
| 4.2 | Default route after that failure | restored; TV still online | |
| 4.3 | `tun0` after that failure | removed | |
| 4.4 | Kill the core while connected (`killall xray` / `killall sing-box`) | routes roll back automatically; TV returns online | |
| 4.5 | Log after a crash | records the core exit and the rollback | |

## 5. Autostart and reboot

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 5.1 | Enable autostart in Settings | state shows On; hook exists at `/var/lib/webosbrew/init.d/alcyone-vpn` | |
| 5.2 | Reboot the TV | VPN comes up without opening the app | |
| 5.3 | Both editions' hooks coexist | distinct filenames, neither overwrites the other | |
| 5.4 | Disable autostart, reboot | VPN does not start | |

## 6. Service restart recovery

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 6.1 | While connected, kill the service process | on restart it detects stale state and rolls routes back | |
| 6.2 | Tunnel lock after recovery | released; a later connect succeeds | |

## 7. Cross-edition tunnel lock

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 7.1 | Connect on the XRay edition | connected | |
| 7.2 | Try to connect on the sing-box edition | refused with "Another Alcyone edition controls the tunnel" | |
| 7.3 | Disconnect XRay, connect sing-box | succeeds | |
| 7.4 | Reboot while XRay is connected, then try sing-box first | stale lock is reclaimed, not a permanent deadlock | |

## 8. Temporary LAN pairing

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 8.1 | Before enabling, browse to `http://<tv-ip>:8080` from a phone | connection refused or `403`; nothing served | |
| 8.2 | Settings → Network import → allow for 5 minutes | code and address shown on the TV | |
| 8.3 | Browse to the address | pairing form appears, no profile data visible | |
| 8.4 | Enter a wrong code | rejected | |
| 8.5 | Enter the correct code | importer page loads | |
| 8.6 | Inspect the page and `GET /api/profiles` | **no** links, UUIDs, passwords or subscription URLs anywhere | |
| 8.7 | Import a subscription from the phone | servers appear on the TV list | |
| 8.8 | Import a single proxy link | profile appears on the TV | |
| 8.9 | Reuse the same code in a second browser | refused (single use) | |
| 8.10 | Wrong code six times | rate limited | |

## 9. Token and window expiry

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 9.1 | Open a window, wait 5 minutes without pairing | code stops working; port closes to the LAN | |
| 9.2 | Pair, then idle 10 minutes | session expires; page asks to pair again | |
| 9.3 | Pair, keep active past 30 minutes | absolute timeout ends the session | |
| 9.4 | Press "Close access" on the TV | existing browser session dies immediately | |
| 9.5 | After any close, probe the port from another device | refused | |

## 10. Subscriptions, TLS and SSRF

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 10.1 | Import a real subscription over HTTPS | succeeds; servers listed | |
| 10.2 | Import from a host with a bad certificate | fails with a certificate error; **no** silent fallback | |
| 10.3 | Import `http://192.168.1.1/` | refused as a blocked address | |
| 10.4 | Import `http://localhost:8080/` | refused | |
| 10.5 | Update all subscriptions | counts refresh; existing selection preserved | |
| 10.6 | Large subscription (hundreds of servers) on the XRay edition | imports without exhausting memory | |

## 11. Interface

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 11.1 | D-pad navigation across every screen | focus moves sensibly; nothing unreachable | |
| 11.2 | BACK from a subpage | returns to Settings with focus restored | |
| 11.3 | Switch language RU ↔ EN ↔ Auto | all strings translate, including error messages | |
| 11.4 | Trigger an error (connect with no server) | message is localized, not an English code | |
| 11.5 | Server list with a large store | scrolls smoothly; flags render | |
| 11.6 | Ping/probe servers | latencies appear; sorting by ping works | |
| 11.7 | Tunnel logs screen | shows entries; **no** secrets present | |
| 11.8 | Clear logs | empties | |

## 12. Resource use

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 12.1 | Process count while connected (XRay) | `xray` + `tun2socks` only | |
| 12.2 | Process count while connected (sing-box) | one `sing-box` process | |
| 12.3 | Memory after an hour connected | stable, no growth | |
| 12.4 | Log file size after an hour | capped, not growing without bound | |
| 12.5 | Open file descriptors | bounded | |

## Sign-off

| Item | Value |
| --- | --- |
| Tester | |
| Date | |
| Firmware | 4.4.3-22 |
| XRay build tested | |
| sing-box build tested | |
| Blocking issues | Authorized TV webOS application/service registry refresh, then repeat the final canonical-package rows |

Do not describe the release as ready to publish or accepted until the blocking
registry issue is closed and the final canonical-package rows are repeated.
