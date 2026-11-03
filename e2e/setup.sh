#!/bin/bash
# ═══════════════════════════════════════════════════════
# Nexus — end-to-end test environment (production build)
#
# Builds the app, creates a throw-away PostgreSQL database through
# scripts/migrate-db.sh (same path as a real deploy), generates real media
# files with ffmpeg, starts a fake TMDB/AniList/MangaDex and the backend in
# production mode serving the built frontend on http://localhost:$PORT.
#
# Usage: bash e2e/setup.sh          (then: node e2e/run.mjs)
#        bash e2e/setup.sh stop
# Needs: node, ffmpeg, python3 + Pillow, PostgreSQL binaries (initdb/pg_ctl)
# ═══════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
E2E="${E2E_DIR:-/tmp/nexus-e2e}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDIR="$E2E/pg"; PGPORT="${PGPORT:-5434}"
PORT="${PORT:-3101}"; MOCK_PORT="${MOCK_PORT:-4010}"
MEDIA="$E2E/media"
RUN_AS=(); [ "$(id -u)" = 0 ] && RUN_AS=(runuser -u postgres --)

stop() {
  [ -f "$E2E/backend.pid" ] && kill "$(cat "$E2E/backend.pid")" 2>/dev/null || true
  [ -f "$E2E/mock.pid" ]    && kill "$(cat "$E2E/mock.pid")" 2>/dev/null || true
  [ -d "$PGDIR/data" ] && "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" stop -m fast >/dev/null 2>&1 || true
}
if [ "${1:-}" = "stop" ]; then stop; rm -rf "$E2E"; echo "stopped"; exit 0; fi
if [ "${1:-}" = "restart-backend" ]; then   # rebuild + restart only the backend
  kill "$(cat "$E2E/backend.pid")" 2>/dev/null || true; sleep 1
  (cd "$ROOT" && npm run build >/dev/null)
  ( cd "$ROOT/backend"; set -a; . "$E2E/env"; set +a; exec node dist/index.js ) > "$E2E/backend.log" 2>&1 < /dev/null &
  echo $! > "$E2E/backend.pid"
  for _ in $(seq 1 40); do curl -sf "localhost:$PORT/api/health" >/dev/null && break; sleep 0.5; done
  curl -s "localhost:$PORT/api/health"; echo; exit 0
fi
stop; rm -rf "$E2E"; mkdir -p "$E2E" "$MEDIA"

# ── 1. Production build ─────────────────────────────
echo "▶ build"
(cd "$ROOT" && npm run build >/dev/null)

# ── 2. Database, installed like a real deploy ───────
echo "▶ database"
mkdir -p "$PGDIR"; [ "$(id -u)" = 0 ] && chown postgres "$PGDIR"
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$PGDIR/data" -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" -o "-p $PGPORT -k $PGDIR" -l "$PGDIR/log" start >/dev/null 2>&1 < /dev/null
for _ in $(seq 1 30); do "$PGBIN/pg_isready" -h "$PGDIR" -p "$PGPORT" -q && break; sleep 0.5; done
psql -h "$PGDIR" -p "$PGPORT" -U postgres -qc "CREATE ROLE nexus_user LOGIN PASSWORD 'e2e_password'" \
  -c "CREATE DATABASE nexus OWNER nexus_user"
# scripts/migrate-db.sh runs "sudo -u postgres psql": point a fake sudo at this cluster
mkdir -p "$E2E/bin"
cat > "$E2E/bin/sudo" <<EOF
#!/bin/bash
shift 2
exec ${RUN_AS[*]} env PGHOST=$PGDIR PGPORT=$PGPORT "\$@"
EOF
chmod +x "$E2E/bin/sudo"
PATH="$E2E/bin:$PATH" bash "$ROOT/scripts/migrate-db.sh" nexus >/dev/null
psql -h "$PGDIR" -p "$PGPORT" -U postgres -d nexus -qc \
  "GRANT ALL ON ALL TABLES IN SCHEMA public TO nexus_user; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO nexus_user"

# ── 3. Media library (real, playable files) ─────────
echo "▶ media"
vid() { # vid <file> [seconds]
  mkdir -p "$(dirname "$1")"
  ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=320x180:rate=24" -f lavfi -i "sine=frequency=440" \
    -t "${2:-6}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart "$1"
}
vid "$MEDIA/films/Marty Supreme (2025)/Marty.Supreme.2025.1080p.WEB.mp4"
vid "$MEDIA/films/Tu.ne.tueras.point.2016.MULTi.1080p.mp4"
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=320x180:rate=24" -f lavfi -i "sine=frequency=440" -t 8 -c:v libvpx -b:v 300k -c:a libopus -shortest "$MEDIA/films/Demo Webm (2020).webm"
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=160x90:rate=12" -f lavfi -i "sine=frequency=330" -t 60 -c:v libvpx -b:v 60k -c:a libopus -b:a 24k -shortest "$MEDIA/films/Long Webm (2021).webm"
mkdir -p "$MEDIA/films"; cp "$MEDIA/films/Tu.ne.tueras.point.2016.MULTi.1080p.mp4" "$MEDIA/films/Notfound Movie 2019.mkv"
# Files a browser cannot read directly → converted on the fly by the server
SRC=(-f lavfi -i "testsrc=size=480x270:rate=24" -f lavfi -i "sine=frequency=550")
ffmpeg -loglevel error -y "${SRC[@]}" -t 30 -c:v libx264 -pix_fmt yuv420p -g 48 -c:a ac3 "$MEDIA/films/Remux Test (2018).mkv"
ffmpeg -loglevel error -y "${SRC[@]}" -t 90 -c:v libx265 -x265-params log-level=error -c:a aac "$MEDIA/films/Hevc Test (2017).mkv"
S="$MEDIA/series/Georgie and Mandys First Marriage S02E12-22 FINAL"
for e in 12 13 14; do vid "$S/Georgie.and.Mandys.First.Marriage.S02E$e.1080p.WEB.H264.mp4" 4; done
vid "$MEDIA/series/Breaking Bad/Saison 1/Episode 1.mp4" 4
vid "$MEDIA/series/Breaking Bad/Saison 1/Episode 2.mp4" 4
vid "$MEDIA/series/Breaking Bad/Saison 2/Episode 1.mp4" 4
vid "$MEDIA/animes/One Piece/One Piece - 01 [1080p].mp4" 4
vid "$MEDIA/animes/One Piece/One Piece - 02 [1080p].mp4" 4
python3 - "$MEDIA" <<'PY'
import sys, os
from PIL import Image, ImageDraw
root = sys.argv[1]
for manga, chapters in [('Solo Leveling', ['Chapter 1', 'Chapter 2'])]:
    for ch in chapters:
        d = os.path.join(root, 'scans', manga, ch); os.makedirs(d, exist_ok=True)
        for i in range(1, 4):
            im = Image.new('RGB', (400, 600), (40 * i, 60, 120)); ImageDraw.Draw(im).text((20, 20), f'{ch} p{i}', fill='white')
            im.save(os.path.join(d, f'{i:02d}.png'))
import zipfile, io
def page(text, colour):
    im = Image.new('RGB', (400, 600), colour); ImageDraw.Draw(im).text((20, 20), text, fill='white')
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()
# CBZ archives directly in the manga folder
d = os.path.join(root, 'scans', 'Vinland Saga'); os.makedirs(d, exist_ok=True)
for n in (1, 2, 10):
    with zipfile.ZipFile(os.path.join(d, f'Vinland Saga - Chapter {n:03d}.cbz'), 'w') as z:
        for i in range(1, 4): z.writestr(f'{i:02d}.png', page(f'CBZ ch{n} p{i}', (30, 90, 40 * i)))
        z.writestr('__MACOSX/._01.png', b'junk')
# PDFs directly in the manga folder
d = os.path.join(root, 'scans', 'Vagabond'); os.makedirs(d, exist_ok=True)
for n in (1, 2):
    imgs = [Image.new('RGB', (400, 600), (90, 40 * n, 160)) for _ in range(2)]
    imgs[0].save(os.path.join(d, f'Vagabond {n:02d}.pdf'), save_all=True, append_images=imgs[1:])
# Volume / chapter / images (nested)
for vol, chs in (('Volume 1', (1, 2)), ('Volume 2', (3,))):
    for c in chs:
        d = os.path.join(root, 'scans', 'Nested Manga', vol, f'Chapitre {c}'); os.makedirs(d, exist_ok=True)
        for i in range(1, 3): open(os.path.join(d, f'{i}.png'), 'wb').write(page(f'v{vol} c{c} p{i}', (120, 60, 30)))
# One-shot: images directly in the manga folder
d = os.path.join(root, 'scans', 'Oneshot Manga'); os.makedirs(d, exist_ok=True)
for i in range(1, 4): open(os.path.join(d, f'{i:02d}.png'), 'wb').write(page(f'oneshot p{i}', (60, 60, 60)))
# No chapter at all
d = os.path.join(root, 'scans', 'Empty Manga'); os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'readme.txt'), 'w').write('nothing here')
d = os.path.join(root, 'scans', 'Berserk', 'Volume 1'); os.makedirs(d, exist_ok=True)
pages = [Image.new('RGB', (400, 600), (200, 50 * i, 50)) for i in range(1, 3)]
pages[0].save(os.path.join(d, 'Chapitre 1.pdf'), save_all=True, append_images=pages[1:])
PY

# ── 4. Fake metadata APIs ───────────────────────────
echo "▶ mock metadata"
MOCK_PORT=$MOCK_PORT node "$ROOT/e2e/mock-metadata.mjs" > "$E2E/mock.log" 2>&1 < /dev/null &
echo $! > "$E2E/mock.pid"

# ── 5. Backend in production mode (serves frontend/dist) ──
echo "▶ backend"
cat > "$E2E/env" <<EOF
NODE_ENV=production
PORT=$PORT
FRONTEND_URL=http://localhost:$PORT
DB_HOST=localhost
DB_PORT=$PGPORT
DB_NAME=nexus
DB_USER=nexus_user
DB_PASSWORD=e2e_password
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
JWT_REFRESH_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-40s}
MEDIA_ROOT=$MEDIA
FILMS_PATH=$MEDIA/films
SERIES_PATH=$MEDIA/series
ANIMES_PATH=$MEDIA/animes
MANGA_PATH=$MEDIA/scans
TMDB_API_KEY=e2e-test-key
TMDB_BASE_URL=http://localhost:$MOCK_PORT/3
TMDB_IMAGE_BASE_URL=http://localhost:$MOCK_PORT/img
MANGADEX_COVERS_URL=http://localhost:$MOCK_PORT/covers
IMAGE_PROXY_HOSTS=localhost
IMAGE_CACHE_DIR=$E2E/image-cache
ANILIST_API_URL=http://localhost:$MOCK_PORT/anilist
MANGADEX_API_URL=http://localhost:$MOCK_PORT/mangadex
RATE_LIMIT_MAX=100000
AUTH_RATE_LIMIT_MAX=1000
LOG_FILE=$E2E/nexus.log
EOF
( cd "$ROOT/backend"; set -a; . "$E2E/env"; set +a; exec node dist/index.js ) > "$E2E/backend.log" 2>&1 < /dev/null &
echo $! > "$E2E/backend.pid"
for _ in $(seq 1 40); do curl -sf "localhost:$PORT/api/health" >/dev/null && break; sleep 0.5; done
curl -sf "localhost:$PORT/api/health" >/dev/null || { echo "backend did not start"; tail -30 "$E2E/backend.log"; exit 1; }

# ── 6. Users ────────────────────────────────────────
H_ADMIN=$(cd "$ROOT/backend" && node -e "console.log(require('bcryptjs').hashSync('Admin1234',4))")
H_USER=$(cd "$ROOT/backend"  && node -e "console.log(require('bcryptjs').hashSync('User12345',4))")
psql -h "$PGDIR" -p "$PGPORT" -U nexus_user -d nexus -qc \
  "INSERT INTO users (username,email,password,role) VALUES ('admin','admin@e2e.io','$H_ADMIN','admin'),('alice','alice@e2e.io','$H_USER','user')"

cat > "$E2E/config.json" <<EOF
{ "base": "http://localhost:$PORT", "mock": "http://localhost:$MOCK_PORT", "media": "$MEDIA",
  "psql": ["psql", "-h", "$PGDIR", "-p", "$PGPORT", "-U", "nexus_user", "-d", "nexus", "-tA", "-c"] }
EOF
echo "✅ ready on http://localhost:$PORT  (admin/Admin1234, alice/User12345)"
