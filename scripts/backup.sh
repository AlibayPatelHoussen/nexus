#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — automatic backups
#
#  Every night (systemd timer, independent of Nexus):
#    - the database (accounts, library, lists, history, IPTV…): pg_dump
#    - backend/.env and backend/data (the Web Push keys), needed to restore
#  into /var/backups/nexus (root only), the last 14 of each kept.
#  The media files themselves are not copied (too big: use a second disk).
#
#  sudo bash scripts/backup.sh install     install + a first backup now
#  sudo bash scripts/backup.sh now         one backup now
#  sudo bash scripts/backup.sh status      last backups + next run
#  sudo bash scripts/backup.sh restore <nexus-db-….dump>   put a backup back
#  sudo bash scripts/backup.sh uninstall   stop (the backups are kept)
#
#  Options (in /etc/default/nexus-backup): BACKUP_DIR=/var/backups/nexus,
#  KEEP=14, COPY_TO=/mnt/disque2/nexus-backups (a copy on another disk)
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

NAME=nexus-backup
BIN=/usr/local/sbin/$NAME
CONF=/etc/default/$NAME
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/nexus}
KEEP=${KEEP:-14}
COPY_TO=${COPY_TO:-}
# The installation: where this script is (from the repository), or the one saved at install
NEXUS_DIR=${NEXUS_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}

need_root() { [ "$(id -u)" -eq 0 ] || { echo "❌ Lance-le avec sudo : sudo bash scripts/backup.sh $1"; exit 1; }; }

# DB_NAME from backend/.env (one line, never the rest of the file), else « nexus »
db_name() {
  local v
  v=$({ grep -E '^DB_NAME=' "$NEXUS_DIR/backend/.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | tr -d "\"' \r")
  [[ $v =~ ^[A-Za-z0-9_]+$ ]] && echo "$v" || echo nexus
}

as_postgres() { runuser -u postgres -- "$@"; }

# $1: a label for the file names (« avant-restauration »)
do_backup() {
  need_root now
  local label=${1:-}
  [[ $KEEP =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ] || { echo "❌ KEEP doit être un nombre"; exit 1; }
  umask 077
  install -d -m 700 "$BACKUP_DIR"
  local db stamp dump files
  db=$(db_name)
  stamp=$(date +%Y-%m-%d_%H%M%S)${label:+-$label}
  # Never over an existing backup (two in the same second)
  local n=1 base=$stamp
  while [ -e "$BACKUP_DIR/nexus-db-$stamp.dump" ]; do n=$((n + 1)); stamp="$base-$n"; done
  dump="$BACKUP_DIR/nexus-db-$stamp.dump"
  files="$BACKUP_DIR/nexus-settings-$stamp.tar.gz"

  # Database: custom format (compressed, restorable table by table); written then renamed
  as_postgres pg_dump --format=custom --dbname="$db" > "$dump.part"
  mv "$dump.part" "$dump"

  # Settings: backend/.env and the Web Push keys (whatever exists)
  local items=() f saved=''
  for f in backend/.env backend/data; do if [ -e "$NEXUS_DIR/$f" ]; then items+=("$f"); fi; done
  if [ ${#items[@]} -gt 0 ]; then
    saved=' + réglages'
    tar -czf "$files.part" -C "$NEXUS_DIR" "${items[@]}"
    mv "$files.part" "$files"
  fi

  # Only the last KEEP of each
  for kind in db settings; do
    # shellcheck disable=SC2012
    { ls -1t "$BACKUP_DIR"/nexus-"$kind"-*.* 2>/dev/null || true; } | { grep -v '\.part$' || true; } | tail -n +$((KEEP + 1)) | xargs -r rm -f --
  done

  # A copy on another disk (if set): the same files, the same number kept
  if [ -n "$COPY_TO" ]; then
    if install -d -m 700 "$COPY_TO" 2>/dev/null; then
      cp -p "$dump" "$COPY_TO/" && { [ ! -e "$files" ] || cp -p "$files" "$COPY_TO/"; }
      for kind in db settings; do
        # shellcheck disable=SC2012
        { ls -1t "$COPY_TO"/nexus-"$kind"-*.* 2>/dev/null || true; } | tail -n +$((KEEP + 1)) | xargs -r rm -f --
      done
    else
      echo "⚠️  Copie impossible vers $COPY_TO (disque absent ?)" >&2
    fi
  fi
  echo "✅ Sauvegarde : $(basename "$dump") ($(du -h "$dump" | cut -f1))$saved"
}

do_install() {
  need_root install
  command -v pg_dump >/dev/null || { echo "❌ pg_dump introuvable (paquet postgresql-client)"; exit 1; }
  install -m 755 "$(readlink -f "$0")" "$BIN"
  # The installation's folder, for the copy in /usr/local/sbin
  if ! grep -qs '^NEXUS_DIR=' "$CONF"; then
    printf '# Nexus backups (scripts/backup.sh)\nNEXUS_DIR=%q\n' "$NEXUS_DIR" >> "$CONF"
  fi
  chmod 644 "$CONF"

  cat > /etc/systemd/system/$NAME.service <<EOF
[Unit]
Description=Nexus backup (database + settings)
After=postgresql.service

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=$BIN now
EOF
  cat > /etc/systemd/system/$NAME.timer <<EOF
[Unit]
Description=Nexus backup, every night

[Timer]
OnCalendar=*-*-* 03:40
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now $NAME.timer >/dev/null
  echo "✅ Sauvegardes automatiques installées (chaque nuit vers 3 h 40, les $KEEP dernières gardées)"
  echo "   Dossier : $BACKUP_DIR (root seulement)"
  do_backup
}

do_status() {
  systemctl list-timers $NAME.timer --no-pager 2>/dev/null | head -3 || true
  echo ""
  echo "Dernières sauvegardes ($BACKUP_DIR) :"
  # shellcheck disable=SC2012
  { ls -1t "$BACKUP_DIR"/nexus-db-*.dump 2>/dev/null || true; } | head -5 | while read -r f; do
    echo "  $(basename "$f")  $(du -h "$f" | cut -f1)"
  done || true
  journalctl -u $NAME.service -n 5 --no-pager 2>/dev/null | tail -5 || true
}

do_restore() {
  need_root restore
  local file=${1:-}
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    echo "Usage : sudo bash scripts/backup.sh restore $BACKUP_DIR/nexus-db-AAAA-MM-JJ_HHMMSS.dump"
    # shellcheck disable=SC2012
    { ls -1t "$BACKUP_DIR"/nexus-db-*.dump 2>/dev/null || true; } | head -5 | sed 's/^/  /'
    exit 1
  fi
  local db; db=$(db_name)
  echo "⚠️  La base « $db » va être remplacée par $(basename "$file")."
  echo "   Ce qui a changé depuis cette sauvegarde sera perdu. Nexus est arrêté pendant la restauration."
  read -r -p "Tape RESTAURER pour continuer : " ok
  [ "$ok" = "RESTAURER" ] || { echo "Annulé."; exit 1; }
  # The chosen backup is read from a private copy: the safety backup below (and its clean-up
  # of old ones) can never touch it
  RESTORE_COPY=$(mktemp /tmp/nexus-restore.XXXXXX)
  trap 'rm -f "$RESTORE_COPY"' EXIT
  cp -- "$file" "$RESTORE_COPY"
  # A last backup of the current state first, in case
  do_backup avant-restauration
  local pm2_user; pm2_user=$(stat -c %U "$NEXUS_DIR")
  runuser -u "$pm2_user" -- pm2 stop nexus-backend >/dev/null 2>&1 || true
  as_postgres pg_restore --clean --if-exists --single-transaction --dbname="$db" < "$RESTORE_COPY"
  runuser -u "$pm2_user" -- pm2 start nexus-backend >/dev/null 2>&1 || true
  echo "✅ Base restaurée depuis $(basename "$file")"
  echo "   Les réglages (.env, clés) se remettent à la main si besoin : tar -xzf nexus-settings-….tar.gz -C $NEXUS_DIR"
}

do_uninstall() {
  need_root uninstall
  systemctl disable --now $NAME.timer 2>/dev/null || true
  rm -f /etc/systemd/system/$NAME.service /etc/systemd/system/$NAME.timer "$BIN"
  systemctl daemon-reload
  echo "Sauvegardes automatiques arrêtées (les fichiers restent dans $BACKUP_DIR)"
}

case "${1:-}" in
  install)   do_install ;;
  now)       do_backup ;;
  status)    do_status ;;
  restore)   do_restore "${2:-}" ;;
  uninstall) do_uninstall ;;
  *) sed -n '3,20p' "$0" | sed 's/^# \{0,2\}//'; exit 1 ;;
esac
