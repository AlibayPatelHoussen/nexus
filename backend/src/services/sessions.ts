import { query } from '../config/database'
import { AppError, UnauthorizedError } from '../utils/errors'

/**
 * Is this token's session still valid? Checked on every authenticated request (and socket):
 *  - the account still exists and has not expired (accounts opened for a limited time);
 *  - its session version is the account's current one (a password change, or « Déconnecter
 *    tous les appareils », increases it: every other session stops at once);
 *  - its device session (refresh token) was not removed (« Déconnecter » this device).
 * Answers are kept 5 s (one query for the burst of requests a page makes), forgotten at
 * once when Nexus itself changes them (forgetSessions).
 */

export interface SessionClaims {
  userId: string
  /** Device session (refresh_tokens.id); missing in tokens issued before sessions existed */
  sid?: string
  /** Session version the token was issued with (1 when missing) */
  sv?: number
}

export interface SessionUser {
  username: string
  role: 'admin' | 'user'
  sessionVersion: number
  expiresAt: Date | null
  /** What the account opens (admins: everything) */
  canMedia: boolean
  canIptv: boolean
}

const TTL_MS = 5_000
const cache = new Map<string, { at: number; user: SessionUser | null; session: boolean }>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class AccountExpiredError extends AppError {
  constructor() { super('Ce compte a expiré', 401, true, 'ACCOUNT_EXPIRED') }
}

export function isExpired(expiresAt: Date | string | null | undefined): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now()
}

/** Forget what is known of an account's sessions (after a change made by Nexus). */
export function forgetSessions(userId?: string) {
  if (!userId) { cache.clear(); return }
  for (const key of cache.keys()) if (key.startsWith(`${userId}|`)) cache.delete(key)
}

async function load(userId: string, sid: string | undefined) {
  const key = `${userId}|${sid ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit
  const { rows } = await query<{ username: string; role: 'admin' | 'user'; session_version: number; expires_at: Date | null; has_session: boolean; can_media: boolean; can_iptv: boolean }>(
    `SELECT u.username, u.role, u.session_version, u.expires_at, u.can_media, u.can_iptv,
            EXISTS (SELECT 1 FROM refresh_tokens r
                     WHERE r.id = $2::uuid AND r.user_id = u.id AND r.expires_at > NOW()
                       AND r.session_version = u.session_version) AS has_session
       FROM users u WHERE u.id = $1::uuid`,
    [userId, sid && UUID.test(sid) ? sid : null],
  )
  const r = rows[0]
  const entry = {
    at: Date.now(),
    user: r ? {
      username: r.username, role: r.role, sessionVersion: r.session_version, expiresAt: r.expires_at,
      canMedia: r.role === 'admin' || r.can_media, canIptv: r.role === 'admin' || r.can_iptv,
    } : null,
    session: !!r?.has_session,
  }
  cache.set(key, entry)
  if (cache.size > 5_000) cache.delete(cache.keys().next().value as string)
  return entry
}

/** The account behind a valid session (current name and role), else an error (401). */
export async function checkSession(claims: SessionClaims): Promise<SessionUser> {
  if (!UUID.test(claims.userId)) throw new UnauthorizedError('Session expired')
  const { user, session } = await load(claims.userId, claims.sid)
  if (!user) throw new UnauthorizedError('Session expired')
  if (isExpired(user.expiresAt)) throw new AccountExpiredError()
  if ((claims.sv ?? 1) !== user.sessionVersion) throw new UnauthorizedError('Session expired')
  if (claims.sid && !session) throw new UnauthorizedError('Session expired')
  return user
}
