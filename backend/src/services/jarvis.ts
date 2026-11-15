import { query } from '../config/database'
import { logger } from '../utils/logger'
import { AppError } from '../utils/errors'
import type { JwtPayload } from '../middleware/auth'
import { sendPush } from './push'

/**
 * Jarvis, the personal assistant, runs as its own service on the server
 * (repository jarvis-backend, API on 127.0.0.1:8765). Nexus relays its
 * users to it: the Jarvis key never reaches the browser.
 *
 * - JARVIS_URL      address of the Jarvis API (default http://127.0.0.1:8765)
 * - JARVIS_API_KEY  app key created on the Jarvis side with
 *                   `python start.py cles ajouter nexus --role admin --confiance`
 * - JARVIS_OWNER    Nexus username linked to the Jarvis owner: that account shares
 *                   the memory, tasks and reminders of the Jarvis terminal.
 *
 * Every Nexus account gets its own Jarvis (conversation, memory, tasks), with the
 * Nexus role: terminal, files, Docker and services stay admin-only on Jarvis too.
 */

export function jarvisConfig() {
  const url = (process.env.JARVIS_URL || 'http://127.0.0.1:8765').trim().replace(/\/+$/, '')
  const key = (process.env.JARVIS_API_KEY || '').trim()
  return { url, key, configured: key.length > 0 }
}

export class JarvisError extends AppError {
  constructor(message: string, statusCode = 503) {
    super(message, statusCode)
  }
}

/** Jarvis identity of a Nexus user (the owner account maps to "owner"). */
export function jarvisUser(user: JwtPayload): string {
  const owner = (process.env.JARVIS_OWNER || '').trim().toLowerCase()
  return owner && user.username.toLowerCase() === owner ? 'owner' : user.userId
}

export function jarvisHeaders(user: JwtPayload): Record<string, string> {
  const { key } = jarvisConfig()
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Jarvis-User': jarvisUser(user),
    'X-Jarvis-Name': user.username,
    'X-Jarvis-Role': user.role,
  }
}

/** Calls the Jarvis API as this user. Throws a readable JarvisError on failure. */
export async function jarvisFetch(
  user: JwtPayload,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  timeoutMs: number | null = 15_000,
): Promise<Response> {
  const { url, configured } = jarvisConfig()
  if (!configured) {
    throw new JarvisError('Jarvis n’est pas configuré sur ce serveur (JARVIS_API_KEY).')
  }
  let res: Response
  try {
    res = await fetch(url + path, {
      method: init.method || 'GET',
      headers: jarvisHeaders(user),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    })
  } catch {
    throw new JarvisError('Jarvis ne répond pas. Vérifie le service sur le serveur (systemctl status jarvis).')
  }
  if (res.ok) return res
  let detail = ''
  try { detail = ((await res.json()) as { detail?: string }).detail || '' } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) {
    throw new JarvisError('Nexus n’est pas autorisé par Jarvis : vérifie JARVIS_API_KEY (clé « nexus » avec --confiance).', 502)
  }
  if (res.status === 409) throw new JarvisError(detail || 'Jarvis répond déjà à un autre message.', 409)
  if (res.status === 404) throw new JarvisError(detail || 'Introuvable.', 404)
  if (res.status === 400 || res.status === 422) throw new JarvisError(detail || 'Requête refusée par Jarvis.', 422)
  throw new JarvisError(detail || `Jarvis a répondu ${res.status}.`, 502)
}

export async function jarvisJson<T>(user: JwtPayload, path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  return (await jarvisFetch(user, path, init)).json() as Promise<T>
}

export interface JarvisStatus {
  configured: boolean
  online:     boolean
  model?:     string
  /** Ollama stopped, model missing… */
  warning?:   string | null
}

export async function jarvisStatus(): Promise<JarvisStatus> {
  const { url, configured } = jarvisConfig()
  if (!configured) return { configured: false, online: false }
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { configured, online: false }
    const health = await res.json() as { model?: string; warning?: string | null }
    return { configured, online: true, model: health.model, warning: health.warning ?? null }
  } catch {
    return { configured, online: false }
  }
}

// ─── Reminders and approval requests → Nexus web push ───────────────────────

interface JarvisNotification { id: number; kind: string; message: string }

function pushTitle(n: JarvisNotification): string {
  if (n.kind === 'reminder') return 'Rappel de Jarvis'
  if (n.message.startsWith('Autorisation demandée')) return 'Jarvis demande une autorisation'
  return 'Jarvis'
}

/** One pass: fetch each user's Jarvis notifications and push them to their devices. */
export async function relayJarvisNotifications(): Promise<number> {
  if (!jarvisConfig().configured) return 0
  const { rows } = await query<{ id: string; username: string; role: 'admin' | 'user' }>(
    'SELECT id, username, role FROM users',
  )
  let sent = 0
  for (const row of rows) {
    const user: JwtPayload = { userId: row.id, username: row.username, role: row.role }
    const { notifications } = await jarvisJson<{ notifications: JarvisNotification[] }>(user, '/api/notifications')
    for (const n of notifications) {
      await sendPush([row.id], { title: pushTitle(n), body: n.message.slice(0, 300), url: '/jarvis', tag: `jarvis-${n.id}` })
      sent++
    }
  }
  return sent
}

let notifierTimer: NodeJS.Timeout | null = null

/** Every 30 s while Jarvis is configured (quiet when Jarvis is stopped). */
export function startJarvisNotifier(intervalMs = 30_000): void {
  if (notifierTimer || !jarvisConfig().configured) return
  let failing = false
  notifierTimer = setInterval(() => {
    relayJarvisNotifications()
      .then(() => {
        if (failing) logger.info('Jarvis notifications: back online')
        failing = false
      })
      .catch((err: Error) => {
        if (!failing) logger.warn(`Jarvis notifications: ${err.message}`)
        failing = true
      })
  }, intervalMs)
  notifierTimer.unref()
}
