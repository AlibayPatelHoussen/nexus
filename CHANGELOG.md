# Changelog

All notable changes to Nexus will be documented here.

## [Unreleased]

### Added — play every video in the browser
- ffprobe detects whether a file is browser-ready (MP4 + H.264 8-bit + AAC/MP3); if so it is streamed directly with range requests
- Otherwise the server converts it on the fly to HLS with ffmpeg: H.264 video is copied and only the audio is converted to AAC; HEVC/MPEG-4/10-bit… are re-encoded with `libx264 -preset veryfast` (max 1080p)
- Seeking anywhere: the conversion restarts at the requested position; ffmpeg is stopped when the player closes, the tab is hidden, or the player stops requesting segments
- Player: centered loading spinner (load / buffering), "Préparation de la vidéo…" while converting
- Fixed: the player reloaded the video (back to 0) on some re-renders

### Fixed (playback & deploy diagnostics)
- Playback progress was never really saved (the periodic save kept the first position); resume now works and "Recommencer" restarts from 0
- Unknown `/api/*` routes returned the SPA page with HTTP 200 instead of a 404 (an outdated backend looked "OK" to the UI)
- Backend reports its build (`/api/health`), the UI warns when it differs from the interface; `deploy.sh` verifies the running build; clear log when the port is already in use
- File manager keeps the current folder in the URL

### Added
- End-to-end test suite on the production build (`npm run e2e`)

### Security
- File manager (`/api/files/*`) is now admin-only; non-admin users can only stream/download inside `MEDIA_ROOT`
- Media URLs use a short-lived read-only *stream* token instead of the access token; tokens in URLs are redacted from access logs
- Typed JWTs (`access` / `refresh` / `stream`), optional `JWT_REFRESH_SECRET`, access tokens now last 15 min
- Refresh re-reads the user from the database (deleted or demoted users lose access)
- Rate limiting on login/refresh and on the API (streaming excluded)
- Script names validated against the scripts directory (no path traversal)
- `execFile` instead of shell `exec` for systemctl/journalctl; unused `runCommand` removed
- Upload filenames sanitized, `rename` rejects names containing a path, Range headers validated (416)

### Fixed
- Rescanning a manga no longer wipes reading progress (chapter upsert in a transaction)
- `.sh` scripts can be run
- Only one media scan runs at a time (409 otherwise)

### Changed
- Versioned database migrations (`backend/src/db/migrations`, `scripts/migrate-db.sh`) replace inline SQL in `deploy.sh`
- Service links come from `SERVICES_DOMAIN`, sudoers file is a template (`NEXUS_USER`)
- Admin-only pages hidden from the sidebar for regular users

### Added
- Full-stack server control panel with React + Node.js + PostgreSQL
- JWT authentication with bcrypt hashing and refresh tokens
- Real-time system stats (CPU, RAM, disk, temperature) via WebSocket
- Complete file manager: browse, edit, upload, download, rename, delete
- Integrated terminal (xterm.js + node-pty via WebSocket)
- Services management: start/stop/restart systemd services with logs
- Scripts runner with SSE streaming output
- Media library: films, series, animes, manga/webtoon
- Automatic metadata fetching from TMDB, AniList, MangaDex
- Custom video player (Plyr) with resume, progress tracking, episode list
- Manga/webtoon reader: vertical scroll, page mode, RTL, zoom, chapters
- Dark/light theme with CSS variables
- Network info page
- Settings: profile, theme, password change
- CI/CD pipeline (GitHub Actions): lint → typecheck → tests → build → deploy
- PM2 ecosystem config
- Cloudflare Tunnel integration
- Complete PostgreSQL schema with triggers

### Security
- JWT + bcrypt authentication
- Rate limiting on all endpoints (stricter on auth)
- Helmet.js security headers
- CORS configuration
- Role-based access (admin/user)
- Sudoers config for safe service control

## [0.1.0] - 2026-04-21
- Initial project scaffolding
