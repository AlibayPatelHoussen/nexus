import { query } from '../config/database'
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'
import { forgetSessions, isExpired } from './sessions'
import { ACCESS, accessOf, type Access } from './auth'

/**
 * Réglages › Utilisateurs, Appareils connectés, Journal des connexions (admins only).
 * Accounts made here are « user » accounts (médias, manga, their downloads); admin
 * accounts are only made in the terminal (scripts/create-admin.sh).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const checkId = (id: string, what = 'User') => { if (!UUID.test(id)) throw new NotFoundError(what) }

export interface AccountRow {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
  created_at: Date
  last_login: Date | null
  expires_at: Date | null
  devices: string
  can_media: boolean
  can_iptv: boolean
}

export async function listAccounts() {
  const { rows } = await query<AccountRow>(
    `SELECT u.id, u.username, u.email, u.role, u.created_at, u.last_login, u.expires_at, u.can_media, u.can_iptv,
            (SELECT COUNT(*) FROM refresh_tokens r WHERE r.user_id = u.id AND r.expires_at > NOW()
               AND r.session_version = u.session_version) AS devices
       FROM users u
      ORDER BY (u.role = 'admin') DESC, LOWER(u.username)`,
  )
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
    lastLogin: r.last_login,
    expiresAt: r.expires_at,
    expired: isExpired(r.expires_at),
    devices: Number(r.devices),
    access: accessOf(r),
  }))
}

async function userAccount(id: string) {
  checkId(id)
  const { rows } = await query<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = $1', [id])
  if (!rows[0]) throw new NotFoundError('User')
  return rows[0]
}

/** New end of a « user » account (null: no limit). An expired account can be opened again this way. */
export async function setExpiry(id: string, expiresAt: unknown) {
  const user = await userAccount(id)
  if (user.role !== 'user') throw new ForbiddenError('Un compte administrateur n’expire pas')
  let date: Date | null = null
  if (expiresAt !== null && expiresAt !== undefined) {
    date = new Date(String(expiresAt))
    if (Number.isNaN(date.getTime())) throw new ValidationError('Date invalide')
    if (date.getTime() <= Date.now()) throw new ValidationError('La date de fin doit être dans le futur')
  }
  await query('UPDATE users SET expires_at = $2 WHERE id = $1', [id, date])
  forgetSessions(id)
}

/** What a « user » account opens: « Médias + IPTV », « Médias », « IPTV seulement ». At once. */
export async function setAccess(id: string, access: unknown) {
  if (typeof access !== 'string' || !(access in ACCESS)) throw new ValidationError('Accès invalide (all, media ou iptv)')
  const user = await userAccount(id)
  if (user.role !== 'user') throw new ForbiddenError('Un compte administrateur a tous les accès')
  const a = ACCESS[access as Access]
  await query('UPDATE users SET can_media = $2, can_iptv = $3 WHERE id = $1', [id, a.media, a.iptv])
  forgetSessions(id)
}

/** Deletes a « user » account (its history, list, sessions; its downloads stay in the queue). */
export async function deleteAccount(id: string, by: string) {
  if (id === by) throw new ForbiddenError('Tu ne peux pas supprimer ton propre compte')
  const user = await userAccount(id)
  if (user.role !== 'user') throw new ForbiddenError('Un compte administrateur se gère dans le terminal')
  await query('DELETE FROM users WHERE id = $1', [id])
  forgetSessions(id)
}

/** Every signed-in device of every account (current: the one asking). */
export async function listSessions(currentSid?: string) {
  const { rows } = await query<{
    id: string; user_id: string; username: string; role: string; device: string | null; location: string | null
    ip: string | null; created_at: Date; last_used_at: Date
  }>(
    `SELECT r.id, r.user_id, u.username, u.role, r.device, r.location, r.ip, r.created_at, r.last_used_at
       FROM refresh_tokens r JOIN users u ON u.id = r.user_id
      WHERE r.expires_at > NOW() AND r.session_version = u.session_version
      ORDER BY r.last_used_at DESC
      LIMIT 500`,
  )
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    role: r.role,
    device: r.device ?? 'Appareil inconnu',
    location: r.location,
    ip: r.ip,
    signedInAt: r.created_at,
    lastActiveAt: r.last_used_at,
    current: r.id === currentSid,
  }))
}

/** « Déconnecter » one device: its session ends at its next request (and its notifications with it). */
export async function revokeSession(id: string) {
  checkId(id, 'Session')
  const { rows } = await query<{ user_id: string }>('DELETE FROM refresh_tokens WHERE id = $1 RETURNING user_id', [id])
  if (!rows[0]) throw new NotFoundError('Session')
  forgetSessions(rows[0].user_id)
}

/** Removes entries of the sign-in journal: one (id), one account's (userId), or all. Returns how many. */
export async function deleteLoginEvents(target: { id?: string; userId?: string }) {
  if (target.id) checkId(target.id, 'Entry')
  if (target.userId) checkId(target.userId)
  const { rowCount } = target.id
    ? await query('DELETE FROM login_events WHERE id = $1', [target.id])
    : target.userId
      ? await query('DELETE FROM login_events WHERE user_id = $1', [target.userId])
      : await query('DELETE FROM login_events')
  if (target.id && !rowCount) throw new NotFoundError('Entry')
  return rowCount ?? 0
}

/** The sign-in journal, newest first. */
export async function listLoginEvents(limit = 100, userId?: string) {
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)))
  if (userId) checkId(userId)
  const { rows } = await query<{
    id: string; user_id: string | null; username: string; success: boolean; reason: string; new_device: boolean
    device: string | null; location: string | null; ip: string | null; created_at: Date
  }>(
    `SELECT id, user_id, username, success, reason, new_device, device, location, ip, created_at
       FROM login_events ${userId ? 'WHERE user_id = $2' : ''}
      ORDER BY created_at DESC LIMIT $1`,
    userId ? [n, userId] : [n],
  )
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    success: r.success,
    reason: r.reason,
    newDevice: r.new_device,
    device: r.device ?? 'Appareil inconnu',
    location: r.location,
    ip: r.ip,
    at: r.created_at,
  }))
}
