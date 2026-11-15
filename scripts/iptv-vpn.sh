#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — a VPN for the IPTV only
#
#  The IPTV (the streams, their checks, the guide, YouTube / Twitch lives) leaves
#  through a WireGuard VPN; nothing else changes: the library, the downloads, TMDB,
#  Cloudflare Tunnel and the updates stay on the normal connection.
#
#  How: wireproxy (WireGuard in user space, no change to the server's routes) opens
#  a local HTTP proxy, 127.0.0.1:25345, that only Nexus's IPTV uses (IPTV_PROXY in
#  backend/.env). If the VPN is down, the IPTV stops instead of going out directly.
#
#  sudo bash scripts/iptv-vpn.sh install <wireguard.conf>   the provider's WireGuard
#                                                            file (Mullvad, Proton VPN…)
#  bash scripts/iptv-vpn.sh status                          up? which country, which IP
#  sudo bash scripts/iptv-vpn.sh uninstall                  back to direct
#
#  Changing country: install again with another file of the provider.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

NAME=nexus-iptv-vpn
DIR=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
ENVF="$DIR/backend/.env"
CONF_DIR=/etc/wireproxy
WG_CONF="$CONF_DIR/iptv-wg.conf"
PROXY_CONF="$CONF_DIR/iptv.conf"
BIN=/usr/local/bin/wireproxy
PORT=25345
PROXY="http://127.0.0.1:$PORT"
# wireproxy v1.0.9 (github.com/whyvl/wireproxy), checked by its SHA-256
WP_VERSION=v1.0.9
declare -A WP_SHA256=(
  [amd64]=beea2016a34e24762d539d7ff727188ab6709e58072d7a69085c5d4f0ae665dc
  [arm64]=5fdf917567e690369aadfc3422397633848f758f726de2132de187e3d4fe0213
)

need_root() { [ "$(id -u)" = 0 ] || { echo "À lancer avec sudo : sudo bash $0 $1${2:+ $2}"; exit 1; }; }

# The account that runs Nexus (owner of the folder), and its PATH (pm2 may come from nvm)
owner() { stat -c %U "$DIR"; }
restart_nexus() {
  local user upath
  user=$(owner)
  upath=$(sudo -u "$user" -i bash -c 'echo $PATH' 2>/dev/null | tail -1)
  if sudo -u "$user" env PATH="$upath" pm2 restart nexus-backend >/dev/null 2>&1; then
    echo "   Nexus redémarré"
  else
    echo "⚠️  Redémarre Nexus toi-même : pm2 restart nexus-backend"
  fi
}

# Sets (or removes, with no value) IPTV_PROXY in backend/.env, keeping the file's owner and rights
set_env() {
  [ -f "$ENVF" ] || { echo "❌ $ENVF introuvable"; exit 1; }
  local tmp; tmp=$(mktemp)
  # Without the previous line and its comment, nor the blank lines they leave at the end
  awk '/^IPTV_PROXY=/ || /^# IPTV through its VPN/ { next } { lines[++n] = $0 }
       END { while (n > 0 && lines[n] ~ /^[[:space:]]*$/) n--; for (i = 1; i <= n; i++) print lines[i] }' "$ENVF" > "$tmp"
  if [ -n "${1:-}" ]; then printf '\n# IPTV through its VPN (scripts/iptv-vpn.sh)\nIPTV_PROXY=%s\n' "$1" >> "$tmp"; fi
  cat "$tmp" > "$ENVF"
  rm -f "$tmp"
}

# Where the IPTV comes out (Cloudflare's trace, through the VPN)
trace() { curl -fsS --max-time 10 -x "$PROXY" https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -E '^(ip|loc)=' | tr '\n' ' '; }

do_install() {
  need_root install "${1:-<wireguard.conf>}"
  local src=${1:-}
  if [ -z "$src" ] || [ ! -f "$src" ]; then
    echo "Donne le fichier WireGuard de ton fournisseur VPN : sudo bash $0 install /chemin/vers/fichier.conf"; exit 1
  fi
  if ! grep -q '^\[Interface\]' "$src" || ! grep -q '^\[Peer\]' "$src" || ! grep -qi '^PrivateKey' "$src" || ! grep -qi '^Endpoint' "$src"; then
    echo "❌ Ce n'est pas un fichier WireGuard ([Interface] avec PrivateKey, [Peer] avec Endpoint)"; exit 1
  fi
  command -v curl >/dev/null || { echo "❌ curl manquant : sudo apt-get install -y curl"; exit 1; }

  local arch
  case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "❌ Processeur $(uname -m) non pris en charge"; exit 1 ;;
  esac

  if ! "$BIN" -v 2>/dev/null | grep -q "${WP_VERSION#v}"; then
    echo "📦 wireproxy $WP_VERSION ($arch)…"
    local tmpd; tmpd=$(mktemp -d)
    curl -fsSL --max-time 120 -o "$tmpd/wp.tgz" \
      "https://github.com/whyvl/wireproxy/releases/download/$WP_VERSION/wireproxy_linux_$arch.tar.gz"
    echo "${WP_SHA256[$arch]}  $tmpd/wp.tgz" | sha256sum -c --quiet - \
      || { echo "❌ Le fichier téléchargé n'est pas celui attendu (empreinte SHA-256) : arrêt"; rm -rf "$tmpd"; exit 1; }
    tar -xzf "$tmpd/wp.tgz" -C "$tmpd" wireproxy
    install -m 755 "$tmpd/wireproxy" "$BIN"
    rm -rf "$tmpd"
  fi

  # The provider's file, without the wg-quick lines wireproxy has no use for (it never runs commands)
  install -d -m 700 "$CONF_DIR"
  grep -viE '^\s*(PostUp|PostDown|PreUp|PreDown|Table|SaveConfig)\s*=' "$src" > "$WG_CONF.tmp"
  install -m 600 "$WG_CONF.tmp" "$WG_CONF"; rm -f "$WG_CONF.tmp"
  cat > "$PROXY_CONF" <<EOF
# Nexus — IPTV through WireGuard (scripts/iptv-vpn.sh)
WGConfig = $WG_CONF

[http]
BindAddress = 127.0.0.1:$PORT
EOF
  chmod 600 "$PROXY_CONF"
  "$BIN" -c "$PROXY_CONF" -n >/dev/null || { echo "❌ wireproxy refuse cette configuration"; exit 1; }

  cat > "/etc/systemd/system/$NAME.service" <<EOF
[Unit]
Description=Nexus IPTV VPN (WireGuard for the IPTV only, wireproxy)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$BIN -c $PROXY_CONF
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$NAME" >/dev/null 2>&1
  systemctl restart "$NAME"

  # Up within a few seconds?
  local out=""
  for _ in $(seq 1 15); do out=$(trace) && [ -n "$out" ] && break; sleep 1; done
  if [ -z "$out" ]; then
    echo "❌ Le VPN ne répond pas : journalctl -u $NAME -n 30 (Nexus n'a pas été changé)"; exit 1
  fi
  set_env "$PROXY"
  echo "✅ VPN de l'IPTV actif : $out"
  restart_nexus
  echo "   Réglages › IPTV dans Nexus montre son état. État ici : bash $0 status"
}

do_status() {
  if ! systemctl is-enabled "$NAME" >/dev/null 2>&1; then echo "VPN de l'IPTV : non installé (l'IPTV sort directement)"; return; fi
  echo "Service : $(systemctl is-active "$NAME" 2>/dev/null)"
  local out; out=$(trace || true)
  echo "Sortie  : ${out:-injoignable (journalctl -u $NAME -n 30)}"
  if grep -q '^IPTV_PROXY=' "$ENVF" 2>/dev/null; then echo "Nexus   : l'IPTV passe par le VPN"
  else echo "Nexus   : IPTV_PROXY absent de backend/.env (relance install)"; fi
}

do_uninstall() {
  need_root uninstall
  systemctl disable --now "$NAME" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$NAME.service" "$PROXY_CONF" "$WG_CONF"
  systemctl daemon-reload
  set_env ""
  echo "✅ VPN de l'IPTV retiré : l'IPTV sort de nouveau directement"
  restart_nexus
}

case "${1:-}" in
  install)   do_install "${2:-}" ;;
  status)    do_status ;;
  uninstall) do_uninstall ;;
  *) sed -n '3,19p' "$0" | sed 's/^# \{0,2\}//'; exit 1 ;;
esac
