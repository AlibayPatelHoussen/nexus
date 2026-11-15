#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — delete an account (admin or user), in the terminal
#
#  bash scripts/delete-account.sh houssen
#  DB_NAME=nexus_dev bash scripts/delete-account.sh alice
#
#  The last admin account is never deleted (Nexus would have nobody to manage it).
#  Its devices are signed out; its list, watch history and notifications go; its
#  downloads and automatic downloads stay (without an owner: the admins are told).
#  Library files are never touched.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

DB_NAME="${DB_NAME:-nexus}"
psql_su() { sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -qtA "$@"; }

username=${1:-}
if [ -z "$username" ]; then read -r -p "Compte à supprimer : " username; fi
if ! [[ $username =~ ^[A-Za-z0-9_@.+-]{1,255}$ ]]; then echo "❌ Nom invalide"; exit 1; fi

info=$(psql_su -F '|' -v u="$username" <<'SQL'
SELECT u.username, u.role, u.email,
       (SELECT COUNT(*) FROM users a WHERE a.role = 'admin' AND a.id <> u.id),
       (SELECT COUNT(*) FROM refresh_tokens r WHERE r.user_id = u.id)
  FROM users u WHERE LOWER(u.username) = LOWER(:'u') OR LOWER(u.email) = LOWER(:'u');
SQL
)
if [ -z "$info" ]; then echo "❌ Aucun compte « $username »"; exit 1; fi
IFS='|' read -r name role email other_admins devices <<<"$info"

if [ "$role" = admin ] && [ "$other_admins" = 0 ]; then
  echo "❌ « $name » est le dernier compte administrateur : crée d'abord un autre admin"
  echo "   (bash scripts/create-admin.sh), connecte-toi avec, puis recommence."
  exit 1
fi

label=$([ "$role" = admin ] && echo "administrateur" || echo "utilisateur")
echo "Compte $label « $name » ($email), $devices appareil(s) connecté(s)."
echo "Ses appareils seront déconnectés ; sa liste et son historique de lecture effacés."
read -r -p "Tape « $name » pour confirmer : " typed
if [ "$typed" != "$name" ]; then echo "Annulé."; exit 1; fi

psql_su -v u="$name" <<'SQL' >/dev/null
DELETE FROM users WHERE username = :'u';
SQL
echo "✅ Compte « $name » supprimé (les autres sessions de Nexus le voient dans les 5 secondes)"
