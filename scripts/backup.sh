#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — automatic backups
#
#  Every night (systemd timer, independent of Nexus), and before each update
#  that changes the database (scripts/migrate-db.sh):
#    - the database (accounts, library, lists, history, IPTV…): pg_dump
#    - backend/.env, backend/data (the Web Push keys) and the admin account
#      scripts (out of Git), needed to restore
#  into /var/backups/nexus (root only), the last 14 of each kept.
#  Google Drive (optional): each backup is also sent there, encrypted (gpg,
#  AES-256, with a passphrase only you know), the last 14 kept there too.
#  The media files themselves are not copied (too big: use a second disk).
#
#  sudo bash scripts/backup.sh install     install + a first backup now
#  sudo bash scripts/backup.sh now         one backup now
#  sudo bash scripts/backup.sh status      last backups + next run
#  sudo bash scripts/backup.sh restore <nexus-db-….dump[.gpg]>   put a backup back
#  sudo bash scripts/backup.sh uninstall   stop (the backups are kept)
#  sudo bash scripts/backup.sh drive       send every backup to Google Drive (once)
#  sudo bash scripts/backup.sh drive get [AAAA-MM-JJ]   fetch a backup from Drive
#  sudo bash scripts/backup.sh drive off   stop sending (what is on Drive stays)
#  sudo bash scripts/backup.sh serveur     the whole server too, every night (once)
#  sudo bash scripts/backup.sh serveur off stop copying the whole server
#
#  The whole server (« serveur », needs « drive »): every night a copy of everything needed to
#  rebuild it on a new machine with scripts/restaurer-serveur.sh — /etc, /home, /root, /opt, /srv,
#  /usr/local, /var (its useful part), /media/scripts, every database (pg_dumpall), the list of the
#  packages, services, disks and of the media files. restic: encrypted with the same passphrase,
#  only what changed is sent, 7 daily, 4 weekly and 6 monthly copies kept (« serveur/ » on Drive,
#  with restaurer-serveur.sh and LISEZ-MOI.txt next to it). Left out: what the system and its
#  packages give back (/usr, /boot…), caches, node_modules and venvs (rebuilt), the media files
#  themselves (only their list) and any file over 1 GB (listed).
#
#  Options (in /etc/default/nexus-backup): BACKUP_DIR=/var/backups/nexus,
#  KEEP=14, COPY_TO=/mnt/disque2/nexus-backups (a copy on another disk),
#  DRIVE_REMOTE (written by « drive »), SERVER_BACKUP=1 (written by « serveur »),
#  SERVER_MAX_FILE=1G (bigger files are left out of the server copy, and listed)
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

NAME=nexus-backup
BIN=/usr/local/sbin/$NAME
CONF=${NEXUS_BACKUP_CONF:-/etc/default/$NAME}
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/nexus}
KEEP=${KEEP:-14}
COPY_TO=${COPY_TO:-}
DRIVE_REMOTE=${DRIVE_REMOTE:-}
# Google Drive: rclone's connection (its token) and the passphrase, root only
DRIVE_DIR=${DRIVE_DIR:-/etc/nexus-backup}
RCLONE_CONF="$DRIVE_DIR/rclone.conf"
PASSFILE="$DRIVE_DIR/passphrase"
DRIVE_NAME=nexus-drive
DRIVE_FOLDER="Sauvegardes Nexus"
DRIVE_STATE="$BACKUP_DIR/.drive-state"
# The installation: where this script is (from the repository), or the one saved at install
NEXUS_DIR=${NEXUS_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}
# The whole server (« serveur »)
SERVER_BACKUP=${SERVER_BACKUP:-0}
SERVER_ROOT=${SERVER_ROOT:-/}
SERVER_DIR=${SERVER_DIR:-${SERVER_ROOT%/}/var/backups/nexus-server}
SERVER_MAX_FILE=${SERVER_MAX_FILE:-1G}
SERVER_STATE="$BACKUP_DIR/.server-state"
SERVER_TAG=nexus-serveur
# Never in the server copy: what the system or its packages give back, what is not a file
SERVER_SKIP_TOP=" proc sys dev run tmp mnt media lost+found boot usr bin sbin lib lib32 lib64 libx32 snap cdrom swap.img swapfile "

need_root() { [ "$(id -u)" -eq 0 ] || { echo "❌ Lance-le avec sudo : sudo bash scripts/backup.sh $1"; exit 1; }; }

# DB_NAME from backend/.env (one line, never the rest of the file), else « nexus »
db_name() {
  local v
  v=$({ grep -E '^DB_NAME=' "$NEXUS_DIR/backend/.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | tr -d "\"' \r")
  [[ $v =~ ^[A-Za-z0-9_]+$ ]] && echo "$v" || echo nexus
}

as_postgres() { runuser -u postgres -- "$@"; }

# KEY=value in $CONF (replaced; an empty value removes the line)
set_conf() {
  touch "$CONF"; chmod 644 "$CONF"
  sed -i "/^$1=/d" "$CONF"
  if [ -n "$2" ]; then printf '%s=%q\n' "$1" "$2" >> "$CONF"; fi
}

# ─── Encryption (gpg, symmetric AES-256) ─────────────────────────────
# A throw-away gpg home each time: nothing cached, nothing left behind
gpg_run() {
  local home rc=0
  home=$(mktemp -d)
  gpg --homedir "$home" --batch --yes --quiet --no-symkey-cache --pinentry-mode loopback "$@" || rc=$?
  gpgconf --homedir "$home" --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$home"
  return $rc
}
encrypt() { gpg_run --passphrase-file "$PASSFILE" --symmetric --cipher-algo AES256 --output "$2" "$1"; }
# $1 encrypted file, $2 output, $3 passphrase file
decrypt() { gpg_run --passphrase-file "$3" --output "$2" --decrypt "$1"; }

# A passphrase typed now, in a private temporary file (the caller removes it)
typed_passfile() {
  local pp f
  read -r -s -p "Phrase de passe des sauvegardes : " pp; echo >&2
  f=$(mktemp); chmod 600 "$f"; printf '%s' "$pp" > "$f"
  echo "$f"
}

# ─── Google Drive (rclone) ───────────────────────────────────────────
rclone_() { rclone --config "$RCLONE_CONF" -q "$@"; }
drive_ready() { [ -n "$DRIVE_REMOTE" ] && command -v rclone >/dev/null && [ -s "$RCLONE_CONF" ]; }
# The backups on Drive (names only), newest first; $1: db | settings
drive_list() {
  { rclone_ lsf --files-only "$DRIVE_REMOTE" 2>/dev/null || true; } \
    | { grep -E "^nexus-$1-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}[A-Za-z0-9-]*\.[a-z.]+\.gpg$" || true; } | sort -r
}

# The backup just made, encrypted, to Drive; then only the last KEEP of each there.
# Never fails the backup itself: what went wrong is kept for « status ».
drive_send() {
  [ -n "$DRIVE_REMOTE" ] || return 0
  local when tmp f out err=''
  when=$(date '+%F %T')
  if ! drive_ready || [ ! -s "$PASSFILE" ]; then
    err="Google Drive n'est plus configuré (sudo bash scripts/backup.sh drive)"
  else
    tmp=$(mktemp -d)
    for f in "$@"; do
      [ -e "$f" ] || continue
      out="$tmp/$(basename "$f").gpg"
      if ! encrypt "$f" "$out"; then err="chiffrement impossible"; break; fi
      if ! rclone_ copyto "$out" "$DRIVE_REMOTE/$(basename "$out")" 2>"$tmp/err"; then
        err=$(tail -1 "$tmp/err" | sed -E 's#^[0-9/]+ [0-9:]+ ([A-Z]+ *: *)?##' | cut -c1-300); err=${err:-envoi refusé}; break
      fi
    done
    rm -rf "$tmp"
  fi
  if [ -n "$err" ]; then
    echo "échec le $when : $err" > "$DRIVE_STATE"
    echo "⚠️  Pas envoyée sur Google Drive : $err" >&2
    return 0
  fi
  local kind
  for kind in db settings; do
    drive_list "$kind" | tail -n +$((KEEP + 1)) | while read -r f; do
      rclone_ deletefile "$DRIVE_REMOTE/$f" 2>/dev/null || true
    done
  done
  echo "envoyée le $when" > "$DRIVE_STATE"
  echo "☁️  Envoyée sur Google Drive, chiffrée (« ${DRIVE_REMOTE#*:} »)"
}

# ─── The whole server (restic, encrypted, next to the backups on Drive) ──
restic_() {
  RCLONE_CONFIG="$RCLONE_CONF" RESTIC_PASSWORD_FILE="$PASSFILE" restic -r "rclone:$DRIVE_REMOTE/serveur" "$@"
}

# What is copied: every folder at the root but the system's own, plus the parts of /usr and /media
# that are not the system's or the library's
server_targets() {
  local R=${SERVER_ROOT%/} e
  for e in "$R"/*; do
    if [ ! -d "$e" ] || [ -L "$e" ]; then continue; fi
    case "$SERVER_SKIP_TOP" in *" ${e##*/} "*) continue ;; esac
    echo "$e"
  done
  for e in "$R/usr/local" "$R/usr/share/keyrings" "$R/media/scripts"; do
    if [ -d "$e" ]; then echo "$e"; fi
  done
}

server_excludes() {
  local R=${SERVER_ROOT%/} p
  for p in /var/cache /var/tmp /var/crash /var/lib/apt/lists /var/lib/postgresql /var/lib/docker/overlay2 \
           /var/lib/docker/image /var/lib/docker/containers /var/lib/containerd /var/lib/snapd \
           /var/lib/systemd/coredump /var/log/journal; do
    echo "--exclude=$R$p"
  done
  # (already on Drive; sent again each day; written again each day)
  for p in "$BACKUP_DIR" "$NEXUS_DIR/transfers" "$NEXUS_DIR/logs"; do
    case "$p" in "$R"/*) echo "--exclude=$p" ;; *) echo "--exclude=$R$p" ;; esac
  done
  # Rebuilt by restaurer-serveur.sh, or not worth keeping
  for p in node_modules .cache .npm .venv venv __pycache__ .local/share/Trash .pm2/logs '.part-*'; do
    echo "--exclude=$p"
  done
}

# What the copy alone does not say: packages, services, disks, every database, the media files' list
server_manifest() {
  local R=${SERVER_ROOT%/} M="$SERVER_DIR/manifest" owner targets
  mapfile -t targets < <(server_targets)
  rm -rf "$M"; install -d -m 700 "$SERVER_DIR" "$M"
  {
    echo "Copie du serveur faite le $(date '+%F %T %Z')"
    echo "Nom : $(hostname)"
    grep -E '^(PRETTY_NAME|VERSION_ID)=' "$R/etc/os-release" 2>/dev/null || true
    echo "Noyau : $(uname -r)"
    echo "Fuseau horaire : $(cat "$R/etc/timezone" 2>/dev/null || true)"
    echo "Nexus : $NEXUS_DIR ($(git -C "$NEXUS_DIR" rev-parse --short HEAD 2>/dev/null || echo '?'))"
  } > "$M/systeme.txt"
  printf '%s\n' "$SERVER_ROOT" > "$M/racine.txt"
  { lsblk -f 2>/dev/null; echo; df -hT 2>/dev/null; } > "$M/disques.txt" || true
  findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS > "$M/montages.txt" 2>/dev/null || true
  apt-mark showmanual > "$M/paquets-manuels.txt" 2>/dev/null || true
  dpkg-query -W -f '${Package}\t${Version}\n' > "$M/paquets-tous.txt" 2>/dev/null || true
  if command -v snap >/dev/null; then snap list > "$M/snaps.txt" 2>/dev/null || true; fi
  if command -v npm >/dev/null; then
    { npm ls -g --depth=0 --parseable 2>/dev/null || true; } | sed -n 's#.*/node_modules/##p' | { grep -vx 'npm\|corepack' || true; } > "$M/npm-global.txt"
  fi
  systemctl list-unit-files --state=enabled --no-legend --no-pager 2>/dev/null | awk '{print $1}' > "$M/services-actifs.txt" || true
  if command -v docker >/dev/null; then
    { docker ps -a 2>&1; echo; docker images 2>&1; echo; docker volume ls 2>&1; } > "$M/docker.txt" || true
  fi
  # Rebuilt after a restore (from the requirements.txt / package-lock.json next to them)
  { find "${targets[@]}" -xdev -type d \( -name node_modules -o -name .venv -o -name venv \) -prune -print 2>/dev/null || true; } > "$M/a-reconstruire.txt"
  # Left out because too big: listed, to fetch again
  { find "${targets[@]}" -xdev -type f -size "+$SERVER_MAX_FILE" -not -path '*/node_modules/*' -printf '%s\t%p\n' 2>/dev/null || true; } > "$M/gros-fichiers.txt"
  # The media library: only its list (the files stay on their disks)
  { find "$R/media" "$R/mnt" -path "$R/media/scripts" -prune -o -type f -printf '%s\t%p\n' 2>/dev/null || true; } | gzip > "$M/mediatheque.txt.gz"
  # pm2's processes, saved where « pm2 resurrect » reads them
  owner=$(stat -c %U "$NEXUS_DIR" 2>/dev/null || true)
  if [ -n "$owner" ] && [ "$owner" != root ] && command -v pm2 >/dev/null; then
    runuser -u "$owner" -- pm2 save --force >/dev/null 2>&1 || true
  fi
  # Every database (Nexus, Jarvis…) and its roles: a consistent dump, never the live files
  if command -v pg_dumpall >/dev/null \
     && as_postgres pg_dumpall --clean --if-exists 2>"$M/postgres-erreurs.txt" | gzip > "$SERVER_DIR/postgres.sql.gz.part"; then
    mv "$SERVER_DIR/postgres.sql.gz.part" "$SERVER_DIR/postgres.sql.gz"; rm -f "$M/postgres-erreurs.txt"
  else
    rm -f "$SERVER_DIR/postgres.sql.gz.part"
    echo "⚠️  Bases PostgreSQL non copiées : $(tail -1 "$M/postgres-erreurs.txt" 2>/dev/null)" >&2
  fi
}

# The copy of the whole server, then only the copies kept (7 days, 4 weeks, 6 months).
# Never fails the backup itself; one at a time.
server_snapshot() {
  [ "$SERVER_BACKUP" = 1 ] || return 0
  local when out rc=0 added targets excludes
  when=$(date '+%F %T')
  if ! drive_ready || [ ! -s "$PASSFILE" ] || ! command -v restic >/dev/null; then
    echo "échec le $when : Google Drive ou restic manquant (sudo bash scripts/backup.sh serveur)" > "$SERVER_STATE"
    echo "⚠️  Copie du serveur impossible : Google Drive ou restic manquant" >&2
    return 0
  fi
  exec 9>"$BACKUP_DIR/.server.lock"
  if ! flock -n 9; then echo "⏭  Copie du serveur déjà en cours"; return 0; fi
  echo "🖥  Copie du serveur…"
  server_manifest
  if ! restic_ cat config >/dev/null 2>&1 && ! restic_ init >/dev/null 2>&1; then
    echo "échec le $when : dépôt « serveur » impossible à créer sur Google Drive" > "$SERVER_STATE"
    echo "⚠️  Copie du serveur impossible : dépôt impossible à créer sur Google Drive" >&2
    return 0
  fi
  mapfile -t targets < <(server_targets)
  mapfile -t excludes < <(server_excludes)
  out=$(mktemp)
  # (progress in the journal every minute: « status » shows it)
  RESTIC_PROGRESS_FPS=0.0166 restic_ backup --one-file-system --exclude-caches --exclude-larger-than "$SERVER_MAX_FILE" \
    --tag "$SERVER_TAG" "${excludes[@]}" "${targets[@]}" > "$out" 2>&1 || rc=$?
  # 3: saved, but some files could not be read
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then
    echo "échec le $when : $(grep -v '^\[' "$out" | tail -1 | cut -c1-250)" > "$SERVER_STATE"
    echo "⚠️  Copie du serveur ratée : $(tail -1 "$out")" >&2
    rm -f "$out"; return 0
  fi
  added=$(sed -n 's/^Added to the repository: \([^(]*\).*/\1/p' "$out" | tail -1 | sed 's/ *$//')
  rm -f "$out"
  local prune=()
  if [ "$(date +%u)" = 7 ]; then prune=(--prune); fi
  restic_ forget --tag "$SERVER_TAG" --keep-daily 7 --keep-weekly 4 --keep-monthly 6 "${prune[@]}" >/dev/null 2>&1 || true
  # What rebuilds it, next to it (no secret in them)
  local f
  for f in restaurer-serveur.sh LISEZ-MOI-restauration.txt; do
    if [ -f "$NEXUS_DIR/scripts/$f" ]; then
      rclone_ copyto "$NEXUS_DIR/scripts/$f" "$DRIVE_REMOTE/${f/LISEZ-MOI-restauration/LISEZ-MOI}" 2>/dev/null || true
    fi
  done
  local note=''
  if [ "$rc" = 3 ]; then note=', quelques fichiers illisibles laissés'; fi
  echo "copiée le $when (${added:-?} envoyés$note)" > "$SERVER_STATE"
  echo "✅ Serveur copié sur Google Drive (${added:-?} envoyés)"
}

server_setup() {
  need_root serveur
  if ! drive_ready || [ ! -s "$PASSFILE" ]; then
    echo "❌ Connecte d'abord Google Drive : sudo bash scripts/backup.sh drive"; exit 1
  fi
  if ! command -v restic >/dev/null; then
    echo "📦 Installation de restic…"
    apt-get install -y -qq restic >/dev/null 2>&1 \
      || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq restic >/dev/null 2>&1; } \
      || { echo "❌ Installation impossible : sudo apt-get install -y restic"; exit 1; }
  fi
  echo "🖥  Copie complète du serveur sur Google Drive"
  echo ""
  echo "   Chaque nuit, tout ce qu'il faut pour reconstruire ce serveur sur une nouvelle machine"
  echo "   (scripts/restaurer-serveur.sh) : réglages (/etc), dossiers des comptes, /opt (Nexus, Jarvis…),"
  echo "   /srv, /usr/local, toutes les bases de données, la liste des paquets, services et disques."
  echo "   Chiffrée avec ta phrase de passe ; seul ce qui a changé repart les nuits suivantes."
  echo "   Pas copiés : les films / séries / mangas eux-mêmes (leur liste oui), ce que les paquets"
  echo "   redonnent, les caches, et tout fichier de plus de $SERVER_MAX_FILE (listés)."
  echo ""
  local est free ans=''
  if ! restic_ cat config >/dev/null 2>&1 && ! restic_ init >/dev/null 2>&1; then
    echo "❌ Impossible de créer le dépôt sur Google Drive"; exit 1
  fi
  echo "📏 Calcul de la taille…"
  local targets excludes
  mapfile -t targets < <(server_targets)
  mapfile -t excludes < <(server_excludes)
  est=$(restic_ backup --dry-run --one-file-system --exclude-caches --exclude-larger-than "$SERVER_MAX_FILE" \
          "${excludes[@]}" "${targets[@]}" 2>/dev/null | sed -n 's/^Would add to the repository: \([^(]*\).*/\1/p' | tail -1 | sed 's/ *$//')
  free=$(rclone_ about "$DRIVE_NAME:" --json 2>/dev/null | sed -n 's/.*"free": *\([0-9]*\).*/\1/p' | head -1)
  echo "   À envoyer la première fois : ${est:-?} (avant compression)"
  if [ -n "$free" ]; then echo "   Place libre sur Google Drive : $(numfmt --to=iec-i --suffix=B "$free" 2>/dev/null || echo "$free octets")"; fi
  read -r -p "Continuer ? (O/n) " ans
  if [[ $ans =~ ^[nN] ]]; then echo "Annulé."; exit 0; fi
  set_conf SERVER_BACKUP 1
  SERVER_BACKUP=1
  write_units
  echo ""
  if systemctl start --no-block $NAME.service 2>/dev/null; then
    echo "✅ La première copie part maintenant, en arrière-plan : elle peut prendre plusieurs heures"
    echo "   (ensuite, seul ce qui a changé). Suis-la avec : sudo bash scripts/backup.sh status"
  else
    do_backup
  fi
  echo "   Pour reconstruire le serveur : « LISEZ-MOI.txt » dans « $DRIVE_FOLDER » sur Google Drive."
}

server_off() {
  need_root "serveur off"
  set_conf SERVER_BACKUP ''
  echo "Copie du serveur arrêtée : celles déjà sur Google Drive (« $DRIVE_FOLDER/serveur ») y restent."
}

# ─── Backups ─────────────────────────────────────────────────────────
# $1: a label for the file names (« avant-restauration », « avant-mise-a-jour »)
do_backup() {
  need_root now
  local label=${1:-}
  [[ $KEEP =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ] || { echo "❌ KEEP doit être un nombre"; exit 1; }
  [ -z "$label" ] || [[ $label =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || { echo "❌ Étiquette invalide : $label"; exit 1; }
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
  # (+ the admin account scripts, kept on this server only, out of Git)
  for f in backend/.env backend/data scripts/create-admin.sh scripts/delete-account.sh; do
    if [ -e "$NEXUS_DIR/$f" ]; then items+=("$f"); fi
  done
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
  drive_send "$dump" "$files"
  if [ -z "$label" ]; then server_snapshot; fi
}

# This script in /usr/local/sbin and the nightly timer
write_units() {
  [ "$(readlink -f "$0")" = "$BIN" ] || install -m 755 "$(readlink -f "$0")" "$BIN"
  # The installation's folder, for the copy in /usr/local/sbin
  if ! grep -qs '^NEXUS_DIR=' "$CONF"; then
    printf '# Nexus backups (scripts/backup.sh)\nNEXUS_DIR=%q\n' "$NEXUS_DIR" >> "$CONF"
  fi
  chmod 644 "$CONF"

  cat > /etc/systemd/system/$NAME.service <<EOF
[Unit]
Description=Nexus backup (database + settings)
Wants=network-online.target
After=postgresql.service network-online.target

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=24h
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
}

do_install() {
  need_root install
  command -v pg_dump >/dev/null || { echo "❌ pg_dump introuvable (paquet postgresql-client)"; exit 1; }
  write_units
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
  echo ""
  if [ -n "$DRIVE_REMOTE" ]; then
    echo "Google Drive (« ${DRIVE_REMOTE#*:} ») : dernière $(cat "$DRIVE_STATE" 2>/dev/null || echo 'pas encore envoyée')"
    if drive_ready; then drive_list db | head -5 | sed 's/^/  /'; fi
  else
    echo "Google Drive : non (pour y envoyer chaque sauvegarde : sudo bash scripts/backup.sh drive)"
  fi
  echo ""
  if [ "$SERVER_BACKUP" = 1 ]; then
    echo "Copie du serveur : dernière $(cat "$SERVER_STATE" 2>/dev/null || echo 'pas encore faite')"
    if systemctl is-active --quiet $NAME.service 2>/dev/null; then
      echo "  en cours : $(journalctl -u $NAME.service -n 1 -o cat --no-pager 2>/dev/null | cut -c1-150)"
    elif drive_ready && command -v restic >/dev/null; then
      restic_ snapshots --tag $SERVER_TAG --compact 2>/dev/null | grep -E '^[0-9a-f]{8} ' | tail -3 | sed 's/^/  /' || true
    fi
  else
    echo "Copie du serveur : non (pour pouvoir le reconstruire : sudo bash scripts/backup.sh serveur)"
  fi
  echo ""
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
  if [[ $file == *.gpg ]]; then
    # One from Google Drive: opened with the passphrase of this server, else the one typed now
    local pf=$PASSFILE typed=''
    if [ ! -s "$pf" ]; then typed=$(typed_passfile); pf=$typed; fi
    if ! decrypt "$file" "$RESTORE_COPY" "$pf"; then
      [ -z "$typed" ] || rm -f "$typed"
      echo "❌ Impossible d'ouvrir $(basename "$file") : mauvaise phrase de passe ?"; exit 1
    fi
    [ -z "$typed" ] || rm -f "$typed"
  else
    cp -- "$file" "$RESTORE_COPY"
  fi
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

# ─── Google Drive: set up once ───────────────────────────────────────
ensure_tools() {
  if ! command -v rclone >/dev/null || ! command -v gpg >/dev/null; then
    echo "📦 Installation de rclone et gnupg…"
    apt-get install -y -qq rclone gnupg >/dev/null 2>&1 \
      || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq rclone gnupg >/dev/null 2>&1; } \
      || { echo "❌ Installation impossible : sudo apt-get install -y rclone gnupg"; exit 1; }
  fi
  local v major=0 minor=0
  v=$(rclone version 2>/dev/null | head -1 || true)
  if [[ $v =~ ^rclone\ v([0-9]+)\.([0-9]+) ]]; then major=${BASH_REMATCH[1]}; minor=${BASH_REMATCH[2]}; fi
  if [ "$major" -lt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -lt 55 ]; }; then
    echo "❌ rclone $major.$minor est trop ancien (1.55 au moins). Installe la dernière version :"
    echo "   sudo -v ; curl https://rclone.org/install.sh | sudo bash"
    exit 1
  fi
}

# What was pasted (the address the browser could not open, or just its code) → the query
# for rclone, which waits on this server. Never another address than rclone's own.
local_query() {
  local p q
  p=$(printf '%s' "$1" | tr -d '[:space:]')
  if [[ $p == *\?* ]]; then
    [[ ${p%%\?*} =~ ^(https?://)?(127\.0\.0\.1|localhost):53682/?$ ]] || return 1
    q=${p#*\?}
  else
    [[ $p =~ ^[A-Za-z0-9/_.%-]{10,}$ ]] || return 1
    q="state=$2&code=${p//\//%2F}"
  fi
  [[ $q =~ ^[A-Za-z0-9._~%/:\&=+-]+$ && $q == *code=* ]] || return 1
  printf '%s' "$q"
}

# The Google account: rclone's connection, scope « drive.file » (rclone only sees the files it
# created: never the rest of the Drive). Works from any device: the link is opened on the phone or
# the computer, and the address it ends on is pasted here.
drive_connect() {
  local attempt log new pid link state google pasted query mask
  new="$DRIVE_DIR/rclone.conf.new"
  mask=$(umask)
  # A connection left waiting by an earlier run (stopped with Ctrl+C) still holds rclone's port
  if pkill -f "rclone config create $DRIVE_NAME drive" 2>/dev/null; then sleep 1; fi
  for attempt in 1 2 3; do
    log=$(mktemp); rm -f "$new"
    umask 077
    timeout 900 rclone config create "$DRIVE_NAME" drive scope=drive.file config_is_local=true \
      --config "$new" </dev/null >"$log" 2>&1 &
    pid=$!
    umask "$mask"
    # Stopped here (Ctrl+C, closed terminal): the waiting rclone goes too
    trap 'kill "$pid" 2>/dev/null; rm -f "$log" "$new"' EXIT
    trap 'exit 130' INT TERM HUP
    link=''
    for _ in $(seq 1 60); do
      link=$({ grep -o 'http://127\.0\.0\.1:53682/auth?state=[A-Za-z0-9_-]*' "$log" || true; } | head -1)
      [ -n "$link" ] && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if [ -z "$link" ]; then
      echo "❌ rclone n'a pas démarré la connexion :"; tail -3 "$log"; rm -f "$log"; exit 1
    fi
    state=${link##*state=}
    google=$(curl -s -o /dev/null -w '%{redirect_url}' "$link" || true)
    echo ""
    echo "1. Ouvre ce lien, choisis ton compte Google et autorise « rclone » (l'outil qui envoie les"
    echo "   fichiers ; il ne voit que les fichiers qu'il crée). Dans le Terminal de Nexus : le bouton"
    echo "   « Ouvrir accounts.google.com » en bas (le lien est trop long pour être touché sur iPhone)."
    echo ""
    echo "$google"
    echo ""
    echo "2. Le navigateur arrive ensuite sur une page qui ne s'ouvre pas (« 127.0.0.1 ») : c'est normal."
    echo "   Copie toute l'adresse de cette page (sur iPhone : touche la barre d'adresse, ou Partager ›"
    echo "   Copier) et colle-la ici (Terminal de Nexus : « … » › Coller)."
    while :; do
      read -r -p "Adresse : " pasted
      if query=$(local_query "$pasted" "$state"); then break; fi
      if [[ $pasted == *google* ]]; then
        echo "   Ça, c'est un morceau du lien Google. Touche « Ouvrir accounts.google.com » en bas, autorise"
        echo "   rclone, puis copie l'adresse de la page qui ne s'ouvre pas et colle-la ici."
      else
        echo "   Ce n'est pas l'adresse attendue : celle de la page qui ne s'ouvre pas, qui commence par"
        echo "   « 127.0.0.1:53682/?state= »."
      fi
    done
    curl -s --max-time 30 -o /dev/null "http://127.0.0.1:53682/?$query" || true
    if wait "$pid" && grep -qs '^token = ' "$new"; then
      trap - EXIT INT TERM HUP
      mv "$new" "$RCLONE_CONF"; chmod 600 "$RCLONE_CONF"; rm -f "$log"
      echo "✅ Google Drive connecté"
      return 0
    fi
    echo "❌ Google n'a pas accepté : $({ grep -iE 'error|expecting' "$log" || true; } | tail -1 | cut -c1-200)"
    rm -f "$log" "$new"
    [ "$attempt" -lt 3 ] && echo "   On recommence avec un nouveau lien."
  done
  exit 1
}

# The passphrase: the one already on this server, or the one of the backups already on Drive
# (checked on the newest), or a new one (typed or made up)
drive_passphrase() {
  local newest tmp pp pp2
  newest=$(drive_list settings | head -1)
  [ -n "$newest" ] || newest=$(drive_list db | head -1)
  tmp=$(mktemp -d)
  opens() { [ -z "$newest" ] && return 0; [ -s "$tmp/f.gpg" ] || rclone_ copyto "$DRIVE_REMOTE/$newest" "$tmp/f.gpg" || return 1; decrypt "$tmp/f.gpg" /dev/null "$1" 2>/dev/null; }
  if [ -s "$PASSFILE" ] && opens "$PASSFILE"; then
    rm -rf "$tmp"; echo "🔑 Phrase de passe : celle déjà enregistrée sur ce serveur"; return 0
  fi
  if [ -n "$newest" ]; then
    echo ""
    echo "🔑 Des sauvegardes de Nexus sont déjà sur ce Google Drive : tape leur phrase de passe."
    for _ in 1 2 3; do
      read -r -s -p "Phrase de passe : " pp; echo
      printf '%s' "$pp" > "$tmp/p"
      if opens "$tmp/p"; then
        install -m 600 "$tmp/p" "$PASSFILE"; rm -rf "$tmp"; echo "✅ Elle ouvre les sauvegardes déjà sur Drive"; return 0
      fi
      echo "   Elle n'ouvre pas $newest."
    done
    rm -rf "$tmp"
    echo "❌ Pour repartir de zéro, supprime le dossier « $DRIVE_FOLDER » sur Google Drive puis relance."
    exit 1
  fi
  echo ""
  echo "🔑 Les sauvegardes sont chiffrées avant de partir : choisis une phrase de passe (12 caractères au moins),"
  echo "   ou laisse vide pour en générer une."
  while :; do
    read -r -s -p "Phrase de passe : " pp; echo
    if [ -z "$pp" ]; then pp=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24); echo "   Générée : $pp"; break; fi
    if [ ${#pp} -lt 12 ]; then echo "   Trop courte (12 caractères au moins)."; continue; fi
    read -r -s -p "Encore une fois : " pp2; echo
    [ "$pp" = "$pp2" ] && break
    echo "   Les deux ne sont pas pareilles."
  done
  printf '%s' "$pp" > "$tmp/p"; install -m 600 "$tmp/p" "$PASSFILE"; rm -rf "$tmp"
  echo "   ⚠️  Note-la (dans ton gestionnaire de mots de passe) : sans elle, les sauvegardes sur Drive ne"
  echo "   s'ouvrent pas. Elle est aussi gardée sur ce serveur ($PASSFILE, root seulement)."
}

drive_setup() {
  need_root drive
  ensure_tools
  install -d -m 700 "$DRIVE_DIR"
  echo "☁️  Sauvegardes sur Google Drive"
  DRIVE_REMOTE="$DRIVE_NAME:$DRIVE_FOLDER"
  local again=n
  if [ -s "$RCLONE_CONF" ] && rclone_ lsf --max-depth 1 "$DRIVE_NAME:" >/dev/null 2>&1; then
    read -r -p "Google Drive est déjà connecté. Connecter un autre compte ? (o/N) " again
  else
    again=o
  fi
  if [[ $again =~ ^[oOyY] ]]; then drive_connect; fi
  drive_passphrase
  set_conf DRIVE_REMOTE "$DRIVE_REMOTE"
  echo ""
  if [ -e /etc/systemd/system/$NAME.timer ]; then
    write_units
    do_backup
  else
    do_install
  fi
  if grep -qs '^envoyée' "$DRIVE_STATE"; then
    echo ""
    echo "✅ Chaque sauvegarde part maintenant, chiffrée, dans « $DRIVE_FOLDER » sur ton Google Drive"
    echo "   (chaque nuit et avant chaque mise à jour de la base ; les $KEEP dernières y restent)."
  fi
}

drive_off() {
  need_root "drive off"
  set_conf DRIVE_REMOTE ''
  rm -f "$RCLONE_CONF"
  echo "Envoi vers Google Drive arrêté : les sauvegardes déjà sur Drive y restent, la phrase de passe"
  echo "reste dans $PASSFILE. L'accès de rclone se retire aussi dans ton compte Google :"
  echo "https://myaccount.google.com/connections"
}

# A backup from Drive (the newest, or the one of a day / a name) into BACKUP_DIR, opened
drive_get() {
  need_root "drive get"
  drive_ready || { echo "❌ Google Drive n'est pas connecté : sudo bash scripts/backup.sh drive"; exit 1; }
  local db stamp pf=$PASSFILE typed='' f tmp
  db=$(drive_list db | { grep -F -- "${1:-}" || true; } | head -1)
  [ -n "$db" ] || { echo "❌ Aucune sauvegarde${1:+ « $1 »} sur Google Drive"; drive_list db | head -10 | sed 's/^/  /'; exit 1; }
  stamp=${db#nexus-db-}; stamp=${stamp%%.*}
  if [ ! -s "$pf" ]; then typed=$(typed_passfile); pf=$typed; fi
  install -d -m 700 "$BACKUP_DIR"
  tmp=$(mktemp -d)
  for f in "nexus-db-$stamp.dump.gpg" "nexus-settings-$stamp.tar.gz.gpg"; do
    rclone_ copyto "$DRIVE_REMOTE/$f" "$tmp/$f" 2>/dev/null || continue
    if ! (umask 077; decrypt "$tmp/$f" "$BACKUP_DIR/${f%.gpg}" "$pf"); then
      rm -rf "$tmp"; [ -z "$typed" ] || rm -f "$typed"
      echo "❌ Impossible d'ouvrir $f : mauvaise phrase de passe ?"; exit 1
    fi
    echo "⬇️  $BACKUP_DIR/${f%.gpg}"
  done
  rm -rf "$tmp"; [ -z "$typed" ] || rm -f "$typed"
  echo ""
  echo "Pour la remettre :"
  echo "   sudo bash scripts/backup.sh restore $BACKUP_DIR/nexus-db-$stamp.dump"
  if [ -e "$BACKUP_DIR/nexus-settings-$stamp.tar.gz" ]; then
    echo "   Réglages (.env, clés), sur une nouvelle installation : sudo tar -xzf $BACKUP_DIR/nexus-settings-$stamp.tar.gz -C $NEXUS_DIR"
  fi
}

case "${1:-}" in
  install)   do_install ;;
  now)       do_backup "${2:-}" ;;
  status)    do_status ;;
  restore)   do_restore "${2:-}" ;;
  uninstall) do_uninstall ;;
  drive)
    case "${2:-}" in
      '')  drive_setup ;;
      get) drive_get "${3:-}" ;;
      off) drive_off ;;
      *)   echo "Usage : sudo bash scripts/backup.sh drive [get [AAAA-MM-JJ] | off]"; exit 1 ;;
    esac ;;
  serveur)
    case "${2:-}" in
      '')  server_setup ;;
      off) server_off ;;
      *)   echo "Usage : sudo bash scripts/backup.sh serveur [off]"; exit 1 ;;
    esac ;;
  *) sed -n '3,40p' "$0" | sed 's/^# \{0,2\}//'; exit 1 ;;
esac
