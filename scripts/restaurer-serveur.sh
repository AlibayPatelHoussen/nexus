#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — rebuild a whole server from its copy on Google Drive
#  (the copy made every night by « sudo bash scripts/backup.sh serveur »)
#
#  On a NEW machine with Ubuntu (the same version as the old one, ideally), as root:
#    sudo bash restaurer-serveur.sh             the newest copy
#    sudo bash restaurer-serveur.sh <id>        another one (the list is shown)
#
#  1. Google Drive: the same connection as « backup.sh drive » (a link to open on any device,
#     the address it ends on pasted here), then the passphrase of the backups.
#  2. The copy is brought back into /var/restauration-nexus (nothing changed yet), what it holds
#     is shown, and nothing is done before « RESTAURER » is typed.
#  3. Then: apt sources and the packages that were installed, the accounts (same ids, same
#     passwords), the files (/etc, /home, /root, /opt, /srv, /usr/local, /var, /media/scripts),
#     owners put right, every database, Nexus rebuilt (npm, pm2), Python venvs and node_modules
#     rebuilt, the services switched on, the disks still there mounted again, the server's name.
#  Everything is written to /root/restauration-nexus-<date>.log; what could not be done is listed
#  at the end. Then: sudo reboot.
#
#  Not in the copy (see LISEZ-MOI.txt): the media files themselves (their list is in
#  /var/backups/nexus-server/manifest/mediatheque.txt.gz) and files over 1 GB (gros-fichiers.txt).
#  For tests only: RESTORE_ROOT (where to write instead of /), RESTORE_STEPS (which steps).
# ══════════════════════════════════════════════════════════════════════
set -uo pipefail

DRIVE_DIR=${DRIVE_DIR:-/etc/nexus-backup}
RCLONE_CONF="$DRIVE_DIR/rclone.conf"
PASSFILE="$DRIVE_DIR/passphrase"
DRIVE_NAME=nexus-drive
DRIVE_FOLDER=${DRIVE_FOLDER:-Sauvegardes Nexus}
DRIVE_REMOTE="$DRIVE_NAME:$DRIVE_FOLDER"
STAGE=${STAGE:-/var/restauration-nexus}
ROOT=${RESTORE_ROOT:-/}
R=${ROOT%/}
STEPS=${RESTORE_STEPS:-packages users files owners postgres rebuild services disks hostname}
LOG=${RESTORE_LOG:-/root/restauration-nexus-$(date +%Y%m%d-%H%M%S).log}
SNAP=${1:-latest}
PROBLEMS=()

say()  { echo "$*"; }
step() { echo ""; echo "━━ $* ━━"; }
warn() { echo "⚠️  $*"; PROBLEMS+=("$*"); }
want() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
die()  { echo "❌ $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Lance-le avec sudo : sudo bash restaurer-serveur.sh"
command -v apt-get >/dev/null || die "Ce script est fait pour Ubuntu / Debian (apt)."
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1
say "🛟 Reconstruction du serveur depuis Google Drive — $(date '+%F %T')"
say "   Journal : $LOG"

export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ─── 1. The tools ────────────────────────────────────────────────────
step "Outils"
need=()
for t in rclone restic curl rsync gpg; do command -v "$t" >/dev/null || need+=("$t"); done
if [ ${#need[@]} -gt 0 ]; then
  pk=("${need[@]/gpg/gnupg}")
  say "📦 Installation : ${pk[*]}"
  apt-get update -q >/dev/null 2>&1
  "${APT[@]}" install "${pk[@]}" >/dev/null || die "Installation impossible : sudo apt-get install -y ${pk[*]}"
fi
say "✅ rclone, restic, rsync"

# ─── 2. Google Drive (same as « backup.sh drive ») ───────────────────
rclone_() { rclone --config "$RCLONE_CONF" -q "$@"; }
restic_() { RCLONE_CONFIG="$RCLONE_CONF" RESTIC_PASSWORD_FILE="$PASSFILE" restic -r "rclone:$DRIVE_REMOTE/serveur" "$@"; }

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

drive_connect() {
  local log new pid link state google pasted query
  new="$DRIVE_DIR/rclone.conf.new"
  if pkill -f "rclone config create $DRIVE_NAME drive" 2>/dev/null; then sleep 1; fi
  for _ in 1 2 3; do
    log=$(mktemp); rm -f "$new"
    (umask 077; exec timeout 900 rclone config create "$DRIVE_NAME" drive scope=drive.file config_is_local=true \
      --config "$new" </dev/null >"$log" 2>&1) &
    pid=$!
    trap 'kill "$pid" 2>/dev/null; rm -f "$log" "$new"' EXIT
    link=''
    for _ in $(seq 1 60); do
      link=$({ grep -o 'http://127\.0\.0\.1:53682/auth?state=[A-Za-z0-9_-]*' "$log" || true; } | head -1)
      [ -n "$link" ] && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    [ -n "$link" ] || { tail -3 "$log"; die "rclone n'a pas démarré la connexion"; }
    state=${link##*state=}
    google=$(curl -s -o /dev/null -w '%{redirect_url}' "$link" || true)
    say ""
    say "1. Ouvre ce lien sur ton PC ou ton téléphone (copie-le en entier), choisis ton compte"
    say "   Google et autorise « rclone » :"
    say ""
    say "$google"
    say ""
    say "2. Le navigateur arrive sur une page qui ne s'ouvre pas (« 127.0.0.1 ») : c'est normal."
    say "   Copie toute l'adresse de cette page (sur PC : Ctrl+L puis Ctrl+C) et colle-la ici."
    while :; do
      read -r -p "Adresse : " pasted
      if query=$(local_query "$pasted" "$state"); then break; fi
      say "   Ce n'est pas l'adresse attendue : celle de la page qui ne s'ouvre pas, qui commence par"
      say "   « 127.0.0.1:53682/?state= »."
    done
    curl -s --max-time 30 -o /dev/null "http://127.0.0.1:53682/?$query" || true
    if wait "$pid" && grep -qs '^token = ' "$new"; then
      trap - EXIT
      mv "$new" "$RCLONE_CONF"; chmod 600 "$RCLONE_CONF"; rm -f "$log"
      say "✅ Google Drive connecté"
      return 0
    fi
    say "❌ Google n'a pas accepté : $({ grep -iE 'error|expecting' "$log" || true; } | tail -1 | cut -c1-200)"
    rm -f "$log" "$new"
  done
  die "Connexion à Google Drive impossible"
}

step "Google Drive"
install -d -m 700 "$DRIVE_DIR"
if [ -s "$RCLONE_CONF" ] && rclone_ lsf --max-depth 1 "$DRIVE_NAME:" >/dev/null 2>&1; then
  say "✅ Déjà connecté"
else
  drive_connect
fi

step "Phrase de passe"
if [ ! -s "$PASSFILE" ] || ! restic_ cat config >/dev/null 2>&1; then
  ok=0
  for _ in 1 2 3; do
    read -r -s -p "Phrase de passe des sauvegardes : " pp; echo
    (umask 077; printf '%s' "$pp" > "$PASSFILE")
    if restic_ cat config >/dev/null 2>&1; then ok=1; break; fi
    say "   Elle n'ouvre pas la copie du serveur (« $DRIVE_FOLDER/serveur » sur Google Drive)."
  done
  [ "$ok" = 1 ] || die "Mauvaise phrase de passe (ou pas de copie du serveur sur ce Google Drive)"
fi
say "✅ Elle ouvre la copie du serveur"

# ─── 3. The copy, into a folder apart ────────────────────────────────
step "Copies disponibles"
restic_ snapshots --tag nexus-serveur --compact 2>/dev/null | grep -E '^[0-9a-f]{8} ' | tail -10 | sed 's/^/  /'
say "Copie choisie : $SNAP"
rm -rf "$STAGE"; install -d -m 700 "$STAGE"
say "⬇️  Téléchargement et déchiffrement (peut être long)…"
restic_ restore "$SNAP" --tag nexus-serveur --target "$STAGE" >/dev/null || die "Copie impossible à ramener"
MANIFEST=$(find "$STAGE" -path '*/var/backups/nexus-server/manifest/systeme.txt' -print -quit 2>/dev/null)
[ -n "$MANIFEST" ] || die "La copie ne contient pas sa description (manifest)"
M=$(dirname "$MANIFEST")
SRC=${M%/var/backups/nexus-server/manifest}
say ""
sed 's/^/   /' "$M/systeme.txt"
old_ver=$(sed -n 's/^VERSION_ID="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$M/systeme.txt" | head -1)
new_ver=$(. /etc/os-release 2>/dev/null; echo "${VERSION_ID:-?}")
if [ -n "$old_ver" ] && [ "$old_ver" != "$new_ver" ]; then
  say ""
  say "⚠️  L'ancien serveur avait Ubuntu $old_ver, celui-ci $new_ver : la plupart des choses suivront,"
  say "   mais le mieux est d'installer la même version."
fi
say ""
say "⚠️  Ce serveur va devenir une copie de l'ancien (ses réglages, comptes, fichiers, services)."
read -r -p "Tape RESTAURER pour continuer : " ok
[ "$ok" = "RESTAURER" ] || die "Annulé (la copie reste dans $STAGE)"

old_passwd="$SRC/etc/passwd"; old_group="$SRC/etc/group"; old_shadow="$SRC/etc/shadow"
# A name's id in a passwd / group file
id_in() { awk -F: -v n="$2" '$1 == n { print $3; exit }' "$1" 2>/dev/null; }
prefix=(); [ "$R" = "" ] || prefix=(--prefix "$ROOT")
copy() {   # rsync src/ dst/ (+ options); 23/24: some files could not be copied
  local rc=0
  mkdir -p "$2"
  rsync -aHAX --numeric-ids "${@:3}" "$1/" "$2/" || rc=$?
  if [ "$rc" -ne 0 ]; then warn "copie de ${2#"$R"} incomplète (rsync $rc)"; fi
}

# ─── 4. Packages ─────────────────────────────────────────────────────
if want packages; then
  step "Paquets"
  copy "$SRC/etc/apt" "$R/etc/apt"
  if [ -d "$SRC/usr/share/keyrings" ]; then copy "$SRC/usr/share/keyrings" "$R/usr/share/keyrings"; fi
  apt-get update -q 2>&1 | grep -E '^(E|W):' | sed 's/^/   /' || true
  mapfile -t pkgs < <(grep -v '^\s*$' "$M/paquets-manuels.txt" 2>/dev/null)
  # (one question to apt for them all: one per package takes minutes)
  declare -A cand=()
  while read -r p c; do cand[$p]=$c; done < <(apt-cache policy "${pkgs[@]}" 2>/dev/null \
    | awk '/^[^ ].*:$/ { p = substr($0, 1, length($0) - 1) } /^  Candidate:/ { print p, $2 }')
  avail=(); missing=()
  for p in "${pkgs[@]}"; do
    if [ -n "${cand[$p]:-}" ] && [ "${cand[$p]}" != "(none)" ]; then avail+=("$p"); else missing+=("$p"); fi
  done
  say "📦 ${#avail[@]} paquets à installer…"
  if ! "${APT[@]}" install "${avail[@]}" >/dev/null 2>&1; then
    for p in "${avail[@]}"; do "${APT[@]}" install "$p" >/dev/null 2>&1 || missing+=("$p"); done
  fi
  if [ ${#missing[@]} -gt 0 ]; then warn "paquets non installés : ${missing[*]}"; fi
  if [ -s "$M/snaps.txt" ] && command -v snap >/dev/null; then
    tail -n +2 "$M/snaps.txt" | awk '{print $1}' | grep -vE '^(core[0-9]*|snapd|bare|gtk-common-themes|gnome-.*)$' | while read -r s; do
      snap install "$s" >/dev/null 2>&1 || snap install "$s" --classic >/dev/null 2>&1 || echo "⚠️  snap non installé : $s"
    done
  fi
  if [ -s "$M/npm-global.txt" ] && command -v npm >/dev/null; then
    mapfile -t g < "$M/npm-global.txt"
    if ! npm install -g "${g[@]}" >/dev/null 2>&1; then
      bad=()
      for t in "${g[@]}"; do npm install -g "$t" >/dev/null 2>&1 || bad+=("$t"); done
      if [ ${#bad[@]} -gt 0 ]; then warn "outils npm globaux non installés : ${bad[*]}"; fi
    fi
  fi
  say "✅ Paquets"
fi

# ─── 5. Accounts: same names, same ids, same passwords, same groups ──
if want users; then
  step "Comptes"
  new_passwd="$R/etc/passwd"; new_group="$R/etc/group"
  while IFS=: read -r name _ uid gid gecos home shell; do
    # People (1000…59999) and the services' own accounts (Jarvis…) that a package does not make
    if [ "$uid" -ge 1000 ] && [ "$uid" -lt 60000 ]; then :
    elif [ "$uid" -gt 0 ] && [ "$uid" -lt 1000 ] && [[ $home == /opt/* || $home == /srv/* || $home == /home/* ]]; then :
    else continue; fi
    [ -n "$(id_in "$new_passwd" "$name")" ] && continue
    gname=$(awk -F: -v g="$gid" '$3 == g { print $1; exit }' "$old_group")
    gname=${gname:-$name}
    if [ -z "$(id_in "$new_group" "$gname")" ]; then
      if awk -F: -v g="$gid" '$3 == g { f = 1 } END { exit !f }' "$new_group"; then groupadd "${prefix[@]}" "$gname"
      else groupadd "${prefix[@]}" -g "$gid" "$gname"; fi
    fi
    opts=(-g "$gname" -d "$home" -s "$shell" -c "$gecos" -M)
    if ! awk -F: -v u="$uid" '$3 == u { f = 1 } END { exit !f }' "$new_passwd"; then opts+=(-u "$uid"); fi
    [ "$uid" -lt 1000 ] && opts+=(-r)
    if useradd "${prefix[@]}" "${opts[@]}" "$name"; then
      hash=$(awk -F: -v n="$name" '$1 == n { print $2; exit }' "$old_shadow" 2>/dev/null)
      if [ -n "$hash" ] && [[ $hash != [\*\!]* ]]; then usermod "${prefix[@]}" -p "$hash" "$name"; fi
      say "👤 $name (uid $(id_in "$new_passwd" "$name"))"
    else
      warn "compte non recréé : $name"
    fi
  done < "$old_passwd"
  # Groups (sudo, docker…): the same members as before
  while IFS=: read -r gname _ gid members; do
    [ -n "$members" ] || continue
    if [ -z "$(id_in "$new_group" "$gname")" ]; then groupadd "${prefix[@]}" "$gname" 2>/dev/null || continue; fi
    IFS=, read -ra mm <<< "$members"
    for u in "${mm[@]}"; do
      [ -n "$(id_in "$new_passwd" "$u")" ] || continue
      grep -qE "^$gname:[^:]*:[^:]*:(.*,)?$u(,|$)" "$new_group" || usermod "${prefix[@]}" -aG "$gname" "$u" 2>/dev/null || true
    done
  done < "$old_group"
  say "✅ Comptes"
fi

# ─── 6. Files ────────────────────────────────────────────────────────
if want files; then
  step "Fichiers"
  # Kept apart: what belongs to this machine (disks, network, boot) or was handled above
  mkdir -p "$R/root/ancienne-config"
  for f in fstab netplan hostname crypttab; do
    if [ -e "$SRC/etc/$f" ]; then cp -a "$SRC/etc/$f" "$R/root/ancienne-config/"; fi
  done
  copy "$SRC/etc" "$R/etc" --exclude=/passwd --exclude=/group --exclude=/shadow --exclude=/gshadow \
    --exclude=/passwd- --exclude=/group- --exclude=/shadow- --exclude=/gshadow- --exclude=/subuid --exclude=/subgid \
    --exclude=/fstab --exclude=/mtab --exclude=/machine-id --exclude=/hostname --exclude=/netplan --exclude=/crypttab \
    --exclude=/resolv.conf --exclude=/ld.so.cache --exclude=/apt --exclude=/dpkg --exclude=/alternatives \
    --exclude=/default/grub --exclude=/default/grub.d --exclude=/kernel --exclude=/initramfs-tools \
    --exclude=/udev/rules.d/70-persistent-net.rules --exclude=/cloud --exclude=/ssl/certs
  say "   /etc"
  copy "$SRC/var" "$R/var" --exclude=/lib/dpkg --exclude=/lib/apt --exclude=/lib/ucf --exclude=/lib/systemd \
    --exclude=/lib/dbus --exclude=/lib/snapd --exclude=/cache --exclude=/tmp --exclude=/log --exclude=/run --exclude=/lock
  say "   /var"
  for d in "$SRC"/*; do
    [ -d "$d" ] || continue
    n=${d##*/}
    case "$n" in etc|var|usr|media) continue ;; esac
    copy "$d" "$R/$n"; say "   /$n"
  done
  if [ -d "$SRC/usr/local" ]; then copy "$SRC/usr/local" "$R/usr/local"; say "   /usr/local"; fi
  if [ -d "$SRC/media/scripts" ]; then copy "$SRC/media/scripts" "$R/media/scripts"; say "   /media/scripts"; fi
  say "✅ Fichiers (l'ancien fstab et le réseau sont gardés dans /root/ancienne-config)"
fi

# ─── 7. Owners: a system account can have another id on this machine ─
if want owners; then
  step "Propriétaires"
  scan=("$R/etc" "$R/var" "$R/usr/local" "$R/media/scripts")
  for d in "$SRC"/*; do
    n=${d##*/}; case "$n" in etc|var|usr|media) ;; *) scan+=("$R/$n") ;; esac
  done
  ex=(); for d in "${scan[@]}"; do [ -e "$d" ] && ex+=("$d"); done
  tmpd=$(mktemp -d); fixed=0
  # Lists first, changes after: two accounts swapping their ids stay right
  while IFS=: read -r name _ uid _; do
    nu=$(id_in "$R/etc/passwd" "$name"); [ -n "$nu" ] && [ "$nu" != "$uid" ] || continue
    find "${ex[@]}" -xdev -uid "$uid" -print0 2>/dev/null > "$tmpd/u.$nu"
  done < "$old_passwd"
  while IFS=: read -r name _ gid _; do
    ng=$(id_in "$R/etc/group" "$name"); [ -n "$ng" ] && [ "$ng" != "$gid" ] || continue
    find "${ex[@]}" -xdev -gid "$gid" -print0 2>/dev/null > "$tmpd/g.$ng"
  done < "$old_group"
  for f in "$tmpd"/u.*; do [ -s "$f" ] || continue; xargs -0 -r chown -h "${f##*.}" < "$f"; fixed=$((fixed + 1)); done
  for f in "$tmpd"/g.*; do [ -s "$f" ] || continue; xargs -0 -r chgrp -h "${f##*.}" < "$f"; fixed=$((fixed + 1)); done
  rm -rf "$tmpd"
  say "✅ Propriétaires ($fixed comptes ou groupes avec un autre numéro ici)"
fi

# ─── 8. Databases ────────────────────────────────────────────────────
if want postgres; then
  step "Bases de données"
  dump="$SRC/var/backups/nexus-server/postgres.sql.gz"
  if [ ! -s "$dump" ]; then
    warn "pas de copie des bases dans cette sauvegarde"
  elif ! command -v psql >/dev/null; then
    warn "PostgreSQL n'est pas installé : bases non remises"
  else
    if [ "$R" = "" ]; then systemctl restart postgresql 2>/dev/null || systemctl start postgresql 2>/dev/null || true; sleep 2; fi
    errs=$(gunzip -c "$dump" | runuser -u postgres -- psql -X -q -d postgres 2>&1 >/dev/null | grep -c 'ERROR' || true)
    if [ "${errs:-0}" -gt 0 ]; then say "✅ Bases remises ($errs messages « ERROR », souvent sans gravité : « existe déjà »…)"
    else say "✅ Bases remises"; fi
  fi
fi

# ─── 9. What the copy left out on purpose: rebuilt ───────────────────
nexus_dir=$(sed -n 's/^NEXUS_DIR=//p' "$SRC/etc/default/nexus-backup" 2>/dev/null | tail -1); nexus_dir=${nexus_dir:-/opt/nexus}
nexus_dir=${nexus_dir//\\ / }
if want rebuild; then
  step "Reconstruction (Nexus, environnements Python, node_modules)"
  if [ -f "$R$nexus_dir/package.json" ] && command -v npm >/dev/null; then
    owner=$(stat -c %U "$R$nexus_dir")
    say "🔨 Nexus ($nexus_dir, compte $owner)…"
    if runuser -u "$owner" -- bash -c "cd '$R$nexus_dir' && npm ci --include=dev && npm run build --workspace=backend && npm run build --workspace=frontend && npm prune --omit=dev" >/dev/null 2>&1; then
      runuser -u "$owner" -- bash -lc "cd '$R$nexus_dir' && (pm2 resurrect || pm2 start ecosystem.config.cjs --env production) && pm2 save" >/dev/null 2>&1 \
        || warn "Nexus construit, mais pas démarré par pm2 (cd $nexus_dir && pm2 start ecosystem.config.cjs --env production)"
      say "✅ Nexus"
    else
      warn "Nexus non reconstruit (cd $nexus_dir && npm ci && npm run build)"
    fi
  fi
  while read -r d; do
    [ -n "$d" ] || continue
    d=${d#"$SRC"}; old_root=$(cat "$M/racine.txt" 2>/dev/null); old_root=${old_root%/}; d=${d#"$old_root"}
    case "$d" in "$nexus_dir"/*) continue ;; esac
    parent=$(dirname "$R$d"); owner=$(stat -c %U "$parent" 2>/dev/null || echo root)
    case "${d##*/}" in
      node_modules)
        if [ -f "$parent/package-lock.json" ]; then
          runuser -u "$owner" -- bash -c "cd '$parent' && npm ci" >/dev/null 2>&1 && say "   $d" || warn "à refaire : cd $(dirname "$d") && npm ci"
        else warn "à refaire : $d (npm install dans $(dirname "$d"))"; fi ;;
      *)
        if [ -f "$parent/requirements.txt" ]; then
          runuser -u "$owner" -- bash -c "python3 -m venv '$R$d' && '$R$d/bin/pip' install -q -r '$parent/requirements.txt'" >/dev/null 2>&1 \
            && say "   $d" || warn "à refaire : python3 -m venv $d && $d/bin/pip install -r $(dirname "$d")/requirements.txt"
        else warn "à refaire : l'environnement Python $d"; fi ;;
    esac
  done < "$M/a-reconstruire.txt"
  say "✅ Reconstruction"
fi

# ─── 10. Services ────────────────────────────────────────────────────
if want services; then
  step "Services"
  systemctl daemon-reload 2>/dev/null || true
  n=0
  while read -r u; do
    [ -n "$u" ] || continue
    if systemctl cat "$u" >/dev/null 2>&1; then
      systemctl enable "$u" >/dev/null 2>&1 && n=$((n + 1))
    fi
  done < "$M/services-actifs.txt"
  say "✅ $n services activés (ils démarrent au redémarrage)"
fi

# ─── 11. Disks still there (the media disks, often) ──────────────────
if want disks; then
  step "Disques"
  while read -r spec mnt type opts rest; do
    case "$spec" in ''|\#*) continue ;; esac
    case "$mnt" in /|/boot|/boot/efi|none|swap) continue ;; esac
    [ "$type" = swap ] && continue
    found=''
    case "$spec" in
      UUID=*)  found=$(blkid -U "${spec#UUID=}" 2>/dev/null) ;;
      LABEL=*) found=$(blkid -L "${spec#LABEL=}" 2>/dev/null) ;;
      /dev/*)  [ -b "$spec" ] && found=$spec ;;
      *)       found=$spec ;;   # network shares…
    esac
    if [ -z "$found" ]; then warn "disque absent : $mnt ($spec) — branche-le puis ajoute sa ligne de /root/ancienne-config/fstab"; continue; fi
    if ! awk -v m="$mnt" '$1 !~ /^#/ && $2 == m { f = 1 } END { exit !f }' "$R/etc/fstab" 2>/dev/null; then
      printf '%s %s %s %s %s\n' "$spec" "$mnt" "$type" "$opts" "${rest:-0 0}" >> "$R/etc/fstab"
    fi
    mkdir -p "$R$mnt"
    say "💽 $mnt ($found)"
  done < "$SRC/etc/fstab"
  if [ "$R" = "" ]; then systemctl daemon-reload 2>/dev/null; mount -a 2>/dev/null || warn "un disque n'a pas pu être monté (mount -a)"; fi
  say "✅ Disques"
fi

# ─── 12. The server's name ───────────────────────────────────────────
if want hostname; then
  name=$(cat "$SRC/etc/hostname" 2>/dev/null)
  if [ -n "$name" ]; then
    if [ "$R" = "" ]; then hostnamectl set-hostname "$name" 2>/dev/null || echo "$name" > /etc/hostname
    else echo "$name" > "$R/etc/hostname"; fi
    step "Nom du serveur : $name"
  fi
fi

# ─── The end ─────────────────────────────────────────────────────────
step "Terminé"
if [ -s "$M/gros-fichiers.txt" ]; then
  say "📄 Fichiers de plus d'1 Go qui n'étaient pas dans la copie (à récupérer ailleurs) :"
  awk -F'\t' '{ printf "   %.1f Go  %s\n", $1/1073741824, $2 }' "$M/gros-fichiers.txt" | head -20
fi
say "🎬 La liste des films / séries / mangas d'avant : $R/var/backups/nexus-server/manifest/mediatheque.txt.gz"
say "   (zcat …/mediatheque.txt.gz | less)"
if [ ${#PROBLEMS[@]} -gt 0 ]; then
  say ""
  say "À regarder :"
  for p in "${PROBLEMS[@]}"; do say "   • $p"; done
fi
say ""
say "La copie déchiffrée reste dans $STAGE (root seulement) : supprime-la quand tout marche"
say "(sudo rm -rf $STAGE). Maintenant : sudo reboot"
