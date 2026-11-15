import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { query } from '../config/database'
import { UnauthorizedError, ConflictError, NotFoundError } from '../utils/errors'
import { secretFor, verifyToken } from '../middleware/auth'
import type { JwtPayload, TokenType } from '../middleware/auth'
import { AccountExpiredError, forgetSessions, isExpired } from './sessions'
import { sendPush } from './push'
import { logger } from '../utils/logger'
import type { ClientInfo } from '../utils/device'

const SALT_ROUNDS = 12
/** « 15m », « 1h », « 900 » (seconds) → seconds; null when unreadable */
export function durationSeconds(v: string): number | null {
  const m = /^(\d+)\s*([smhd])?$/i.exec(v.trim())
  if (!m) return null
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86_400 } as Record<string, number>)[(m[2] ?? 's').toLowerCase()]
}

/** Access tokens: 15 minutes by default, never over an hour (the app renews them by itself) */
const ACCESS_MAX_SECONDS = 3600
let warnedLongAccess = false
export function accessLifetime(): string | number {
  const raw = process.env.JWT_EXPIRES_IN
  const seconds = raw ? durationSeconds(raw) : null
  if (!seconds) return '15m'
  if (seconds > ACCESS_MAX_SECONDS) {
    if (!warnedLongAccess) {
      logger.warn(`JWT_EXPIRES_IN=${raw} is too long for access tokens: 1 hour is used (15m recommended in backend/.env)`)
      warnedLongAccess = true
    }
    return ACCESS_MAX_SECONDS
  }
  return seconds
}

/** Compared against for an unknown name, so it takes as long as a wrong password */
const DUMMY_HASH = bcrypt.hashSync('nexus-unknown-account', SALT_ROUNDS)
const REFRESH_DAYS = 30
/** Sign-in journal: older entries are removed */
const JOURNAL_DAYS = 180

interface User {
  id: string
  username: string
  email: string
  password: string
  role: 'admin' | 'user'
  theme: 'dark' | 'light'
  session_version: number
  expires_at: Date | null
  can_media: boolean
  can_iptv: boolean
}

/** What an account opens: « Médias + IPTV » (all), « Médias » (media), « IPTV seulement » (iptv). */
export type Access = 'all' | 'media' | 'iptv'
export const ACCESS: Record<Access, { media: boolean; iptv: boolean }> = {
  all: { media: true, iptv: true },
  media: { media: true, iptv: false },
  iptv: { media: false, iptv: true },
}
export function accessOf(u: { role: string; can_media: boolean; can_iptv: boolean }): Access {
  if (u.role === 'admin' || (u.can_media && u.can_iptv)) return 'all'
  return u.can_media ? 'media' : 'iptv'
}
/** The account as the interface sees it */
function publicUser(u: User) {
  const access = accessOf(u)
  return {
    id: u.id, username: u.username, email: u.email, role: u.role, theme: u.theme, expiresAt: u.expires_at,
    access, canMedia: ACCESS[access].media, canIptv: ACCESS[access].iptv,
  }
}

/** No device information (tests, scripts) */
const NO_CLIENT: ClientInfo = { ip: null, userAgent: null, device: 'Appareil inconnu', location: null }

export class AuthService {
  // ─── Generate Tokens ──────────────────────────────
  private static sign(payload: JwtPayload, typ: TokenType, expiresIn: string | number): string {
    const { userId, username, role, sid, sv } = payload
    // jwtid: two logins in the same second must not produce the same token
    // (refresh tokens are stored with a UNIQUE constraint)
    return jwt.sign({ userId, username, role, sid, sv, typ }, secretFor(typ), { expiresIn, jwtid: randomUUID() } as jwt.SignOptions)
  }

  static generateAccessToken(payload: JwtPayload): string {
    return this.sign(payload, 'access', accessLifetime())
  }

  static generateRefreshToken(payload: JwtPayload): string {
    return this.sign(payload, 'refresh', process.env.JWT_REFRESH_EXPIRES_IN || `${REFRESH_DAYS}d`)
  }

  /** Read-only token for media URLs (<video>, <img>, <iframe>), passed as ?token=. Same session as the caller. */
  static generateStreamToken(payload: JwtPayload): string {
    return this.sign(payload, 'stream', process.env.JWT_STREAM_EXPIRES_IN || '6h')
  }

  /** A new device session: its refresh token row (device, place) and both tokens. */
  private static async openSession(user: Pick<User, 'id' | 'username' | 'role' | 'session_version'>, client: ClientInfo) {
    const sid = randomUUID()
    const payload: JwtPayload = { userId: user.id, username: user.username, role: user.role, sid, sv: user.session_version }
    const refreshToken = this.generateRefreshToken(payload)
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at, session_version, user_agent, device, ip, location)
       VALUES ($1, $2, $3, NOW() + make_interval(days => $4), $5, $6, $7, $8, $9)`,
      [sid, user.id, refreshToken, REFRESH_DAYS, user.session_version, client.userAgent, client.device, client.ip, client.location],
    )
    return { sid, accessToken: this.generateAccessToken(payload), refreshToken }
  }

  /** One line of the sign-in journal (and the old ones removed). */
  private static async journal(entry: { userId: string | null; username: string; reason: 'ok' | 'password' | 'unknown' | 'expired'; newDevice?: boolean }, client: ClientInfo) {
    try {
      await query(
        `INSERT INTO login_events (user_id, username, success, reason, new_device, device, user_agent, ip, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.userId, entry.username.slice(0, 255), entry.reason === 'ok', entry.reason, !!entry.newDevice,
          client.device, client.userAgent, client.ip, client.location],
      )
      await query(`DELETE FROM login_events WHERE created_at < NOW() - make_interval(days => $1)`, [JOURNAL_DAYS])
    } catch (err) {
      logger.warn(`Sign-in journal: ${(err as Error).message}`)
    }
  }

  /** « houssen · iPhone · Safari · Lyon, France » on the admins' devices. */
  private static notifyNewDevice(username: string, client: ClientInfo, sid: string) {
    void (async () => {
      const { rows } = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`)
      await sendPush(rows.map((r) => r.id), {
        title: 'Nouvel appareil connecté',
        body: [username, client.device, client.location ?? client.ip].filter(Boolean).join(' · '),
        url: '/settings#appareils',
        tag: `login-${sid}`,
      })
    })().catch((err: Error) => logger.warn(`New device notification: ${err.message}`))
  }

  // ─── Login ────────────────────────────────────────
  static async login(username: string, password: string, client: ClientInfo = NO_CLIENT) {
    const result = await query<User>(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username],
    )

    const user = result.rows[0]
    if (!user) {
      // Same work and same answer as a wrong password: the reply never tells which names exist
      await bcrypt.compare(password, DUMMY_HASH)
      await this.journal({ userId: null, username, reason: 'unknown' }, client)
      throw new UnauthorizedError('Invalid credentials')
    }

    if (!await bcrypt.compare(password, user.password)) {
      await this.journal({ userId: user.id, username: user.username, reason: 'password' }, client)
      throw new UnauthorizedError('Invalid credentials')
    }

    // Only said once the password is right
    if (isExpired(user.expires_at)) {
      await this.journal({ userId: user.id, username: user.username, reason: 'expired' }, client)
      throw new AccountExpiredError()
    }

    // A device this account never signed in from (same browser identity)
    const seen = await query(
      'SELECT 1 FROM login_events WHERE user_id = $1 AND success AND user_agent IS NOT DISTINCT FROM $2 LIMIT 1',
      [user.id, client.userAgent],
    )
    const newDevice = seen.rows.length === 0

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
    const session = await this.openSession(user, client)
    await this.journal({ userId: user.id, username: user.username, reason: 'ok', newDevice }, client)
    if (newDevice) this.notifyNewDevice(user.username, client, session.sid)

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: publicUser(user),
    }
  }

  // ─── Refresh ──────────────────────────────────────
  static async refresh(refreshToken: string, client?: ClientInfo) {
    const payload = verifyToken(refreshToken, 'refresh')
    if (!payload) throw new UnauthorizedError('Invalid refresh token')

    const result = await query<{ id: string; user_id: string; session_version: number }>(
      `SELECT id, user_id, session_version FROM refresh_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [refreshToken],
    )
    const session = result.rows[0]
    if (!session) throw new UnauthorizedError('Refresh token revoked or expired')

    // Re-read the user so a deleted or demoted account does not keep its old role
    const users = await query<Pick<User, 'id' | 'username' | 'role' | 'session_version' | 'expires_at'>>(
      'SELECT id, username, role, session_version, expires_at FROM users WHERE id = $1',
      [session.user_id],
    )
    const user = users.rows[0]
    if (!user || session.session_version !== user.session_version) {
      // Account deleted, or its password changed since this device signed in
      await query('DELETE FROM refresh_tokens WHERE id = $1', [session.id])
      throw new UnauthorizedError(user ? 'Session expired' : 'User no longer exists')
    }
    if (isExpired(user.expires_at)) throw new AccountExpiredError()

    // Last activity of this device (and where it is now)
    if (client) {
      await query(
        `UPDATE refresh_tokens SET last_used_at = NOW(), ip = COALESCE($2, ip), location = COALESCE($3, location),
           user_agent = COALESCE($4, user_agent), device = CASE WHEN $4::text IS NULL THEN device ELSE $5 END
         WHERE id = $1`,
        [session.id, client.ip, client.location, client.userAgent, client.device],
      )
    }

    return {
      accessToken: this.generateAccessToken({
        userId: user.id, username: user.username, role: user.role, sid: session.id, sv: user.session_version,
      }),
    }
  }

  // ─── Logout ───────────────────────────────────────
  static async logout(refreshToken: string): Promise<void> {
    const { rows } = await query<{ user_id: string }>('DELETE FROM refresh_tokens WHERE token = $1 RETURNING user_id', [refreshToken])
    if (rows[0]) forgetSessions(rows[0].user_id)
  }

  // ─── Register (admin only): « user » accounts; admins are made in the terminal ─
  static async register(data: {
    username: string
    email: string
    password: string
    expiresAt?: Date | null
    /** What the account opens (default: media and IPTV) */
    access?: Access
  }) {
    const existing = await query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) OR LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)',
      [data.username, data.email],
    )

    if (existing.rows.length > 0) {
      throw new ConflictError('Username or email already taken')
    }

    const hashed = await bcrypt.hash(data.password, SALT_ROUNDS)

    const access = ACCESS[data.access ?? 'all']
    const result = await query<User>(
      `INSERT INTO users (username, email, password, role, expires_at, can_media, can_iptv)
       VALUES ($1, $2, $3, 'user', $4, $5, $6)
       RETURNING id, username, email, role, theme, expires_at, can_media, can_iptv`,
      [data.username, data.email, hashed, data.expiresAt ?? null, access.media, access.iptv],
    )

    return result.rows[0]
  }

  // ─── Change Password ──────────────────────────────
  /**
   * New password: the account's session version goes up, so every OTHER device is signed
   * out at once; this one gets tokens of the new version and stays signed in.
   */
  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    current?: { sid?: string; client?: ClientInfo },
  ) {
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId],
    )

    if (result.rows.length === 0) throw new NotFoundError('User')

    const user = result.rows[0]
    const isValid = await bcrypt.compare(currentPassword, user.password)
    if (!isValid) throw new UnauthorizedError('Current password is incorrect')

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS)
    const { rows } = await query<{ session_version: number }>(
      'UPDATE users SET password = $1, session_version = session_version + 1 WHERE id = $2 RETURNING session_version',
      [hashed, userId],
    )
    const sv = rows[0].session_version

    // The other devices' sessions go (their notifications with them); this one moves to the new version
    await query('DELETE FROM refresh_tokens WHERE user_id = $1 AND id IS DISTINCT FROM $2::uuid', [userId, current?.sid ?? null])
    forgetSessions(userId)
    const kept = current?.sid
      ? (await query('UPDATE refresh_tokens SET session_version = $3 WHERE id = $1 AND user_id = $2 RETURNING id', [current.sid, userId, sv])).rows[0]
      : undefined
    const me = { ...user, session_version: sv }
    if (kept) {
      return { accessToken: this.generateAccessToken({ userId, username: user.username, role: user.role, sid: current!.sid, sv }) }
    }
    // A token from before device sessions: a new session for this device
    const session = await this.openSession(me, current?.client ?? NO_CLIENT)
    return { accessToken: session.accessToken, refreshToken: session.refreshToken }
  }

  /** « Déconnecter tous les appareils » of an account: new session version, no session left. */
  static async signOutEverywhere(userId: string): Promise<number> {
    const { rowCount } = await query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [userId])
    if (!rowCount) throw new NotFoundError('User')
    const { rowCount: removed } = await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])
    forgetSessions(userId)
    return removed ?? 0
  }

  // ─── Change Username ──────────────────────────────
  /** Rename the account (password asked again); returns the user and an access token with the new name. */
  static async changeUsername(userId: string, username: string, currentPassword: string, current?: Pick<JwtPayload, 'sid' | 'sv'>) {
    const result = await query<User>('SELECT * FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) throw new NotFoundError('User')
    const user = result.rows[0]
    if (!await bcrypt.compare(currentPassword, user.password)) throw new UnauthorizedError('Current password is incorrect')

    // Unique without regard to case, and never someone else's e-mail (login takes both)
    const taken = await query(
      'SELECT 1 FROM users WHERE id <> $1 AND (LOWER(username) = LOWER($2) OR LOWER(email) = LOWER($2))', [userId, username])
    if (taken.rows.length) throw new ConflictError('Username already taken')

    await query('UPDATE users SET username = $1 WHERE id = $2', [username, userId])
    forgetSessions(userId)
    return {
      accessToken: this.generateAccessToken({ userId, username, role: user.role, sid: current?.sid, sv: current?.sv ?? user.session_version }),
      user: publicUser({ ...user, username }),
    }
  }

  // ─── Update Theme ────────────────────────────────
  static async updateTheme(userId: string, theme: 'dark' | 'light'): Promise<void> {
    await query('UPDATE users SET theme = $1 WHERE id = $2', [theme, userId])
  }
}
