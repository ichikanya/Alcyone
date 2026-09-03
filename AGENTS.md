# AI Agent Navigation & Token Optimization Guide (AGENTS.md)

This project is optimized for AI agent pairing (Codex, Claude, Antigravity, Cursor) with minimal token consumption and fast codebase navigation.

---

## 1. Fast Codebase Navigation (Repowise)

Repowise maintains a local codebase index at workspace root with the dependency graph,
generated docs, git history, architectural decisions, and code-health data.

### Navigation Rules:
- **Start broad**: Use the Repowise MCP tool `get_overview` for architectural context.
- **Use targeted tools**: `get_context` for files/symbols, `get_answer` or `search_codebase` for questions, and `get_risk` for change impact.
- **Maintenance checks**: Use `get_health` and `get_dead_code` when reviewing technical debt or cleanup.
- **CLI fallback**: `repowise search "<search term>"`, `repowise health`, and `repowise risk main..HEAD`.
- **Incremental update**: After modifying code, run `repowise update .` from workspace root.

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
- **Update Repowise index (local, no API key required)**:
  ```bash
  repowise update .
  ```
