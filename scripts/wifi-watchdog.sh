#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — Wi-Fi watchdog, for USB Wi-Fi dongles that stop working
#
#  Checked every minute (systemd timer, independent of Nexus). When the
#  Internet is unreachable, it repairs step by step:
#    1. restart the Wi-Fi service (wifi / NetworkManager / wpa_supplicant…)
#    2. interface down / up + service restart
#    3. "unplug / replug" the USB dongle by software (USB re-enumeration)
#  It also turns off Wi-Fi power saving and USB autosuspend, the usual
#  cause of dongles falling asleep.
#
#  sudo bash scripts/wifi-watchdog.sh install     install + start
#  sudo bash scripts/wifi-watchdog.sh status      state + last repairs
#  sudo bash scripts/wifi-watchdog.sh check       one check now
#  sudo bash scripts/wifi-watchdog.sh uninstall   remove
#
#  Options (in /etc/default/nexus-wifi-watchdog): WIFI_IFACE=wlx…,
#  WIFI_SERVICE=wifi, PING_HOSTS="1.1.1.1 8.8.8.8 9.9.9.9"
# ══════════════════════════════════════════════════════════════════════
set -u

NAME=nexus-wifi-watchdog
BIN=/usr/local/sbin/$NAME
STATE_DIR=/var/lib/$NAME
CONF=/etc/default/$NAME
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
PING_HOSTS=${PING_HOSTS:-"1.1.1.1 8.8.8.8 9.9.9.9"}

log() { echo "$*"; logger -t "$NAME" -- "$*" 2>/dev/null || true; }

need_root() { [ "$(id -u)" = 0 ] || { echo "À lancer avec sudo : sudo bash $0 ${1:-}"; exit 1; }; }

# Wi-Fi interface: WIFI_IFACE, else the first wireless one
iface() {
  if [ -n "${WIFI_IFACE:-}" ]; then echo "$WIFI_IFACE"; return; fi
  for d in /sys/class/net/*; do
    [ -e "$d/wireless" ] || [ -e "$d/phy80211" ] && { basename "$d"; return; }
  done
}

# USB device of the interface (e.g. /sys/bus/usb/devices/1-2), remembered:
# once the dongle has crashed the interface may have disappeared
usb_dev() {
  local ifc=$1 p
  if [ -n "$ifc" ] && [ -e "/sys/class/net/$ifc/device" ]; then
    p=$(readlink -f "/sys/class/net/$ifc/device")
    # .../1-2/1-2:1.0 → .../1-2 (the device, not its interface)
    while [ -n "$p" ] && [ "$p" != / ] && [ ! -e "$p/idVendor" ]; do p=$(dirname "$p"); done
    if [ -e "$p/idVendor" ]; then
      mkdir -p "$STATE_DIR"; echo "$p" > "$STATE_DIR/usb"; echo "$p"; return
    fi
  fi
  [ -r "$STATE_DIR/usb" ] && cat "$STATE_DIR/usb"
}

# Reachable = answers ping, or accepts a TCP connection on port 53 (DNS)
# (works without ping, and where ICMP is filtered)
online() {
  local h
  for h in $PING_HOSTS; do
    if command -v ping >/dev/null; then ping -c 1 -W 3 "$h" >/dev/null 2>&1 && return 0; fi
    timeout 4 bash -c "exec 3<>/dev/tcp/$h/${CHECK_PORT:-53}" 2>/dev/null && return 0
  done
  return 1
}

restart_service() {
  local ifc=$1 u
  for u in ${WIFI_SERVICE:-} wifi "wpa_supplicant@$ifc" NetworkManager iwd wpa_supplicant systemd-networkd; do
    [ -n "$u" ] || continue
    if systemctl is-enabled "$u" >/dev/null 2>&1 || systemctl is-active "$u" >/dev/null 2>&1; then
      log "→ restart service $u"; systemctl restart "$u" 2>&1 | head -3; return 0
    fi
  done
  command -v netplan >/dev/null && { log "→ netplan apply"; netplan apply 2>&1 | head -3; return 0; }
  log "→ no Wi-Fi service found to restart (set WIFI_SERVICE in $CONF)"
}

usb_replug() {
  local dev=$1
  if [ -z "$dev" ] || [ ! -e "$dev/authorized" ]; then log "→ USB device of the dongle unknown, cannot replug it"; return 1; fi
  log "→ USB replug of $(basename "$dev") ($(cat "$dev/idVendor" 2>/dev/null):$(cat "$dev/idProduct" 2>/dev/null))"
  echo 0 > "$dev/authorized"; sleep 3; echo 1 > "$dev/authorized"; sleep 8
}

no_power_save() {
  local ifc=$1 dev=$2
  [ -n "$ifc" ] && command -v iw >/dev/null && iw dev "$ifc" set power_save off 2>/dev/null
  [ -n "$dev" ] && [ -w "$dev/power/control" ] && echo on > "$dev/power/control" 2>/dev/null
  return 0
}

do_check() {
  need_root check
  mkdir -p "$STATE_DIR"
  local ifc dev fails
  ifc=$(iface); dev=$(usb_dev "$ifc")
  fails=$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0)

  if online; then
    [ "$fails" -gt 0 ] && log "✅ Internet back (after $fails failed check(s))"
    echo 0 > "$STATE_DIR/fails"
    no_power_save "$ifc" "$dev"
    return 0
  fi

  fails=$((fails + 1)); echo "$fails" > "$STATE_DIR/fails"
  log "❌ No Internet (check #$fails, interface: ${ifc:-none})"
  # Interface gone (dongle crashed): replug right away
  if [ -z "$ifc" ] || [ ! -e "/sys/class/net/$ifc" ]; then usb_replug "$dev"; restart_service "${ifc:-wlan0}"; return 0; fi
  case $fails in
    1) ;;                                     # may be a short outage: wait one minute
    2) restart_service "$ifc" ;;
    3) log "→ interface $ifc down/up"; ip link set "$ifc" down 2>&1; sleep 2; ip link set "$ifc" up 2>&1; restart_service "$ifc" ;;
    *) usb_replug "$dev" && restart_service "$(iface)"
       # Next time start again at step 2 (every ~3 min while it stays down)
       echo 1 > "$STATE_DIR/fails" ;;
  esac
}

do_install() {
  need_root install
  local src ifc dev
  src=$(readlink -f "$0")
  install -m 755 "$src" "$BIN"
  ifc=$(iface); dev=$(usb_dev "$ifc")

  cat > /etc/systemd/system/$NAME.service <<EOF
[Unit]
Description=Nexus Wi-Fi watchdog (repairs the USB Wi-Fi dongle)
After=network.target

[Service]
Type=oneshot
ExecStart=$BIN check
EOF
  cat > /etc/systemd/system/$NAME.timer <<EOF
[Unit]
Description=Nexus Wi-Fi watchdog, every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

  # Keep the dongle awake: USB autosuspend off for it (survives reboots / replugs)
  if [ -n "$dev" ] && [ -r "$dev/idVendor" ]; then
    cat > /etc/udev/rules.d/90-$NAME.rules <<EOF
# Nexus: never autosuspend the Wi-Fi dongle
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="$(cat "$dev/idVendor")", ATTR{idProduct}=="$(cat "$dev/idProduct")", TEST=="power/control", ATTR{power/control}="on"
EOF
    udevadm control --reload 2>/dev/null || true
  fi
  # NetworkManager: Wi-Fi power saving off
  if [ -d /etc/NetworkManager/conf.d ]; then
    printf '[connection]\nwifi.powersave = 2\n' > /etc/NetworkManager/conf.d/90-$NAME-powersave.conf
  fi
  no_power_save "$ifc" "$dev"

  systemctl daemon-reload
  systemctl enable --now $NAME.timer >/dev/null
  echo "✅ Wi-Fi watchdog installed (checks every minute)"
  echo "   Wi-Fi interface : ${ifc:-not found — set WIFI_IFACE in $CONF}"
  echo "   USB dongle      : ${dev:+$(basename "$dev") ($(cat "$dev/idVendor" 2>/dev/null):$(cat "$dev/idProduct" 2>/dev/null))}${dev:-not found}"
  echo "   Power saving / USB autosuspend: off"
  echo "   Last repairs    : sudo bash scripts/wifi-watchdog.sh status"
}

do_status() {
  echo "Interface : $(iface || true)    USB : $(usb_dev "$(iface)" 2>/dev/null | xargs -r basename)"
  if online; then echo "Internet  : ✅ OK"; else echo "Internet  : ❌ unreachable"; fi
  systemctl list-timers $NAME.timer --no-pager 2>/dev/null | head -3
  echo ""; echo "Last events:"
  journalctl -t $NAME -n 15 --no-pager 2>/dev/null || echo "(no journal)"
}

do_uninstall() {
  need_root uninstall
  systemctl disable --now $NAME.timer 2>/dev/null
  rm -f /etc/systemd/system/$NAME.service /etc/systemd/system/$NAME.timer "$BIN" \
        /etc/udev/rules.d/90-$NAME.rules /etc/NetworkManager/conf.d/90-$NAME-powersave.conf
  rm -rf "$STATE_DIR"
  systemctl daemon-reload
  echo "Wi-Fi watchdog removed"
}

case "${1:-}" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  check)     do_check ;;
  status)    do_status ;;
  *) sed -n '3,21p' "$0" | sed 's/^# \{0,2\}//'; exit 1 ;;
esac
