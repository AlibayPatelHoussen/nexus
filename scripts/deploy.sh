#!/bin/bash
# ═══════════════════════════════════════════════════════
# Nexus — Deployment Script
# Usage: bash scripts/deploy.sh
# ═══════════════════════════════════════════════════════

set -e

NEXUS_DIR="/opt/nexus"
LOG_DIR="$NEXUS_DIR/logs"

echo "🚀 Nexus deployment starting..."

# ── Create dirs ──────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Pull latest code ─────────────────────────────────
cd "$NEXUS_DIR"
git pull origin main

# ── Install dependencies (including devDeps for build) ─
echo "📦 Installing dependencies..."
npm ci --include=dev

# ── Build backend ────────────────────────────────────
echo "🔨 Building backend..."
npm run build --workspace=backend

# ── Build frontend ───────────────────────────────────
echo "🎨 Building frontend..."
npm run build --workspace=frontend

# ── Fix table ownership so nexus_user can run DDL migrations ─
echo "🔑 Fixing table ownership..."
sudo -u postgres psql -d nexus -c "
  DO \$\$
  DECLARE r RECORD;
  BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO nexus_user';
    END LOOP;
  END \$\$;
" 2>/dev/null || echo "  (ownership fix skipped — already correct or no sudo)"

# ── Run DB migrations ────────────────────────────────
echo "🗄️  Running DB migrations..."
npm run db:migrate --workspace=backend

# ── Prune devDependencies after build ────────────────
echo "🧹 Pruning dev dependencies..."
npm prune --omit=dev

# ── Restart PM2 ──────────────────────────────────────
echo "♻️  Restarting services..."
# Kill any orphan process on port 3001 before starting
fuser -k 3001/tcp 2>/dev/null || true
sleep 1
pm2 delete nexus-backend 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save

echo "✅ Deployment complete!"
pm2 status nexus-backend
