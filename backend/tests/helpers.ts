import jwt from 'jsonwebtoken'
import type { TokenType } from '../src/middleware/auth'

/**
 * Accounts the tests' tokens belong to: every request checks its session against the
 * database (account exists, not expired, current session version), so they really exist
 * (made by tests/setupDb.ts before each integration file).
 */
export const FIXTURES = {
  admin: { id: '00000000-0000-4000-8000-00000000ad01', username: 'test-admin' },
  user: { id: '00000000-0000-4000-8000-000000000001', username: 'test-user' },
  other: { id: '00000000-0000-4000-8000-000000000002', username: 'test-other' },
} as const

export function makeToken(role: 'admin' | 'user' = 'admin', typ: TokenType = 'access', userId: string = FIXTURES[role].id): string {
  const secret = typ === 'refresh'
    ? process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!
    : process.env.JWT_SECRET!
  return jwt.sign({ userId, username: `test${role}`, role, typ }, secret, { expiresIn: '1h' })
}
