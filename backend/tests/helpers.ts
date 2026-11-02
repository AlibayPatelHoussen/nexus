import jwt from 'jsonwebtoken'
import type { TokenType } from '../src/middleware/auth'

export function makeToken(role: 'admin' | 'user' = 'admin', typ: TokenType = 'access', userId = 'test-uuid'): string {
  const secret = typ === 'refresh'
    ? process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!
    : process.env.JWT_SECRET!
  return jwt.sign({ userId, username: `test${role}`, role, typ }, secret, { expiresIn: '1h' })
}
