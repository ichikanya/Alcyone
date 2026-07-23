# Bundled VPN cores

The edition builder injects exactly one core set into each IPK:

- XRay Edition: the unchanged Linux ARMv7 Xray 26.3.27 binary and tun2socks used by Alcyone 3.1.7.
- sing-box Edition: a Linux ARMv7 sing-box 1.13.14 binary built from upstream tag `v1.13.14` (commit `25a600db24f7680ad9806ce5427bd0ab8afe1114`) with Go 1.24.7.

The sing-box build intentionally enables only `with_quic`, `with_utls`, `badlinkname`, and `tfogo_checklinkname0`. It omits gVisor, WireGuard, ACME, APIs, Tailscale, Tor/Naive, and auxiliary services. The application uses the native system TUN stack, so the edition runs one VPN process.

Build command used for the sing-box ARMv7 binary:

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 GOTOOLCHAIN=local \
  go build -trimpath \
  -tags "with_quic,with_utls,badlinkname,tfogo_checklinkname0" \
  -ldflags "-X github.com/sagernet/sing-box/constant.Version=1.13.14 -X internal/godebug.defaultGODEBUG=multipathtcp=0 -checklinkname=0 -s -w -buildid=" \
  -o sing-box ./cmd/sing-box
```

SHA-256:

```text
b7ea2a82185f0f7a59510b01b24a93cc3c45529dabbf3c97970ad66c49c6b882  xray/xray
b2bbe63f8144ce67a9f8839541428999302b68cd54fbf14f403c73be75cd719a  xray/tun2socks
900c9e01b628a59c39af5705b389bff0de3a4c2fc66a1f0f5951fe3f11f5f664  sing-box/sing-box
```

Upstream source and licenses:

- <https://github.com/XTLS/Xray-core/tree/v26.3.27>
- <https://github.com/xjasonlyu/tun2socks/tree/v2.6.0>
- <https://github.com/SagerNet/sing-box/tree/v1.13.14>
