import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError, ForbiddenError } from '../utils/errors'

export interface JwtPayload {
  userId: string
  username: string
  role: 'admin' | 'user'
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  // Allow token via query param for media streaming (video elements can't set headers)
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : (req.query.token as string | undefined)

  if (!token) throw new UnauthorizedError('No token provided')

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
    req.user = payload
    next()
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError()
  if (req.user.role !== 'admin') throw new ForbiddenError('Admin access required')
  next()
}
