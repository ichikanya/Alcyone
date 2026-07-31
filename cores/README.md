# Native VPN cores

Native executables are not stored in Git. They are generated into the ignored
`build/cores/` directory before packaging:

| Edition | Release inputs | Target |
| --- | --- | --- |
| XRay | Xray built from source; checksum-verified upstream tun2socks asset | Linux ARMv7 |
| sing-box | trimmed sing-box built from source | Linux ARMv7 |

Every source tag resolves to an exact Git commit. Go modules remain in readonly
mode and are verified through the upstream `go.sum`. The old cgo/lwIP
tun2socks is consumed from its immutable upstream release because rebuilding it
requires its historical cross-C toolchain; its SHA-256 is checked before use.

Machine-readable commits, build flags, expected output hashes, sizes and
licenses are in [`provenance.json`](provenance.json). Upstream license texts are
in [`licenses/`](licenses).

## Build

Install Git and Go 1.26.1, then run:

```sh
tools/build-cores.sh
```

Individual components may be produced with `xray`, `tun2socks`, or `sing-box`
as the first argument. The script never resolves `latest`, verifies the exact
checked-out commit, disables automatic Go toolchain switching, and checks the
tun2socks release checksum.

`tests/binary-provenance.test.py` checks both the pinned manifest and every
generated ELF when `build/cores/` exists.
