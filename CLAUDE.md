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

- Branch `claude/eloquent-darwin-19tvre`; PR to `main`, green CI, squash-merge without asking.
- Checks: `python3 -m unittest discover downloaders`, backend `npm test` (see e2e/setup.sh for the
  test database), `npm run e2e`, frontend `npx tsc --noEmit && npx eslint src --quiet && npx vitest run`.
- Never show secrets (.env). `/media/scripts` holds the owner's original scripts: never modify them.
