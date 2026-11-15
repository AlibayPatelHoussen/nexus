#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — create an admin account, or reset one's password
#
#  Admin accounts are only made here, in the terminal: in Nexus, an admin only
#  creates « user » accounts (Réglages › Utilisateurs).
#
#  bash scripts/create-admin.sh            asks the name, e-mail and password
#  DB_NAME=nexus_dev bash scripts/create-admin.sh
#
#  Resetting an existing account signs it out of every device (new session version).
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

DIR=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
DB_NAME="${DB_NAME:-nexus}"
psql_su() { sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -qtA "$@"; }

read -r -p "Nom d'utilisateur [houssen] : " username
username=${username:-houssen}
if ! [[ $username =~ ^[A-Za-z0-9_-]{3,50}$ ]]; then
  echo "❌ 3 à 50 caractères : lettres, chiffres, _ et -"; exit 1
fi

existing=$(psql_su -v u="$username" <<'SQL'
SELECT email FROM users WHERE LOWER(username) = LOWER(:'u');
SQL
)
read -r -p "E-mail${existing:+ [$existing]} : " email
email=${email:-$existing}
if ! [[ $email =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "❌ E-mail invalide"; exit 1
fi

read -r -s -p "Mot de passe : " password; echo
read -r -s -p "Mot de passe (encore) : " again; echo
if [ "$password" != "$again" ]; then echo "❌ Les deux mots de passe sont différents"; exit 1; fi
if [ ${#password} -lt 8 ] || ! [[ $password =~ [a-z] && $password =~ [A-Z] && $password =~ [0-9] ]]; then
  echo "❌ Au moins 8 caractères, avec une majuscule, une minuscule et un chiffre"; exit 1
fi

# bcrypt like Nexus (12 rounds); the password goes through stdin, never on a command line
hash=$(printf '%s' "$password" | node -e '
  const bcrypt = require(process.argv[1])
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(bcrypt.hashSync(s, 12)))
' "$DIR/backend/node_modules/bcryptjs")

psql_su -v u="$username" -v e="$email" -v h="$hash" <<'SQL' >/dev/null
INSERT INTO users (username, email, password, role)
VALUES (:'u', :'e', :'h', 'admin')
ON CONFLICT (username) DO UPDATE
   SET email = EXCLUDED.email, password = EXCLUDED.password, role = 'admin', expires_at = NULL,
       session_version = users.session_version + 1;
DELETE FROM refresh_tokens r USING users u
 WHERE r.user_id = u.id AND u.username = :'u' AND r.session_version <> u.session_version;
SQL

echo ""
if [ -n "$existing" ]; then
  echo "✅ Compte admin « $username » mis à jour (déconnecté de tous ses appareils)"
else
  echo "✅ Compte admin « $username » créé"
fi
