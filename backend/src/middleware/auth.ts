import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError, ForbiddenError } from '../utils/errors'

export type TokenType = 'access' | 'refresh' | 'stream'

export interface JwtPayload {
  userId: string
  username: string
  role: 'admin' | 'user'
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
    return { userId: payload.userId, username: payload.username, role: payload.role }
  } catch {
    return null
  }
}

function bearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
}

/** Standard API auth: access token in the Authorization header only. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req)
  if (!token) throw new UnauthorizedError('No token provided')

  const payload = verifyToken(token, 'access')
  if (!payload) throw new UnauthorizedError('Invalid or expired token')

  req.user = payload
  next()
}

/**
 * Auth for media URLs used directly by <video>/<img>/<iframe>, which cannot
 * set headers. Accepts either an access token in the header, or a
 * short-lived, read-only *stream* token in the `token` query parameter.
 * An access token in the query string is never accepted.
 */
export function authenticateStream(req: Request, _res: Response, next: NextFunction): void {
  const header = bearerToken(req)
  const payload = header
    ? verifyToken(header, 'access')
    : typeof req.query.token === 'string'
      ? verifyToken(req.query.token, 'stream')
      : null

  if (!header && typeof req.query.token !== 'string') throw new UnauthorizedError('No token provided')
  if (!payload) throw new UnauthorizedError('Invalid or expired token')

  req.user = payload
  next()
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError()
  if (req.user.role !== 'admin') throw new ForbiddenError('Admin access required')
  next()
}
