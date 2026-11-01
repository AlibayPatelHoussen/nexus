import 'dotenv/config'
import { Client } from 'pg'
import fs from 'fs'
import path from 'path'

// Same logic as scripts/migrate-db.sh, for development and CI.
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

async function migrate() {
  const client = new Client({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'nexus',
    user:     process.env.DB_USER     || 'nexus_user',
    password: process.env.DB_PASSWORD || '',
  })

  await client.connect()

  try {
    if (process.argv.includes('--reset')) {
      await client.query('DROP SCHEMA public CASCADE')
      await client.query('CREATE SCHEMA public')
      await client.query('GRANT ALL ON SCHEMA public TO PUBLIC')
    }

    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
      : []
    const versionOf = (f: string) => path.basename(f, '.sql')

    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'`,
    )
    const fresh = rows.length === 0

    if (fresh) {
      // Fresh install: full schema already contains every migration
      await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8'))
      for (const f of files) {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [versionOf(f)],
        )
      }
      process.stdout.write(`Schema created (${files.length} migration(s) marked as applied)\n`)
      return
    }

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
    )

    for (const f of files) {
      const version = versionOf(f)
      if (applied.has(version)) continue
      process.stdout.write(`Applying ${version}…\n`)
      try {
        await client.query('BEGIN')
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'))
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    process.stdout.write('Migrations complete\n')
  } finally {
    await client.end()
  }
}

migrate().catch((err) => { console.error(err); process.exit(1) })
