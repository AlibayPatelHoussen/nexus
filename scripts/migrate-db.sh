#!/bin/bash
# ═══════════════════════════════════════════════════════
# Nexus — apply database schema / migrations as the postgres superuser
# Usage: bash scripts/migrate-db.sh [db_name]
# Same logic as backend/src/db/migrate.ts (see db/migrations/README.md)
# ═══════════════════════════════════════════════════════
set -euo pipefail

DB_NAME="${1:-${DB_NAME:-nexus}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_DIR="$ROOT/backend/src/db"

psql_su() { sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@"; }

shopt -s nullglob
MIGRATIONS=("$DB_DIR"/migrations/[0-9]*_*.sql)

FRESH=$(psql_su -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'")

if [ "$FRESH" != "1" ]; then
  echo "🗄️  Fresh database — applying schema.sql"
  psql_su --single-transaction < "$DB_DIR/schema.sql"
  for f in "${MIGRATIONS[@]}"; do
    v=$(basename "$f" .sql)
    psql_su -c "INSERT INTO schema_migrations (version) VALUES ('$v') ON CONFLICT DO NOTHING"
  done
  exit 0
fi

psql_su -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"

# Before the first pending migration: a backup (scripts/backup.sh install), sent to Google Drive
# too when it is set up. Never blocks the update.
BACKED_UP=0
backup_first() {
  [ "$BACKED_UP" = 0 ] || return 0
  BACKED_UP=1
  local bin=/usr/local/sbin/nexus-backup
  [ -x "$bin" ] || return 0
  echo "💾 Backup before the database changes…"
  if [ "$(id -u)" = 0 ]; then "$bin" now avant-mise-a-jour || echo "⚠️  Backup failed: the update goes on"
  elif sudo -n true 2>/dev/null; then sudo -n "$bin" now avant-mise-a-jour || echo "⚠️  Backup failed: the update goes on"
  else echo "⚠️  No backup (sudo asks for a password): the update goes on"
  fi
}

for f in "${MIGRATIONS[@]}"; do
  v=$(basename "$f" .sql)
  [[ "$v" =~ ^[0-9]+_[A-Za-z0-9_]+$ ]] || { echo "❌ Invalid migration name: $v"; exit 1; }
  if [ "$(psql_su -tAc "SELECT 1 FROM schema_migrations WHERE version = '$v'")" = "1" ]; then
    continue
  fi
  backup_first
  echo "🗄️  Applying migration $v"
  { cat "$f"; echo; echo "INSERT INTO schema_migrations (version) VALUES ('$v');"; } \
    | psql_su --single-transaction
done

# Tables created here belong to postgres: give them to the database owner (Nexus' user)
psql_su <<'SQL'
DO $$ DECLARE owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  IF owner IS NOT NULL AND owner <> 'postgres' THEN
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', owner);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', owner);
  END IF;
END $$;
SQL

echo "✅ Database up to date"
