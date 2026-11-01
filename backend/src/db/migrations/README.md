# Database migrations

`schema.sql` always describes the **full, current** schema and is applied only
on a fresh database. Every later change goes into a new numbered file here
(`002_add_something.sql`, `003_…`) **and** into `schema.sql`.

Applied versions are recorded in the `schema_migrations` table. On a fresh
install, all migrations present at that time are marked as applied without
running them (their effect is already in `schema.sql`).

- Production: `scripts/migrate-db.sh` (runs as the `postgres` superuser, called by `deploy.sh`)
- Development / CI: `npm run db:migrate --workspace=backend` (runs as `DB_USER`)

Each file runs in a single transaction. Keep migrations idempotent when possible
(`IF NOT EXISTS`, `DO $$ … $$` guards).
