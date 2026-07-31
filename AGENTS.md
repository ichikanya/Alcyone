# AI Agent Navigation & Token Optimization Guide (AGENTS.md)

This project is optimized for AI agent pairing (Codex, Claude, Antigravity, Cursor) with minimal token consumption and fast codebase navigation.

---

## 1. Fast Knowledge Graph Navigation (Graphify)

A zero-token-cost Knowledge Graph AST is maintained in `graphify-out/`.

### Token-Saving Navigation Rules:
- **Never read raw `graphify-out/graph.json`**: It is a large JSON payload that wastes context window tokens.
- **Use Graphify CLI for targeted subgraphs**:
  - `graphify query "<search term>"` — Find specific components or functions.
  - `graphify path "<nodeA>" "<nodeB>"` — Trace data/request flow between modules.
  - `graphify explain "<module/concept>"` — Get scoped architectural explanations.
  - `graphify god-nodes --top 5` — Inspect key hub modules.
- **Overview**: Read `graphify-out/GRAPH_REPORT.md` ONLY for broad architectural context.
- **Zero API-Cost Graph Update**: After modifying code, run `graphify update .` to keep the graph current.

---

## 2. Core Architectural Map

| Component / Path | Responsibility | Key Symbols / Functions |
| :--- | :--- | :--- |
| [app/app.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/app.js) | webOS TV Frontend UI | Focus navigation, Luna service bridge calls, UI state rendering |
| [app/service/service.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/service.js) | Luna Service Entry Point | Edition loading, path resolution (`editionLib.paths`), API initialization |
| [app/service/lib/api.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/api.js) | Service API Dispatcher | `getProfiles`, `connect`, `disconnect`, `importValue`, `addSubscription` |
| [app/service/lib/proto/parsers.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/proto/parsers.js) | Link & Subscription Parsers | `extractProxyLinks`, `parseProxyLink`, `profileKeyFromLink`, `dedupeProfilesInStore` |
| [app/service/lib/net/subscriptions.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/net/subscriptions.js) | Subscription Downloader | `download`, `fetchCandidate`, User-Agent candidates (`Happ`, `sing-box`, etc.) |
| [app/service/lib/net/ssrf.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/net/ssrf.js) | SSRF & Redirect Safety | Safe IP parsing, redirect header preservation (`SENSITIVE_HEADERS`) |
| [app/service/lib/device-info.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/device-info.js) | Physical TV Hardware ID | Physical hardware info lookup, SHA-256 `X-HWID` derivation |
| [app/service/lib/vpn/manager.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/vpn/manager.js) | VPN Lifecycle Manager | `connect`, `disconnect`, `resolveCores`, core binary auto-staging |
| [app/service/lib/supervisor.js](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/app/service/lib/supervisor.js) | Child Process Supervisor | Executable permission validation (`isExecutableFile`), process spawning |
| [build_ipk.py](file:///c:/Users/Kurumi/Documents/Claude/publishing/alcyone-github/build_ipk.py) | IPK Packager | Debian-style AR/tar packaging for XRay and sing-box editions |

---

## 3. Essential Commands Cheat-Sheet

- **Run Full Test Suite**:
  ```bash
  node tests/run_all.js
  ```
- **Build IPK Packages**:
  ```bash
  python build_ipk.py
  ```
- **Update Knowledge Graph (0 API Token Cost)**:
  ```bash
  graphify update .
  ```
