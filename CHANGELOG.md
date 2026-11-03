# Changelog

All notable changes to Nexus will be documented here.

## [Unreleased]

### Security — forced deletion accepted any password
- With passwordless sudo (`NOPASSWD`, common on cloud servers), sudo checked nothing, so any password deleted the item. The password is now checked by the system (`unix_chkpwd`, the helper used for logins) before sudo runs, whatever the sudo configuration; if it cannot be checked, the forced deletion is refused

### Added — force a deletion with the server password
- When a deletion in the media library is refused for lack of rights (folder owned by root…), Nexus asks for the server account's password (the one used for `sudo`) and deletes it anyway
- Only inside the library folders (never a library/category folder itself, a system folder, or outside through a symlink or `../`); the password goes to `sudo` on stdin, is never stored or logged; `sudo -k` always re-checks it
- 5 wrong attempts → blocked 15 min (`SUDO_RATE_LIMIT_MAX`); cancelling shows the `chown` command to fix the rights for good

### Changed — confirmations and permission errors
- Confirmations (delete files, remove a title from the library, restart the server) use an in-app dialog instead of the browser's `confirm()`: clear title, what will happen, list of items, red "Supprimer" button, Escape / "Annuler" cancel
- "Permission denied" on deletion now names the folder that actually blocks it (deleting needs write access to the parent folder) and its owner; the error toast shows the `sudo chown` command with a "Copier" button
- `deploy.sh` warns when library folders do not belong to the Nexus user and prints the one-time fix

### Fixed — artwork, manga chapters, file deletion
- Anime covers never displayed: AniList serves them from `s4.anilist.co`, blocked by the CSP; MangaDex refuses hotlinked covers. All remote artwork now goes through a backend proxy with a disk cache (`/api/images/…`), with a clean placeholder when an image is missing
- Manga chapters: recursive discovery (image folders at any depth, PDF and CBZ/ZIP anywhere, one-shots), CBZ reader support, one broken manga no longer stops the scan; chapter list sorted by number with empty / error states
- Artwork is shown whole (object-fit: contain, 2:3 frame, blurred fill) on title pages, the billboard, cards and episode stills; text never overlaps it
- File deletion: clear messages (permission denied with the `chown` command, missing file, busy…), batch delete reporting each failure, protected system/library folders, `../` cannot escape `FILES_ROOT`, list refreshed after deletion

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
