import { config } from 'dotenv'
import { resolve } from 'path'
import { Pool } from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
import { logger } from '../utils/logger'

// __dirname = dist/config/ → ../../.env = backend/.env
config({ path: resolve(__dirname, '../../.env') })

export const db = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'nexus',
  user:     process.env.DB_USER     || 'nexus_houssen',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

db.on('error', (err) => {
  logger.error('Unexpected DB error', { stack: err.stack })
})

export async function connectDB(): Promise<void> {
  const client = await db.connect()
  client.release()
  logger.info('PostgreSQL connected')
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  const start  = Date.now()
  const result = await db.query<T>(text, params)
  const duration = Date.now() - start

  if (duration > 1000) {
    logger.warn(`Slow query (${duration}ms): ${text}`)
  }

  return result
}

/** Run `fn` inside a transaction on a dedicated client (ROLLBACK on error). */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
