# Phase 1 handoff — elevation, error classification and the Grant-permissions flow

Status: **Phase 0 complete and accepted. Phase 1 not started.**

This document is the entry point for implementing release **4.0.3**. It records what Phase 0 proved
on real hardware, what is currently on the TV and in the repository, which code is permanent, which
code is a temporary probe that must be deleted, and the constraints Phase 1 must respect.

---

## 1. Hard prerequisite

**Alcyone supports only rooted LG webOS TVs with Homebrew Channel installed and running as root.**

This is not a soft requirement or a degraded mode. The service needs root for exactly two things —
creating and configuring `tun0`, and editing the kernel routing table — and the only supported way to
obtain it is Homebrew Channel's `elevateService`.

If the prerequisite is not satisfied, **VPN activation must remain unavailable.** The UI states the
requirement and stops there.

Explicitly forbidden as a fallback, in this or any later phase:

- alternative privilege escalation of any kind;
- Homebrew Channel `/exec` or `/spawn`;
- shell commands issued from the frontend or the service;
- direct edits to LS2 configuration (`services.d`, `roles.d`, `client-permissions.d`,
  `api-permissions.d`, `manifests.d`) by Alcyone.

Detection is a read-only call to `luna://org.webosbrew.hbchannel.service/checkRoot`. On this TV it
returns `{"returnValue": true}`. If it fails, errors, or returns false, treat the prerequisite as
unmet: report it distinctly, disable VPN activation, and offer no workaround.

---

## 2. Proven Phase 0 results

Target: **historical validation hardware (address omitted)** — LG `lm18a`, Rockhopper **4.4.3-22`, Homebrew Channel **0.7.3** running
as root. Historical probe artifact details are retained only in local evidence, not in maintainer-facing reports.

| # | Proposition | Result |
| --- | --- | --- |
| 1 | The application may call `luna://org.webosbrew.hbchannel.service/elevateService` | **Proven.** Verbatim response `{"returnValue":true}` |
| 2 | The method accepts the real service id `com.alcyone.vpn.service` | **Proven** |
| 3 | Elevation rewrites the LS2 files | **Proven.** 3 of 5 changed (below) |
| 4 | A still-jailed running service can receive `restartService` | **Proven.** Acknowledged with `{"restarting":true,…"pid":5586}` |
| 5 | The old process exits | **Proven.** `/proc/5586` gone |
| 6 | LS2 relaunches the service as uid 0 | **Proven.** PID 5890, `Uid: 0 0 0 0`, `CapEff: 0000003fffffffff` |
| 7 | App-side `getState` polling observes root | **Proven.** `poll 1: uid=0 root=true pid=5890` — first poll, ~1 s |

### 2.1 Package installation destroys elevation (deterministically)

Before the probe install, 4.0.1 was elevated and working. Installing the probe reset it. After
`elevateService`, the same files were restored:

| File | Elevated (4.0.1) | After install | After `elevateService` |
| --- | --- | --- | --- |
| `services.d/com.alcyone.vpn.service.service` | `c8927e77…` | `57c878c4…` | `c8927e77…` |
| `roles.d/com.alcyone.vpn.service.service.json` | `0266bf6c…` | `96b376d8…` | `0266bf6c…` |
| `manifests.d/com.alcyone.vpn.json` | `bdb4c050…` | `db9d74ef…` | `2690d553…` |
| `client-permissions.d/com.alcyone.vpn.service.root.json` | `c2259c69…` | `c2259c69…` | `c2259c69…` |
| `api-permissions.d/com.alcyone.vpn.service.api.public.json` | `81d53b63…` | `81d53b63…` | `81d53b63…` |

What changes:

- **`services.d`** — `Exec` flips between the stock jailed `/usr/bin/run-js-service` and Homebrew
  Channel's un-jailed `…/org.webosbrew.hbchannel.service/run-js-service`.
- **`roles.d`** — the elevated form carries `allowedNames: [svc, "*", "com.webos.service.capture.client*"]`
  and `{"service":"*","inbound":["*"],"outbound":["*"]}`; installation reduces it to the bare service
  name with no wildcard.
- **`manifests.d`** — the elevated form references `…service.root.json` and `…api.public.json`;
  installation drops both references. The final hash differs from 4.0.1's only because the manifest
  correctly carries `"version":"4.0.2"`.
- The two **created** files are only written when missing. They survived from an earlier elevation and
  were left orphaned — present on disk but unreferenced, therefore inert — until `elevateService`
  re-linked them.

**Reinstall, upgrade and repair each destroy elevation. A TV reboot does not** — the patched files
persist on disk.

### 2.2 `elevate-service` never restarts the target

Immediately after `elevateService` returned success, the running service was still **PID 5586, uid
5033, `CapEff: 0000000000000000`** — unchanged. Elevation on disk has no effect on a running process.

This is why the working sequence has always needed three steps, and it is the entire justification for
`restartService`.

### 2.3 The false `CORE_MISSING` is confirmed, not theorised

`/var/lib/alcyone` is `drwx------ root root`. The jailed service (uid 5033) cannot traverse it, so it
cannot reach `/var/lib/alcyone/bin/xray`. `supervisor.isExecutableFile()` treats the resulting `EACCES`
exactly like a missing file, `resolveExecutable()` returns `''`, and `manager.connect()` raises
`CORE_MISSING`.

Same root cause: a jailed service **cannot write `service.log`**, so failures leave no diagnostic trail
until elevation succeeds.

### 2.4 Restart is clean

Post-restart log, verbatim and secret-free:

```
INFO luna methods registered count=24
INFO recovering stale tunnel state after restart
INFO routes rolled back
INFO service started edition=xray version=4.0.2
INFO importer listening scope=loopback port=8080
```

The importer comes back on **loopback only**; LAN exposure still requires an explicit pairing window.

### 2.5 Platform notes for later phases

- **`luna-send` requires a TTY on this build.** Without one it exits 0 and prints nothing at all — a
  silent false negative. Use `ssh -tt`.
- **Packages installed to `/media/developer` have no `/var/lib/opkg/status` entry at all.** The
  stale-`opkg` design in Phase 2 must not assume a stanza exists.
- LS2 files live under **`/var/luna-service2-dev/`** on this device, not `/var/luna-service2/`.
- The service process is named `com.alcyone.vpn` with argv `com.alcyone.vpn.service`; it does **not**
  contain the string "alcyone" in a form `ps | grep alcyone` finds. Resolve its PID from
  `ls-monitor -l`.
- `--disable-timeouts` is pushed into `process.argv` at runtime by `keepResident()` and therefore never
  appears in `/proc/<pid>/cmdline`. Its absence there is not a defect.

---

## 3. Current state

### 3.1 TV

- Running the **probe** build: version `4.0.2`, title `Alcyone XRay PROBE`, real ids
  `com.alcyone.vpn` / `com.alcyone.vpn.service`.
- Service **elevated**: PID 5890, uid 0.
- `/tmp/alcyone-probe.ipk` removed. Nothing else was added to the TV.
- `/var/lib/alcyone` intact: `backups/`, `bin/` (xray, tun2socks, geoip.dat, geosite.dat),
  `core-config.json`, `profiles.json` (100,797 bytes, mtime unchanged), `service-state.json`,
  `service.log`, `tunnel.log`.
- `route.state` is absent — consumed by the documented restart-recovery path
  (`recovering stale tunnel state after restart` → `routes rolled back`). Transient runtime state, not
  user data.
- The VPN was **not** run during Phase 0.

### 3.2 Repository

Uncommitted, unpushed. Version is at **4.0.2** (the probe version). Phase 1 releases as **4.0.3**;
4.0.2 is never published.

Test status: all suites green except **`tests/ipk-binary-packaging-and-15-servers.test.js`**, which
fails for a **pre-existing** reason unrelated to Phase 0 — it asserts the committed 4.0.1 IPK carries
cores under `usr/palm/services/…/bin/`, but the builder deliberately ships them only under
`usr/palm/applications/…/bin/` (no duplicate binaries). Decide separately whether to fix the test or
the expectation.

Feed files (`com.alcyone.vpn*.manifest.json`, `r.json`, `repository.json`) were **not** touched and
still advertise 3.2.1 with stale hashes. That is Phase 2 work and must be published last.

---

## 4. Files changed for the probe

| File | Change | Disposition |
| --- | --- | --- |
| `app/service/lib/privilege.js` | new | **keep** |
| `app/service/lib/probe-phase0.js` | new | **delete** |
| `app/service/lib/api.js` | `privilege` require + `getState.privilege`; `restartService`; `probeElevationState`; `probeLog` | mixed |
| `app/service/service.js` | `requestRestart()` + `context.requestRestart`; three `METHODS` entries | mixed |
| `app/service/services.json` | three commands declared | mixed |
| `app/app.js` | `lunaAt()` refactor; probe constants, helpers, `SUB_OF`/`RETURN_FOCUS` entries, `wire()` bindings | mixed |
| `app/index.html` | PROBE settings row + PROBE page | **delete** |
| `app/appinfo.json` | version `4.0.1` → `4.0.2` | **keep** (retarget 4.0.3) |
| `build_ipk.py` | `VERSION` bump; `PROBE_*` constants, `probe_edition()`, `--probe` | mixed |
| `tests/frontend-luna.test.js` | one guard replaced by three | **keep** |
| `tests/build-editions.test.py` | `VERSION` bump; `build(probe=…)` + probe assertion block | mixed |
| `tests/xray-asset-packaging.test.py` | `VERSION` bump | **keep** (retarget 4.0.3) |

### 4.1 Permanent code to keep

- **`app/service/lib/privilege.js`** — observation-only privilege probe (`uid`, `root`, `pid`).
  `fs`/`process` only, no shell, no writes. `root` is `null` when `process.getuid` is unavailable,
  meaning *unknown*; callers must not conclude from `null`.
- **`restartService`** — the whole chain: `Api.prototype.restartService`, `requestRestart()` and
  `context.requestRestart` in `service.js`, the `METHODS` entry, and the `services.json` command.
  Responds first, then runs the existing `shutdown()` path on a 250 ms timer. Verified end to end.
- **`getState.privilege`** — `{ uid, root, pid }`. No filesystem paths.
- **`lunaAt(service, method, params, timeoutMs, cb)`** in `app/app.js` — the generalized bridge.
  `luna()` delegates to it, so every existing call site is unchanged.
- **The three `frontend-luna.test.js` guards** — see §6.
- **Version handling** in `build_ipk.py`, `app/appinfo.json`, `tests/build-editions.test.py`,
  `tests/xray-asset-packaging.test.py`. Retarget all four to `4.0.3` together; they must not drift.

### 4.2 Probe-only code to remove

Every item below is marked in-source with `TEMPORARY — PHASE 0 PROBE, REMOVE BEFORE RELEASE`
(`TEMPORARY -- PHASE 0 PROBE` in Python). Grep for that banner; it should return nothing when Phase 1
is done.

1. Delete `app/service/lib/probe-phase0.js`.
2. `app/service/lib/api.js` — remove the `probe-phase0` require, `Api.prototype.probeElevationState`,
   `Api.prototype.probeLog`.
3. `app/service/service.js` — remove `probeElevationState` and `probeLog` from `METHODS`.
   **Keep `restartService`.**
4. `app/service/services.json` — remove the two probe commands. **Keep `restartService`.**
5. `app/index.html` — remove the `PHASE 0 PROBE` settings row and the `<section id="probe">` page.
6. `app/app.js` — remove the probe constants (`PROBE_HBCHANNEL`, `PROBE_ELEVATE_TIMEOUT_MS`,
   `PROBE_POLL_INTERVAL_MS`, `PROBE_POLL_LIMIT`), the probe helpers (`probeSay`, `probeStamp`,
   `probeVerbatim`, `probePrivilegeLine`, `probeReadState`, `probeRequestElevation`,
   `probeRestartAndPoll`), the `probe` entries in `SUB_OF` / `RETURN_FOCUS`, and the four `wire()`
   bindings. **Keep `lunaAt()`.**
7. `build_ipk.py` — remove `PROBE_TITLE_SUFFIX`, `PROBE_ARTIFACT_MARKER`, `probe_edition()`, the
   `probe=` parameter on `build_edition()`, and the `--probe` argument.
8. `tests/build-editions.test.py` — remove the probe assertion block and the `probe=` parameter on
   `build()`.

After removal, `luna methods registered` must log **count=22** (21 original + `restartService`).

---

## 5. Minimal Phase 1 scope (release 4.0.3)

Phase 0 removes the need for a fallback branch: the in-app path is proven, so build it directly.

1. **Extend `privilege.js`** to report, as *separate independent facts*, `uid`, `root`,
   `appPayloadReadable`, `dataDirWritable`, `tunVisible`.
   `ELEVATION_REQUIRED` keys on **`root === false` alone**. Never combine `dataDirWritable` into the
   elevation decision — §2.3 shows it is a *consequence* of the jail, not a definition of it, and
   combining them would misclassify a genuinely elevated service with a damaged data directory.

2. **Add `app/service/lib/health.js`** — one ordered gate, first failure wins, later checks not
   attempted:

   | # | Check | Code |
   | --- | --- | --- |
   | 1 | `privilege.root === false` | `ELEVATION_REQUIRED` |
   | 2 | package payload present (`appDir/bin`, `appinfo.json`, service dir) | `PACKAGE_INCOMPLETE` |
   | 3 | core resolves to an existing regular file | `CORE_MISSING` |
   | 4 | core executable, non-zero, ELF magic matches architecture | `CORE_INTEGRITY_FAILED` |
   | 5 | required Xray asset present | `ASSET_MISSING` |
   | 6 | asset size + sha256 match pinned values | `ASSET_INTEGRITY_FAILED` |

   Reuse `xray-assets.checkFile()` verbatim; remap only the code. Do not write a second hasher.

3. **`errors.js`** — add `ELEVATION_REQUIRED`, `ELEVATION_FAILED`, `CORE_INTEGRITY_FAILED`,
   `ASSET_INTEGRITY_FAILED`, `PACKAGE_INCOMPLETE`, and a distinct code for the unmet hard prerequisite
   (suggested `HOMEBREW_REQUIRED`). Retain `ASSET_CORRUPT` as an alias so a 4.0.x frontend against a
   4.0.3 service still renders text.

4. **`manager.js`** — run the health gate **before** `resolveCores()`.

5. **`supervisor.js`** — `isExecutableFile()` returns `{ exists, executable, reason }` and skips
   `chmodSync` when `root !== true`, so a jail `EACCES` can never again be reported as a missing file.

6. **`app/app.js`** — replace the probe page with the production flow:
   - persistent, remote-navigable banner on `ELEVATION_REQUIRED`;
   - one **Grant permissions** button running the proven sequence: `elevateService` with a constant id
     → `restartService` → poll `getState` until `root === true` (~1 s interval, ~15 s cap);
   - if `checkRoot` shows the hard prerequisite is unmet, show the requirement, **disable VPN
     activation**, and offer no alternative;
   - localized `err.*` strings in ru and en for every new code. The UI shows what to do, never internal
     paths.

7. **Remove all probe-only code** per §4.2 and bump to **4.0.3**.

### Out of scope for Phase 1

`getInstallDiagnostics`; removing the duplicate `ensureStagedExecutable()` staging path; the Windows
repair CLI; stale-`opkg` recovery; feed and manifest synchronization. All Phase 2.

---

## 6. Security and compatibility constraints

- **No frontend shell.** The app's only channels are `luna()` to its own service and one fixed-URI call
  to `elevateService` with a **constant** id from the edition table. No user input, profile or
  subscription value reaches either.
- **No `/exec`, no `/spawn`**, in the frontend or the service.
- **Alcyone never edits LS2 configuration itself.** Only Homebrew Channel's `elevateService` does.
- Unchanged: `callerAllowed()` (`message.sender === edition.appId`); pairing, session, CSRF and Origin
  protections; TLS verification; SSRF and redirect limits; pinned sha256 asset integrity.
- **`/var/lib/alcyone` is never deleted, reset, emptied or auto-exported.**
- No duplicate cores or assets.
- `--disable-timeouts` preserved — do not modify `keepResident()`.
- **ES5 / Node 0.12 / webOS 4+** in all service code: `var`, function declarations, callbacks. No
  `let`/`const`, arrow functions, promises or template literals. `tests/node012-syntax.test.js` must
  cover every new module.
- Diagnostics never print URIs, UUIDs, passwords, subscription URLs or tokens. `logger.scrubValue`
  already strips them; do not bypass it.

### 6.1 The frontend guard change made in Phase 0

`tests/frontend-luna.test.js` previously had one guard:

```js
record('frontend does not reference Homebrew Channel exec',
  source.indexOf('hbchannel') < 0 && source.indexOf('/exec') < 0);
```

It banned the literal string `hbchannel` anywhere in the frontend, which the deliberately-approved
`elevateService` call trips. It was replaced by three narrower checks:

1. `/exec` **and** `/spawn` banned outright — strictly stronger, the original never checked `/spawn`;
2. Homebrew Channel methods restricted to an `elevateService` allow-list, parsed from the actual
   `lunaAt(` call sites;
3. the Homebrew Channel URI must be a literal constant.

Net effect is stricter, not weaker. Keep all three. Note guard 1 matches comment text too — do not
write `/exec` or `/spawn` in `app/app.js` comments.

---

## 7. Physical-TV validation for Phase 1

Target: authorized physical TV (address omitted; LG `lm18a`, webOS 4.4.3-22). Record each row.

Reach the service PID with `ls-monitor -l | awk '$2=="com.alcyone.vpn.service"{print $1}'`, and use
`ssh -tt` for any `luna-send`.

| # | Step | Expected |
| --- | --- | --- |
| 1 | Install 4.0.3 over the probe build | Installs; elevation reset (§2.1) |
| 2 | Launch the app without elevating | Banner shows `ELEVATION_REQUIRED`, **not** "core not found" |
| 3 | Press **Enable VPN** while unelevated | Refuses with `ELEVATION_REQUIRED`; no `CORE_MISSING` |
| 4 | Press **Grant permissions** | Elevation → restart → banner clears in ~15 s, no PC used |
| 5 | Service identity after step 4 | `Uid: 0 0 0 0`, new PID, old PID gone |
| 6 | Press **Enable VPN** (normal flow) | XRay + tun2socks start, `tun0` up, routes applied |
| 7 | Check external IP from the UI | Reports the VPN exit address, not the ISP address |
| 8 | Disconnect, then `ip route show default` | Identical to the value recorded before the test |
| 9 | `ip link show tun0` after disconnect | Interface gone |
| 10 | Profiles, subscriptions, language after upgrade | Preserved; `profiles.json` size and content intact |
| 11 | Reinstall 4.0.3 over itself | Elevation destroyed then re-applied by step 4; profiles untouched |
| 12 | Full TV reboot | Elevation **survives**; service relaunches on demand; autostart works if enabled |
| 13 | `restartService` while VPN connected | Clean disconnect, routes restored, lock released, relaunches elevated |
| 14 | Delete a core from `<dataDir>/bin` while elevated | `CORE_MISSING`, **not** `ELEVATION_REQUIRED` |
| 15 | Truncate `geoip.dat` while elevated | `ASSET_INTEGRITY_FAILED`, distinct from `ASSET_MISSING` |
| 16 | Simulate the hard prerequisite unmet | Requirement stated; **VPN activation unavailable**; no workaround offered; nothing crashes |
| 17 | Repeat 1–9 and 12–13 for the sing-box edition | Same results; single `sing-box` process; port 8081; own dataDir |
| 18 | Both editions installed, elevate one only | Other reports `ELEVATION_REQUIRED`; cross-edition tunnel lock respected |
| 19 | Inspect UI and `service.log` throughout | No URIs, UUIDs, passwords, subscription URLs or tokens |
| 20 | Grep the tree for the probe banner | No `PHASE 0 PROBE` occurrences remain |

Workstation checks before touching the TV:

```powershell
cd .\publishing\alcyone-github
node --check .\app\app.js
node --check .\app\service\service.js
node .\tests\run_all.js
node .\tests\node012-syntax.test.js
python .\tests\build-editions.test.py
python .\tests\repo-guards.test.py
python .\build_ipk.py --edition all
```
