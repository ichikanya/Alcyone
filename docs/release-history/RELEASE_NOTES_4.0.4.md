# Alcyone 4.0.4

Released on August 6, 2026.

- Both XRay and sing-box editions are packaged by the official webOS
  `ares-package` tool. Their control metadata now includes `Installed-Size`,
  `webOS-Package-Format-Version: 2`, and `webOS-Packager-Version`.
- The LAN web importer no longer shows an HWID compatibility checkbox. A
  privacy-preserving derived HWID and provider compatibility headers are sent
  automatically for HTTPS subscription requests and never over plaintext HTTP.
- Older importer clients may continue to send the `compatMode` field; it is
  accepted for request compatibility but cannot disable the HTTPS-only policy.
- Both editions retain the pinned ARM cores, independent application and
  service identities, data directories, ports, migration behavior, routing,
  protocol support, and TV interface from 4.0.3.

Downloads:

- [Alcyone XRay 4.0.4](https://github.com/ichikanya/Alcyone/releases/download/v4.0.4/Alcyone-XRay_4.0.4.ipk)
- [Alcyone sing-box 4.0.4](https://github.com/ichikanya/Alcyone/releases/download/v4.0.4/Alcyone-sing-box_4.0.4.ipk)
