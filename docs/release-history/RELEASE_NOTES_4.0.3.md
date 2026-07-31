# Alcyone 4.0.3

Released on July 31, 2026.

- Privileged VPN lifecycle, routing and native core processes are owned by the
  edition-specific Luna service.
- Native ARM core inputs carry pinned provenance and are verified during both
  packaging and runtime staging.
- The XRay path adds endpoint DNS bootstrap, direct-route bypasses, rollback,
  data-plane verification and bounded recovery for a transient pre-readiness
  startup exit.
- The LAN importer remains loopback-only unless an explicit, temporary pairing
  window is active; authenticated mutations require a session and CSRF token.
- ARM payloads are declared as `arm`; no historical `_all.ipk` archive remains
  in the repository.
- A bounded connected-state route guard detects a physical interface or
  gateway change, removes tunnel-owned state, preserves the current network
  manager route, and reports the localized `NETWORK_CHANGED` result.
- Data-plane verification tries a bounded set of independent HTTPS IP sources
  and accepts only a valid IP response, so a supported proxy is not rejected
  because one public probe source is filtered or unavailable.

The intermittent pre-readiness XRay failure is contained at the lifecycle
boundary: each core launch gets an independent log descriptor, the readiness
wait is generation-scoped, and one bounded retry is allowed after a transient
pre-readiness exit. A repeated failure remains a normal `CORE_START_FAILED`
with rollback rather than a stranded route or duplicate process.
