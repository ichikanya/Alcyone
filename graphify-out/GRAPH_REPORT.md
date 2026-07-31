# Graph Report - alcyone-github  (2026-07-31)

## Corpus Check
- 113 files · ~404,056 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1030 nodes · 2272 edges · 67 communities (59 shown, 8 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 340 edges (avg confidence: 0.53)
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
- lan-importer.test.js
- Native VPN cores
- RELEASE_NOTES_3.0.6.md
- errors.js
- tv-ui.test.js
- certs/README.md
- xray.js
- AI Agent Navigation & Token Optimization Guide (AGENTS.md)
- app/countries.js
- service.js
- DeviceInfo
- luna-api.test.js
- xray-asset-packaging.test.py
- singbox.js
- singbox.js
- core-integrity.js
- elevation-and-health.test.js

## God Nodes (most connected - your core abstractions)
1. `err()` - 64 edges
2. `t()` - 38 edges
3. `VpnManager()` - 35 edges
4. `r()` - 35 edges
5. `a()` - 34 edges
6. `i()` - 26 edges
7. `n()` - 25 edges
8. `tr()` - 22 edges
9. `RouteManager()` - 21 edges
10. `parseProxyLink()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `request()` --indirect_call--> `c()`  [INFERRED]
  tests/lan-importer.test.js → diagnostic-artifacts/hbchannel-service.js
- `lunaAt()` --indirect_call--> `r()`  [INFERRED]
  app/app.js → diagnostic-artifacts/hbchannel-service.js
- `later()` --indirect_call--> `resolve()`  [INFERRED]
  tests/lifecycle-races.test.js → app/service/lib/net/endpoint-bootstrap.js
- `parseClashVless()` --indirect_call--> `k()`  [INFERRED]
  app/service/lib/proto/parsers.js → diagnostic-artifacts/hbchannel-service.js
- `paramsIdentity()` --indirect_call--> `a()`  [INFERRED]
  app/service/lib/proto/parsers.js → diagnostic-artifacts/hbchannel-service.js

## Import Cycles
- None detected.

## Communities (67 total, 8 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.08
Nodes (79): activePageFocusables(), allTvFocusables(), applyI18n(), applyState(), applyStore(), autoLang(), bindFlagFallback(), captureServerListFocus() (+71 more)

### Community 1 - "parsers.js"
Cohesion: 0.07
Nodes (69): expandNested(), fetchCandidate(), headersFor(), markNested(), addUniqueLink(), applyYamlKey(), b64DecodeLoose(), bestName() (+61 more)

### Community 2 - "err"
Cohesion: 0.17
Nodes (11): Alcyone maintainer audit - final state, Canonical unpublished packages, Changes made, Complete test results, Executive result, Final candidate replay, Original maintainer items, Physical evidence (+3 more)

### Community 3 - "Manual TV validation checklist"
Cohesion: 0.04
Nodes (44): Architecture, Components, Cross-edition tunnel lock, Data storage, Editions, Local development, Luna method API, Migration (+36 more)

### Community 4 - "build_ipk.py"
Cohesion: 0.09
Nodes (42): app_overrides(), ar_member(), build_control_tar(), build_data_tar(), build_edition(), edition_architecture(), edition_js(), edition_json() (+34 more)

### Community 6 - "PairingManager"
Cohesion: 0.13
Nodes (5): generateCode(), generateToken(), PairingManager(), safeEqual(), Element()

### Community 7 - "atomic.js"
Cohesion: 0.06
Nodes (27): ensureDir(), readJson(), writeFileAtomic(), writeJsonAtomic(), Autostart(), copy(), load(), merge() (+19 more)

### Community 8 - "ImporterServer"
Cohesion: 0.26
Nodes (5): elfMachine(), HealthGate(), machineMatchesRuntime(), statDenied(), statOrNull()

### Community 9 - "ProfileStore"
Cohesion: 0.15
Nodes (10): defaultStore(), hasValidFullConfig(), hasValidLink(), isArray(), makeId(), normalize(), now(), ProfileStore() (+2 more)

### Community 10 - "Changelog"
Cohesion: 0.10
Nodes (20): 3.0.1, 3.0.2, 3.0.5, 3.0.6, 3.0.7, 3.0.8, 3.0.9, 3.1.0 (+12 more)

### Community 11 - "Supervisor"
Cohesion: 0.14
Nodes (7): DeviceInfo(), capFile(), formatMeta(), Logger(), newRunId(), rewriteInPlace(), scrubValue()

### Community 12 - "RouteManager"
Cohesion: 0.31
Nodes (5): isAlcyoneError(), toResult(), makeSelfSigned(), record(), runTlsCheck()

### Community 13 - "build-cores.sh"
Cohesion: 0.23
Nodes (16): build_singbox(), build_tun2socks(), build_xray(), CGO_ENABLED, die(), GOARCH, GOARM, GOFLAGS (+8 more)

### Community 14 - "release-history/README.md"
Cohesion: 0.10
Nodes (11): Alcyone application source, Release history, Alcyone 3.0.1, Alcyone 3.0.2, Alcyone 3.0.5, What's New:, Alcyone 3.0.7, What's Fixed (+3 more)

### Community 15 - "Phase 1 handoff — elevation, error classification and the Grant-permissions flow"
Cohesion: 0.10
Nodes (19): 1. Hard prerequisite, 2.1 Package installation destroys elevation (deterministically), 2.2 `elevate-service` never restarts the target, 2.3 The false `CORE_MISSING` is confirmed, not theorised, 2.4 Restart is clean, 2.5 Platform notes for later phases, 2. Proven Phase 0 results, 3.1 TV (+11 more)

### Community 16 - "runtime-regressions.test.js"
Cohesion: 0.26
Nodes (12): record(), testAutostart(), testDns(), testEditionAndEarlyLogs(), testImporterCsp(), testLegacyRoutes(), testLogInodeStability(), testLunaAuthorization() (+4 more)

### Community 17 - "privilege.js"
Cohesion: 0.36
Nodes (10): accessMode(), cacheKey(), canAccess(), copy(), probe(), readAppPayloadReadable(), readDataDirWritable(), readRoot() (+2 more)

### Community 18 - "logger.js"
Cohesion: 0.16
Nodes (9): clientKey(), ImporterServer(), parseCookies(), readBody(), securityHeaders(), esc(), importerPage(), pairingPage() (+1 more)

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
Cohesion: 0.08
Nodes (40): Diagnostics(), resolveAll(), buildResult(), canonicalHost(), isLiteralAddress(), isValidHostname(), normalizeTarget(), once() (+32 more)

### Community 33 - "node012-runtime.test.js"
Cohesion: 0.52
Nodes (6): check(), decompressionCheck(), dnsCheck(), endpointBootstrapCheck(), httpsRedirectCheck(), nestedFailureCheck()

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

### Community 45 - "errors.js"
Cohesion: 0.29
Nodes (4): checkFile(), referenced(), sha256File(), verifyReferenced()

### Community 48 - "tv-ui.test.js"
Cohesion: 0.12
Nodes (69): a(), b(), Be(), bt(), c(), Ct(), d(), dt() (+61 more)

### Community 53 - "xray.js"
Cohesion: 0.15
Nodes (25): applyBootstrap(), applyResourcePolicy(), applyXhttpLimits(), boundedPolicyValue(), build(), buildFullConfig(), buildStreamSettings(), canonicalHost() (+17 more)

### Community 54 - "AI Agent Navigation & Token Optimization Guide (AGENTS.md)"
Cohesion: 0.33
Nodes (5): 1. Fast Knowledge Graph Navigation (Graphify), 2. Core Architectural Map, 3. Essential Commands Cheat-Sheet, AI Agent Navigation & Token Optimization Guide (AGENTS.md), Token-Saving Navigation Rules:

### Community 55 - "app/countries.js"
Cohesion: 0.48
Nodes (5): emoji(), isSupported(), nativeSrc(), normalize(), regionalIndicator()

### Community 56 - "service.js"
Cohesion: 0.17
Nodes (13): Api(), guard(), err(), displayName(), importValue(), isPlainObject(), language(), optionalBoolean() (+5 more)

### Community 57 - "DeviceInfo"
Cohesion: 0.21
Nodes (4): decodeProcIpv4(), findIpBinary(), routeIdentity(), RouteManager()

### Community 58 - "luna-api.test.js"
Cohesion: 0.60
Nodes (4): assertNoSecrets(), call(), expectError(), record()

### Community 60 - "xray-asset-packaging.test.py"
Cohesion: 0.53
Nodes (5): ar_payload(), compressed_tar(), main(), Focused Xray-only staging and IPK asset integrity checks., sha256()

### Community 63 - "singbox.js"
Cohesion: 0.19
Nodes (6): isExecutableFile(), isPermissionDenied(), resolveExecutable(), resolveFailureReason(), runningAsRoot(), Supervisor()

### Community 64 - "singbox.js"
Cohesion: 0.39
Nodes (8): applyBootstrap(), build(), canonicalHost(), endpoints(), outboundFor(), own(), tlsFor(), transportFor()

### Community 65 - "core-integrity.js"
Cohesion: 0.50
Nodes (8): copyFileAtomic(), expectedFor(), matches(), prepare(), regularFile(), sha256File(), verifyForLaunch(), verifyPackaged()

## Knowledge Gaps
- **136 isolated node(s):** `name`, `version`, `description`, `main`, `private` (+131 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `err()` connect `service.js` to `singbox.js`, `core-integrity.js`, `http-client.test.js`, `parsers.js`, `service.js`, `PairingManager`, `atomic.js`, `ImporterServer`, `ProfileStore`, `RouteManager`, `errors.js`, `logger.js`, `xray.js`, `DeviceInfo`, `singbox.js`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `register()` connect `atomic.js` to `service.js`, `app.js`, `RouteManager`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `paramsIdentity()` connect `parsers.js` to `tv-ui.test.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `t()` (e.g. with `bt()` and `c()`) actually correct?**
  _`t()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 23 inferred relationships involving `r()` (e.g. with `lunaAt()` and `c()`) actually correct?**
  _`r()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 26 inferred relationships involving `a()` (e.g. with `paramsIdentity()` and `c()`) actually correct?**
  _`a()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _136 weakly-connected nodes found - possible documentation gaps or missing edges._