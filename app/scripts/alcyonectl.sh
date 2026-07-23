#!/bin/sh
EDITION_CONF="$(dirname "$0")/../edition.conf"
if [ -f "$EDITION_CONF" ]; then . "$EDITION_CONF"; fi
: "${ALCYONE_APP_ID:=com.alcyone.vpn}"
: "${ALCYONE_AUTOSTART:=alcyone-vpn}"
: "${ALCYONE_CORE:=xray}"
: "${ALCYONE_CORE_LABEL:=XRay}"
: "${ALCYONE_CORE_VERSION:=26.3.27}"
: "${ALCYONE_DATA_DIR:=/var/lib/alcyone}"
: "${ALCYONE_EDITION_NAME:=XRay Edition}"
: "${ALCYONE_TITLE:=Alcyone XRay}"
: "${ALCYONE_VERSION:=3.2.0}"
: "${ALCYONE_WEB_PORT:=8080}"
APP_DIR="/media/developer/apps/usr/palm/applications/$ALCYONE_APP_ID"
DATA_DIR="$ALCYONE_DATA_DIR"
CORE="$ALCYONE_CORE"
CORE_LABEL="$ALCYONE_CORE_LABEL"
CORE_LOG="$DATA_DIR/core-install.log"
mkdir -p "$DATA_DIR" "$DATA_DIR/bin"

# Fast polling: busybox on webOS usually supports fractional sleep.
# If it does not, short_sleep falls back to a whole second.
HAVE_FSLEEP=0
if sleep 0.1 2>/dev/null; then HAVE_FSLEEP=1; fi
short_sleep() { if [ "$HAVE_FSLEEP" = "1" ]; then sleep 0.25; else sleep 1; fi; }

set_open_files_limit() {
  target="${1:-2048}"
  current="$(ulimit -n 2>/dev/null || echo 0)"
  case "$current" in ''|*[!0-9]*) current=0 ;; esac
  [ "$current" -eq "$target" ] 2>/dev/null || ulimit -n "$target" 2>/dev/null || true
  echo "Open files limit: $(ulimit -n 2>/dev/null || echo unknown)"
}

find_node_core() {
  for n in /usr/bin/node /usr/bin/nodejs /usr/palm/nodejs/node /usr/local/bin/node /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/node /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/node /media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/node; do
    if [ -x "$n" ]; then printf '%s\n' "$n"; return 0; fi
  done
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  if command -v nodejs >/dev/null 2>&1; then command -v nodejs; return 0; fi
  return 1
}

fetch_file() {
  url="$1"; out="$2"
  rm -f "$out" 2>/dev/null || true
  if command -v wget >/dev/null 2>&1; then
    wget --no-check-certificate -q -O "$out" "$url" 2>/dev/null && [ -s "$out" ] && return 0
    wget -q -O "$out" "$url" 2>/dev/null && [ -s "$out" ] && return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -k -L -f -s -o "$out" "$url" 2>/dev/null && [ -s "$out" ] && return 0
    curl -L -f -s -o "$out" "$url" 2>/dev/null && [ -s "$out" ] && return 0
  fi
  n="$(find_node_core 2>/dev/null || true)"
  if [ -n "$n" ] && [ -f "$APP_DIR/scripts/alcyone-download.js" ]; then
    "$n" "$APP_DIR/scripts/alcyone-download.js" "$url" "$out" >/tmp/alcyone-download.out 2>/tmp/alcyone-download.err && [ -s "$out" ] && return 0
    cat /tmp/alcyone-download.err 2>/dev/null || true
  fi
  return 1
}

zip_extract() {
  zip="$1"; dest="$2"; want="$3"
  mkdir -p "$dest"
  if command -v unzip >/dev/null 2>&1; then unzip -o "$zip" -d "$dest" >/dev/null 2>&1 && return 0; fi
  if command -v busybox >/dev/null 2>&1; then busybox unzip -o "$zip" -d "$dest" >/dev/null 2>&1 && return 0; fi
  n="$(find_node_core 2>/dev/null || true)"
  if [ -n "$n" ] && [ -f "$APP_DIR/scripts/alcyone-unzip-one.js" ]; then
    if [ -n "$want" ]; then
      "$n" "$APP_DIR/scripts/alcyone-unzip-one.js" "$zip" "$dest" "$want" 2>&1 && return 0
    else
      "$n" "$APP_DIR/scripts/alcyone-unzip-one.js" "$zip" "$dest" xray 2>&1 && return 0
      "$n" "$APP_DIR/scripts/alcyone-unzip-one.js" "$zip" "$dest" tun2socks 2>&1 && return 0
    fi
  fi
  return 1
}

copy_if_exec() {
  src="$1"; dst="$2"
  if [ -f "$src" ]; then cp "$src" "$dst" 2>/dev/null && chmod 755 "$dst" 2>/dev/null && [ -x "$dst" ] && return 0; fi
  return 1
}

install_tun2socks_online() {
  tmp="/tmp/alcyone-tun2socks.zip"; outdir="/tmp/alcyone-tun2socks"
  echo "Trying online tun2socks install..."
  for url in     "https://github.com/xjasonlyu/tun2socks/releases/download/v2.6.0/tun2socks-linux-armv7.zip"     "https://sourceforge.net/projects/tun2socks.mirror/files/v2.6.0/tun2socks-linux-armv7.zip/download"     "https://github.com/xjasonlyu/tun2socks/releases/download/v2.5.2/tun2socks-linux-armv7.zip"     "https://sourceforge.net/projects/tun2socks.mirror/files/v2.5.2/tun2socks-linux-armv7.zip/download"     "https://sourceforge.net/projects/tun2socks.mirror/files/v2.5.1/tun2socks-linux-armv7.zip/download"     "https://github.com/xjasonlyu/tun2socks/releases/download/v2.5.1/tun2socks-linux-armv7.zip"     "https://sourceforge.net/projects/tun2socks.mirror/files/v2.5.0/tun2socks-linux-armv7.zip/download"     "https://github.com/xjasonlyu/tun2socks/releases/download/v2.5.0/tun2socks-linux-armv7.zip"
  do
    echo "download: $url"
    rm -rf "$outdir" 2>/dev/null || true
    if fetch_file "$url" "$tmp" && zip_extract "$tmp" "$outdir" "tun2socks"; then
      f="$(find "$outdir" -type f \( -name 'tun2socks' -o -name '*tun2socks*' \) 2>/dev/null | head -n 1)"
      if [ -n "$f" ] && copy_if_exec "$f" "$DATA_DIR/bin/tun2socks"; then echo "tun2socks installed: $DATA_DIR/bin/tun2socks"; return 0; fi
    fi
  done
  echo "tun2socks online install failed"
  return 1
}

install_xray_online() {
  tmp="/tmp/alcyone-xray.zip"; outdir="/tmp/alcyone-xray"
  echo "Trying online xray install..."
  for url in     "https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-linux-arm32-v7a.zip"     "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-arm32-v7a.zip"
  do
    echo "download: $url"
    rm -rf "$outdir" 2>/dev/null || true
    if fetch_file "$url" "$tmp"; then
      if zip_extract "$tmp" "$outdir" "xray"; then
        zip_extract "$tmp" "$outdir" "geosite.dat" >/dev/null 2>&1 || true
        zip_extract "$tmp" "$outdir" "geoip.dat" >/dev/null 2>&1 || true
        f="$(find "$outdir" -type f -name 'xray' 2>/dev/null | head -n 1)"
        if [ -n "$f" ] && copy_if_exec "$f" "$DATA_DIR/bin/xray"; then
          echo "xray installed: $DATA_DIR/bin/xray"
          fg="$(find "$outdir" -type f -name 'geosite.dat' 2>/dev/null | head -n 1)"
          [ -n "$fg" ] && cp "$fg" "$DATA_DIR/bin/geosite.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null && echo "geosite.dat installed" || true
          fgi="$(find "$outdir" -type f -name 'geoip.dat' 2>/dev/null | head -n 1)"
          [ -n "$fgi" ] && cp "$fgi" "$DATA_DIR/bin/geoip.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null && echo "geoip.dat installed" || true
          return 0
        fi
      fi
    fi
  done
  echo "xray online install failed"
  return 1
}

install_singbox_online() {
  archive="/tmp/alcyone-sing-box.tar.gz"; outdir="/tmp/alcyone-sing-box"
  url="https://github.com/SagerNet/sing-box/releases/download/v1.13.14/sing-box-1.13.14-linux-armv7.tar.gz"
  echo "Trying online sing-box install..."
  rm -rf "$outdir" 2>/dev/null || true
  mkdir -p "$outdir"
  if fetch_file "$url" "$archive"; then
    if command -v tar >/dev/null 2>&1; then
      tar -xzf "$archive" -C "$outdir" >/dev/null 2>&1 || true
    elif command -v busybox >/dev/null 2>&1; then
      busybox tar -xzf "$archive" -C "$outdir" >/dev/null 2>&1 || true
    fi
    binary="$(find "$outdir" -type f -name 'sing-box' 2>/dev/null | head -n 1)"
    if [ -n "$binary" ] && copy_if_exec "$binary" "$DATA_DIR/bin/sing-box"; then
      echo "sing-box installed: $DATA_DIR/bin/sing-box"
      return 0
    fi
  fi
  echo "sing-box online install failed"
  return 1
}

ensure_bins_online(){
 mkdir -p "$DATA_DIR/bin" "$DATA_DIR/backup"
 echo "Alcyone $ALCYONE_EDITION_NAME core check v$ALCYONE_VERSION $(date 2>/dev/null || true)"
 if [ "$CORE" = "sing-box" ]; then
   [ -x "$DATA_DIR/bin/sing-box" ] && echo "sing-box: ok $DATA_DIR/bin/sing-box" && return 0
   copy_if_exec "$DATA_DIR/backup/sing-box" "$DATA_DIR/bin/sing-box" && echo "sing-box restored from backup" || true
   [ -x "$DATA_DIR/bin/sing-box" ] && return 0
   copy_if_exec "$APP_DIR/bin/sing-box" "$DATA_DIR/bin/sing-box" && echo "sing-box copied from app bundle" || true
   [ -x "$DATA_DIR/bin/sing-box" ] && return 0
   install_singbox_online || true
   [ -x "$DATA_DIR/bin/sing-box" ] && return 0
   echo "ERROR: core missing after install attempts"
   echo "missing: $DATA_DIR/bin/sing-box"
   return 1
 fi
 # Prefer already installed persistent binaries.
 [ -x "$DATA_DIR/bin/xray" ] && echo "xray: ok $DATA_DIR/bin/xray" || true
 [ -x "$DATA_DIR/bin/tun2socks" ] && echo "tun2socks: ok $DATA_DIR/bin/tun2socks" || true
 [ -x "$DATA_DIR/bin/xray" ] && [ -x "$DATA_DIR/bin/tun2socks" ] && return 0
 # Restore from backup, if user created one earlier.
 copy_if_exec "$DATA_DIR/backup/xray" "$DATA_DIR/bin/xray" && echo "xray restored from backup" || true
 copy_if_exec "$DATA_DIR/backup/tun2socks" "$DATA_DIR/bin/tun2socks" && echo "tun2socks restored from backup" || true
 [ -x "$DATA_DIR/bin/xray" ] && [ -x "$DATA_DIR/bin/tun2socks" ] && return 0
 # Restore bundled binaries if the IPK contains them.
 copy_if_exec "$APP_DIR/bin/xray" "$DATA_DIR/bin/xray" && echo "xray copied from app bundle" || true
 copy_if_exec "$APP_DIR/bin/tun2socks" "$DATA_DIR/bin/tun2socks" && echo "tun2socks copied from app bundle" || true
 [ -x "$DATA_DIR/bin/xray" ] && [ -x "$DATA_DIR/bin/tun2socks" ] && return 0
 # Last compatibility bridge: copy from VLess+ if it is still installed.
 if [ -x "/media/developer/apps/usr/palm/applications/vless.m.vpn/xray-core/xray" ]; then copy_if_exec "/media/developer/apps/usr/palm/applications/vless.m.vpn/xray-core/xray" "$DATA_DIR/bin/xray" && echo "xray copied from VLess+" || true; fi
 if [ -x "/media/developer/apps/usr/palm/applications/vless.m.vpn/xray-core/tun2socks" ]; then copy_if_exec "/media/developer/apps/usr/palm/applications/vless.m.vpn/xray-core/tun2socks" "$DATA_DIR/bin/tun2socks" && echo "tun2socks copied from VLess+" || true; fi
 [ -x "$DATA_DIR/bin/xray" ] && [ -x "$DATA_DIR/bin/tun2socks" ] && return 0
 # Online recovery. This is useful on a clean rooted TV with internet.
 [ -x "$DATA_DIR/bin/xray" ] || install_xray_online || true
 [ -x "$DATA_DIR/bin/tun2socks" ] || install_tun2socks_online || true
 [ -x "$DATA_DIR/bin/xray" ] && [ -x "$DATA_DIR/bin/tun2socks" ] && return 0
 echo "ERROR: core missing after install attempts"
 [ -x "$DATA_DIR/bin/xray" ] || echo "missing: $DATA_DIR/bin/xray"
 [ -x "$DATA_DIR/bin/tun2socks" ] || echo "missing: $DATA_DIR/bin/tun2socks"
 return 1
}
CONFIG="$DATA_DIR/config.json"
PROFILES="$DATA_DIR/profiles.json"
XRAY_PID_FILE="$DATA_DIR/xray.pid"
SINGBOX_PID_FILE="$DATA_DIR/sing-box.pid"
TUN2SOCKS_PID_FILE="$DATA_DIR/tun2socks.pid"
LOG_GUARD_PID_FILE="$DATA_DIR/log-guard.pid"
WEB_PID_FILE="$DATA_DIR/alcyone-web.pid"
LOG_FILE="$DATA_DIR/alcyone.log"
WEB_LOG_FILE="$DATA_DIR/alcyone-web.log"
MAX_LOG_BYTES=2097152
AUTOSTART="/var/lib/webosbrew/init.d/$ALCYONE_AUTOSTART"
WEB_JS="$APP_DIR/web/alcyone-web.js"
WEB_PORT="$ALCYONE_WEB_PORT"
ROUTE_ENV="$DATA_DIR/route.env"
ROUTE_STATE="$DATA_DIR/route.state"
TUN_NAME="tun0"
TUN_IP="198.18.0.1"
TUN_GW="198.18.0.2"
TUN_MASK="30"
SOCKS_PORT="10801"
VLESS_APP="/media/developer/apps/usr/palm/applications/vless.m.vpn"
notify() {
  msg="$1"
  # toast.png is a dedicated opaque notification icon without transparent
  # corners, so LG toasts do not show dark seams around the app icon.
  icon="$APP_DIR/toast.png"
  [ -f "$icon" ] || icon="$APP_DIR/icon.png"
  if command -v luna-send-pub >/dev/null 2>&1; then
    luna-send-pub -f -n 1 luna://com.webos.notification/createToast '{"message":"'"$msg"'","iconUrl":"'"$icon"'"}' >/dev/null 2>&1 || true
  fi
}
mkdir -p "$DATA_DIR" "$DATA_DIR/bin"

find_xray() {
  for p in "$DATA_DIR/bin/xray" "$APP_DIR/bin/xray" "$VLESS_APP/xray-core/xray"; do
    if [ -x "$p" ]; then printf '%s\n' "$p"; return 0; fi
  done
  if command -v xray >/dev/null 2>&1; then command -v xray; return 0; fi
  return 1
}
find_tun2socks() {
  for p in "$DATA_DIR/bin/tun2socks" "$APP_DIR/bin/tun2socks" "$VLESS_APP/xray-core/tun2socks"; do
    if [ -x "$p" ]; then printf '%s\n' "$p"; return 0; fi
  done
  if command -v tun2socks >/dev/null 2>&1; then command -v tun2socks; return 0; fi
  return 1
}
find_singbox() {
  for p in "$DATA_DIR/bin/sing-box" "$APP_DIR/bin/sing-box"; do
    if [ -x "$p" ]; then printf '%s\n' "$p"; return 0; fi
  done
  if command -v sing-box >/dev/null 2>&1; then command -v sing-box; return 0; fi
  return 1
}
persist_vless_bins() {
  [ "$CORE" = "xray" ] || return 0
  if [ -x "$VLESS_APP/xray-core/xray" ] && [ ! -x "$DATA_DIR/bin/xray" ]; then cp "$VLESS_APP/xray-core/xray" "$DATA_DIR/bin/xray" 2>/dev/null && chmod 755 "$DATA_DIR/bin/xray" 2>/dev/null || true; fi
  if [ -x "$VLESS_APP/xray-core/tun2socks" ] && [ ! -x "$DATA_DIR/bin/tun2socks" ]; then cp "$VLESS_APP/xray-core/tun2socks" "$DATA_DIR/bin/tun2socks" 2>/dev/null && chmod 755 "$DATA_DIR/bin/tun2socks" 2>/dev/null || true; fi
  if [ -f "$VLESS_APP/xray-core/geosite.dat" ] && [ ! -f "$DATA_DIR/bin/geosite.dat" ]; then cp "$VLESS_APP/xray-core/geosite.dat" "$DATA_DIR/bin/geosite.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null || true; fi
  if [ -f "$VLESS_APP/xray-core/geoip.dat" ] && [ ! -f "$DATA_DIR/bin/geoip.dat" ]; then cp "$VLESS_APP/xray-core/geoip.dat" "$DATA_DIR/bin/geoip.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null || true; fi
}
find_node() {
  for n in /usr/bin/node /usr/bin/nodejs /usr/palm/nodejs/node /usr/local/bin/node /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/node /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/node /media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/node; do
    if [ -x "$n" ]; then printf '%s\n' "$n"; return 0; fi
  done
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  if command -v nodejs >/dev/null 2>&1; then command -v nodejs; return 0; fi
  return 1
}
ip_addr() {
  ip4=""
  if command -v ip >/dev/null 2>&1; then ip4="$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {gsub(/\/.*$/, "", $2); if ($2 != "127.0.0.1") {print $2; exit}}')"; fi
  if [ -z "$ip4" ] && command -v ifconfig >/dev/null 2>&1; then ip4="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' | sed 's/addr://')"; fi
  [ -n "$ip4" ] || ip4="127.0.0.1"
  printf '%s\n' "$ip4"
}
web_url() { printf 'http://%s:%s\n' "$(ip_addr)" "$WEB_PORT"; }
is_running() {
  if [ "$CORE" = "sing-box" ]; then
    [ -f "$SINGBOX_PID_FILE" ] || return 1
    sp="$(cat "$SINGBOX_PID_FILE" 2>/dev/null || true)"
    [ -n "$sp" ] || return 1
    kill -0 "$sp" 2>/dev/null
    return
  fi
  [ -f "$XRAY_PID_FILE" ] || return 1
  [ -f "$TUN2SOCKS_PID_FILE" ] || return 1
  xp="$(cat "$XRAY_PID_FILE" 2>/dev/null || true)"; tp="$(cat "$TUN2SOCKS_PID_FILE" 2>/dev/null || true)"
  [ -n "$xp" ] && [ -n "$tp" ] || return 1
  kill -0 "$xp" 2>/dev/null && kill -0 "$tp" 2>/dev/null
}
is_ipv4() { echo "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; }
unique_ipv4() { awk '/^[0-9]+\./ && !seen[$1]++ {print $1}'; }
filter_server_ipv4() {
  awk '
    function bad(ip,a) {
      if (ip !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) return 1
      split(ip,a,".")
      if (a[1] == 0 || a[1] == 127 || a[1] >= 224) return 1
      # These are resolver/check IPs that can appear in nslookup output on webOS.
      # They must never be treated as VPN server IPs, otherwise health checks stay on LAN.
      if (ip == "1.1.1.1" || ip == "1.0.0.1" || ip == "8.8.8.8" || ip == "8.8.4.4") return 1
      if (ip == "9.9.9.9" || ip == "149.112.112.112" || ip == "208.67.222.222" || ip == "208.67.220.220") return 1
      return 0
    }
    bad($1) == 0 && !seen[$1]++ {print $1}
  '
}
nslookup_answer_ips() {
  h="$1"; dns="${2:-}"
  if [ -n "$dns" ]; then out="$(nslookup "$h" "$dns" 2>/dev/null || true)"; else out="$(nslookup "$h" 2>/dev/null || true)"; fi
  printf '%s\n' "$out" | awk '
    BEGIN { in_answer = 0 }
    /^Name[[:space:]]*:/ { in_answer = 1; next }
    in_answer && /^Address[[:space:]]+[0-9]+:/ { print $3; next }
    in_answer && /^Address[[:space:]]*:/ { print $2; next }
  '
}
filter_resolved() { grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | filter_server_ipv4 | unique_ipv4; }
resolve_host4_all() {
  h="$1"
  if is_ipv4 "$h"; then echo "$h"; return 0; fi
  # Fast path first: system resolver, then default nslookup. Extra resolvers
  # run only when those fail, in parallel, so a slow DNS does not add
  # tens of seconds to every VPN start.
  if command -v getent >/dev/null 2>&1; then
    out="$(getent hosts "$h" 2>/dev/null | awk '{print $1}' | filter_resolved)"
    if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  fi
  if command -v nslookup >/dev/null 2>&1; then
    out="$(nslookup_answer_ips "$h" | filter_resolved)"
    if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
    d1="/tmp/alcyone-dns1.$$"; d2="/tmp/alcyone-dns2.$$"; d3="/tmp/alcyone-dns3.$$"
    ( nslookup_answer_ips "$h" 1.1.1.1 > "$d1" 2>/dev/null ) &
    ( nslookup_answer_ips "$h" 8.8.8.8 > "$d2" 2>/dev/null ) &
    ( if command -v ping >/dev/null 2>&1; then ping -c 1 -W 2 "$h" 2>/dev/null | sed -n 's/^PING .* (\([0-9.][0-9.]*\)).*/\1/p' > "$d3"; fi ) &
    wait
    out="$(cat "$d1" "$d2" "$d3" 2>/dev/null | filter_resolved)"
    rm -f "$d1" "$d2" "$d3" 2>/dev/null || true
    if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  fi
  if command -v ping >/dev/null 2>&1; then
    ping -c 1 -W 2 "$h" 2>/dev/null | sed -n 's/^PING .* (\([0-9.][0-9.]*\)).*/\1/p' | filter_resolved
  fi
}
resolve_host4() { resolve_host4_all "$1" | head -n 1; }
route_add_lan_ip() {
  rip="$1"
  [ -n "$rip" ] || return 0
  if [ -n "${ORIG_GW:-}" ]; then
    ip route replace "$rip" via "$ORIG_GW" dev "${ORIG_DEV:-wlan0}" 2>/dev/null || ip route add "$rip" via "$ORIG_GW" dev "${ORIG_DEV:-wlan0}" 2>/dev/null || true
  else
    ip route replace "$rip" dev "${ORIG_DEV:-wlan0}" 2>/dev/null || ip route add "$rip" dev "${ORIG_DEV:-wlan0}" 2>/dev/null || true
  fi
}
route_del_lan_ip() {
  rip="$1"
  [ -n "$rip" ] || return 0
  if [ -n "${ORIG_GW:-}" ]; then ip route del "$rip" via "$ORIG_GW" dev "${ORIG_DEV:-wlan0}" 2>/dev/null || true; fi
  ip route del "$rip" dev "${ORIG_DEV:-wlan0}" 2>/dev/null || true
  ip route del "$rip" 2>/dev/null || true
}
save_route_state() {
  line="$(ip route show default 2>/dev/null | grep -v "$TUN_NAME" | head -n 1)"
  ORIG_GW="$(echo "$line" | awk '{for(i=1;i<=NF;i++) if($i=="via") {print $(i+1); exit}}')"
  ORIG_DEV="$(echo "$line" | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')"
  [ -n "$ORIG_DEV" ] || ORIG_DEV="wlan0"
  SERVER_HOST=""; SERVER_HOSTS=""; SERVER_PORT=""
  if [ -f "$ROUTE_ENV" ]; then . "$ROUTE_ENV" 2>/dev/null || true; fi
  [ -n "${SERVER_HOSTS:-}" ] || SERVER_HOSTS="${SERVER_HOST:-}"
  SERVER_IPS=""
  for server_host in ${SERVER_HOSTS:-}; do
    resolved="$(resolve_host4_all "$server_host" 2>/dev/null | tr '\n' ' ')"
    if [ -z "$resolved" ]; then echo "WARNING: could not resolve VPN server $server_host before routing" >&2; fi
    SERVER_IPS="$SERVER_IPS $resolved"
  done
  SERVER_IPS="$(printf '%s\n' "$SERVER_IPS" | tr ' ' '\n' | filter_resolved | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  SERVER_IP="$(echo "${SERVER_IPS:-}" | awk '{print $1}')"
  { echo "ORIG_GW='$ORIG_GW'"; echo "ORIG_DEV='$ORIG_DEV'"; echo "SERVER_HOST='${SERVER_HOST:-}'"; echo "SERVER_HOSTS='${SERVER_HOSTS:-}'"; echo "SERVER_PORT='${SERVER_PORT:-}'"; echo "SERVER_IP='$SERVER_IP'"; echo "SERVER_IPS='$SERVER_IPS'"; } > "$ROUTE_STATE"
}
cleanup_net() {
  if [ -f "$ROUTE_STATE" ]; then . "$ROUTE_STATE" 2>/dev/null || true; fi
  ip route del 0.0.0.0/1 2>/dev/null || true
  ip route del 128.0.0.0/1 2>/dev/null || true
  for rip in ${SERVER_IPS:-${SERVER_IP:-}}; do route_del_lan_ip "$rip"; done
  ip route flush dev "$TUN_NAME" 2>/dev/null || true
  ip link set "$TUN_NAME" down 2>/dev/null || true
  ip addr flush dev "$TUN_NAME" 2>/dev/null || ip addr del "$TUN_IP/$TUN_MASK" dev "$TUN_NAME" 2>/dev/null || true
  ip link delete "$TUN_NAME" 2>/dev/null || true
  ip route flush cache 2>/dev/null || true
  rm -f "$ROUTE_STATE"
}
cap_log_file() {
  [ -f "$LOG_FILE" ] || return 0
  size="$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)"
  case "$size" in ''|*[!0-9]*) size=0 ;; esac
  [ "$size" -le "$MAX_LOG_BYTES" ] && return 0
  tmp="$DATA_DIR/.alcyone-log-tail.$$"
  if tail -n 600 "$LOG_FILE" > "$tmp" 2>/dev/null; then
    : > "$LOG_FILE"
    cat "$tmp" >> "$LOG_FILE" 2>/dev/null || true
  fi
  rm -f "$tmp"
}
log_guard_running() {
  [ -f "$LOG_GUARD_PID_FILE" ] || return 1
  p="$(cat "$LOG_GUARD_PID_FILE" 2>/dev/null || true)"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null || return 1
  [ ! -r "/proc/$p/cmdline" ] || tr '\000' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q 'alcyonectl.sh log-guard'
}
stop_log_guard() {
  if log_guard_running; then
    p="$(cat "$LOG_GUARD_PID_FILE" 2>/dev/null || true)"
    kill "$p" 2>/dev/null || true
    i=0
    while [ "$i" -lt 8 ] && kill -0 "$p" 2>/dev/null; do short_sleep; i=$((i + 1)); done
    kill -9 "$p" 2>/dev/null || true
  fi
  rm -f "$LOG_GUARD_PID_FILE"
}
log_guard_loop() {
  xp="$1"; tp="$2"; sleeper=""
  trap '[ -z "$sleeper" ] || kill "$sleeper" 2>/dev/null || true; [ "$(cat "$LOG_GUARD_PID_FILE" 2>/dev/null || true)" != "$$" ] || rm -f "$LOG_GUARD_PID_FILE"; exit 0' 1 2 15
  while kill -0 "$xp" 2>/dev/null || kill -0 "$tp" 2>/dev/null; do
    sleep 60 & sleeper=$!
    wait "$sleeper" 2>/dev/null || true
    sleeper=""
    cap_log_file
  done
  cap_log_file
  [ "$(cat "$LOG_GUARD_PID_FILE" 2>/dev/null || true)" != "$$" ] || rm -f "$LOG_GUARD_PID_FILE"
}
start_log_guard() {
  stop_log_guard
  if [ "$CORE" = "sing-box" ]; then
    "$APP_DIR/scripts/alcyonectl.sh" log-guard "$SINGBOX_PID" "" >/dev/null 2>&1 &
  else
    "$APP_DIR/scripts/alcyonectl.sh" log-guard "$XRAY_PID" "$TUN2SOCKS_PID" >/dev/null 2>&1 &
  fi
  echo $! > "$LOG_GUARD_PID_FILE"
}
vpn_procs_alive() {
  if [ "$CORE" = "sing-box" ]; then
    ps 2>/dev/null | grep -E '[s]ing-box' >/dev/null 2>&1
  else
    ps 2>/dev/null | grep -E '[x]ray|[t]un2socks' >/dev/null 2>&1
  fi
}
kill_vpn_processes() {
  stop_log_guard
  if [ "$CORE" = "sing-box" ]; then
    process_pid_files="$SINGBOX_PID_FILE"
    process_names="sing-box"
  else
    process_pid_files="$XRAY_PID_FILE $TUN2SOCKS_PID_FILE"
    process_names="xray tun2socks"
  fi
  for f in $process_pid_files; do if [ -f "$f" ]; then p="$(cat "$f" 2>/dev/null || true)"; [ -n "$p" ] && kill "$p" 2>/dev/null || true; fi; done
  for process_name in $process_names; do killall "$process_name" 2>/dev/null || true; done
  # Wait only while the processes are actually dying; a fresh start
  # with nothing running does not sleep at all.
  i=0; n=8; [ "$HAVE_FSLEEP" = "1" ] && n=16
  while [ "$i" -lt "$n" ] && vpn_procs_alive; do short_sleep; i=$((i + 1)); done
  if vpn_procs_alive; then
    for f in $process_pid_files; do if [ -f "$f" ]; then p="$(cat "$f" 2>/dev/null || true)"; [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; fi; done
    for process_name in $process_names; do killall -9 "$process_name" 2>/dev/null || true; done
    i=0; n=4; [ "$HAVE_FSLEEP" = "1" ] && n=8
    while [ "$i" -lt "$n" ] && vpn_procs_alive; do short_sleep; i=$((i + 1)); done
  fi
}
stop() { echo "Stopping Alcyone $CORE_LABEL"; kill_vpn_processes; cleanup_net; rm -f "$XRAY_PID_FILE" "$SINGBOX_PID_FILE" "$TUN2SOCKS_PID_FILE"; [ "${ALCYONE_SILENT:-0}" = "1" ] || notify "Alcyone: VPN отключён"; echo "Stopped"; }
tcp_port_listening() {
  p="$1"
  hex="$(printf '%04X' "$p" 2>/dev/null || true)"
  [ -n "$hex" ] || return 1
  if [ -r /proc/net/tcp ] && grep -qi ":$hex .* 0A " /proc/net/tcp 2>/dev/null; then return 0; fi
  if [ -r /proc/net/tcp6 ] && grep -qi ":$hex .* 0A " /proc/net/tcp6 2>/dev/null; then return 0; fi
  if command -v netstat >/dev/null 2>&1 && netstat -an 2>/dev/null | grep -E "[\.:]$p[[:space:]].*LISTEN" >/dev/null 2>&1; then return 0; fi
  return 1
}
wait_for_xray_socks() {
  i=0; n=12; [ "$HAVE_FSLEEP" = "1" ] && n=48
  while [ "$i" -lt "$n" ]; do
    kill -0 "$XRAY_PID" 2>/dev/null || return 1
    tcp_port_listening "$SOCKS_PORT" && return 0
    short_sleep
    i=$((i + 1))
  done
  return 1
}
wait_for_tun_ready() {
  i=0; n=12; [ "$HAVE_FSLEEP" = "1" ] && n=48
  while [ "$i" -lt "$n" ]; do
    if [ "$CORE" = "sing-box" ]; then
      kill -0 "$SINGBOX_PID" 2>/dev/null || return 1
    else
      kill -0 "$TUN2SOCKS_PID" 2>/dev/null || return 1
    fi
    ip link show "$TUN_NAME" >/dev/null 2>&1 && return 0
    short_sleep
    i=$((i + 1))
  done
  return 1
}
apply_tun_routes() {
  . "$ROUTE_STATE" 2>/dev/null || true
  echo "Applying TUN routes..."
  ip route del 0.0.0.0/1 2>/dev/null || true
  ip route del 128.0.0.0/1 2>/dev/null || true
  if [ "$CORE" = "sing-box" ]; then
    ip addr show "$TUN_NAME" 2>/dev/null | grep -q "$TUN_IP/$TUN_MASK" ||
      ip addr add "$TUN_IP/$TUN_MASK" dev "$TUN_NAME" 2>/dev/null || true
  else
    ip addr add "$TUN_IP/$TUN_MASK" peer "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || true
  fi
  ip link set "$TUN_NAME" up 2>/dev/null || true
  ip route replace "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || ip route add "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || true
  for rip in ${SERVER_IPS:-${SERVER_IP:-}}; do route_add_lan_ip "$rip"; done
  if [ "$CORE" = "sing-box" ]; then
    ip route replace 0.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || ip route add 0.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || true
    ip route replace 128.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || ip route add 128.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || true
  else
    ip route replace 0.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || ip route add 0.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || true
    ip route replace 128.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || ip route add 128.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || true
  fi
  ip route flush cache 2>/dev/null || true
}
route_check_ip() { echo "9.9.9.9"; echo "208.67.222.222"; echo "1.0.0.1"; }
wait_for_route_active() {
  i=0
  while [ "$i" -lt 8 ]; do
    for cip in $(route_check_ip); do
      PUBLIC_ROUTE="$(ip route get "$cip" 2>/dev/null | head -n 1)"
      echo "Route public check $cip: $PUBLIC_ROUTE"
      if echo "$PUBLIC_ROUTE" | grep -q "$TUN_NAME\|$TUN_GW"; then return 0; fi
    done
    if [ "$CORE" = "sing-box" ]; then
      ip route replace 0.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || ip route add 0.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || true
      ip route replace 128.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || ip route add 128.0.0.0/1 dev "$TUN_NAME" 2>/dev/null || true
    else
      ip route replace 0.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || ip route add 0.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || true
      ip route replace 128.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || ip route add 128.0.0.0/1 via "$TUN_GW" dev "$TUN_NAME" 2>/dev/null || true
    fi
    ip route flush cache 2>/dev/null || true
    sleep 1
    i=$((i + 1))
  done
  return 1
}
fetch_public_ip_url() {
  out="$(curl -4 -s --connect-timeout 3 --max-time 4 "$1" 2>/dev/null | tr -d '\r\n' | head -c 80)"
  is_ipv4 "$out" || return 1
  printf '%s\n' "$out"
}
get_public_ip() {
  [ -n "$(command -v curl 2>/dev/null || true)" ] || return 1
  for url in https://api.ipify.org https://ifconfig.me/ip http://api.ipify.org; do
    out="$(fetch_public_ip_url "$url" 2>/dev/null || true)"
    [ -n "$out" ] && { printf '%s\n' "$out"; return 0; }
  done
  return 1
}
DIRECT_CHECK_IPS=""
cleanup_direct_check_routes() {
  for direct_route_ip in ${DIRECT_CHECK_IPS:-}; do route_del_lan_ip "$direct_route_ip"; done
  DIRECT_CHECK_IPS=""
  for server_route_ip in ${SERVER_IPS:-${SERVER_IP:-}}; do route_add_lan_ip "$server_route_ip"; done
  ip route flush cache 2>/dev/null || true
}
get_direct_public_ip() {
  [ -n "$(command -v curl 2>/dev/null || true)" ] || return 1
  [ -f "$ROUTE_STATE" ] || return 1
  . "$ROUTE_STATE" 2>/dev/null || return 1
  [ -n "${ORIG_DEV:-}" ] || return 1
  for target in 'api.ipify.org|https://api.ipify.org' 'ifconfig.me|https://ifconfig.me/ip' 'api.ipify.org|http://api.ipify.org'; do
    check_host="${target%%|*}"
    check_url="${target#*|}"
    check_ips="$(resolve_host4_all "$check_host" 2>/dev/null | tr '\n' ' ')"
    [ -n "$check_ips" ] || continue
    DIRECT_CHECK_IPS="$check_ips"
    trap 'cleanup_direct_check_routes' 0
    trap 'cleanup_direct_check_routes; exit 130' 1 2 15
    bypass_ready=1
    for check_ip in $check_ips; do
      route_add_lan_ip "$check_ip"
      check_route="$(ip route get "$check_ip" 2>/dev/null | head -n 1)"
      echo "$check_route" | grep -q "dev ${ORIG_DEV}" || bypass_ready=0
      echo "$check_route" | grep -q "$TUN_NAME\|$TUN_GW" && bypass_ready=0
    done
    ip route flush cache 2>/dev/null || true
    if [ "$bypass_ready" = "1" ]; then direct_ip="$(fetch_public_ip_url "$check_url" 2>/dev/null || true)"; else direct_ip=""; fi
    cleanup_direct_check_routes
    trap - 0 1 2 15
    [ -n "$direct_ip" ] && { printf '%s\n' "$direct_ip"; return 0; }
  done
  return 1
}
vpn_health_check() {
  if ! wait_for_route_active; then echo "Health: VPN route is not active"; return 2; fi
  if ! is_running; then echo "Health: VPN process stopped during startup"; return 3; fi
  echo "Health: VPN processes and route are active"
  return 0
}
start_attempt() {
  ALCYONE_SILENT=1 stop >/dev/null 2>&1 || true
  save_route_state
  . "$ROUTE_STATE" 2>/dev/null || true
  [ -n "${SERVER_HOSTS:-${SERVER_HOST:-}}" ] && echo "Server hosts: ${SERVER_HOSTS:-$SERVER_HOST} resolved=${SERVER_IPS:-unresolved}"
  : > "$LOG_FILE" 2>/dev/null || true
  echo "Config check: skipped for compatibility"
  if [ "$CORE" = "sing-box" ]; then
    echo "Starting sing-box native TUN... log=$LOG_FILE"
    set_open_files_limit 1024
    "$SINGBOX_BIN" run -c "$CONFIG" >>"$LOG_FILE" 2>&1 &
    SINGBOX_PID=$!; echo "$SINGBOX_PID" > "$SINGBOX_PID_FILE"
    if ! wait_for_tun_ready; then echo "ERROR: sing-box did not create $TUN_NAME, see $LOG_FILE" >&2; tail -n 80 "$LOG_FILE" >&2 || true; return 13; fi
  else
    echo "Starting xray + tun2socks... log=$LOG_FILE"
    set_open_files_limit 4096
    "$XRAY_BIN" -config "$CONFIG" >>"$LOG_FILE" 2>&1 &
    XRAY_PID=$!; echo "$XRAY_PID" > "$XRAY_PID_FILE"
    if ! wait_for_xray_socks; then echo "ERROR: xray did not open SOCKS port $SOCKS_PORT, see $LOG_FILE" >&2; tail -n 80 "$LOG_FILE" >&2 || true; return 12; fi
    set_open_files_limit 2048
    if "$TUN2SOCKS_BIN" -h 2>&1 | grep -q -- '-device'; then
      "$TUN2SOCKS_BIN" --device "tun://$TUN_NAME" --proxy "socks5://127.0.0.1:$SOCKS_PORT" --udp-timeout 30s --loglevel warn >>"$LOG_FILE" 2>&1 &
    else
      "$TUN2SOCKS_BIN" -tunName "$TUN_NAME" -proxyServer "127.0.0.1:$SOCKS_PORT" -udpTimeout 30s -loglevel warn >>"$LOG_FILE" 2>&1 &
    fi
    TUN2SOCKS_PID=$!; echo "$TUN2SOCKS_PID" > "$TUN2SOCKS_PID_FILE"
    if ! wait_for_tun_ready; then echo "ERROR: tun2socks did not create $TUN_NAME, see $LOG_FILE" >&2; tail -n 80 "$LOG_FILE" >&2 || true; return 13; fi
  fi
  start_log_guard
  apply_tun_routes
  vpn_health_check
}
ensure_dat_files() {
  uses_geosite=0
  uses_geoip=0
  if [ -f "$CONFIG" ]; then
    if command -v grep >/dev/null 2>&1; then
      if grep -q "geosite:" "$CONFIG" 2>/dev/null; then uses_geosite=1; fi
      if grep -q "geoip:" "$CONFIG" 2>/dev/null; then uses_geoip=1; fi
    else
      uses_geosite=1
      uses_geoip=1
    fi
  fi
  if [ "$uses_geosite" = "1" ] && [ ! -f "$DATA_DIR/bin/geosite.dat" ]; then
    echo "Config uses geosite, ensuring geosite.dat is present..."
    if [ -f "$DATA_DIR/backup/geosite.dat" ]; then
      cp "$DATA_DIR/backup/geosite.dat" "$DATA_DIR/bin/geosite.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null && echo "geosite.dat restored from backup" || true
    fi
    if [ ! -f "$DATA_DIR/bin/geosite.dat" ] && [ -f "$APP_DIR/bin/geosite.dat" ]; then
      cp "$APP_DIR/bin/geosite.dat" "$DATA_DIR/bin/geosite.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null && echo "geosite.dat copied from app bundle" || true
    fi
    if [ ! -f "$DATA_DIR/bin/geosite.dat" ] && [ -f "$VLESS_APP/xray-core/geosite.dat" ]; then
      cp "$VLESS_APP/xray-core/geosite.dat" "$DATA_DIR/bin/geosite.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null && echo "geosite.dat copied from VLess+" || true
    fi
    if [ ! -f "$DATA_DIR/bin/geosite.dat" ]; then
      echo "Downloading geosite.dat..."
      if fetch_file "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat" "$DATA_DIR/bin/geosite.dat"; then
        chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null && echo "geosite.dat downloaded successfully" || true
      elif fetch_file "https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat" "$DATA_DIR/bin/geosite.dat"; then
        chmod 644 "$DATA_DIR/bin/geosite.dat" 2>/dev/null && echo "geosite.dat downloaded successfully (v2fly)" || true
      fi
    fi
  fi
  if [ "$uses_geoip" = "1" ] && [ ! -f "$DATA_DIR/bin/geoip.dat" ]; then
    echo "Config uses geoip, ensuring geoip.dat is present..."
    if [ -f "$DATA_DIR/backup/geoip.dat" ]; then
      cp "$DATA_DIR/backup/geoip.dat" "$DATA_DIR/bin/geoip.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null && echo "geoip.dat restored from backup" || true
    fi
    if [ ! -f "$DATA_DIR/bin/geoip.dat" ] && [ -f "$APP_DIR/bin/geoip.dat" ]; then
      cp "$APP_DIR/bin/geoip.dat" "$DATA_DIR/bin/geoip.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null && echo "geoip.dat copied from app bundle" || true
    fi
    if [ ! -f "$DATA_DIR/bin/geoip.dat" ] && [ -f "$VLESS_APP/xray-core/geoip.dat" ]; then
      cp "$VLESS_APP/xray-core/geoip.dat" "$DATA_DIR/bin/geoip.dat" 2>/dev/null && chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null && echo "geoip.dat copied from VLess+" || true
    fi
    if [ ! -f "$DATA_DIR/bin/geoip.dat" ]; then
      echo "Downloading geoip.dat..."
      if fetch_file "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat" "$DATA_DIR/bin/geoip.dat"; then
        chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null && echo "geoip.dat downloaded successfully" || true
      elif fetch_file "https://github.com/v2fly/geoip/releases/latest/download/geoip.dat" "$DATA_DIR/bin/geoip.dat"; then
        chmod 644 "$DATA_DIR/bin/geoip.dat" 2>/dev/null && echo "geoip.dat downloaded successfully (v2fly)" || true
      fi
    fi
  fi
}
start() {
  persist_vless_bins
  if [ "$CORE" = "sing-box" ]; then
    SINGBOX_BIN="$(find_singbox 2>/dev/null || true)"
    if [ -z "$SINGBOX_BIN" ]; then echo "ERROR: sing-box missing. Put sing-box at $DATA_DIR/bin/sing-box" >&2; notify "Alcyone: VPN не запущен, нет sing-box"; exit 10; fi
  else
    XRAY_BIN="$(find_xray 2>/dev/null || true)"; TUN2SOCKS_BIN="$(find_tun2socks 2>/dev/null || true)"
    if [ -z "$XRAY_BIN" ]; then echo "ERROR: xray missing. Put xray at $DATA_DIR/bin/xray" >&2; notify "Alcyone: VPN не запущен, нет xray"; exit 10; fi
    if [ -z "$TUN2SOCKS_BIN" ]; then echo "ERROR: tun2socks missing. Put tun2socks at $DATA_DIR/bin/tun2socks" >&2; notify "Alcyone: VPN не запущен, нет tun2socks"; exit 10; fi
  fi
  if [ ! -f "$CONFIG" ]; then echo "ERROR: missing config $CONFIG" >&2; notify "Alcyone: VPN не запущен, нет config.json"; exit 11; fi
  [ "$CORE" = "xray" ] && ensure_dat_files
  attempt=1
  while [ "$attempt" -le 2 ]; do
    echo "Start attempt $attempt/2"
    start_attempt
    rc=$?
    if [ "$rc" -eq 0 ]; then
      if [ "$CORE" = "sing-box" ]; then
        echo "Started sing-box pid=$SINGBOX_PID"
        echo "Routing: sing-box native TUN"
      else
        echo "Started xray pid=$XRAY_PID tun2socks pid=$TUN2SOCKS_PID"
        echo "Routing: xray + tun2socks split TUN"
      fi
      notify "Alcyone: VPN включён"
      exit 0
    fi
    echo "WARNING: start attempt $attempt failed rc=$rc" >&2
    route_diag >&2 || true
    ALCYONE_SILENT=1 stop >/dev/null 2>&1 || true
    attempt=$((attempt + 1))
    sleep 2
  done
  notify "Alcyone: VPN не запущен. Процессы или маршрут не активны"
  echo "ERROR: VPN processes or route failed after retries" >&2
  route_diag >&2 || true
  exit 15
}

route_diag() {
  if [ -f "$ROUTE_STATE" ]; then . "$ROUTE_STATE" 2>/dev/null || true; fi
  echo "Route original: dev=${ORIG_DEV:-?} gw=${ORIG_GW:-none} server=${SERVER_IPS:-${SERVER_IP:-unresolved}}"
  pr="$(ip route get 9.9.9.9 2>/dev/null | head -n 1)"; echo "Route public 9.9.9.9: $pr"; echo "$pr" | grep -q "$TUN_NAME\|$TUN_GW" && echo "Route state: VPN route active" || echo "Route state: public traffic still uses LAN"
  for rip in ${SERVER_IPS:-${SERVER_IP:-}}; do echo "Route server $rip: $(ip route get "$rip" 2>/dev/null | head -n 1)"; done
  ip addr show "$TUN_NAME" 2>/dev/null | sed 's/^/tun0: /' | head -n 8
  ip route show 2>/dev/null | grep -E '0\.0\.0\.0/1|128\.0\.0\.0/1|198\.18\.0|default|tun0' | sed 's/^/route: /'
}
web_running() { [ -f "$WEB_PID_FILE" ] || return 1; pid="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"; [ -n "$pid" ] || return 1; kill -0 "$pid" 2>/dev/null; }
port_listening() { hex="$(printf '%04X' "$WEB_PORT" 2>/dev/null || echo 1F90)"; if [ -r /proc/net/tcp ] && grep -qi ":$hex .* 0A " /proc/net/tcp 2>/dev/null; then return 0; fi; if [ -r /proc/net/tcp6 ] && grep -qi ":$hex .* 0A " /proc/net/tcp6 2>/dev/null; then return 0; fi; if command -v netstat >/dev/null 2>&1 && netstat -an 2>/dev/null | grep -E "[\.:]$WEB_PORT[[:space:]].*LISTEN" >/dev/null 2>&1; then return 0; fi; return 1; }
web_alive() { web_running && port_listening; }
kill_web_leftovers() {
  if [ -f "$WEB_PID_FILE" ]; then p="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"; [ -n "$p" ] && kill "$p" 2>/dev/null || true; fi
  for cmdline in /proc/[0-9]*/cmdline; do
    [ -r "$cmdline" ] || continue
    cmd="$(tr '\000' ' ' < "$cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *"$WEB_JS"*) p="${cmdline#/proc/}"; p="${p%/cmdline}"; kill "$p" 2>/dev/null || true ;;
    esac
  done
  rm -f "$WEB_PID_FILE"
}
# Legacy migration: the discontinued build's web server may still hold port 8080.
kill_legacy_web() { for p in $(ps 2>/dev/null | awk '/incy-web\.js/ && !/awk/ {print $1}'); do kill "$p" 2>/dev/null || true; done; }
web_start() {
  n="$(find_node 2>/dev/null || true)"
  if [ -z "$n" ]; then echo "ERROR: node not found" >&2; exit 20; fi
  if [ ! -f "$WEB_JS" ]; then echo "ERROR: missing web server $WEB_JS" >&2; exit 21; fi
  if web_alive; then echo "Web UI already running pid=$(cat "$WEB_PID_FILE")"; echo "Web URL: $(web_url)"; exit 0; fi
  if ! web_running && port_listening; then kill_legacy_web; kill_web_leftovers; sleep 1; fi
  if web_running && ! port_listening; then kill_web_leftovers; sleep 1; fi
  : > "$WEB_LOG_FILE" 2>/dev/null || true
  set_open_files_limit 256
  ALCYONE_WEB_PORT="$WEB_PORT" ALCYONE_DATA_DIR="$DATA_DIR" ALCYONE_WEB_HOST="0.0.0.0" ALCYONE_CORE="$CORE" ALCYONE_EDITION_NAME="$ALCYONE_EDITION_NAME" ALCYONE_TITLE="$ALCYONE_TITLE" ALCYONE_VERSION="$ALCYONE_VERSION" nohup "$n" "$WEB_JS" >>"$WEB_LOG_FILE" 2>&1 </dev/null &
  echo $! > "$WEB_PID_FILE"
  i=0; n=5; [ "$HAVE_FSLEEP" = "1" ] && n=20
  while [ "$i" -lt "$n" ]; do short_sleep; if web_alive; then echo "Web UI started pid=$(cat "$WEB_PID_FILE")"; echo "Web URL: $(web_url)"; exit 0; fi; i=$((i + 1)); done
  echo "ERROR: Web UI did not start" >&2; tail -n 60 "$WEB_LOG_FILE" >&2 2>/dev/null || true; rm -f "$WEB_PID_FILE"; exit 22
}
web_stop() { if web_running; then p="$(cat "$WEB_PID_FILE")"; kill "$p" 2>/dev/null || true; sleep 1; kill -9 "$p" 2>/dev/null || true; fi; kill_web_leftovers; rm -f "$WEB_PID_FILE"; echo "Web UI stopped"; }
disconnect() { stop; web_stop; web_start; }
ip_test() {
  echo "Alcyone external IP test"
  if command -v curl >/dev/null 2>&1; then
    if is_running; then
      echo "VPN process: running"
      vpn_ip="$(get_public_ip 2>/dev/null || true)"
      direct_ip="$(get_direct_public_ip 2>/dev/null || true)"
      echo "IP via VPN: ${vpn_ip:-failed}"
      echo "IP direct: ${direct_ip:-failed}"
    else
      echo "VPN process: stopped"
      direct_ip="$(get_public_ip 2>/dev/null || true)"
      echo "IP direct: ${direct_ip:-failed}"
    fi
  else echo "curl: missing"; fi
  route_diag
}
ping_profile() {
  encoded_id="$1"; host="$2"; ping_bin=""
  case "$host" in
    *:*) if command -v ping6 >/dev/null 2>&1; then ping_bin="ping6"; elif command -v ping >/dev/null 2>&1; then ping_bin="ping"; fi ;;
    *) if command -v ping >/dev/null 2>&1; then ping_bin="ping"; fi ;;
  esac
  ms=""
  if [ -n "$ping_bin" ]; then
    ping_out="$("$ping_bin" -c 1 -W 2 "$host" 2>/dev/null || true)"
    ms="$(printf '%s\n' "$ping_out" | awk '
      /time[=<][[:space:]]*[0-9]/ {
        value=$0
        sub(/^.*time[=<][[:space:]]*/, "", value)
        sub(/[^0-9.].*$/, "", value)
        if (value != "") { printf "%d\n", value + 0.5; exit }
      }
    ')"
  fi
  case "$ms" in
    ''|*[!0-9]*) printf 'PING\t%s\tn/a\n' "$encoded_id" ;;
    *) [ "$ms" -lt 1 ] && ms=1; printf 'PING\t%s\t%s\n' "$encoded_id" "$ms" ;;
  esac
}
ping_servers() {
  payload="$1"; tmp="/tmp/alcyone-ping.$$"; total=0; batch=0
  rm -rf "$tmp" 2>/dev/null || true
  mkdir -p "$tmp" || return 1
  trap 'rm -rf "$tmp" 2>/dev/null || true' 0 1 2 15
  if ! printf '%s' "$payload" | base64 -d > "$tmp/input" 2>/dev/null; then
    echo "ERROR: invalid ping request" >&2
    return 1
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    encoded_id="${line%%|*}"; host="${line#*|}"
    [ "$encoded_id" != "$line" ] || continue
    total=$((total + 1)); batch=$((batch + 1))
    ( ping_profile "$encoded_id" "$host" ) > "$tmp/result.$total" &
    if [ "$batch" -ge 6 ]; then wait; batch=0; fi
  done < "$tmp/input"
  wait
  i=1
  while [ "$i" -le "$total" ]; do cat "$tmp/result.$i" 2>/dev/null || true; i=$((i + 1)); done
  rm -rf "$tmp" 2>/dev/null || true
  trap - 0 1 2 15
}
sub_update() {
  n="$(find_node 2>/dev/null || true)"
  if [ -z "$n" ]; then echo "ERROR: node not found" >&2; exit 30; fi
  ALCYONE_DATA_DIR="$DATA_DIR" "$n" "$WEB_JS" --update-subscriptions
}
status() {
  if is_running; then
    if [ "$CORE" = "sing-box" ]; then echo "Alcyone: running sing-box=$(cat "$SINGBOX_PID_FILE")"; else echo "Alcyone: running xray=$(cat "$XRAY_PID_FILE") tun2socks=$(cat "$TUN2SOCKS_PID_FILE")"; fi
  else
    echo "Alcyone: stopped"
  fi
  if web_alive; then echo "Web UI: running pid=$(cat "$WEB_PID_FILE") url=$(web_url)"; elif web_running; then echo "Web UI: process exists but port $WEB_PORT is not listening"; else echo "Web UI: stopped url=$(web_url)"; fi
  if port_listening; then echo "Port $WEB_PORT: listening"; else echo "Port $WEB_PORT: not listening"; fi
  [ -f "$CONFIG" ] && echo "Config: $CONFIG" || echo "Config: missing"
  [ -f "$PROFILES" ] && echo "Profiles: $PROFILES" || echo "Profiles: missing"
  if [ "$CORE" = "sing-box" ]; then
    if find_singbox >/dev/null 2>&1; then echo "sing-box: $(find_singbox)"; else echo "sing-box: missing"; echo "Core install log tail:"; tail -n 25 "$CORE_LOG" 2>/dev/null || true; fi
    echo "Routing: sing-box native TUN"
  else
    if find_xray >/dev/null 2>&1; then echo "xray: $(find_xray)"; else echo "xray: missing"; fi
    if find_tun2socks >/dev/null 2>&1; then echo "tun2socks: $(find_tun2socks)"; else echo "tun2socks: missing"; echo "Core install log tail:"; tail -n 25 "$CORE_LOG" 2>/dev/null || true; fi
    echo "Routing: xray + tun2socks split TUN"
  fi
  route_diag
  if find_node >/dev/null 2>&1; then echo "node: $(find_node)"; else echo "node: missing"; fi
}
probe() {
  persist_vless_bins
  echo "Alcyone probe"
  echo "User: $(id 2>/dev/null || true)"
  [ "$(id -u 2>/dev/null || echo 999)" = "0" ] && echo "Root: yes" || echo "Root: no"
  echo "Kernel: $(uname -a 2>/dev/null || true)"
  echo "IP: $(ip_addr)"
  echo "Web URL: $(web_url)"
  [ -e /dev/net/tun ] && echo "TUN: yes /dev/net/tun" || echo "TUN: missing /dev/net/tun"
  command -v ip >/dev/null 2>&1 && echo "iproute2: yes" || echo "iproute2: missing"
  if [ "$CORE" = "sing-box" ]; then
    if find_singbox >/dev/null 2>&1; then echo "sing-box: $(find_singbox)"; "$(find_singbox)" version 2>&1 | head -n 5 || true; else echo "sing-box: missing"; fi
  else
    if find_xray >/dev/null 2>&1; then echo "xray: $(find_xray)"; "$(find_xray)" version 2>&1 | head -n 5 || true; else echo "xray: missing"; fi
    if find_tun2socks >/dev/null 2>&1; then echo "tun2socks: $(find_tun2socks)"; else echo "tun2socks: missing"; fi
  fi
  if find_node >/dev/null 2>&1; then n="$(find_node)"; echo "node: $n"; "$n" --version 2>&1 | head -n 3 || true; else echo "node: missing"; fi
  status
}
process_open_files() {
  label="$1"; pid_file="$2"
  [ -f "$pid_file" ] || return 0
  process_pid="$(cat "$pid_file" 2>/dev/null || true)"
  case "$process_pid" in ''|*[!0-9]*) return 0 ;; esac
  kill -0 "$process_pid" 2>/dev/null || return 0
  process_used="$(ls "/proc/$process_pid/fd" 2>/dev/null | wc -l 2>/dev/null | tr -d ' ')"
  process_limit="$(awk '/Max open files/ { print $4; exit }' "/proc/$process_pid/limits" 2>/dev/null || true)"
  [ -n "$process_used" ] || process_used="unknown"
  [ -n "$process_limit" ] || process_limit="unknown"
  echo "$label open files: $process_used/$process_limit pid=$process_pid"
}
logs() { echo "=== resources ==="; if [ "$CORE" = "sing-box" ]; then process_open_files "sing-box" "$SINGBOX_PID_FILE"; else process_open_files "xray" "$XRAY_PID_FILE"; process_open_files "tun2socks" "$TUN2SOCKS_PID_FILE"; fi; process_open_files "web" "$WEB_PID_FILE"; echo "=== core install log ==="; tail -n 80 "$CORE_LOG" 2>/dev/null || echo "No logs yet: $CORE_LOG"; echo "=== $CORE_LABEL tunnel log ==="; tail -n 80 "$LOG_FILE" 2>/dev/null || echo "No logs yet: $LOG_FILE"; echo "=== web log ==="; tail -n 60 "$WEB_LOG_FILE" 2>/dev/null || echo "No logs yet: $WEB_LOG_FILE"; }
clear_logs() {
  clear_failed=0
  for clear_file in "$CORE_LOG" "$LOG_FILE" "$WEB_LOG_FILE"; do
    : > "$clear_file" 2>/dev/null || clear_failed=1
  done
  if [ "$clear_failed" = "0" ]; then echo "Logs cleared"; else echo "ERROR: some logs could not be cleared" >&2; return 1; fi
}
web_status() { echo "Alcyone Web diagnostics"; echo "IP: $(ip_addr)"; echo "Web URL: $(web_url)"; if find_node >/dev/null 2>&1; then n="$(find_node)"; echo "node: $n"; "$n" --version 2>&1 | head -n 3 || true; else echo "node: missing"; fi; [ -f "$WEB_PID_FILE" ] && echo "pid file: $(cat "$WEB_PID_FILE" 2>/dev/null || true)" || echo "pid file: missing"; web_running && echo "process: running" || echo "process: stopped"; port_listening && echo "port $WEB_PORT: listening" || echo "port $WEB_PORT: not listening"; echo "=== web log ==="; tail -n 80 "$WEB_LOG_FILE" 2>/dev/null || echo "No web log yet: $WEB_LOG_FILE"; }
install_autostart() { mkdir -p /var/lib/webosbrew/init.d; cat > "$AUTOSTART" <<EOS
#!/bin/sh
$APP_DIR/scripts/alcyonectl.sh start >$DATA_DIR/autostart.log 2>&1 &
$APP_DIR/scripts/alcyonectl.sh web-start >$DATA_DIR/autostart-web.log 2>&1 &
EOS
  chmod +x "$AUTOSTART"; echo "Autostart installed: $AUTOSTART"; }
remove_autostart() { rm -f "$AUTOSTART"; echo "Autostart removed: $AUTOSTART"; }
case "${1:-status}" in
  start) ensure_bins_online >"$CORE_LOG" 2>&1 || { cat "$CORE_LOG" 2>/dev/null || true; echo "ERROR: $CORE_LABEL core missing"; exit 1; } ; start ;;
  stop) stop ;;
  disconnect) disconnect ;;
  restart) stop; ensure_bins_online >"$CORE_LOG" 2>&1 || { cat "$CORE_LOG" 2>/dev/null || true; echo "ERROR: $CORE_LABEL core missing"; exit 1; }; start ;;
  status) status ;;
  probe) ensure_bins_online >/dev/null 2>&1;  probe ;;
  logs) logs ;;
  clear-logs) clear_logs ;;
  install-core) ensure_bins_online >"$CORE_LOG" 2>&1; rc=$?; cat "$CORE_LOG" 2>/dev/null || true; exit $rc ;;
  ip-test) ip_test ;;
  ping-servers) ping_servers "${2:-}" ;;
  sub-update) sub_update ;;
  web-start) web_start ;;
  web-stop) web_stop ;;
  web-restart) web_stop; web_start ;;
  web-status) web_status ;;
  web-url) web_url ;;
  install-autostart) install_autostart ;;
  remove-autostart) remove_autostart ;;
  log-guard) log_guard_loop "${2:-}" "${3:-}" ;;
  *) echo "Usage: $0 {start|stop|disconnect|restart|status|probe|logs|clear-logs|install-core|ip-test|ping-servers|sub-update|web-start|web-stop|web-restart|web-status|web-url|install-autostart|remove-autostart}"; exit 2 ;;
esac
