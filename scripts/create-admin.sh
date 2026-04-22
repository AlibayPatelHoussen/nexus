#!/bin/bash
# Nexus — Crée ou reset le compte admin

sudo -u postgres psql -d nexus -c "
INSERT INTO users (username, email, password, role)
VALUES (
  'houssen',
  'admin@nexus.local',
  '\$2a\$12\$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'admin'
) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'admin';
"

echo ""
echo "✅ Compte admin créé / réinitialisé"
echo "   Username : houssen"
echo "   Password : password"
echo "   → Change le mot de passe après connexion"
