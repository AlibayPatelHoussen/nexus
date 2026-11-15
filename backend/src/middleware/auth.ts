import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError, ForbiddenError } from '../utils/errors'
import { checkSession } from '../services/sessions'

export type TokenType = 'access' | 'refresh' | 'stream'

export interface JwtPayload {
  userId: string
  username: string
  role: 'admin' | 'user'
  /** Device session (refresh_tokens.id): « Déconnecter » this device ends it */
  sid?: string
  /** Account session version: a password change increases it, ending the other sessions */
  sv?: number
  /** What the account opens, read from the database on each request (admins: everything) */
  canMedia?: boolean
  canIptv?: boolean
}

interface SignedPayload extends JwtPayload {
  typ?: TokenType
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload
  }
}

/** Refresh tokens use their own secret when configured (falls back to JWT_SECRET). */
export function secretFor(typ: TokenType): string {
  if (typ === 'refresh') return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!
  return process.env.JWT_SECRET!
}

/**
 * Verify a JWT and make sure it is of the expected type, so a refresh or
 * stream token can never be used as an access token (and vice versa).
 * Returns null when the token is invalid, expired or of the wrong type.
 */
export function verifyToken(token: string, typ: TokenType): JwtPayload | null {
  try {
    const payload = jwt.verify(token, secretFor(typ)) as SignedPayload
    if (payload.typ !== typ) return null
    return {
      userId: payload.userId, username: payload.username, role: payload.role,
      ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}),
      ...(typeof payload.sv === 'number' ? { sv: payload.sv } : {}),
    }
  } catch {
    return null
  }
}

function bearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
}

/**
 * A valid token whose session still holds (account not deleted nor expired, password not
 * changed since, device not disconnected): the request goes on with the account's current
 * name and role (a demoted admin loses its rights at once).
 */
export async function verifySession(token: string, typ: TokenType): Promise<JwtPayload> {
  const payload = verifyToken(token, typ)
  if (!payload) throw new UnauthorizedError('Invalid or expired token')
  const user = await checkSession(payload)
  return { ...payload, username: user.username, role: user.role, canMedia: user.canMedia, canIptv: user.canIptv }
}

function useSession(req: Request, next: NextFunction, token: string, typ: TokenType) {
  verifySession(token, typ).then((user) => { req.user = user; next() }, next)
}

/** Standard API auth: access token in the Authorization header only. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req)
  if (!token) throw new UnauthorizedError('No token provided')
  useSession(req, next, token, 'access')
}

/**
 * Auth for media URLs used directly by <video>/<img>/<iframe>, which cannot
 * set headers. Accepts either an access token in the header, or a
 * short-lived, read-only *stream* token in the `token` query parameter.
 * An access token in the query string is never accepted.
 */
export function authenticateStream(req: Request, _res: Response, next: NextFunction): void {
  const header = bearerToken(req)
  if (header) { useSession(req, next, header, 'access'); return }
  if (typeof req.query.token !== 'string') throw new UnauthorizedError('No token provided')
  useSession(req, next, req.query.token, 'stream')
}

/** The media (films, series, animes, manga, downloads): accounts that have them. */
export function requireMedia(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError()
  if (req.user.role !== 'admin' && req.user.canMedia === false) throw new ForbiddenError('Ce compte n’a pas accès aux médias', 'NO_MEDIA_ACCESS')
  next()
}

/** The IPTV: accounts that have it. */
export function requireIptv(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError()
  if (req.user.role !== 'admin' && req.user.canIptv === false) throw new ForbiddenError('Ce compte n’a pas accès à l’IPTV', 'NO_IPTV_ACCESS')
  next()
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError()
  if (req.user.role !== 'admin') throw new ForbiddenError('Admin access required')
  next()
}
