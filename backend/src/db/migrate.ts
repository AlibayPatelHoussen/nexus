import 'dotenv/config'
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

  // Only run full schema on fresh install (tables don't exist yet)
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'`
  )
  if (rows.length === 0) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
    await client.query(schema)
  }

  await client.end()
  process.stdout.write('Migrations complete\n')
}

migrate().catch((err) => { console.error(err); process.exit(1) })
