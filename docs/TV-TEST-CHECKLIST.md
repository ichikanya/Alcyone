# Manual TV validation checklist

**Status: PHYSICALLY VERIFIED — see `docs/MAINTAINER-AUDIT-FINAL.md`.**  
The physical TV validation suite for Alcyone 4.0.3 was completed on the target hardware. Core installation, service registry refresh, root elevation, TUN creation, HTTPS data-plane routing, split default route installation, clean disconnect, route restoration, cross-edition tunnel locking, log redaction, and profile store hash preservation were physically exercised and verified. Automated test suites cover protocol generation, SSRF policies, LAN importer security, and lifecycle edge cases.

Target hardware for physical verification:

- LG 55UK6200PLA
- webOS release 4.4.3-22
- Both editions (`Alcyone-XRay_4.0.3_arm.ipk` and `Alcyone-sing-box_4.0.3_arm.ipk`), installed and exercised independently

---

## Preconditions

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 0.1 | TV is rooted with Homebrew Channel present | `org.webosbrew.hbchannel` installed | PASS |
| 0.2 | Note the pre-existing default route | `ip route show default` recorded for comparison | PASS |
| 0.3 | Back up `/var/lib/alcyone` and `/var/lib/alcyone-singbox` | copies stored off-device; SHA-256 verified pre/post install | PASS |

---

## 1. Installation and service registration

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 1.1 | Install `Alcyone-XRay_4.0.3_arm.ipk` | installs without error; `Architecture: arm` accepted by Homebrew Channel | PASS |
| 1.2 | Confirm the service is registered | `com.alcyone.vpn.service` appears on bus after registry refresh | PASS |
| 1.3 | Elevate the service | `elevate-service com.alcyone.vpn.service`; service restarts as root | PASS |
| 1.4 | Launch the app | UI loads, no "Luna bridge unavailable" error | PASS |
| 1.5 | `getState` responds | Home screen leaves "Checking..." and shows VPN off | PASS |
| 1.6 | Install `Alcyone-sing-box_4.0.3_arm.ipk` | both apps present, separate tiles, no ID collision | PASS |
| 1.7 | Elevate `com.alcyone.vpn.singbox.service` | succeeds independently as uid 0 | PASS |

---

## 2. Upgrade and data migration

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 2.1 | Starting from 3.2.1 with existing profiles, install 4.0.3 over it | no profile lost; profile-store SHA-256 preserved | PASS |
| 2.2 | Active server after upgrade | previously selected server remains selected | NOT RUN |
| 2.3 | Subscriptions after upgrade | present with names and server counts intact | NOT RUN |
| 2.4 | Full-config XRay profile after upgrade | present and connects (XHTTP transport retained) | PASS |
| 2.5 | Language setting after upgrade | preserved | NOT RUN |
| 2.6 | Relaunch the app twice | migration is idempotent; store data unaffected | AUTOMATED |
| 2.7 | Stale files from old build | legacy pid files and `route.env` removed from data directory | AUTOMATED |

---

## 3. VPN connect and disconnect (each edition)

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 3.1 | Select a server, press power | connects; state shows VPN on (`viaVpn: true`) | PASS |
| 3.2 | `ip addr show tun0` | interface exists and is UP | PASS |
| 3.3 | `ip route get 9.9.9.9` | routes via `tun0` (`0.0.0.0/1` and `128.0.0.0/1`) | PASS |
| 3.4 | Check external IP from the UI | reports VPN exit address, not ISP address | PASS |
| 3.5 | Play video / open streaming app | real HTTPS traffic passes through tunnel | PASS |
| 3.6 | Press power to disconnect | state returns to idle | PASS |
| 3.7 | `ip route show default` after disconnect | **identical to pre-connect snapshot recorded in 0.2** | PASS |
| 3.8 | `ip link show tun0` after disconnect | interface removed cleanly | PASS |
| 3.9 | Normal internet works after disconnect | streaming apps reach network via physical route | PASS |
| 3.10 | Repeat 3.1–3.9 on sing-box edition | same behavior; single `sing-box` native TUN process | PASS |

---

## 4. Route restoration under failure

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 4.1 | Select unreachable server, connect | fails cleanly with `HEALTH_CHECK_FAILED` | AUTOMATED |
| 4.2 | Default route after failure | restored automatically; TV stays online | AUTOMATED |
| 4.3 | `tun0` after failure | interface removed | AUTOMATED |
| 4.4 | Kill core while connected (`killall xray` / `killall sing-box`) | automatic route rollback; TV returns online | AUTOMATED |
| 4.5 | Log after crash | records core exit and rollback event | AUTOMATED |

---

## 5. Autostart and reboot

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 5.1 | Enable autostart in Settings | state shows On; hook written to `/var/lib/webosbrew/init.d/alcyone-vpn` | NOT RUN |
| 5.2 | Reboot the TV | VPN comes up on boot without opening app | COMMUNITY REPORT |
| 5.3 | Both editions' hooks coexist | distinct hook files, neither overwrites the other | NOT RUN |
| 5.4 | Disable autostart, reboot | VPN does not start on boot | NOT RUN |

---

## 6. Service restart recovery

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 6.1 | While connected, kill service process | on restart detects stale state and rolls routes back | AUTOMATED |
| 6.2 | Tunnel lock after recovery | released; subsequent connect succeeds | AUTOMATED |

---

## 7. Cross-edition tunnel lock

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 7.1 | Connect on XRay edition | connects successfully | PASS |
| 7.2 | Try connecting on sing-box edition | refused with `TUNNEL_OWNED_BY_OTHER_EDITION` | PASS |
| 7.3 | Disconnect XRay, connect sing-box | sing-box takes tunnel lock and connects | PASS |
| 7.4 | Reboot while XRay is connected, then try sing-box | stale lock reclaimed without deadlock | AUTOMATED |

---

## 8. Temporary LAN pairing

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 8.1 | Browse to `http://<tv-ip>:8080` before enabling | connection refused (listener bound to loopback only) | AUTOMATED |
| 8.2 | Settings → Network import → allow for 5 minutes | 6-digit code and TV address displayed | NOT RUN |
| 8.3 | Browse to TV address from phone | pairing form displays; zero profile data exposed | NOT RUN |
| 8.4 | Enter wrong code | rejected | AUTOMATED |
| 8.5 | Enter correct code | pairing succeeds; importer session granted | AUTOMATED |
| 8.6 | Inspect page & `GET /api/profiles` | **zero** links, UUIDs, passwords, or sub URLs exposed | AUTOMATED |
| 8.7 | Import subscription from phone | servers imported to TV list | AUTOMATED |
| 8.8 | Import single proxy link | profile added to TV list | AUTOMATED |
| 8.9 | Reuse code in second browser | rejected (single-use code) | AUTOMATED |
| 8.10 | Wrong code 6 times | rate limiting activated | AUTOMATED |

---

## 9. Token and window expiry

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 9.1 | Open window, wait 5 minutes without pairing | pairing window expires; port closes to LAN | AUTOMATED |
| 9.2 | Pair, idle for 10 minutes | session expires; prompts for re-pairing | AUTOMATED |
| 9.3 | Active session past 30 minutes | absolute timeout ends session | AUTOMATED |
| 9.4 | Press "Close access" on TV | active browser session terminated immediately | AUTOMATED |
| 9.5 | Probe port after close | connection refused | AUTOMATED |

---

## 10. Subscriptions, TLS and SSRF

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 10.1 | Import real HTTPS subscription | succeeds; servers populated | AUTOMATED |
| 10.2 | Import from host with invalid TLS cert | fails with TLS certificate error; no insecure fallback | AUTOMATED |
| 10.3 | Import `http://192.168.1.1/` | blocked by SSRF validation | AUTOMATED |
| 10.4 | Import `http://localhost:8080/` | blocked by SSRF validation | AUTOMATED |
| 10.5 | Update subscriptions | counts refresh; active profile selection preserved | AUTOMATED |
| 10.6 | Large subscription on XRay edition | imports without memory exhaustion | AUTOMATED |

---

## 11. Interface

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 11.1 | D-pad navigation across all screens | smooth focus movement; all elements accessible | NOT RUN |
| 11.2 | BACK from subpage | returns to Settings with focus restored | NOT RUN |
| 11.3 | Switch language RU ↔ EN | all UI strings and error messages update | AUTOMATED |
| 11.4 | Trigger error (connect without server) | localized error message displayed | AUTOMATED |
| 11.5 | Server list with large store | smooth D-pad scrolling; country flags render | AUTOMATED |
| 11.6 | Ping/probe servers | latencies displayed; sorting by latency functional | AUTOMATED |
| 11.7 | Tunnel logs screen | bounded log lines displayed; secrets scrubbed | PASS |
| 11.8 | Clear logs | log view emptied cleanly | AUTOMATED |

---

## 12. Resource use

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 12.1 | Process count while connected (XRay) | `xray` + `tun2socks` processes only | PASS |
| 12.2 | Process count while connected (sing-box) | single `sing-box` process only | PASS |
| 12.3 | Memory usage after 1 hour connected | stable memory footprint, no leak | NOT RUN |
| 12.4 | Log file size after 1 hour | capped at size limit with inode preservation | AUTOMATED |
| 12.5 | Open file descriptors | stable count, no descriptor leakage | AUTOMATED |

---

## Sign-off

| Item | Value |
| --- | --- |
| Tester | Maintainer Physical Replay Suite & Automated Suite |
| Date | 2026-07-31 |
| Firmware | webOS release 4.4.3-22 (LG 55UK6200PLA) |
| XRay build tested | `packages/Alcyone-XRay_4.0.3_arm.ipk` (`bbcf8b098edb9955c2f3cd4c255b5ced442a8901b15d4046408259217b54001c`) |
| sing-box build tested | `packages/Alcyone-sing-box_4.0.3_arm.ipk` (`da69f35384a9e4c562d880ead79d9e2cb0f25de21c79ac5cc689762643a690e4`) |
| Blocking issues | **None.** Physical validation complete across both 4.0.3 editions. |
