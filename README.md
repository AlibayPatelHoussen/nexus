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
- **Jarvis assistant** — chat (voice too) with the local AI assistant running on the server ([jarvis-backend](https://github.com/AlibayPatelHoussen/jarvis-backend)), relayed by Nexus
- **Real-time stats** — CPU, RAM, disk, temperature via WebSocket
- **Dark/Light theme**
- **JWT authentication** with bcrypt hashing
- **Accounts** — admins have everything; « user » accounts get the media, manga, their own downloads (automatic ones too), their settings and the storage (no Jarvis, services, files, terminal). Admins create user accounts in *Réglages › Utilisateurs*, optionally for a limited time (1 month, 6 months, 1 year or any date); admin accounts are only made and deleted in the terminal (`bash scripts/create-admin.sh`, `bash scripts/delete-account.sh`)
- **Connected devices** — every sign-in is recorded (device, IP, approximate place from Cloudflare), refused ones too; *Réglages › Appareils connectés* signs a device out at once; a new device notifies the admins. A new password signs the account's other devices out (session version)
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

GET    /api/jarvis/status
GET    /api/jarvis/history
POST   /api/jarvis/chat          (Server-Sent Events)
POST   /api/jarvis/chat/confirm
GET    /api/jarvis/approvals
POST   /api/jarvis/approvals/:id
POST   /api/jarvis/clear
```

### Jarvis

Jarvis runs as its own service on the server (see the jarvis-backend repository,
`docs/SERVEUR.md`). Create its key for Nexus, then set it in `backend/.env`:

```bash
cd /opt/jarvis && sudo -u jarvis .venv/bin/python start.py cles ajouter nexus --role admin --confiance
```

```
JARVIS_URL=http://127.0.0.1:8765
JARVIS_API_KEY=jv_...
JARVIS_OWNER=houssen   # this Nexus account shares the memory of the Jarvis terminal
JARVIS_TOOLS_SECRET=…  # lets Jarvis download, scan the library, open IPTV channels
```

With `JARVIS_TOOLS_SECRET` set (and the same value as `JARVIS_HOST_SECRET` plus
`JARVIS_HOST_TOOLS_URL=http://127.0.0.1:3001/api/jarvis/tools` in Jarvis' `.env`),
Jarvis can act in Nexus: downloads, library report and scans, IPTV channels —
with the rights of the Nexus account it talks for.

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

**Private repository:** the server then needs a read-only token to pull `main`
and read the CI result. Create a fine-grained token on GitHub (*Settings →
Developer settings → Fine-grained tokens*, this repository only, permissions
**Contents** and **Checks** read-only), then run
`sudo bash scripts/auto-deploy.sh set-token` (it checks the token right away).
The token is kept in `/etc/default/nexus-auto-deploy` (root and the Nexus user
only) and given to git through environment variables, never on a command line
nor in `.git/config`. Save it **before** making the repository private, and
again when it expires.

### Wi-Fi watchdog (USB dongle)

`sudo bash scripts/wifi-watchdog.sh install` repairs a USB Wi-Fi dongle that
stops working (service restart → interface down/up → USB replug).

The UI also shows a warning banner when the backend does not run the same build
as the interface, and *Paramètres → Version* displays both versions.

Expose the app (backend serving the built frontend) via Cloudflare Tunnel:
```
nexus.houssen-serveur.com → localhost:3001
```
To see the city of each sign-in (not only the country) in *Réglages › Appareils connectés*,
turn on **Add visitor location headers** once in the Cloudflare dashboard (*Rules → Settings →
Managed Transforms*). Nexus only trusts those headers when the request comes through the
tunnel (from the same machine).

### VPN for the IPTV only

To watch another country's channels, the IPTV (streams, checks, guide, YouTube / Twitch
lives) can leave through a WireGuard VPN while the rest of Nexus keeps the normal
connection. With the WireGuard file of your provider (Mullvad, Proton VPN…):
```
sudo bash scripts/iptv-vpn.sh install /path/to/provider.conf   # changing country: install again
bash scripts/iptv-vpn.sh status
sudo bash scripts/iptv-vpn.sh uninstall
```
It installs wireproxy (WireGuard in user space, pinned version checked by SHA-256, no
change to the server's routes) as `nexus-iptv-vpn.service`, a local HTTP proxy on
127.0.0.1:25345, and sets `IPTV_PROXY` in `backend/.env`. If the VPN is down, the IPTV
stops instead of going out directly. *IPTV › Paramètres › VPN* shows its state, exit country and IP,
and « Utiliser le VPN » switches it off and on again without the terminal.

### The IPTV at its own address

Accounts made in *Réglages › Utilisateurs* open « Médias + IPTV », « Médias » or « IPTV
seulement » (changed at once on the account's sheet). For the IPTV, add a second public
hostname to the **same** tunnel and service as Nexus:
```
iptv.houssen-serveur.com → localhost:3001
```
then enter it in *IPTV › Paramètres › Adresse de l’IPTV*. At that address Nexus shows the IPTV
only; « IPTV seulement » accounts are sent there to sign in.

Admin accounts: `bash scripts/create-admin.sh` (asks the name, e-mail and password; on an
existing account it resets the password and signs it out everywhere). Delete an account
(admin or user): `bash scripts/delete-account.sh <name>` (asks to type the name again; never
the last admin).

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
