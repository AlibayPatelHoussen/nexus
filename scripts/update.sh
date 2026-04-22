#!/bin/bash
# Nexus — Pull + Build + Restart

set -e
cd /opt/nexus

echo "=== Git pull ==="
git pull origin main

echo ""
echo "=== Install dependencies ==="
npm install

echo ""
echo "=== Build backend ==="
npm run build --workspace=backend

echo ""
echo "=== Restart PM2 ==="
pm2 restart nexus-backend

echo ""
echo "=== Logs ==="
sleep 2
pm2 logs nexus-backend --lines 20 --nostream
