# Alcyone maintainer audit - final state

Date: 2026-07-31

This report is sanitized. It contains no device address, endpoint, profile
value, subscription URL, credential, pairing code, external IP, or personal
filesystem path. The physical target is referred to only as the authorized
physical TV.

## Executive result

All original maintainer requirements are complete except publication, which
was explicitly out of scope. The final source tree passes the complete
mandatory suite, produces separate unpublished ARM candidates, and both final
XRay and sing-box candidates were installed through Homebrew Channel and
physically replayed on the authorized physical TV. TUN creation, HTTPS,
VPN-path verification, clean disconnect, route restoration, and data-hash
preservation all passed. No persistent user data changed.

Recommendation: ready for maintainer publication review. No code, package,
registry, or physical-validation blocker remains. No public feed, release,
commit, push, or reboot was performed.

## Original maintainer items

The saved handoff did not contain a machine-readable Resolved/Unresolved table;
the previous statuses below are reconstructed from its findings, existing
tests, release notes, and the working tree at session continuation.

| Original item | Previous status | Final verified status | Evidence |
| --- | --- | --- | --- |
| Privileged work belongs in the per-edition Luna service; elevation must be explicit and fail closed | Partial | Verified locally; prior physical root-required operation verified | `app/service/service.js`, `app/service/lib/privilege.js`, `tests/elevation-and-health.test.js`, `tests/elevation-flow-frontend.test.js` |
| Clean install and upgrade preserve data, profiles, subscriptions, settings, backups, and installed binaries | Partial | Verified for final candidate installation and physical replay | Pre/post profile-store and staged-core SHA-256 unchanged; installed version `4.0.3`; `tests/migration-and-switch.test.js`, `tests/build-editions.test.py` |
| Native binary provenance, integrity, and reproducible release inputs | Partial | Verified | `cores/provenance.json`, `app/service/lib/core-integrity.js`, `tests/binary-provenance.test.py` 54/54, reproducible edition build test |
| ARM architecture, ES5, and Node.js 0.12 compatibility | Resolved | Reverified | `tests/node012-syntax.test.js` (33 files), `tests/node012-runtime.test.js` (13/13), architecture tests |
| Supported protocol generation and edition capability boundaries | Partial | Verified | `app/service/lib/config/xray.js`, `app/service/lib/config/singbox.js`, `tests/endpoint-bootstrap.test.js`, `tests/provider-compat.test.js`, `tests/resource-and-edition.test.js` |
| Imported Hysteria2 compatibility: a supported Hysteria2 data path must not become `HEALTH_CHECK_FAILED` because an individual IP probe source is unavailable | Unresolved (new compatibility finding) | Fixed and physically verified with both final editions | `app/service/lib/diagnostics.js`, `tests/data-plane-probe.test.js`; bounded HTTPS-only verification and final TV replay passed |
| DNS bootstrap, TLS verification, hostname/SNI preservation, redirects, SSRF, and authorization | Resolved | Preserved and reverified | `app/service/lib/net/http-client.js`, `app/service/lib/net/endpoint-bootstrap.js`, `tests/http-client.test.js` (21/21), `tests/hwid-and-redirect-regression.test.js` |
| Lifecycle, crash recovery, intermittent XRay startup, and no stranded routes | Partial / intermittent | Fixed, regression-tested, and physically replayed | `app/service/lib/vpn/manager.js`, `app/service/lib/supervisor.js`, `tests/lifecycle-races.test.js` (25 focused checks), `tests/vpn-lifecycle-service.test.js` (35/35) |
| Network changes must not restore stale gateway/interface routes | Unresolved | Fixed and verified | `app/service/lib/vpn/manager.js`, `app/service/lib/net/routes.js`, `tests/route-safety.test.js` (15/15), lifecycle network-change checks |
| Exact route rollback, data-plane verification, and cross-edition tunnel ownership | Partial | Verified locally and in final candidate replay | `app/service/lib/net/routes.js`, `app/service/lib/tunnel-lock.js`, lifecycle and route-safety suites |
| Sing-box edition must remain independent and use one capability-based architecture | Partial | Verified in final candidate replay | `app/service/lib/edition.js`, both generated edition packages, edition matrix tests, `tests/resource-and-edition.test.js` |
| Authentication, pairing, sessions, CSRF, Origin checks, secret redaction, and LAN scope | Resolved | Preserved and reverified | `app/service/lib/pairing.js`, `app/service/lib/web/server.js`, `tests/lan-importer.test.js` (30/30), binding tests |
| SSRF and redirect protections must survive compatibility/provider behavior | Resolved | Preserved and reverified | `tests/http-client.test.js`, `tests/provider-compat.test.js`, `tests/hwid-and-redirect-regression.test.js` |
| Descriptor, process, log, body, header, redirect, and subscription limits | Partial | Verified | `app/service/lib/logger.js`, `app/service/lib/supervisor.js`, `tests/resource-and-edition.test.js`, runtime log inode/cap checks |
| Logs must be bounded, secret-safe, and distinguish current versus historical events and sources | Unresolved / confusing | Fixed and physically exercised | `app/service/lib/logger.js`, `app/service/service.js`, `tests/runtime-regressions.test.js`: shared ephemeral run id, `run=...`, `source=service|core`, startup core marker |
| UI/service bridge reliability, elevation flow, and log viewer behavior | Partial | Verified locally; prior normal UI connection evidence valid | `app/app.js`, `tests/frontend-call-reliability.test.js`, `tests/frontend-luna.test.js`, `tests/elevation-flow-frontend.test.js` |
| Historical release artifacts, `_all.ipk` architecture error, package naming, and feed consistency | Unresolved / regressed | Fixed locally; public feed intentionally unchanged | `build_ipk.py`, `tests/ipk-binary-packaging-and-15-servers.test.js`, `tests/repo-guards.test.py`; only the two canonical 4.0.3 ARM IPKs remain in `packages/` |
| Maintainer documentation and release notes must describe the actual build | Partial | Updated | `README.md`, `docs/ARCHITECTURE.md`, `docs/release-history/CHANGELOG.md`, `docs/release-history/RELEASE_NOTES_4.0.3.md` |
| Physical installation, privilege, UI, traffic, FD stability, routing, status, rollback, and log validation | Partial | Final candidate installation, privilege, traffic, routing, status, rollback, and data preservation verified; publication remains pending | See the physical section below |

## Changes made

- Added fail-closed network-change detection. When the captured physical
  interface or gateway changes, the manager disconnects and rolls back only
  tunnel-owned state while preserving the newly active network-manager route.
- Added regression coverage for interface changes, gateway changes, and stale
  route prevention.
- Root cause of the new compatibility failure was the health check's fixed
  two-source external-IP dependency, not Hysteria2 schema support: the
  affected Hysteria2 profiles generated valid XRay 26.3.27 configurations and
  carried ordinary HTTPS traffic, while both fixed probe sources returned no
  usable IP. Replaced that dependency with five bounded HTTPS-only sources;
  every response still requires strict IP validation before connection status
  becomes connected. No provider, profile, server, hostname, or endpoint
  workaround was added.
- Added a process-lifetime run identifier shared by service and core log views.
  New lines include a bounded random run id and source label; restart markers
  make retained historical lines distinguishable without persisting identity.
- Kept core stdout/stderr in the bounded core log and retained the existing
  secret scrubber, inode-preserving cap, and clear behavior.
- Preserved the single `ignore` stdio mode required by sing-box on the affected
  webOS Node runtime while retaining descriptor-backed XRay logging.
- Scrubbed inherited webOS UI, media, loader, and Luna service context from
  native-core environments, while retaining only fixed core-safe defaults and
  purpose-specific values. This removes a platform-runtime SIGABRT without
  changing validation, argv handling, or user data.
- Added lifecycle regressions for the native-core stdio mode, preload removal,
  and platform-environment scrubbing.
- Corrected package inspection tests and documentation to use the canonical
  4.0.3 ARM artifact names and `packages/` output.
- Removed historical ambiguous `_all.ipk` and candidate artifacts. The public
  feed remains at its last published version because publication was not
  authorized.
- Sanitized the historical handoff so maintainer-facing documentation contains
  no physical device address.

## Complete test results

- `node tests/run_all.js`: all 29 suites passed.
- `node tests/lifecycle-races.test.js`: 25 focused checks passed.
- `node tests/node012-syntax.test.js`: 33 service files parsed.
- `node tests/node012-runtime.test.js`: 13/13 passed.
- `python tests/build-editions.test.py`: reproducible XRay and sing-box builds
  passed.
- `python tests/binary-provenance.test.py`: 54/54 passed.
- `python tests/xray-asset-packaging.test.py`: passed.
- `python tests/repo-guards.test.py`: passed; 179 files scanned.
- `node --check`: application, service, manager, and supervisor sources passed.
- Retired `app/scripts/alcyonectl.sh`: syntax check N/A because the guarded
  legacy control script is intentionally absent.
- Final aggregate exit status: all executed checks passed.

Warnings were limited to existing Node deprecation warnings for legacy
runtime APIs; no test failed or was suppressed.

## Canonical unpublished packages

The final `packages/` directory contains exactly these two files and no other
IPK candidate:

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `packages/Alcyone-XRay_4.0.3_arm.ipk` | 22,019,458 bytes | `bbcf8b098edb9955c2f3cd4c255b5ced442a8901b15d4046408259217b54001c` |
| `packages/Alcyone-sing-box_4.0.3_arm.ipk` | 11,955,754 bytes | `da69f35384a9e4c562d880ead79d9e2cb0f25de21c79ac5cc689762643a690e4` |

Build inputs are pinned in `cores/provenance.json`; package architecture is
derived from the ELF machine type and is ARM, not `all`.

## Separate final candidate packages

These unpublished candidates were built after the final runtime fix and were
physically replayed:

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `diagnostic-artifacts/final-candidates-20260731-fix4/Alcyone-XRay_4.0.3-final-candidate-fix4_arm.ipk` | 22,020,726 bytes | `c78fe1c9dcb96123d78dfb3ab079ec1eb454ab7c7f86f08ef9c14b106baa8906` |
| `diagnostic-artifacts/final-candidates-20260731-fix4/Alcyone-sing-box_4.0.3-final-candidate-fix4_arm.ipk` | 11,957,010 bytes | `2e286a5310fdcc2fc859a6b0ebadf2017e532476b6a877e95e31adf1ed8bf01b` |

## Physical evidence

Only the authorized physical TV was used.

### Previously completed evidence retained

The saved session already established, on the authorized physical TV and
before the final logger-only package rebuild:

- clean installation with version `4.0.3`;
- profile-store SHA-256 and staged XRay binary SHA-256 preserved across install;
- root-required TUN and route setup succeeded;
- normal UI connection succeeded;
- real HTTPS traffic passed;
- external address result was recorded only as changed=yes/no;
- one XRay and one tun2socks process remained present;
- repeated descriptor/RSS/thread samples were stable;
- TUN and split routing were active while connected;
- UI disconnect restored ordinary connectivity and route state;
- the prior service/core logs were bounded and secret-scrubbed.

### Final candidate replay

- Both final candidates were installed through the normal Homebrew Channel
  application installer with exact lowercase SHA-256 verification, then the
  service registry was refreshed and both services were elevated to uid 0.
- XRay: connect succeeded; TUN appeared; ordinary HTTPS passed; the service
  reported `viaVpn: true`; disconnect returned idle; TUN disappeared and the
  physical default route was restored.
- sing-box: the same connect, TUN, HTTPS, `viaVpn: true`, disconnect, TUN
  removal, and route-restoration checks passed. This replay validated the
  final native-core environment fix.
- Final physical data-preservation hashes remained unchanged for the XRay
  profile store and staged XRay binary. The temporary sing-box fixture also
  retained the same profile-store hash.
- All temporary TV installer files, diagnostic scripts, copied packages, and
  the temporary test service were removed. No diagnostic process remains.

## Remaining blockers by severity

1. **Low - publication is intentionally pending.** The public feed and public
   release were not changed, as explicitly required. A maintainer must perform
   the release/feed action after accepting the unpublished artifacts.

No other locally resolvable blocker remains.
