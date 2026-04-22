#!/bin/bash
# ═══════════════════════════════════════════════════════
# Nexus — Server Setup Script (Ubuntu 24.04)
# Run once on a fresh server:
#   bash scripts/setup-server.sh
# ═══════════════════════════════════════════════════════

set -e

echo "🔧 Setting up Nexus server..."

# ── Node.js 20 ───────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node $(node -v) / npm $(npm -v)"

# ── PM2 ──────────────────────────────────────────────
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  sudo npm install -g pm2
  pm2 startup systemd -u $USER --hp $HOME | tail -1 | sudo bash
fi

# ── PostgreSQL ───────────────────────────────────────
if ! command -v psql &> /dev/null; then
  echo "📦 Installing PostgreSQL..."
  sudo apt-get install -y postgresql postgresql-contrib
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
fi

# ── Python3 ──────────────────────────────────────────
sudo apt-get install -y python3 python3-pip

# ── Build tools (for node-pty) ────────────────────────
sudo apt-get install -y build-essential python3-dev

# ── Setup PostgreSQL DB ──────────────────────────────
echo "🗄️  Setting up database..."
DB_NAME="nexus"
DB_USER="nexus_houssen"
DB_PASS=$(openssl rand -hex 32)

sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true

echo ""
echo "⚠️  Save these DB credentials in your .env:"
echo "   DB_HOST=localhost"
echo "   DB_PORT=5432"
echo "   DB_NAME=$DB_NAME"
echo "   DB_USER=$DB_USER"
echo "   DB_PASSWORD=$DB_PASS"
echo ""

# ── Clone repo ───────────────────────────────────────
NEXUS_DIR="/opt/nexus"
if [ ! -d "$NEXUS_DIR" ]; then
  echo "📁 Cloning Nexus..."
  sudo git clone https://github.com/AlibayPatelHoussen/nexus.git "$NEXUS_DIR"
  sudo chown -R $USER:$USER "$NEXUS_DIR"
fi

# ── Create .env ──────────────────────────────────────
if [ ! -f "$NEXUS_DIR/backend/.env" ]; then
  JWT_SECRET=$(openssl rand -hex 64)
  cat > "$NEXUS_DIR/backend/.env" << EOF
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://nexus.houssen-serveur.com

DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS

JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

MEDIA_ROOT=/media
FILMS_PATH=/media/films
SERIES_PATH=/media/series
ANIMES_PATH=/media/animes
MANGA_PATH=/media/scans
YOUTUBE_PATH=/media/youtube
SCRIPTS_PATH=/media/scripts

TMDB_API_KEY=YOUR_TMDB_KEY_HERE

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=10

LOG_LEVEL=info
LOG_FILE=/opt/nexus/logs/nexus.log
EOF
  echo "✅ Created .env — edit TMDB_API_KEY manually"
fi

# ── Run schema (as postgres superuser to avoid permission issues) ─────
echo "🗄️  Running database schema..."
cd "$NEXUS_DIR"
sudo -u postgres psql -d "$DB_NAME" -f backend/src/db/schema.sql 2>/dev/null || true

# Grant table-level privileges to nexus_houssen
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;" 2>/dev/null || true

# ── Create admin user ────────────────────────────────
echo ""
echo "👤 Creating admin user..."
ADMIN_HASH=$(node -e "const b=require('bcryptjs');console.log(b.hashSync('ChangeMe123!',12))")
PGPASSWORD="$DB_PASS" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c \
  "INSERT INTO users (username, email, password, role) VALUES ('houssen', 'admin@nexus.local', '$ADMIN_HASH', 'admin') ON CONFLICT DO NOTHING;"

echo "   Username: houssen"
echo "   Password: ChangeMe123! (change it after first login!)"

# ── Install & build ──────────────────────────────────
echo "📦 Installing & building Nexus..."
npm ci
npm run build

mkdir -p logs

# ── Start PM2 ────────────────────────────────────────
pm2 start ecosystem.config.cjs --env production
pm2 save

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Edit /opt/nexus/backend/.env — add your TMDB_API_KEY"
echo "   2. Add Cloudflare Tunnel: nexus.houssen-serveur.com → localhost:3001"
echo "   3. Login at https://nexus.houssen-serveur.com"
echo "   4. Change your password in Settings"
echo ""
pm2 status
