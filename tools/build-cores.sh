#!/bin/sh
# Build every native component from an immutable upstream Git commit.
#
# No native executable is stored in this repository. The Go module checksums
# and exact source commits make every network input reviewable and fail closed.
#
# Usage:
#   tools/build-cores.sh [all|xray|tun2socks|sing-box|launcher]
#
# Environment:
#   BUILD_ROOT  temporary source/work directory
#   OUT_DIR     output root (defaults to build/cores)

set -eu

ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
BUILD_ROOT="${BUILD_ROOT:-${TMPDIR:-/tmp}/alcyone-core-build}"
OUT_DIR="${OUT_DIR:-${ROOT}/build/cores}"

GO_VERSION="1.26.1"
ZIG_VERSION="0.16.0"
XRAY_REPO="https://github.com/XTLS/Xray-core.git"
XRAY_TAG="v26.3.27"
XRAY_COMMIT="d2758a023cd7f4174a5a5fa4ff66e487d4342ba0"
XRAY_RELEASE_ARCHIVE="Xray-linux-arm32-v7a.zip"
XRAY_RELEASE_ARCHIVE_SHA256="c7265ae13c63ca0241a037df4ef960ad37938c8a67d984cc08834b2cfdf5654b"
XRAY_GEOSITE_SHA256="adf92de0cfc70e458b399f04c5f912bf42d115ed7e37281b30e2f1c68605e4e9"
XRAY_GEOIP_SHA256="744c97b74c52bae2ac8664fef6ac481d7765cb8432a0df54f0368a88b9b4a354"
TUN2SOCKS_REPO="https://github.com/eycorsican/go-tun2socks.git"
TUN2SOCKS_TAG="v1.16.11"
TUN2SOCKS_COMMIT="0ced89adec90debc056b38fe9a0bf51f4ae5cc38"
TUN2SOCKS_ASSET_SHA256="b2bbe63f8144ce67a9f8839541428999302b68cd54fbf14f403c73be75cd719a"
SINGBOX_REPO="https://github.com/SagerNet/sing-box.git"
SINGBOX_TAG="v1.13.14"
SINGBOX_COMMIT="25a600db24f7680ad9806ce5427bd0ab8afe1114"

export CGO_ENABLED=0
export GOOS=linux
export GOARCH=arm
export GOARM=7
export GOTOOLCHAIN=local
export GOFLAGS="-mod=readonly"
COMMON_LDFLAGS="-s -w -buildid="

log() { printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

prepare_source() {
    name="$1"
    repository="$2"
    commit="$3"
    source_dir="${BUILD_ROOT}/src/${name}"

    rm -rf -- "${source_dir}"
    mkdir -p -- "${source_dir}"
    git -C "${source_dir}" init -q
    git -C "${source_dir}" remote add origin "${repository}"
    git -C "${source_dir}" fetch -q --depth 1 origin "${commit}"
    git -C "${source_dir}" checkout -q --detach FETCH_HEAD
    actual="$(git -C "${source_dir}" rev-parse HEAD)"
    [ "${actual}" = "${commit}" ] || die "${name}: expected ${commit}, got ${actual}"
    printf '%s' "${source_dir}"
}

report() {
    file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -- "${file}"
    else
        shasum -a 256 -- "${file}"
    fi
}

verify_sha256() {
    file="$1"
    expected="$2"
    if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum -- "${file}" | cut -d' ' -f1)"
    else
        actual="$(shasum -a 256 -- "${file}" | cut -d' ' -f1)"
    fi
    [ "${actual}" = "${expected}" ] ||
        die "checksum mismatch for ${file}: expected ${expected}, got ${actual}"
}

build_xray() {
    src="$(prepare_source xray "${XRAY_REPO}" "${XRAY_COMMIT}")"
    mkdir -p -- "${OUT_DIR}/xray"
    ( cd "${src}" && go build -trimpath -ldflags "${COMMON_LDFLAGS}" \
        -o "${OUT_DIR}/xray/xray" ./main )
    archive="${BUILD_ROOT}/${XRAY_RELEASE_ARCHIVE}"
    url="https://github.com/XTLS/Xray-core/releases/download/${XRAY_TAG}/${XRAY_RELEASE_ARCHIVE}"
    command -v unzip >/dev/null 2>&1 || die "unzip not found"
    if command -v curl >/dev/null 2>&1; then
        curl --fail --location --proto '=https' --tlsv1.2 --output "${archive}" -- "${url}"
    else
        wget --https-only -O "${archive}" -- "${url}"
    fi
    verify_sha256 "${archive}" "${XRAY_RELEASE_ARCHIVE_SHA256}"
    unzip -p "${archive}" geosite.dat > "${OUT_DIR}/xray/geosite.dat"
    unzip -p "${archive}" geoip.dat > "${OUT_DIR}/xray/geoip.dat"
    verify_sha256 "${OUT_DIR}/xray/geosite.dat" "${XRAY_GEOSITE_SHA256}"
    verify_sha256 "${OUT_DIR}/xray/geoip.dat" "${XRAY_GEOIP_SHA256}"
    report "${OUT_DIR}/xray/xray"
    report "${OUT_DIR}/xray/geosite.dat"
    report "${OUT_DIR}/xray/geoip.dat"
}

build_tun2socks() {
    mkdir -p -- "${OUT_DIR}/tun2socks"
    target="${OUT_DIR}/tun2socks/tun2socks"
    url="https://github.com/eycorsican/go-tun2socks/releases/download/${TUN2SOCKS_TAG}/tun2socks-linux-arm-7"
    # v1 uses cgo/lwIP and needs an old cross-C toolchain. Consume the author's
    # immutable release asset instead of silently producing a different build.
    if command -v curl >/dev/null 2>&1; then
        curl --fail --location --proto '=https' --tlsv1.2 --output "${target}" -- "${url}"
    else
        wget --https-only -O "${target}" -- "${url}"
    fi
    verify_sha256 "${target}" "${TUN2SOCKS_ASSET_SHA256}"
    chmod 755 "${target}"
    report "${OUT_DIR}/tun2socks/tun2socks"
}

build_singbox() {
    src="$(prepare_source sing-box "${SINGBOX_REPO}" "${SINGBOX_COMMIT}")"
    mkdir -p -- "${OUT_DIR}/sing-box"
    ( cd "${src}" && go build \
        -trimpath \
        -tags "with_quic,with_utls,badlinkname,tfogo_checklinkname0" \
        -ldflags "-X github.com/sagernet/sing-box/constant.Version=${SINGBOX_TAG#v} -X internal/godebug.defaultGODEBUG=multipathtcp=0 -checklinkname=0 ${COMMON_LDFLAGS}" \
        -o "${OUT_DIR}/sing-box/sing-box" ./cmd/sing-box )
    report "${OUT_DIR}/sing-box/sing-box"
}

build_launcher() {
    command -v zig >/dev/null 2>&1 || die "zig toolchain not found"
    actual_zig="$(zig version 2>/dev/null || echo unknown)"
    [ "${actual_zig}" = "${ZIG_VERSION}" ] ||
        die "expected zig ${ZIG_VERSION}, got ${actual_zig}"
    mkdir -p -- "${OUT_DIR}/launcher"
    zig cc -target arm-linux-musleabihf -Os -static -s \
        -o "${OUT_DIR}/launcher/alcyone-exec" "${ROOT}/tools/alcyone-exec.c"
    size="$(wc -c < "${OUT_DIR}/launcher/alcyone-exec" | tr -d ' ')"
    [ "${size}" -le 65536 ] || die "alcyone-exec exceeds 64 KiB: ${size}"
    chmod 755 "${OUT_DIR}/launcher/alcyone-exec"
    report "${OUT_DIR}/launcher/alcyone-exec"
}

build_netguard() {
    # Same contract as the launcher: static musl ARMv7 hard-float, no
    # dynamic dependencies. The guardian is the last line of defense for
    # ordinary internet; its size ceiling stays bounded on principle.
    command -v zig >/dev/null 2>&1 || die "zig toolchain not found"
    actual_zig="$(zig version 2>/dev/null || echo unknown)"
    [ "${actual_zig}" = "${ZIG_VERSION}" ] ||
        die "expected zig ${ZIG_VERSION}, got ${actual_zig}"
    mkdir -p -- "${OUT_DIR}/netguard"
    zig cc -target arm-linux-musleabihf -Os -static -s \
        -o "${OUT_DIR}/netguard/alcyone-netguard" "${ROOT}/tools/alcyone-netguard.c"
    size="$(wc -c < "${OUT_DIR}/netguard/alcyone-netguard" | tr -d ' ')"
    [ "${size}" -le 131072 ] || die "alcyone-netguard exceeds 128 KiB: ${size}"
    chmod 755 "${OUT_DIR}/netguard/alcyone-netguard"
    report "${OUT_DIR}/netguard/alcyone-netguard"
}

main() {
    command -v git >/dev/null 2>&1 || die "git not found"
    mkdir -p -- "${BUILD_ROOT}/src" "${OUT_DIR}"

    target="${1:-all}"
    if [ "${target}" != "launcher" ]; then
        command -v go >/dev/null 2>&1 || die "go toolchain not found"
        actual_go="$(go env GOVERSION 2>/dev/null || echo unknown)"
        [ "${actual_go}" = "go${GO_VERSION}" ] ||
            die "expected go${GO_VERSION}, got ${actual_go}"
        log "toolchain ${actual_go}; target ${GOOS}/${GOARCH}v${GOARM}"
        log "xray ${XRAY_TAG}; tun2socks ${TUN2SOCKS_TAG}; sing-box ${SINGBOX_TAG}"
    fi
    case "${target}" in
        all) build_xray; build_tun2socks; build_singbox; build_launcher; build_netguard ;;
        xray) build_xray ;;
        tun2socks) build_tun2socks ;;
        sing-box) build_singbox ;;
        launcher) build_launcher ;;
        netguard) build_netguard ;;
        *) die "unknown component: ${target}" ;;
    esac
}

main "$@"
