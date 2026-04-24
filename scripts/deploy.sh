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

# ── Run DDL patches as postgres superuser ────────────
echo "🗄️  Running DB patches..."
sudo -u postgres psql -d nexus <<'PSQL'
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS language VARCHAR(10);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chapters_folder_path_key'
  ) THEN
    DELETE FROM chapters a USING chapters b
      WHERE a.id > b.id AND a.folder_path = b.folder_path;
    ALTER TABLE chapters ADD CONSTRAINT chapters_folder_path_key UNIQUE (folder_path);
  END IF;
END $$;
PSQL

# ── Run DB migrations (fresh install only) ───────────
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
