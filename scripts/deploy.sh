#!/bin/bash
# ═══════════════════════════════════════════════════════
# Nexus — Deployment Script
# Usage: bash scripts/deploy.sh
# ═══════════════════════════════════════════════════════

set -e
# Make a failed step obvious: the running backend is NOT restarted in that case
trap 'echo ""; echo "❌ Déploiement interrompu (ligne $LINENO) — le backend n'"'"'a PAS été redémarré, corrige l'"'"'erreur ci-dessus puis relance."' ERR

NEXUS_DIR="/opt/nexus"
LOG_DIR="$NEXUS_DIR/logs"

echo "🚀 Nexus deployment starting..."

# ── Create dirs ──────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Pull latest code ─────────────────────────────────
cd "$NEXUS_DIR"
# npm may rewrite package-lock.json on the server (older deploys ran
# "npm prune"): it is generated, never edited by hand → restore it first
git checkout -- package-lock.json 2>/dev/null || true
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Local changes in $NEXUS_DIR would block the update:"
  git status --short
  echo "   Keep them with 'git stash', or discard them with 'git checkout -- <file>', then re-run."
  exit 1
fi
if ! getent hosts github.com >/dev/null 2>&1; then
  echo "❌ The server cannot reach github.com: no Internet (Wi-Fi dongle down?) or DNS problem."
  echo "   Wi-Fi watchdog (repairs the USB dongle by itself): sudo bash scripts/wifi-watchdog.sh install"
  echo "   Its state / last repairs:                          sudo bash scripts/wifi-watchdog.sh status"
  exit 1
fi
git pull --ff-only origin main

# ── ffmpeg is needed to convert videos the browser cannot read ──
if ! command -v ffmpeg &> /dev/null || ! command -v ffprobe &> /dev/null; then
  echo "⚠️  ffmpeg is not installed: MKV/AVI/HEVC videos will not play in the browser."
  echo "   Install it with: sudo apt-get install -y ffmpeg   (then re-run this script)"
fi

# ── poppler-utils turns PDF manga pages into light images on the server ──
if ! command -v pdftoppm &> /dev/null; then
  echo "📦 Installing poppler-utils (fast PDF manga pages)..."
  if ! sudo -n apt-get install -y poppler-utils; then
    echo "⚠️  poppler-utils could not be installed: PDF chapters will be drawn by the phone (slower)."
    echo "   Install it with: sudo apt-get install -y poppler-utils"
  fi
fi

# ── Install dependencies (including devDeps for build) ─
echo "📦 Installing dependencies..."
npm ci --include=dev

# ── Build backend ────────────────────────────────────
echo "🔨 Building backend..."
npm run build --workspace=backend

# ── Build frontend ───────────────────────────────────
echo "🎨 Building frontend..."
npm run build --workspace=frontend

# ── Apply schema / pending migrations (as postgres superuser) ──
echo "🗄️  Running DB migrations..."
bash scripts/migrate-db.sh nexus

# ── Prune devDependencies after build ────────────────
echo "🧹 Pruning dev dependencies..."
npm prune --omit=dev
git checkout -- package-lock.json 2>/dev/null || true   # keep the tree clean for the next pull

# ── Restart PM2 ──────────────────────────────────────
echo "♻️  Restarting services..."
# Kill any orphan process on port 3001 before starting
fuser -k 3001/tcp 2>/dev/null || sudo -n fuser -k 3001/tcp 2>/dev/null || true
sleep 1
pm2 delete nexus-backend 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save

# ── Verify the new backend is the one answering ─────
# (an old process started outside PM2 can keep port 3001: the new one then
#  crash-loops with EADDRINUSE while the old code keeps serving requests)
EXPECTED=$(git rev-parse --short=12 HEAD)
PORT=$(grep -E '^PORT=' backend/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-3001}
echo "🔎 Checking the running backend (expected build $EXPECTED)..."
RUNNING=""
for _ in $(seq 1 20); do
  RUNNING=$(curl -s "http://localhost:$PORT/api/health" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')
  [ "$RUNNING" = "$EXPECTED" ] && break
  sleep 1
done

if [ "$RUNNING" = "$EXPECTED" ]; then
  echo "✅ Deployment complete! Backend $RUNNING is running on port $PORT."
  pm2 status nexus-backend

  # ── Library folders Nexus cannot modify (delete / rename from the UI fails) ──
  env_val() { grep -E "^$1=" backend/.env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
  NOT_OWNED=""
  for key in MEDIA_ROOT FILMS_PATH SERIES_PATH ANIMES_PATH MANGA_PATH SCRIPTS_PATH; do
    dir=$(env_val "$key"); [ -d "$dir" ] || continue
    bad=$(find "$dir" -maxdepth 3 ! -user "$(id -un)" -print -quit 2>/dev/null || true)
    [ -n "$bad" ] && NOT_OWNED="$NOT_OWNED $dir"
  done
  if [ -n "$NOT_OWNED" ]; then
    MEDIA=$(env_val MEDIA_ROOT)
    echo ""
    if sudo -n true 2>/dev/null; then
      # Passwordless sudo: give the library back to the Nexus account now
      for dir in $NOT_OWNED; do sudo -n chown -R "$(id -un):" "$dir" || true; done
      echo "✅ Library folders given back to $(id -un):$NOT_OWNED"
    else
      echo "⚠️  Some library files do not belong to $(id -un): deleting or renaming them from Nexus will fail."
      echo "   Folders concerned:$NOT_OWNED"
      echo "   Fix (once):  sudo chown -R $(id -un): \"${MEDIA:-/media}\""
    fi
  fi
else
  echo ""
  echo "❌ The backend answering on port $PORT is NOT the new build."
  echo "   expected: $EXPECTED"
  echo "   running : ${RUNNING:-old version (no build info) or not answering}"
  echo ""
  echo "   Process listening on port $PORT:"
  { ss -ltnp 2>/dev/null | grep -E "[:.]$PORT[[:space:]]" \
    || lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null \
    || sudo -n lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null; } || echo "   (could not list it — try: sudo lsof -iTCP:$PORT -sTCP:LISTEN)"
  echo ""
  echo "   Last backend logs:"
  pm2 logs nexus-backend --lines 15 --nostream 2>/dev/null || true
  echo ""
  echo "   If another process holds the port (started by hand, systemd or another user):"
  echo "     sudo fuser -k $PORT/tcp && pm2 restart nexus-backend"
  exit 1
fi
