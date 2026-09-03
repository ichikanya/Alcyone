# Alcyone 4.2.2

Released on September 3, 2026.

This stabilization release fixes the VPN disconnects and memory pressure
reproduced under YouTube traffic while preserving support for legacy webOS 4
and capability-based fallbacks for newer webOS generations.

- Prevented imported XRay `freedom` outbounds from routing back into the TUN,
  which previously created a recursive socket storm and could force webOS to
  restart YouTube to reclaim memory.
- Added verified physical-interface and on-link LAN routes, with a safe legacy
  fallback on kernels that cannot support the policy-routing backend.
- Made public liveness-probe failures non-fatal while recent bidirectional TUN
  traffic proves that the user's connection is working.
- Added bounded, persistent recovery scheduling and early descriptor-runaway
  guards without allowing restart storms.
- Hardened shutdown so a core is never considered stopped until its process
  actually exits; duplicate and orphaned cores are blocked by exact executable
  identity checks.
- Made migrations fail safely: profiles are backed up, corrupt stores are never
  replaced with an empty list, and incompatible profiles are marked rather
  than deleted.
- Kept XRay and sing-box isolated with edition-owned TUN devices and strictly
  owned rollback state.
- Verified the final XRay package on the target webOS 4.x and 5.x televisions
  with instrumented YouTube testing and multi-hour real sessions. Root access,
  profiles, Alcyone and Homebrew Channel remained intact.

Downloads:

- [Alcyone XRay 4.2.2](https://github.com/ichikanya/Alcyone/releases/download/v4.2.2/Alcyone-XRay_4.2.2.ipk)
- [Alcyone sing-box 4.2.2](https://github.com/ichikanya/Alcyone/releases/download/v4.2.2/Alcyone-sing-box_4.2.2.ipk)
