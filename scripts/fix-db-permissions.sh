#!/bin/bash
# Nexus — Fix DB user password and table permissions

DB_NAME="nexus"
DB_USER="nexus_houssen"
DB_PASS=$(grep DB_PASSWORD /opt/nexus/backend/.env | cut -d= -f2)

echo "=== Mise à jour du mot de passe PostgreSQL ==="
sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';"

echo ""
echo "=== Attribution des droits sur les tables ==="
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"

echo ""
echo "=== Redémarrage de Nexus ==="
pm2 restart nexus-backend

echo ""
echo "=== Logs ==="
pm2 logs nexus-backend --lines 20 --nostream
