# Changelog

All notable changes to Nexus will be documented here.

## [Unreleased]

### Added — YouTube in Médias, push notifications (step 5, part 2)
- Médias › YouTube, next to Films / Séries / Animes (same switch on Mac and iPhone; the switch now shows on every video page on Mac too): the videos of `/media/youtube` as 16:9 thumbnails with title, channel and duration, newest download first or by title, optionally grouped by channel; playing resumes where you stopped
- The scanner indexes `/media/youtube` (`MediaScanner.scanYoutube`, `POST /api/media/scan/youtube`, part of full scans and of the rescan after a YouTube download): title, channel, duration and date from yt-dlp's `.info.json`, the `.jpg` next to the video as thumbnail (served by the image route, only from the library folders); old `/media/youtube/Titre.mp4` files are listed too
- Films saved by movix in language folders (`/media/films/VF/Titre_2020.mp4`) are now one film each instead of a single title « VF »
- PWA push notifications: Réglages › Notifications turns them on per device (iPhone: from the home-screen app); a notification when a download finishes or fails, opening the queue when tapped; « Envoyer un test ». VAPID keys generated once in `backend/data/vapid.json` (or `VAPID_*` in `.env`); devices that unsubscribed are forgotten
- Migration 004: media type `youtube` + `channel`, tables `push_subscriptions` and `follows`

### Added — « Téléchargements » page (step 5, part 1)
- New section Téléchargements (sidebar, ⌘K, and Aperçu on iPhone), admins only
- One search field queries the four scripts at once; cards appear as each script answers, with a discreet line for the ones still searching or that failed. Poster grid like the TV app on Mac (YouTube in 16:9 with the duration), big thumbnails list on iPhone; type filter Tout / Animés / Mangas / Films / Séries / YouTube; badges with one system colour per type; images that fail show a neutral placeholder
- Detail sheet (macOS sheet / iOS bottom sheet): season and language, episodes or chapters as number chips with a range « De … à … », « Tout sélectionner », already downloaded ones ticked; one button for a film or a video; duplicates ask before downloading again
- Queue: En cours / En attente / Terminés / Échecs with progress bars (chapter and page for manga; Mo, speed and time left for video), live over Socket.io; pause / resume / cancel / retry / remove from the context menu on Mac and by swiping the row on iPhone; « Ouvrir » plays the video or opens the manga reader
- `GET /api/downloads/:id/open` finds the downloaded file in the library

### Added — downloads backend (step 4 of « Téléchargements »)
- Table `downloads` (migration 003) and a queue worker: 2 jobs at a time (`DOWNLOADS_PARALLEL`), each runs the right script with `spawn` (arguments as an array, minimal environment without Nexus' secrets, own process group so pause / cancel also stop ffmpeg and the browser), reads its JSON Lines and saves the progress; jobs left running by a restart go back to the queue
- Admin API: `POST /api/downloads/search` (the four scripts in parallel, results streamed over Socket.io `/downloads` as `download:search_result`, one `download:search_done` per script, timeout per script), `GET /api/downloads/details`, `POST /api/downloads`, `GET /api/downloads`, `POST /api/downloads/:id/pause|resume|cancel|retry`, `DELETE /api/downloads/:id`; live `download:status` / `download:progress`
- Strict validation of ids, languages, seasons and episode / chapter lists; duplicates (same title and episodes / chapters already queued or done) answer 409 with the list instead of downloading again, unless forced
- When a download finishes, the library of its type is rescanned so it appears at once
- Search posters go through `/api/images/remote`, a cached image proxy that only serves URLs signed by the server
- `migrate-db.sh` gives tables created by migrations to the database owner

### Added — download scripts usable by Nexus (step 1 of « Téléchargements »)
- `downloaders/`: copies of the scripts of `/media/scripts` (anisama, films, movix, youtube; the originals stay untouched as a backup) with a non-interactive mode: `--json --search`, `--details`, `--download <id> [--season] [--lang] [--episodes|--chapters] --dest`. Output is JSON Lines (`result`, `details`, `item_start`, `progress`, `item_done`, `item_skipped`, `error`, `done`); without `--json` the menus work as before
- anisama: one title gives an `anime` and/or a `manga` result (season links vs `scan/` links of the site), with poster and synopsis kept in its catalogue; fixed for the site's new video host (ansembed) and dead mirror domains (each request now sends its own site as Referer)
- movix: the TMDB key is no longer written in the script (`TMDB_API_KEY` from the environment / Nexus' `.env`)
- youtube: search through yt-dlp metadata (thumbnail, duration, channel); downloads go to `/media/youtube/{Chaîne}/{Titre} [id].mp4` with the thumbnail `.jpg` (same name, also embedded) and `.info.json`
- Files being downloaded are named `.part-…` and renamed when complete, so a cut download is never taken for a finished one
- CI compiles the scripts and runs their unit tests

### Fixed — services and overview show the real state of the server
- Services are read from systemd (`systemctl show`) instead of `is-active`, which answered "inactive" for units that do not exist: services that are not installed now show "Non installé" (hidden from Aperçu) instead of "Arrêté"
- Cockpit is socket-activated: it now shows "Actif · à la demande" when its socket is listening, instead of "Arrêté"; Démarrer / Arrêter / Redémarrer act on the socket too, and its journal includes both units
- Wi-Fi uses the network manager actually installed (`WIFI_SERVICE`, wifi, NetworkManager, iwd, wpa_supplicant, systemd-networkd); the Wi-Fi watchdog and automatic deployment are listed too
- Service details: since when, memory used, started at boot, systemd units; states "Démarrage…" / "Arrêt…" are shown instead of "État inconnu"
- Memory in Aperçu no longer counts the Linux disk cache as used (total − available, like htop); free disk space is the space really writable

### Changed — Apple-like motion
- Buttons, links and cards shrink slightly under the finger / click and spring back when released (cards press more softly); list rows highlight at once and fade out on release, like iOS lists
- Pages slide in like iOS navigation on phones (push from the right, back from the left, fade between tabs) and fade in on Mac / iPad; each page keeps its own scroll position (a new page opens at the top, "back" returns where you were)
- Segmented controls: the selected thumb slides to the new choice; switches: the knob stretches while pressed; tab bar icons bounce when chosen; context menus pop open from where they were asked; artwork fades in once loaded
- Everything follows "Reduce motion"

### Fixed
- MangaDex matched the wrong title (a "One Piece" folder got "One Piece: Ace's Story—The Manga"): MangaDex sorted its results by latest upload, so licensed series without chapters on the site fell behind their spin-offs. The search now asks for relevance order, also compares alternative titles, ignores punctuation / accents, and prefers the closest title over one that only starts the same way
- A rescan now replaces a wrong MangaDex match already stored (title, cover, synopsis, genres); when MangaDex does not answer, the stored data is kept

### Removed
- The Scripts page (running `.py` / `.sh` files from `/media/scripts`) and its `/api/scripts` routes: it did not work and the space will be used for something else

### Changed — manga pages served like manga sites
- New `GET /api/media/chapters/:id/page/:n?w=` (stream token): every page (image folder, CBZ or PDF) is converted once by the server to a light WebP at the screen's width (sharp; PDFs via poppler `pdftoppm`), kept in `backend/cache/pages` and sent with an immutable cache header. A 2 MB scan becomes a few hundred KB; PDFs are no longer downloaded and drawn by the phone
- The server prepares the next 3 pages while one is read, and the reader downloads the next 4 in the background: turning the page is instant
- `deploy.sh` / `setup-server.sh` install `poppler-utils`; without it, PDF chapters fall back to PDF.js on the phone

### Changed — manga: first pages first, chapters kept on the device
- The server now answers Range requests for PDFs too (206): PDF.js only downloads what the page being read needs (first page of a 71 MB volume: ~2 MB instead of the whole file)
- Pages already read (PDF and images) are kept on the device (Cache Storage, last 40 chapters): coming back to a chapter shows them without downloading anything again. Needs HTTPS (or localhost); without it, reading works without the cache

### Fixed
- Manga PDF chapters stayed blank / loading on iPhone: they are now read with PDF.js (Mozilla's PDF reader, works in Safari) inside the Nexus reader, with the same modes as image chapters. The PDF is downloaded in one request (progress shown) because the server answers range requests with the whole file, which broke PDF.js and Safari's own viewer on big PDFs; pages are drawn only when they come near the screen
- Notifications were unreadable in dark mode (white text on the toast library's white background)

### Changed — interface redesigned like a native Apple app
- One design system in `src/design/tokens.css` (colours light / dark, type scale per device, radii, 4/8 spacing, motion, materials); Tailwind only reads these tokens. System font (SF Pro / SF Mono), Geist removed. One accent (system blue); green / orange / red only for states; darker accessible variants for coloured text (WCAG AA)
- Appearance Auto / Clair / Sombre (Auto follows the device and stays local; the server keeps storing light / dark)
- Adaptive app frame: translucent sidebar and toolbar on desktop (⌘K quick search, ⌘, for Réglages), collapsible sidebar on tablets, tab bar (Aperçu, Médias, Manga, Terminal, Réglages), Large Titles and back buttons on phones
- Components: Button, Toggle, SegmentedControl, TextField, GroupedList / ListRow, Sheet (macOS sheet / iOS bottom sheet with swipe to dismiss), ActionSheet, ContextMenu (right click / long press), StatSparkline, CapacityBar, EmptyState, Skeleton, Spinner; confirmations as macOS alerts / iOS action sheets; notifications as banners
- Overview like Activity Monitor (live 3-minute graphs), library like the TV app (featured title, shelves, Finder-like list view), title pages inside the app frame, AVKit-style player controls, Books-style manga reader, Terminal.app theme in light and dark, Finder / Files-like file manager (selection, keyboard, path bar, selection mode on phones), Services as list + detail, Réglages and Réseau as grouped lists, Apple ID-style sign-in
- PWA: manifest, app icon, Apple web-app meta tags (installable on the home screen)
- French units everywhere (6,1 Go, 2,4 Mo/s, 23 %); no emoji, no gradients, glows or neon; old styles, `StatCard`, `ServiceRow`, `notify.tsx` and the unused Plyr stylesheet removed
- Removed the overview's "Redémarrer" and "Mises à jour" buttons: they only displayed a message and did nothing
- Stopping or restarting a service now asks for confirmation (it can cut access to Nexus)

### Changed — immediate automatic deployment
- GitHub webhook `POST /api/deploy/webhook` (HMAC `X-Hub-Signature-256` with `DEPLOY_WEBHOOK_SECRET`, event "Workflow runs"): when the CI of a push to `main` is green, Nexus writes `logs/.deploy-request` and the systemd unit `nexus-auto-deploy.path` deploys immediately
- `auto-deploy.sh install` creates the secret in `backend/.env`, restarts Nexus and prints the webhook settings for GitHub; the timer becomes a 10-minute safety net; commits merged during a deployment are deployed right after it

### Added — automatic deployment
- `scripts/auto-deploy.sh install`: the server checks `main` every 2 minutes and runs `deploy.sh` by itself once the commit's CI is green (red CI → skipped; failing deployment retried 3 times; one run at a time; no CI result after 15 min → deployed anyway). Pull-based: no inbound SSH or GitHub secret. `status` shows the running version vs GitHub and the last deployments
- The disabled SSH "Deploy to Server" CI job is removed

### Fixed
- `wifi-watchdog.sh install` crashed with "Segmentation fault": its `install` function called itself instead of the `install` command

### Added — Wi-Fi watchdog for USB dongles
- `scripts/wifi-watchdog.sh install`: checks the Internet every minute (systemd timer, independent of Nexus) and repairs step by step — Wi-Fi service restart, interface down/up, then software USB replug of the dongle; turns off Wi-Fi power saving and USB autosuspend for the dongle. `status` shows the last repairs
- `deploy.sh` says clearly when the server has no Internet instead of a raw git error

### Added — full server access from Nexus
- File manager administrator mode: when an action is refused for lack of rights and the Nexus account has passwordless sudo, it is done with sudo — create folder/file, edit, rename, move (also between disks), delete, upload, list/read protected folders. What Nexus creates belongs to its account; an edited system file keeps its owner. `FILES_SUDO=off` disables it
- Terminal like Cockpit: real login shell of the account with a clean environment (Nexus' secrets are no longer inherited), `xterm-256color`, session kept on the server when leaving the page / losing the network (output replayed on return, closed after `TERMINAL_IDLE_MINUTES`, default 60), font size, copy / paste (Ctrl+Shift+C / V), clickable links, Unicode, "Réinitialiser", "Nouvelle session" after `exit`, "Reprendre ici" when opened elsewhere
- `deploy.sh` gives the library folders back to the Nexus account automatically when sudo needs no password
- Clear error messages for create / rename / upload / edit in the file manager

### Fixed
- Uploaded file names with accents were garbled ("Ã‰pisode")

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
