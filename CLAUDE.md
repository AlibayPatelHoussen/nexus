# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Nexus — rules for every change

Nexus is a self-hosted server panel and media center (backend Node/Express +
PostgreSQL, frontend React + Vite + Tailwind, download scripts in Python in
`downloaders/`). Answer the owner in French.

## Commands

npm workspaces (`frontend`, `backend`); run from the repo root unless noted.

- Dev: `npm run dev` (backend `tsx watch` on :3001 + Vite on :5173). DB schema: `npm run db:migrate -w backend`.
- Frontend checks (in `frontend/`): `npx tsc --noEmit && npx eslint src --quiet && npx vitest run`;
  one test: `npx vitest run src/path/file.test.ts -t "name"`.
- Backend (in `backend/`): `npm test` (jest, needs PostgreSQL); one test: `npx jest tests/unit/foo.test.ts -t "name"`;
  `npm run typecheck`, `npm run lint`.
- Python downloaders: `python3 -m unittest discover downloaders`.
- E2E: `npm run e2e` = `bash e2e/setup.sh` (throw-away PostgreSQL on port 5434 under `/tmp/nexus-e2e`,
  generated media files, a mock TMDB / AniList / MangaDex / IMDb server `e2e/mock-metadata.mjs`, the
  built backend on :3101 serving `frontend/dist`) then `node e2e/run.mjs` (API + Playwright tests, phone
  viewport by default). Users admin/Admin1234, alice/User12345. `bash e2e/setup.sh restart-backend`
  after backend changes, `npm run e2e:stop` to stop. Rebuild the frontend before E2E or screenshots.
- CI (`.github/workflows/ci.yml`): lint + typecheck, backend tests with PostgreSQL + Python tests, frontend
  tests, build. A green `main` triggers the deploy webhook (below).

## Architecture

- **Backend** (`backend/src`): Express routers in `routes/`, logic and SQL in `services/` (plain `pg`
  via `config/database.ts` `query()`, no ORM). Rows are mapped to camelCase API objects in the
  services (e.g. `mapMedia` in `services/media.ts`). Socket.io namespaces in `socket.ts`: live stats,
  terminal (node-pty), download progress. Admin-only areas use `requireAdmin`.
- **Accounts and sessions**: `admin` has everything; `user` accounts get médias, manga, their own downloads
  (queue, socket events and notifications only for the account that asked), automatic downloads (one follow per
  title, owned by whoever switched it on), their own settings (appearance, name, password) and the storage (stats
  reduced to `disk` + `mediaStorage`); the frontend hides the rest (`adminOnly` in `components/shell/nav.ts`,
  `AdminOnly` routes). Admin accounts are only made / deleted in the terminal (`scripts/create-admin.sh`,
  `scripts/delete-account.sh`, which keeps the last admin; both are out of Git on purpose — `.gitignore`, kept on the
  server by `deploy.sh` and in the backups — never add them back); `/api/users` makes `user` accounts, optionally with
  `expires_at`, and manages the sign-in journal. Each sign-in opens a device session (`refresh_tokens`: device, IP, place
  from Cloudflare headers via `utils/device.ts`) and is journaled (`login_events`). Tokens carry the session
  (`sid`) and the account's `session_version` (`sv`); `services/sessions.ts` checks them on every request, stream
  and socket (5 s cache, `forgetSessions()` after a change): a new password bumps the version (other devices out).
  Each `user` account's access (`users.can_media`, `can_iptv`: « Médias + IPTV », « Médias », « IPTV seulement »)
  is enforced by `requireMedia` / `requireIptv` (routes, streams, socket `guard('media')`) and followed by the
  frontend (`components/shell/access.ts`: `useAccess`, `canSee`, `need` in `nav.ts`, `Need` routes). Nexus opened at
  the IPTV's own address (IPTV settings `publicUrl`, given by `/api/health.iptvUrl`, or any `iptv.` host) shows the
  IPTV and the settings only; « IPTV seulement » accounts are sent there. « user » accounts (and accounts without the
  media) have the IPTV apart: its own iPhone tab and sidebar section « Télévision » (`iptvTab`); admins find it under Médias.
- **Database**: `backend/src/db/schema.sql` is the full current schema (fresh installs); every change also gets a
  numbered file in `backend/src/db/migrations/` (see its README). Both must stay in sync.
- **Media library**: `services/scanner.ts` walks the media folders, looks titles up on TMDB / AniList /
  MangaDex and upserts `media_items` / episodes / chapters. Background enrichment (`services/imdb.ts`,
  `services/artwork.ts`, after scans and daily): IMDb ids + ratings from the official dataset, Apple
  TV-style artwork (textless key art, title logo) from TMDB `/images`. Remote artwork is never sent to
  the browser directly: `services/images.ts` + `routes/images.ts` proxy and cache it
  (`/api/images/media/:id/:field`).
- **Downloads**: `services/downloadScripts.ts` runs the Python scripts of `downloaders/` in `--json`
  mode (argument arrays, validated values, minimal env); `services/downloads.ts` keeps the queue,
  `follows.ts` auto-downloads new episodes, `downloadNotifications.ts` + `push.ts` send web push.
  `downloaders/` are copies of the owner's scripts with a non-interactive mode.
  The films site moves domains: `films.py` keeps the working address in `downloaders/data/films_site.json` and follows
  the site itself (`site_url()`: redirect, « nouvelle adresse » page, addresses seen before; never private hosts); admins
  see / paste it in Réglages › Bibliothèque › Site de films (`services/filmsSite.ts`, `GET|PUT /api/downloads/films-site`).
  After each films.py run (`onScriptEnd`) and every 6 h (`films.py --site`), `syncFilmsSite` compares the file's `ok` / `url`
  with what admins were told (`app_settings('films_site')`) and pushes « en panne », « nouvelle adresse », « à toi de jouer »,
  « ça remarche » once per change.
- **IPTV**: `downloaders/iptv/` (standard library only) builds one catalogue from the iptv-org API and the
  Free-TV playlist (`freetv.py`), checks streams, and looks up the stream behind a YouTube / Twitch /
  Dailymotion live page with yt-dlp (`resolver.py`). `services/iptv.ts` keeps it in the `iptv_*` tables
  (priority countries first, background checks a few at a time; every hour `iptv_cli.py changed` asks the sources
  with conditional requests, and the catalogue is refreshed as soon as one published a new version, daily at the latest); `services/iptvProxy.ts` relays streams
  through signed addresses (a stream address never reaches the browser). A stream that plays with sound
  only (MPEG-2, HEVC…) is converted live by ffmpeg, which reads it through the relay
  (`services/iptvConvert.ts`; the player's side is `pages/iptv/picture.ts`). Pages in `pages/iptv/`.
  Optional VPN for the IPTV only (`services/iptvVpn.ts`): with `IPTV_PROXY` (the local HTTP proxy of wireproxy,
  installed by `scripts/iptv-vpn.sh`), the relay (`iptvFetch`, undici ProxyAgent) and the Python module (HTTP(S)_PROXY)
  go through it, nothing else of Nexus; VPN down = IPTV stops, never direct. Admins switch it off / on in the IPTV
  settings (`vpnEnabled`).
  « Mes chaînes » (`iptv_my_channels`, `services/iptvMyChannels.ts`): channels added by admins with their stream link
  (one, or an M3U list parsed on the server), written into `iptv_channels` as `my-<id>` with `mine_rank` (first in their
  country, kept by every refresh, never checked in the background). The link may hold credentials: never sent to a
  browser (host only). Their logo, when none is given: the same channel (name without HD/FHD, same country) in the
  catalogue, else in iptv-org's whole database (`logo_index`, kept in `iptv_meta('logos')` at each refresh).
- **Transfers** (Aperçu › Transferts, admins): `services/transfers.ts` + `routes/transfers.ts` keep files sent from one
  device in `TRANSFERS_DIR` (default `transfers/` of the installation, out of Git and backups) under their id, 7 days
  (`TRANSFERS_KEEP_DAYS`); socket namespace `/transfers` (`transfer:added` / `transfer:removed`, the sending page knows
  itself by `X-Nexus-Client`), push « Fichier reçu » to the other devices (`sendPush(…, { exceptSession })`), hourly
  clean-up. The file manager's `/api/files/zip` streams folders / selections as a stored .zip (yazl,
  `services/zipDownload.ts`). Downloads name files with `utils/contentDisposition.ts` (UTF-8 `filename*`).
  Frontend: `pages/dashboard/TransfersGroup.tsx`, `components/shell/TransferToasts.tsx`, `hooks/useUploads.ts`
  (progress, « Annuler », drag & drop), `components/files/UploadRows.tsx`. Every download goes through
  `utils/saveFile.tsx` with a link built inside the tap (`hooks/useStreamToken.ts`, token fetched ahead): in place in a
  browser; in the iPhone home-screen app the share sheet (≤ 1 GB) or the in-app browser sheet — never a page opened
  first and filled later (it stays « about:blank » there).
- **Episodes watched** (séries / animes, per account): `watch_history` (the player's progress; completed past 90 %), plus
  « Marquer comme vu / non vu » (`services/watchedEpisodes.ts`, `POST /api/media/:id/episodes/watched`; non vu deletes the row).
  `components/media/watchState.ts` (watched, `next` = in progress else after the furthest watched, specials aside) drives the play
  button (`MediaDetailPage`) and `PlayerPage` without `?ep`; long-press menu and « Sélectionner » in `EpisodesSection`
  (iPhone toolbar `components/ui/SelectionBar.tsx`, shared with the chapters).
- **Reading progress** (mangas, per account): `read_history` (page reached per chapter, `completed`), `services/readProgress.ts`
  (`GET|POST /api/media/:id/reading` « Marquer comme lu / non lu » — non lu clears that number in every version —,
  `POST /api/media/chapters/:id/reading` from the reader, debounced; the last page = read). Frontend:
  `components/media/readingState.ts` (read numbers across versions, `next` = chapter being read at its page, else the one after
  the furthest read) → « Commencer / Continuer · Chapitre N / Relire » in `MediaDetailPage`, « Lu » / « Page X sur Y » rows,
  long-press menu and « Sélectionner » mode in `ChaptersSection`; the reader opens at `?page=N`.
- **Mangas offline** (PWA, « Hors ligne » in `components/media/ChaptersSection.tsx`, off by default):
  `services/offlineManga.ts` keeps, per title, the next chapters from the one read last (`wantedChapters`, 5 / 10 / 25 /
  all) and the chapters chosen one by one (`index.manual`, ↓ on a row: kept until removed) in the reader's Cache Storage (`services/readerCache.ts`, same page keys; kept chapters are pinned out of its LRU
  via `services/offlineIndex.ts`, localStorage) plus each title's JSON and each chapter's page list (manifest) or whole
  PDF; the reader uses them first (`getChapterPages`, `usePdfDocument`), `mediaService.getById` falls back to them, the
  Manga library shows « Sur cet appareil » without a connection. `public/sw.js` keeps the app shell (`app-files.json`
  from the Vite plugin, cache `nexus-app-<version>`, matched with `ignoreVary`) and the kept titles' artwork, only
  while a title is kept (page → SW message `offline`). A failed refresh without a server answer never signs out.
- **Names for Jellyfin** (`services/renamer.ts`, `routes/rename.ts` → `/api/library/rename`, admins; UI
  `pages/settings/RenameRows.tsx`): films `Titre (Année) [tmdbid-N]/Titre (Année).ext`, shows `Titre (Année) [tmdbid-N]/Season NN/Titre
  SNNEMM.ext`. `planRenames` (preview) / `applyRenames` (under `MediaScanner.exclusive('rename')`): files moved (sudo fallback),
  then the rows in one transaction (same ids: progress, favourites); a folder made again by a script for a title already renamed
  joins it (`mergeInto`). Every move in `media_renames` by batch (`undoRenames`); `app_settings('rename').auto` (on by
  default) renames each finished download (`onDownloadFinished`). Never: files playing / written < 2 min, folders being
  downloaded. `downloads.removeReplaced` follows renamed paths; `downloaders/nexus_cli.series_folder` prefers Jellyfin-named folders.
- **Security**: secrets only in `backend/.env` (Nexus refuses to start without `JWT_SECRET`); the file manager never
  reads or changes secrets and leaves the Nexus folder read-only (`assertAllowed` in `services/files.ts`, code
  `PROTECTED_FILE`); `trust proxy` = loopback (cloudflared on this machine); http visitors via Cloudflare are
  redirected to https; JSON bodies 1 MB (11 MB for `/api/files/write` and `/api/iptv/my-channels/import`), uploads 5 GB per file (20 GB per
  transfer); passwords 8–72 characters. Backups:
  `scripts/backup.sh` (nightly and before pending migrations: pg_dump + settings to `/var/backups/nexus`; with
  `backup.sh drive`, each one also encrypted (gpg) to Google Drive through rclone, `drive.file` scope, token and
  passphrase in `/etc/nexus-backup`; with `backup.sh serveur`, a restic copy of the whole server (minus `/usr`, caches,
  venvs / node_modules, media files, files > 1 GB) plus a manifest in `/var/backups/nexus-server`, rebuilt on a new machine
  by `scripts/restaurer-serveur.sh`).
- **Deploy**: GitHub webhook `routes/deploy.ts` only writes a request file; `scripts/auto-deploy.sh`
  (systemd path unit) runs `scripts/deploy.sh` outside the app (build, `scripts/migrate-db.sh`, restart).
  Settings › Version compares interface and server commits.
- **Frontend** (`frontend/src`): React Router pages in `pages/`, React Query for server state,
  Zustand (`stores/authStore.ts`: session, appearance), API calls in `services/`. Shell:
  `components/shell/` (`AppShell` picks the desktop sidebar or the iPhone tab bar via `useShell().device`;
  `Page` is the scaffold every page uses: toolbar / navigation bar, large title, `hero`, `leading`,
  `barOverride`). Design system: `design/tokens.css` (all colours, radii, glass materials),
  `design/motion.ts` (springs), `index.css` (glass / bar utilities, shelves), `components/ui/*`,
  `components/media/*` (Hero billboard, MediaRow shelves, MediaCard, DetailHero, EpisodesSection).
  `cn()` in `utils` is tailwind-merge extended with the custom type scale and radii.
  Manga reader (`pages/player/MangaReaderPage.tsx`): on touch screens its own zoom (`components/media/readerZoom.ts`:
  pinch, double tap via `utils/doubleTap.ts`; vertical = the column's width, page by page = transform + pan, `PageFlip`
  `isLocked` while enlarged); the browser's page zoom is blocked there (`gesturestart`, two-finger `touchmove`).

## Design: iOS 26 / macOS 26 "Liquid Glass" — always

- The whole interface follows **iOS 26 / macOS 26 Liquid Glass** (WWDC 2025). Never the
  iOS 17 (or older) look: no flat grey bars with hairlines, no small rounded rectangles for buttons.
- **Sources, in this order when they disagree:** 1) Apple's official Figma kits
  (iOS & iPadOS: file `XAPnIBWdXCxvERbkNZLRIl`, macOS: file `9Ayp4YtfSedFV74qTqnPPD`, read
  through the Figma MCP), 2) Apple's Human Interface Guidelines, 3) the Apple TV app / tv.apple.com
  and the owner's screenshots, 4) the liquid-glass-design skills, 5) general knowledge.
- **Glass is for the navigation layer only**: sidebar, tab bar, toolbars, floating buttons,
  sheets, menus, popovers, player controls. Content (posters, lists, cards, text) stays opaque.
  Never glass on glass; one or two glass surfaces per screen.
  - `.glass` (small UI), `.glass-strong` (large UI), `.glass-clear` (over images / video): the
    translucent blur + saturation, the thin bright rim (kit: `1.25px 0 0 -0.75px`), specular top light.
- **Type:** the system font (`-apple-system` → SF Pro on Apple devices, Inter elsewhere). Big
  bold titles, clear hierarchy. SF Symbols / SF Pro files are never shipped (Apple license):
  icons are Lucide, sized and weighted like SF Symbols.
- **Shapes:** very round. Buttons, segmented controls, search fields, tab bar = capsules
  (`rounded-pill`). Concentric corners (inner radius = outer radius − inset).
- Light and dark mode, Apple system colours (`src/design/tokens.css`). Only the selected / primary
  element is tinted.
- **Motion:** springs everywhere (`src/design/motion.ts`, framer-motion), 60 fps (transform /
  opacity only). Press = small scale down, spring back. Selection capsules slide (`layoutId`).
  Skeletons, never spinners, for loading content.
- **Accessibility:** `prefers-reduced-motion` (MotionConfig reducedMotion="user" + CSS),
  `prefers-reduced-transparency`, `prefers-contrast`, contrast AA for text, keyboard navigation with
  visible focus, every icon-only control has a label, 44 px touch targets.
- **Navigation stays on the left** on desktop: the floating glass sidebar (macOS 26), same
  sections as today. On iPhone: the floating glass tab bar (iOS 26). Never remove a section.
- **Always reuse the design system** (`src/design/*`, `src/components/ui/*`, `src/components/media/*`).
  Never restyle by hand what a component already does; never hard-code colours, radii or durations
  (tokens only).
- Desktop **and** iPhone must both be right.
- **After every visual change, check with Playwright:** `npm run build -w frontend` then
  `node e2e/shots.mjs [page…]` (1440 px and 390 px, dark and light) and look at the images in
  `/tmp/nexus-e2e/shots/design/`. Compare with the kit / Apple TV, fix the differences.

## Workflow

- Work on the branch the session names (a `claude/…` branch); PR to `main`, green CI, squash-merge without asking.
  **Never ask the owner** whether to commit, push, open the PR or merge: after every change, do the whole
  chain yourself (checks → commit → push → PR → watch CI → fix if red → squash-merge), then tell the owner.
  If that branch's PR was already merged, merge `main` into it before the next change (no force-push).
- `.claude/settings.json` pre-approves the usual tools (shell, GitHub, messages to the owner's other
  sessions, reminders) so the owner is not asked each time; force-push, reading `.env` and touching
  `/media/scripts` stay denied.
- Checks: `python3 -m unittest discover downloaders`, backend `npm test` (see e2e/setup.sh for the
  test database), `npm run e2e`, frontend `npx tsc --noEmit && npx eslint src --quiet && npx vitest run`.
- Never show secrets (.env). `/media/scripts` holds the owner's original scripts: never modify them.
