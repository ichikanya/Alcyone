# Graph Report - alcyone-github  (2026-07-28)

## Corpus Check
- 94 files · ~244,771 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 748 nodes · 1476 edges · 62 communities (53 shown, 9 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 172 edges (avg confidence: 0.53)
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
- VpnManager
- runtime-regressions.test.js
- err
- logger.js
- Element
- errors.js
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
- subscriptions.js
- service.js
- DeviceInfo
- singbox.js
- lib/edition.js
- xray-asset-packaging.test.py
- RELEASE_NOTES_3.0.5.md

## God Nodes (most connected - your core abstractions)
1. `err()` - 45 edges
2. `parseProxyLink()` - 21 edges
3. `tr()` - 19 edges
4. `wire()` - 19 edges
5. `Changelog` - 19 edges
6. `renderServers()` - 18 edges
7. `ProfileStore()` - 17 edges
8. `VpnManager()` - 17 edges
9. `RouteManager()` - 16 edges
10. `PairingManager()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `endpoints()` --calls--> `parseProxyLink()`  [EXTRACTED]
  app/service/lib/config/singbox.js → app/service/lib/proto/parsers.js
- `endpoints()` --calls--> `parseProxyLink()`  [EXTRACTED]
  app/service/lib/config/xray.js → app/service/lib/proto/parsers.js
- `startup()` --indirect_call--> `paths()`  [INFERRED]
  app/service/service.js → app/service/lib/edition.js
- `guard()` --calls--> `err()`  [EXTRACTED]
  app/service/lib/api.js → app/service/lib/errors.js
- `readLock()` --calls--> `readJson()`  [EXTRACTED]
  app/service/lib/tunnel-lock.js → app/service/lib/atomic.js

## Import Cycles
- None detected.

## Communities (62 total, 9 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.11
Nodes (63): activePageFocusables(), allTvFocusables(), applyI18n(), applyStore(), autoLang(), bindFlagFallback(), captureServerListFocus(), cardHtml() (+55 more)

### Community 1 - "parsers.js"
Cohesion: 0.09
Nodes (63): addUniqueLink(), applyYamlKey(), b64DecodeLoose(), bestName(), bufferFrom(), buildHysteria2Link(), buildSocksLink(), buildSsLink() (+55 more)

### Community 2 - "err"
Cohesion: 0.13
Nodes (23): Diagnostics(), resolveAll(), decodeBody(), fetchUrl(), fetchUrlNow(), isTlsError(), loadBundledCa(), pumpQueue() (+15 more)

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
Cohesion: 0.17
Nodes (9): clientKey(), ImporterServer(), parseCookies(), readBody(), securityHeaders(), esc(), importerPage(), pairingPage() (+1 more)

### Community 9 - "ProfileStore"
Cohesion: 0.15
Nodes (10): defaultStore(), hasValidFullConfig(), hasValidLink(), isArray(), makeId(), normalize(), now(), ProfileStore() (+2 more)

### Community 10 - "Changelog"
Cohesion: 0.11
Nodes (19): 3.0.1, 3.0.2, 3.0.5, 3.0.6, 3.0.7, 3.0.8, 3.0.9, 3.1.0 (+11 more)

### Community 11 - "Supervisor"
Cohesion: 0.18
Nodes (8): isExecutableFile(), resolveExecutable(), Supervisor(), assertNoSecrets(), call(), expectError(), finish(), record()

### Community 13 - "build-cores.sh"
Cohesion: 0.23
Nodes (16): build_singbox(), build_tun2socks(), build_xray(), CGO_ENABLED, die(), GOARCH, GOARM, GOFLAGS (+8 more)

### Community 14 - "release-history/README.md"
Cohesion: 0.15
Nodes (6): Alcyone application source, Release history, Alcyone 3.0.1, Alcyone 3.0.2, Alcyone 3.2.1, Alcyone 4.0.0

### Community 15 - "VpnManager"
Cohesion: 0.18
Nodes (3): ensureStagedExecutable(), getCandidatePaths(), VpnManager()

### Community 16 - "runtime-regressions.test.js"
Cohesion: 0.26
Nodes (12): record(), testAutostart(), testDns(), testEditionAndEarlyLogs(), testImporterCsp(), testLegacyRoutes(), testLogInodeStability(), testLunaAuthorization() (+4 more)

### Community 17 - "err"
Cohesion: 0.30
Nodes (11): err(), displayName(), importValue(), isPlainObject(), language(), optionalBoolean(), profileId(), proxyLink() (+3 more)

### Community 18 - "logger.js"
Cohesion: 0.30
Nodes (5): capFile(), formatMeta(), Logger(), rewriteInPlace(), scrubValue()

### Community 20 - "errors.js"
Cohesion: 0.22
Nodes (4): Api(), guard(), isAlcyoneError(), toResult()

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
Cohesion: 0.70
Nodes (4): check(), decompressionCheck(), dnsCheck(), nestedFailureCheck()

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

### Community 55 - "subscriptions.js"
Cohesion: 0.25
Nodes (5): expandNested(), fetchCandidate(), headersFor(), readTarEntries(), unpackDataTarFromIpk()

### Community 56 - "service.js"
Cohesion: 0.31
Nodes (7): callerAllowed(), keepResident(), main(), register(), respond(), run(), startup()

### Community 58 - "singbox.js"
Cohesion: 0.53
Nodes (5): build(), endpoints(), outboundFor(), tlsFor(), transportFor()

### Community 59 - "lib/edition.js"
Cohesion: 0.60
Nodes (4): copy(), load(), merge(), paths()

### Community 60 - "xray-asset-packaging.test.py"
Cohesion: 0.60
Nodes (4): data_tar(), main(), Focused Xray-only staging and IPK asset integrity checks., sha256()

## Knowledge Gaps
- **112 isolated node(s):** `name`, `version`, `description`, `main`, `private` (+107 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `err()` connect `err` to `parsers.js`, `err`, `service.js`, `PairingManager`, `atomic.js`, `ImporterServer`, `ProfileStore`, `Supervisor`, `RouteManager`, `VpnManager`, `errors.js`, `xray.js`, `subscriptions.js`, `service.js`, `singbox.js`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `register()` connect `service.js` to `app.js`, `err`, `errors.js`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `testDns()` connect `runtime-regressions.test.js` to `app.js`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _112 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1080958842152872 - nodes in this community are weakly interconnected._
- **Should `parsers.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09317051108095885 - nodes in this community are weakly interconnected._
- **Should `err` be split into smaller, more focused modules?**
  _Cohesion score 0.1310344827586207 - nodes in this community are weakly interconnected._