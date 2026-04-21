# Nexus

> Self-hosted server control panel & media center — control everything from one place.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)
![CI](https://github.com/AlibayPatelHoussen/nexus/actions/workflows/ci.yml/badge.svg)

## Features

- **Full server control** — files, services, terminal, network, users
- **Media center** — films, series, animes, manga/webtoon with metadata from TMDB & AniList
- **Custom video player** — resume, favorites, subtitles, history
- **Manga/Webtoon reader** — vertical scroll & page mode
- **Real-time stats** — CPU, RAM, disk, temperature via WebSocket
- **Dark/Light theme**
- **JWT authentication** with bcrypt hashing
- **Role-based access control**

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

# Setup database
createdb nexus
psql nexus < backend/src/db/schema.sql

# Start development
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:3001

### Environment Variables

See [`backend/.env.example`](backend/.env.example) for all required variables.

Key variables:
- `JWT_SECRET` — minimum 64 characters, random string
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
│       ├── services/       # Business logic
│       ├── models/         # DB queries
│       ├── db/             # Schema & migrations
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

POST   /api/scripts/:name/run
GET    /api/terminal (WebSocket)
```

## Production Deployment

```bash
# On your server
git clone https://github.com/AlibayPatelHoussen/nexus.git /opt/nexus
cd /opt/nexus
npm ci --omit=dev
npm run build

# Start with PM2
pm2 start backend/dist/index.js --name nexus-backend
pm2 save
```

Expose via Cloudflare Tunnel:
```
nexus.houssen-serveur.com → localhost:5173 (or 3001 if serving static files)
```

## License

MIT
