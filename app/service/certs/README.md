# TLS trust bundle

`cacert.pem` is the Mozilla root CA bundle distributed by the curl project:

- Source: <https://curl.se/ca/cacert.pem>
- Certificate data date: 2026-07-16
- SHA-256: `3ff344e30b9b1ed2971044eabb438a08f2e2245ddb5f8ab1a3ad8b63ab4eaf91`

It is bundled because the Node.js trust store on webOS 4 is too old for many
current HTTPS certificate chains. Certificate and hostname verification remain
enabled; Alcyone does not fall back to insecure TLS.
