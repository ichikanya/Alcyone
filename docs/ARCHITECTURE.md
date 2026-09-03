# Architecture

Alcyone is a VPN client for rooted LG webOS TVs, shipped as two independently
installable editions that share one codebase.

| Edition | App ID | Service ID | Data directory | Core |
| --- | --- | --- | --- | --- |
| XRay | `com.alcyone.vpn` | `com.alcyone.vpn.service` | `/var/lib/alcyone` | Xray + tun2socks |
| sing-box | `com.alcyone.vpn.singbox` | `com.alcyone.vpn.singbox.service` | `/var/lib/alcyone-singbox` | sing-box (native TUN) |

Luna service names may not contain `-` and must begin with the app ID, which is
why the sing-box edition uses `singbox` in its identifiers.

## Components

```
app/
  index.html, style.css, app.js     TV interface (presentation only)
  edition.js                        generated per-edition public facts
  bin/                              generated package location for native cores
  service/
    service.js                      Luna entry point, registration, lifecycle
    services.json, package.json     service metadata (generated per edition)
    lib/
      api.js                        Luna method implementations
      edition.js                    edition table and path derivation
      errors.js                     structured error codes
      validate.js                   input validation for every entry point
      atomic.js                     exact owned/shared atomic writes
      shared-permissions.js         fixed allowlisted 4.0.x mode repair
      logger.js                     bounded, secret-scrubbing logging
      supervisor.js                 child process lifecycle
      tunnel-lock.js                cross-edition connection ownership
      connection-capabilities.js    behavior-based TUN/proxy capability probe
      system-proxy.js                ConnMan proxy snapshot/apply/restore
      migrate.js                    idempotent startup initialization
      autostart.js                  boot hook management
      diagnostics.js                reachability and external IP checks
      config/xray.js                Xray config generation
      config/singbox.js             sing-box config generation
      net/routes.js                 TUN and routing, snapshot and rollback
      net/ssrf.js                   SSRF policy (pure)
      net/http-client.js            hardened HTTP client
      net/subscriptions.js          subscription retrieval
      proto/parsers.js              protocol and subscription parsing (pure)
      store/profiles.js             persistence and sanitized serialization
      web/server.js                 LAN importer HTTP server
      web/templates.js              LAN importer HTML and strings
```

## Trust boundary

The TV frontend is **untrusted with respect to privileged operations**. It:

- never builds or submits a shell command;
- never reads or writes the filesystem;
- never sees a proxy link, UUID, password, subscription URL or core config;
- communicates only through narrowly scoped Luna methods carrying JSON.

The Luna service accepts calls only when the bus-provided sender equals the
matching edition app ID. Another installed application cannot invoke its
privileged methods.

Everything privileged lives in the Luna service. The frontend renders the
sanitized display metadata the service returns and asks it to act.

The previous design called Homebrew Channel's generic `/exec` endpoint with
strings assembled in the browser. That is removed: there is no code path from UI
input to a shell.

## Why the service needs root

TUN requires root for two operations:

1. creating and configuring the `tun0` device;
2. modifying the kernel routing table.

System Proxy also remains root-required. The service must read protected ConnMan
settings on older firmware, persist a `0600` recovery record, install the boot
recovery hook, and call the connection manager's proxy methods. The frontend
never edits those files or calls the connection manager directly.

Root is granted by Homebrew Channel's `elevate-service` mechanism
(`luna://org.webosbrew.hbchannel.service/elevateService`), which rewrites the
service's LS2 configuration. The application cannot elevate itself.

webOS gives a service a single identity, so profile storage, subscription
downloads and the LAN importer run elevated too, even though they do not need
it. They are written defensively for that reason: validated inputs, bounded
resources, no shell, no dynamic code.

## Luna method API

All methods take a JSON object, reject unknown fields, and return
`{returnValue, ok, ...}` on success or `{returnValue: false, ok: false,
errorCode, errorDetail?}` on failure. `errorCode` is a stable machine token;
the frontend maps it to Russian or English text.

| Method | Payload | Returns |
| --- | --- | --- |
| `getState` | `{}` | edition, connection/tunnel state, mode capabilities, device diagnostics, LAN state, autostart, revision |
| `getProfiles` | `{}` | sanitized profiles and subscriptions, activeId, lang, selected connection mode |
| `getProfilesMeta` | `{}` | store revision, for cheap change detection |
| `selectProfile` | `{profileId, reconnect?}` | selected id, whether it reconnected |
| `deleteProfile` | `{profileId}` | `{}` |
| `importLink` | `{link, name?}` | new profile id |
| `addSubscription` | `{url, name?}` | subscription id, imported count |
| `updateSubscriptions` | `{subscriptionId?}` | updated count, failures with codes |
| `deleteSubscription` | `{subscriptionId}` | `{}` |
| `connect` | `{profileId?}` | tunnel state |
| `disconnect` | `{}` | tunnel state |
| `restart` | `{}` | tunnel state |
| `autostart` | `{}` | whether the boot hook started the tunnel |
| `probeProfiles` | `{}` | `[{id, latencyMs}]` |
| `checkExternalIp` | `{}` | address, whether it went through the VPN |
| `getLogs` | `{lines?}` | bounded log tail, routing diagnostics |
| `clearLogs` | `{}` | `{cleared}` |
| `setAutostart` | `{enabled}` | resulting state |
| `setLanguage` | `{lang}` | resulting language |
| `setConnectionMode` | `{mode: "tun"}` | selected mode; only accepted while idle |
| `startPairing` | `{}` | pairing code, expiry, port, LAN addresses |
| `stopPairing` | `{}` | `{pairingActive: false}` |

`startPairing` is the only method that returns a secret, and it returns it to
the TV screen so the user can read it. It is never served over the network.

## TUN lifecycle

Connect:

1. take the cross-edition tunnel lock;
2. resolve the server endpoints that must bypass the tunnel;
3. snapshot the current default route to `route.state`;
4. write the core config to the data directory;
5. start the core(s) with fixed paths and argument arrays;
6. wait for readiness (`tun0` present; for XRay, the loopback SOCKS port first);
7. install split-default routes `0.0.0.0/1` and `128.0.0.0/1`;
8. verify public traffic actually leaves via the tunnel.

Any failure at any step runs the same cleanup: stop children, roll routes back,
release the lock. A core that dies while connected triggers the same path, so a
crash restores connectivity rather than stranding the TV behind a dead tunnel.

Rollback is idempotent and reads its state from disk, so a service restarted
after an unclean shutdown can still restore the original route.

All routing goes through `/sbin/ip` with argument arrays and `shell: false`.

The former System Proxy lifecycle below is retained only as historical design
reference and regression-test documentation. It is not selectable in 4.0.6:
native webOS applications such as YouTube ignore ConnMan's proxy setting, so
only TUN provides TV-wide coverage.

Former System Proxy connect:

1. take the shared connection lock (the same lock used by TUN);
2. correlate `getStatus()` with the kernel physical default route and refuse an
   ambiguous Wi-Fi/Ethernet selection;
3. read the exact original proxy from `proxyInfo`, or from a read-only ConnMan
   settings fallback containing only `Proxy.Method`, `Proxy.URL`,
   `Proxy.Servers`, and `Proxy.Excludes`;
4. write `/var/lib/alcyone-shared/system-proxy.state` mode `0600` and install
   `/var/lib/webosbrew/init.d/alcyone-proxy-recovery` before changing anything;
5. start the edition core with only a loopback HTTP inbound on
   `127.0.0.1:10802`;
6. make a bounded proxy-aware HTTP request through that listener, apply the
   temporary manual proxy with `setProxy`, and verify `findProxyForURL()`
   returns `PROXY 127.0.0.1:10802`;
7. on disconnect or failure, compare the live value with Alcyone's applied
   value, restore the original proxy, verify it, stop the core, clear recovery
   state, and release the lock.

If the original network disappears, recovery remains pending and is never
applied to a replacement network. If another actor changes the proxy, Alcyone
stops without overwriting that change and reports
`SYSTEM_PROXY_RESTORE_CONFLICT`. System Proxy is deliberately partial: it can
cover proxy-aware HTTP/HTTPS TCP traffic, but UDP, QUIC, multicast, many DNS
paths, DRM/media stacks, and applications that ignore the system proxy may
bypass it. It is not a full-tunnel or no-leak mode.

## Cross-edition connection lock

Both editions manage the same TV connection, so only one may own the tunnel or
the system proxy. `/var/lib/alcyone-shared/tunnel.lock` records the owning
edition, service ID, pid, and active mode while retaining the legacy tunnel
fields. A lock whose pid is gone is stale and may be reclaimed; a live lock held
by the other edition makes `connect` fail with
`CONNECTION_OWNED_BY_OTHER_EDITION`. Direct users of the legacy lock module
still receive `TUNNEL_OWNED_BY_OTHER_EDITION` for compatibility. An edition
never releases the other's lock.

## Data storage

`<dataDir>/profiles.json` holds profiles and subscriptions, written atomically
(temp file, fsync, rename) with mode `0600` inside a `0700` directory. An
interrupted write is recovered from the leftover temp file on next read.

Other files in the data directory: `core-config.json` (generated core config),
`route.state` (rollback snapshot), `service-state.json` (migration version),
`service.log` and `tunnel.log` (bounded).

At every service start, before ordinary migration work, the fixed
`shared-permissions.js` allowlist checks `/var/lib`, `/var/lib/webosbrew`, and
`/var/lib/webosbrew/init.d`. It changes only an existing real directory whose
full permission bits are exactly `0700`, to `0755`; it never recurses, creates
a target, follows a symlink, or exposes these paths through `getState`.

Shared System Proxy recovery state is intentionally separate from profile data:
`/var/lib/alcyone-shared/system-proxy.state` is mode `0600` and stores only the
owner, physical route/network identity, original/applied proxy, lifecycle stage,
and timestamp. It never stores profile credentials or unrelated ConnMan keys.

## Migration

webOS does not execute Debian maintainer scripts, so the packages contain none.
All initialization runs on service start and is idempotent:

- repair the exact 4.0.3–4.0.7 shared-directory mode signature, if present;
- create the directory tree with restrictive permissions;
- copy bundled cores into the writable data directory when missing or outdated;
- normalize the profile store through the current schema without losing entries;
- remove artefacts of the retired shell implementation (stale pid files, etc.);
- record the migration version.

Legacy bare-array stores and current object stores are both accepted. Apart
from the fixed, exact-mode shared-directory repair above, nothing outside this
edition's own directories is read or modified.

## Editions

Shared: everything above. Edition-specific: the identity table in
`lib/edition.js`, `config/xray.js` versus `config/singbox.js`, and which cores
the packager bundles.

The XRay edition keeps full user-supplied Xray configurations (including XHTTP
transports and balancers), pinning only the loopback inbound and a leading
private-range bypass rule. The sing-box edition runs one native system-TUN
process with a deliberately minimal ruleset for low-powered TVs; XHTTP is an
Xray-only transport and returns `UNSUPPORTED_TRANSPORT` there.

## Local development

```sh
node --check app/app.js
find app/service -name '*.js' -print0 | xargs -0 -n1 node --check
for t in tests/*.test.js; do node "$t"; done
for t in tests/*.test.py; do python "$t"; done

tools/build-cores.sh
python build_ipk.py --edition all --output-dir packages
```

`build/cores/` is gitignored. Native binaries are build inputs, while the two
canonical unpublished maintainer IPKs are written to `packages/`. Tagged
releases download the exact edition artifacts produced by the successful build
jobs.
