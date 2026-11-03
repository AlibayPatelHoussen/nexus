# Nexus

> Self-hosted server control panel & media center — control everything from one place.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)
![CI](https://github.com/AlibayPatelHoussen/nexus/actions/workflows/ci.yml/badge.svg)

## Features

- **Full server control** — files, services, terminal, network, users
- **Media center** — films, series, animes, manga/webtoon with metadata from TMDB & AniList
- **Custom video player** — resume, favorites, history; plays every format in the browser (MKV, AVI, HEVC… converted on the fly with ffmpeg, like Jellyfin)
- **Manga/Webtoon reader** — vertical scroll & page mode
- **Real-time stats** — CPU, RAM, disk, temperature via WebSocket
- **Dark/Light theme**
- **JWT authentication** with bcrypt hashing
- **Role-based access control** — file manager, terminal and service control are admin-only
- **Rate limiting** on login and API

## Stack

| Layer     | Tech |
|-----------|------|
| Frontend  | React 18, Vite, TypeScript, TailwindCSS, Zustand, React Query |
| Backend   | Node.js, Express, TypeScript, Socket.io |
| Database  | PostgreSQL 16 |
| Auth      | JWT + bcrypt |
| Icons     | Lucide React |
| Player    | Plyr (custom skin) |
| CI/CD     | GitHub Actions |

## Getting Started

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 16
- npm >= 10

### Installation

```bash
# Clone the repo
git clone https://github.com/AlibayPatelHoussen/nexus.git
cd nexus

# Install all dependencies (root + workspaces)
npm install

# Setup environment
cp backend/.env.example backend/.env
# Edit backend/.env with your values

# Setup database (creates the schema, then applies pending migrations)
createdb nexus
npm run db:migrate --workspace=backend

# Start development
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:3001

### Environment Variables

See [`backend/.env.example`](backend/.env.example) for all required variables.

Key variables:
- `JWT_SECRET` — minimum 64 characters, random string (`JWT_REFRESH_SECRET` recommended too)
- `MEDIA_ROOT` — non-admin users can only stream files inside this directory
- `TMDB_API_KEY` — get one free at [themoviedb.org](https://www.themoviedb.org/settings/api)
- `DB_*` — PostgreSQL connection details

## Project Structure

```
nexus/
├── frontend/               # React + Vite app
│   └── src/
│       ├── components/     # Reusable UI components
│       ├── pages/          # Page components
│       ├── hooks/          # Custom hooks
│       ├── stores/         # Zustand stores
│       ├── services/       # API calls
│       └── types/          # TypeScript types
│
├── backend/                # Express API
│   └── src/
│       ├── routes/         # Express routers
│       ├── controllers/    # Route handlers
│       ├── middleware/     # Auth, error handling
│       ├── services/       # Business logic + DB queries
│       ├── db/             # schema.sql, migrations/, migrate.ts
│       └── utils/          # Logger, helpers
│
└── .github/
    └── workflows/
        └── ci.yml          # CI/CD pipeline
```

## CI/CD

Every push to `main` or `develop`:
1. **Lint** — ESLint on both workspaces
2. **Typecheck** — TypeScript strict mode
3. **Tests** — Jest (backend) + Vitest (frontend) with PostgreSQL service
4. **Build** — compile both workspaces
5. **Deploy** — SSH deploy to server (main branch only)

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | Your server IP or domain |
| `SERVER_USER` | SSH username |
| `SERVER_SSH_KEY` | Private SSH key |

## API Endpoints

```
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh

GET    /api/system/stats
GET    /api/system/info

GET    /api/files?path=/
POST   /api/files/create
DELETE /api/files
PATCH  /api/files/rename

GET    /api/media/films
GET    /api/media/series
GET    /api/media/animes
GET    /api/media/manga
GET    /api/media/:id
POST   /api/media/scan

GET    /api/services
PATCH  /api/services/:name/toggle
GET    /api/services/:name/logs

GET    /api/terminal (WebSocket)
```

## Production Deployment

First install (Ubuntu): `bash scripts/setup-server.sh` (PostgreSQL, `.env`, schema, admin user).

Every update:

```bash
cd /opt/nexus && bash scripts/deploy.sh
```

`deploy.sh` pulls `main`, installs dependencies, builds backend **and** frontend,
applies database migrations, restarts PM2 and then **checks that the backend
answering on the port is the new build**. It must end with
`✅ Deployment complete! Backend <commit> is running…`; otherwise it prints why
(old process still holding the port, migration error…) and what to run.

### Automatic deployment (recommended)

```bash
cd /opt/nexus && sudo bash scripts/auto-deploy.sh install
```

As soon as the CI of `main` is green, GitHub calls Nexus
(`/api/deploy/webhook`, signed with `DEPLOY_WEBHOOK_SECRET`) and the server
deploys right away (systemd unit `nexus-auto-deploy.path`, outside Nexus since
deploying restarts it). `install` creates the secret and prints the webhook to
add once on GitHub (*Settings → Webhooks*, event **Workflow runs**). A check every
10 minutes is the safety net (missed webhook, Wi-Fi down). Red CI → not deployed;
a failing deployment is retried 3 times then left alone (the running version
keeps working); commits merged during a deployment are deployed right after.
`bash scripts/auto-deploy.sh status` shows the running version, GitHub's, the
last webhook and the last deployments (log: `logs/auto-deploy.log`).

### Wi-Fi watchdog (USB dongle)

`sudo bash scripts/wifi-watchdog.sh install` repairs a USB Wi-Fi dongle that
stops working (service restart → interface down/up → USB replug).

The UI also shows a warning banner when the backend does not run the same build
as the interface, and *Paramètres → Version* displays both versions.

Expose the app (backend serving the built frontend) via Cloudflare Tunnel:
```
nexus.houssen-serveur.com → localhost:3001
```

### Troubleshooting
| Symptom | Fix |
|---|---|
| Banner "Le serveur n'est pas à jour" / player "Lecture impossible (backend pas à jour)" | re-run `bash scripts/deploy.sh` and read its last lines |
| Log `Port 3001 is already in use` | an old process holds the port: `sudo fuser -k 3001/tcp && pm2 restart nexus-backend` |
| Orange "Clé TMDB absente" notice, no posters | set `TMDB_API_KEY` in `backend/.env`, redeploy, then scan |
| MKV/AVI/HEVC videos do not play | the server converts them with ffmpeg: check `ffmpeg -version` (install with `sudo apt-get install -y ffmpeg`) |

## Testing

```bash
npm test          # backend (Jest) + frontend (Vitest) unit/integration tests
npm run e2e       # end-to-end tests on the production build (see e2e/README.md)
```

## License

MIT
