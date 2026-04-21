# Contributing to Nexus

## Development Setup

```bash
git clone https://github.com/AlibayPatelHoussen/nexus.git
cd nexus
npm install
cp backend/.env.example backend/.env
# Fill in your .env values
npm run dev
```

## Branch Strategy

- `main` — production, auto-deploys to server
- `develop` — integration branch
- `feature/xxx` — feature branches

## Commit Convention

```
feat: add manga reader zoom controls
fix: terminal reconnects on socket drop
chore: update dependencies
docs: add deployment guide
test: add auth integration tests
refactor: extract media scanner to service
```

## Code Style

- TypeScript strict mode on both sides
- ESLint + Prettier (run `npm run lint:fix`)
- No `any` without a comment explaining why
- All API routes need authentication middleware

## Testing

```bash
# Run all tests
npm test

# Backend only
npm test --workspace=backend

# Frontend only
npm test --workspace=frontend

# Watch mode
npm run test:watch --workspace=frontend
```

Coverage thresholds: 70% branches/functions/lines/statements.

## Adding a New Page

1. Create `frontend/src/pages/yourpage/YourPage.tsx`
2. Add lazy import in `App.tsx`
3. Add route in `App.tsx`
4. Add nav item in `Layout.tsx`
5. Add backend route in `backend/src/routes/`
6. Register route in `backend/src/index.ts`
