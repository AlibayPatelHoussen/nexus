import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../config/database'
import { UnauthorizedError, ConflictError, NotFoundError } from '../utils/errors'
import type { JwtPayload } from '../middleware/auth'

const SALT_ROUNDS = 12

interface User {
  id: string
  username: string
  email: string
  password: string
  role: 'admin' | 'user'
  theme: 'dark' | 'light'
}

export class AuthService {
  // ─── Generate Tokens ──────────────────────────────
  static generateAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    } as jwt.SignOptions)
  }

  static generateRefreshToken(payload: JwtPayload): string {
    return jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    } as jwt.SignOptions)
  }

  // ─── Login ────────────────────────────────────────
  static async login(username: string, password: string) {
    const result = await query<User>(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username],
    )

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid credentials')
    }

    const user = result.rows[0]
    const isValid = await bcrypt.compare(password, user.password)

    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials')
    }

    // Update last_login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
    }

    const accessToken  = this.generateAccessToken(payload)
    const refreshToken = this.generateRefreshToken(payload)

    // Store refresh token
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken],
    )

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        theme: user.theme,
      },
    }
  }

  // ─── Refresh ──────────────────────────────────────
  static async refresh(refreshToken: string) {
    let payload: JwtPayload

    try {
      payload = jwt.verify(refreshToken, process.env.JWT_SECRET!) as JwtPayload
    } catch {
      throw new UnauthorizedError('Invalid refresh token')
    }

    const result = await query(
      `SELECT * FROM refresh_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [refreshToken],
    )

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Refresh token revoked or expired')
    }

    const newPayload: JwtPayload = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    }

    return {
      accessToken: this.generateAccessToken(newPayload),
    }
  }

  // ─── Logout ───────────────────────────────────────
  static async logout(refreshToken: string): Promise<void> {
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken])
  }

  // ─── Register (admin only) ────────────────────────
  static async register(data: {
    username: string
    email: string
    password: string
    role?: 'admin' | 'user'
  }) {
    const existing = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [data.username, data.email],
    )

    if (existing.rows.length > 0) {
      throw new ConflictError('Username or email already taken')
    }

    const hashed = await bcrypt.hash(data.password, SALT_ROUNDS)

    const result = await query<User>(
      `INSERT INTO users (username, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, theme`,
      [data.username, data.email, hashed, data.role || 'user'],
    )

    return result.rows[0]
  }

  // ─── Change Password ──────────────────────────────
  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId],
    )

    if (result.rows.length === 0) throw new NotFoundError('User')

    const user = result.rows[0]
    const isValid = await bcrypt.compare(currentPassword, user.password)
    if (!isValid) throw new UnauthorizedError('Current password is incorrect')

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS)
    await query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId])

    // Revoke all refresh tokens
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])
  }

  // ─── Update Theme ────────────────────────────────
  static async updateTheme(userId: string, theme: 'dark' | 'light'): Promise<void> {
    await query('UPDATE users SET theme = $1 WHERE id = $2', [theme, userId])
  }
}
