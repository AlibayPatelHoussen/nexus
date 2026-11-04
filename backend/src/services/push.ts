import fs from 'fs'
import path from 'path'
import webpush from 'web-push'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import { ValidationError } from '../utils/errors'

/**
 * Web Push (PWA notifications): the browser of each device gives a
 * subscription, the server signs its messages with its VAPID keys; Apple /
 * Google / Mozilla deliver them, encrypted end to end.
 *
 * Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY from .env, else generated once
 * and kept in backend/data/vapid.json (not versioned).
 */
const KEY_FILE = process.env.VAPID_FILE || path.resolve(__dirname, '../../data/vapid.json')
let keys: { publicKey: string; privateKey: string } | null = null

function vapid() {
  if (keys) return keys
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  } else {
    try {
      keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))
    } catch {
      keys = webpush.generateVAPIDKeys()
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true })
      fs.writeFileSync(KEY_FILE, JSON.stringify(keys), { mode: 0o600 })
      logger.info(`Web Push keys generated in ${KEY_FILE}`)
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost', keys!.publicKey, keys!.privateKey)
  return keys!
}

export const publicKey = () => vapid().publicKey

export interface PushSubscriptionInput { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }

export async function subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string) {
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : ''
  const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : ''
  if (!/^https:\/\/\S{10,2000}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw new ValidationError('Abonnement invalide')
  }
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, endpoint, p256dh, auth, (userAgent || '').slice(0, 300)],
  )
}

export async function unsubscribe(userId: string, endpoint: unknown) {
  if (typeof endpoint !== 'string') return
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint])
}

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** Sends to every device of these users; forgets devices that unsubscribed. */
export async function sendPush(userIds: string[], msg: PushMessage): Promise<number> {
  if (!userIds.length) return 0
  vapid()
  const { rows } = await query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])', [userIds],
  )
  let sent = 0
  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg), { TTL: 24 * 3600 })
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id])
      } else {
        logger.warn(`Push to ${new URL(s.endpoint).host} failed: ${status ?? ''} ${(err as Error).message}`)
      }
    }
  }))
  return sent
}

export async function deviceCount(userId: string) {
  const { rows } = await query<{ n: string }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = $1', [userId])
  return Number(rows[0]?.n || 0)
}
