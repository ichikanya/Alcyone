# Graph Report - alcyone-github  (2026-07-29)

## Corpus Check
- 105 files · ~263,317 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 871 nodes · 1751 edges · 70 communities (62 shown, 8 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 188 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `74292bb0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- parsers.js
- err
- Manual TV validation checklist
- build_ipk.py
- service.js
- PairingManager
- atomic.js
- ImporterServer
- ProfileStore
- Changelog
- Supervisor
- RouteManager
- build-cores.sh
- release-history/README.md
- Phase 1 handoff — elevation, error classification and the Grant-permissions flow
- runtime-regressions.test.js
- privilege.js
- logger.js
- Element
- elevation-flow-frontend.test.js
- build-editions.test.py
- frontend-call-reliability.test.js
- package.json
- binary-provenance.test.py
- Alcyone 3.0.9
- Alcyone 3.1.0
- Alcyone 3.1.1
- Alcyone 3.1.4
- Alcyone 3.1.6
- Alcyone 3.1.7
- Alcyone 3.2.0
- http-client.test.js
- node012-runtime.test.js
- repo-guards.test.py
- Alcyone 3.0.8
- Alcyone 3.1.2
- Alcyone 3.1.3
- Alcyone 3.1.5
- Native VPN cores
- RELEASE_NOTES_3.0.6.md
- RELEASE_NOTES_3.0.7.md
- certs/README.md
- xray.js
- AI Agent Navigation & Token Optimization Guide (AGENTS.md)
- app/countries.js
- service.js
- DeviceInfo
- luna-api.test.js
- xray-asset-packaging.test.py
- HealthGate
- ssrf.js
- http-client.js
- core-integrity.js
- manager.js
- singbox.js
- RELEASE_NOTES_3.0.5.md

## God Nodes (most connected - your core abstractions)
1. `err()` - 57 edges
2. `tr()` - 22 edges
3. `parseProxyLink()` - 21 edges
4. `VpnManager()` - 21 edges
5. `wire()` - 20 edges
6. `Changelog` - 19 edges
7. `luna()` - 18 edges
8. `updateHome()` - 18 edges
9. `renderServers()` - 18 edges
10. `ProfileStore()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `gate()` --indirect_call--> `paths()`  [INFERRED]
  tests/elevation-and-health.test.js → app/service/lib/edition.js
- `endpoints()` --calls--> `parseProxyLink()`  [EXTRACTED]
  app/service/lib/config/singbox.js → app/service/lib/proto/parsers.js
- `endpoints()` --calls--> `parseProxyLink()`  [EXTRACTED]
  app/service/lib/config/xray.js → app/service/lib/proto/parsers.js
- `markNested()` --calls--> `err()`  [EXTRACTED]
  app/service/lib/net/subscriptions.js → app/service/lib/errors.js
- `guard()` --calls--> `err()`  [EXTRACTED]
  app/service/lib/api.js → app/service/lib/errors.js

## Import Cycles
- None detected.

## Communities (70 total, 8 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.09
Nodes (76): activePageFocusables(), allTvFocusables(), applyI18n(), applyState(), applyStore(), autoLang(), bindFlagFallback(), captureServerListFocus() (+68 more)

### Community 1 - "parsers.js"
Cohesion: 0.08
Nodes (67): expandNested(), fetchCandidate(), headersFor(), markNested(), addUniqueLink(), applyYamlKey(), b64DecodeLoose(), bestName() (+59 more)

### Community 2 - "err"
Cohesion: 0.30
Nodes (11): err(), displayName(), importValue(), isPlainObject(), language(), optionalBoolean(), profileId(), proxyLink() (+3 more)

### Community 3 - "Manual TV validation checklist"
Cohesion: 0.04
Nodes (44): Architecture, Components, Cross-edition tunnel lock, Data storage, Editions, Local development, Luna method API, Migration (+36 more)

### Community 4 - "build_ipk.py"
Cohesion: 0.09
Nodes (42): app_overrides(), ar_member(), build_control_tar(), build_data_tar(), build_edition(), edition_architecture(), edition_js(), edition_json() (+34 more)

### Community 5 - "service.js"
Cohesion: 0.16
Nodes (7): fileExists(), Migrator(), readPid(), checkFile(), referenced(), sha256File(), verifyReferenced()

### Community 6 - "PairingManager"
Cohesion: 0.13
Nodes (5): generateCode(), generateToken(), PairingManager(), safeEqual(), Element()

### Community 7 - "atomic.js"
Cohesion: 0.14
Nodes (8): ensureDir(), readJson(), writeFileAtomic(), writeJsonAtomic(), Autostart(), processAlive(), readLock(), TunnelLock()

### Community 8 - "ImporterServer"
Cohesion: 0.11
Nodes (10): DeviceInfo(), clientKey(), ImporterServer(), parseCookies(), readBody(), securityHeaders(), esc(), importerPage() (+2 more)

### Community 9 - "ProfileStore"
Cohesion: 0.15
Nodes (10): defaultStore(), hasValidFullConfig(), hasValidLink(), isArray(), makeId(), normalize(), now(), ProfileStore() (+2 more)

### Community 10 - "Changelog"
Cohesion: 0.11
Nodes (19): 3.0.1, 3.0.2, 3.0.5, 3.0.6, 3.0.7, 3.0.8, 3.0.9, 3.1.0 (+11 more)

### Community 11 - "Supervisor"
Cohesion: 0.23
Nodes (6): isExecutableFile(), isPermissionDenied(), resolveExecutable(), resolveFailureReason(), runningAsRoot(), Supervisor()

### Community 13 - "build-cores.sh"
Cohesion: 0.23
Nodes (16): build_singbox(), build_tun2socks(), build_xray(), CGO_ENABLED, die(), GOARCH, GOARM, GOFLAGS (+8 more)

### Community 14 - "release-history/README.md"
Cohesion: 0.12
Nodes (8): Alcyone application source, Release history, Alcyone 3.0.1, Alcyone 3.0.2, Alcyone 3.0.5, What's New:, Alcyone 3.2.1, Alcyone 4.0.0

### Community 15 - "Phase 1 handoff — elevation, error classification and the Grant-permissions flow"
Cohesion: 0.10
Nodes (19): 1. Hard prerequisite, 2.1 Package installation destroys elevation (deterministically), 2.2 `elevate-service` never restarts the target, 2.3 The false `CORE_MISSING` is confirmed, not theorised, 2.4 Restart is clean, 2.5 Platform notes for later phases, 2. Proven Phase 0 results, 3.1 TV (+11 more)

### Community 16 - "runtime-regressions.test.js"
Cohesion: 0.26
Nodes (12): record(), testAutostart(), testDns(), testEditionAndEarlyLogs(), testImporterCsp(), testLegacyRoutes(), testLogInodeStability(), testLunaAuthorization() (+4 more)

### Community 17 - "privilege.js"
Cohesion: 0.20
Nodes (12): accessMode(), cacheKey(), canAccess(), copy(), probe(), readAppPayloadReadable(), readDataDirWritable(), readRoot() (+4 more)

### Community 20 - "elevation-flow-frontend.test.js"
Cohesion: 0.46
Nodes (13): boot(), countMethod(), editionFacts(), finish(), makeElement(), methods(), record(), runAutomaticEdition() (+5 more)

### Community 21 - "build-editions.test.py"
Cohesion: 0.39
Nodes (8): build(), elf_machine(), main(), Verify independent, reproducible XRay and sing-box IPK builds.  Also asserts the, read_ar(), read_tar_members(), sha256(), verify()

### Community 23 - "package.json"
Cohesion: 0.29
Nodes (6): dependencies, description, main, name, private, version

### Community 24 - "binary-provenance.test.py"
Cohesion: 0.53
Nodes (5): check(), elf_machine(), main(), Verify pinned native release inputs against their recorded provenance.  Native b, sha256_file()

### Community 25 - "Alcyone 3.0.9"
Cohesion: 0.40
Nodes (4): Alcyone 3.0.9, Large Subscription Fix, Tunnel Reliability, Validation

### Community 26 - "Alcyone 3.1.0"
Cohesion: 0.40
Nodes (4): Alcyone 3.1.0, TV Interface, Validation, VPN Lifecycle

### Community 27 - "Alcyone 3.1.1"
Cohesion: 0.40
Nodes (4): Alcyone 3.1.1, Reliable Disconnect, TV Interface, Validation

### Community 28 - "Alcyone 3.1.4"
Cohesion: 0.40
Nodes (4): Alcyone 3.1.4, Import and compatibility, Parsing and reliability, Validation

### Community 29 - "Alcyone 3.1.6"
Cohesion: 0.40
Nodes (4): Alcyone 3.1.6, Subscription import, Validation, VPN reliability and performance

### Community 30 - "Alcyone 3.1.7"
Cohesion: 0.40
Nodes (4): Alcyone 3.1.7, Controls, Validation, VPN reliability and performance

### Community 31 - "Alcyone 3.2.0"
Cohesion: 0.40
Nodes (4): Alcyone 3.2.0, Build and validation, sing-box Edition, XRay Edition

### Community 32 - "http-client.test.js"
Cohesion: 0.60
Nodes (3): makeSelfSigned(), record(), runTlsCheck()

### Community 33 - "node012-runtime.test.js"
Cohesion: 0.60
Nodes (5): check(), decompressionCheck(), dnsCheck(), httpsRedirectCheck(), nestedFailureCheck()

### Community 34 - "repo-guards.test.py"
Cohesion: 0.50
Nodes (3): iter_files(), main(), Repository guard: reject insecure patterns in the production tree.  These are th

### Community 35 - "Alcyone 3.0.8"
Cohesion: 0.50
Nodes (3): Alcyone 3.0.8, Core Update, What's Fixed

### Community 36 - "Alcyone 3.1.2"
Cohesion: 0.50
Nodes (3): Alcyone 3.1.2, Новый главный экран, Проверка

### Community 37 - "Alcyone 3.1.3"
Cohesion: 0.50
Nodes (3): Alcyone 3.1.3, Stability and resource fixes, Validation

### Community 38 - "Alcyone 3.1.5"
Cohesion: 0.50
Nodes (3): Alcyone 3.1.5, Subscription compatibility, Validation

### Community 53 - "xray.js"
Cohesion: 0.40
Nodes (10): applyResourcePolicy(), applyXhttpLimits(), boundedPolicyValue(), build(), buildFullConfig(), buildStreamSettings(), endpoints(), isArray() (+2 more)

### Community 54 - "AI Agent Navigation & Token Optimization Guide (AGENTS.md)"
Cohesion: 0.33
Nodes (5): 1. Fast Knowledge Graph Navigation (Graphify), 2. Core Architectural Map, 3. Essential Commands Cheat-Sheet, AI Agent Navigation & Token Optimization Guide (AGENTS.md), Token-Saving Navigation Rules:

### Community 55 - "app/countries.js"
Cohesion: 0.48
Nodes (5): emoji(), isSupported(), nativeSrc(), normalize(), regionalIndicator()

### Community 56 - "service.js"
Cohesion: 0.13
Nodes (15): Diagnostics(), copy(), load(), merge(), paths(), callerAllowed(), keepResident(), main() (+7 more)

### Community 57 - "DeviceInfo"
Cohesion: 0.24
Nodes (5): capFile(), formatMeta(), Logger(), rewriteInPlace(), scrubValue()

### Community 58 - "luna-api.test.js"
Cohesion: 0.60
Nodes (4): assertNoSecrets(), call(), expectError(), record()

### Community 60 - "xray-asset-packaging.test.py"
Cohesion: 0.53
Nodes (5): ar_payload(), compressed_tar(), main(), Focused Xray-only staging and IPK asset integrity checks., sha256()

### Community 63 - "HealthGate"
Cohesion: 0.28
Nodes (4): elfMachine(), HealthGate(), statDenied(), statOrNull()

### Community 64 - "ssrf.js"
Cohesion: 0.33
Nodes (13): resolveValidated(), allZero(), assertAddressAllowed(), assertHostnameAllowed(), assertResolvedAddresses(), assertUrlAllowed(), blockedIpv4Reason(), blockedIpv6Reason() (+5 more)

### Community 65 - "http-client.js"
Cohesion: 0.25
Nodes (15): decodeBody(), fetchUrl(), fetchUrlNow(), isTlsError(), loadBundledCa(), protocolHint(), pumpQueue(), redirectOriginChanged() (+7 more)

### Community 66 - "core-integrity.js"
Cohesion: 0.50
Nodes (8): copyFileAtomic(), expectedFor(), matches(), prepare(), regularFile(), sha256File(), verifyForLaunch(), verifyPackaged()

### Community 67 - "manager.js"
Cohesion: 0.33
Nodes (3): resolveAll(), readTarEntries(), unpackDataTarFromIpk()

### Community 68 - "singbox.js"
Cohesion: 0.53
Nodes (5): build(), endpoints(), outboundFor(), tlsFor(), transportFor()

### Community 69 - "RELEASE_NOTES_3.0.5.md"
Cohesion: 0.22
Nodes (4): Api(), guard(), isAlcyoneError(), toResult()

## Knowledge Gaps
- **125 isolated node(s):** `name`, `version`, `description`, `main`, `private` (+120 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `err()` connect `err` to `ssrf.js`, `http-client.js`, `core-integrity.js`, `parsers.js`, `singbox.js`, `RELEASE_NOTES_3.0.5.md`, `PairingManager`, `atomic.js`, `ImporterServer`, `ProfileStore`, `service.js`, `Supervisor`, `RouteManager`, `logger.js`, `xray.js`, `service.js`, `HealthGate`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `register()` connect `service.js` to `app.js`, `err`, `RELEASE_NOTES_3.0.5.md`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `testDns()` connect `runtime-regressions.test.js` to `app.js`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _125 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09082278481012658 - nodes in this community are weakly interconnected._
- **Should `parsers.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08108108108108109 - nodes in this community are weakly interconnected._
- **Should `Manual TV validation checklist` be split into smaller, more focused modules?**
  _Cohesion score 0.041666666666666664 - nodes in this community are weakly interconnected._