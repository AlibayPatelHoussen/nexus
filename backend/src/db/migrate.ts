import { Client } from 'pg'
import fs from 'fs'
import path from 'path'

async function migrate() {
  const client = new Client({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'nexus',
    user:     process.env.DB_USER     || 'nexus_user',
    password: process.env.DB_PASSWORD || '',
  })

  await client.connect()

  const reset = process.argv.includes('--reset')
  if (reset) {
    await client.query('DROP SCHEMA public CASCADE')
    await client.query('CREATE SCHEMA public')
    await client.query('GRANT ALL ON SCHEMA public TO PUBLIC')
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
  await client.query(schema)

  // Incremental patches — safe to run multiple times
  await client.query(`ALTER TABLE chapters ADD COLUMN IF NOT EXISTS language VARCHAR(10)`)
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chapters_folder_path_key'
      ) THEN
        -- Remove duplicate folder_paths before adding unique constraint
        DELETE FROM chapters a USING chapters b
          WHERE a.id > b.id AND a.folder_path = b.folder_path;
        ALTER TABLE chapters ADD CONSTRAINT chapters_folder_path_key UNIQUE (folder_path);
      END IF;
    END $$
  `)

  await client.end()
  process.stdout.write('Migrations complete\n')
}

migrate().catch((err) => { console.error(err); process.exit(1) })
