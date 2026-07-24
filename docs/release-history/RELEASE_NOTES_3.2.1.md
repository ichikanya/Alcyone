# Alcyone 3.2.1

This packaging compatibility release adds the standard webOS
`usr/palm/packages/<app-id>/packageinfo.json` metadata to both independently
installable editions.

- XRay and sing-box application behavior, cores, UI, identities, and persistent
  storage paths are unchanged.
- Both IPKs can now be inspected by the current webOS Homebrew compatibility
  verifier.
- Both editions require root and webOS 4 or newer because earlier releases do
  not provide the required TUN kernel module.
