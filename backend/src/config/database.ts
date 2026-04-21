import { Pool } from 'pg'
import { logger } from '../utils/logger'

export const db = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'nexus',
  user:     process.env.DB_USER     || 'nexus_user',
  password: process.env.DB_PASSWORD || '',
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

// Helper for typed queries
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  const start = Date.now()
  const result = await db.query<T>(text, params)
  const duration = Date.now() - start

  if (duration > 1000) {
    logger.warn(`Slow query (${duration}ms): ${text}`)
  }

  return result
}
