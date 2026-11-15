import { Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { AuthService } from '../services/auth'
import { ValidationError } from '../utils/errors'
import { clientInfo } from '../utils/device'

function validate(req: Request) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    throw new ValidationError(errors.array()[0].msg as string)
  }
}

// ─── Validators ───────────────────────────────────────
export const loginValidators = [
  body('username').notEmpty().withMessage('Username is required').trim(),
  body('password').notEmpty().withMessage('Password is required'),
]

const usernameRule = () => body('username')
  .trim()
  .isLength({ min: 3, max: 50 })
  .withMessage('Username must be 3–50 characters')
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Username can only contain letters, numbers, _ and -')

export const changeUsernameValidators = [
  usernameRule(),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
]

export const registerValidators = [
  usernameRule(),
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and a number'),
  // Account opened for a limited time: its end (ISO date, in the future), or null
  body('access').optional().isIn(['all', 'media', 'iptv']).withMessage('Access must be all, media or iptv'),
  body('expiresAt').optional({ values: 'null' }).isISO8601().withMessage('Invalid expiry date')
    .custom((v: string) => new Date(v).getTime() > Date.now()).withMessage('The expiry date must be in the future'),
]

export const changePasswordValidators = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and a number'),
]

// ─── Handlers ─────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  validate(req)
  const { username, password } = req.body
  const result = await AuthService.login(username, password, clientInfo(req))
  res.json({ success: true, data: result })
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body
  if (refreshToken) await AuthService.logout(refreshToken)
  res.json({ success: true })
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body
  if (!refreshToken) throw new ValidationError('Refresh token required')
  const result = await AuthService.refresh(refreshToken, clientInfo(req))
  res.json({ success: true, data: result })
}

export async function register(req: Request, res: Response): Promise<void> {
  validate(req)
  const { username, email, password, expiresAt, access } = req.body
  const user = await AuthService.register({ username, email, password, access, expiresAt: expiresAt ? new Date(expiresAt) : null })
  res.status(201).json({ success: true, data: user })
}

export function streamToken(req: Request, res: Response): void {
  res.json({ success: true, data: { token: AuthService.generateStreamToken(req.user!) } })
}

export function me(req: Request, res: Response): void {
  res.json({ success: true, data: req.user })
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  validate(req)
  const { currentPassword, newPassword } = req.body
  // The other devices are signed out; this one gets new tokens (session version + 1)
  const tokens = await AuthService.changePassword(req.user!.userId, currentPassword, newPassword, { sid: req.user!.sid, client: clientInfo(req) })
  res.json({ success: true, message: 'Password updated', data: tokens })
}

export async function changeUsername(req: Request, res: Response): Promise<void> {
  validate(req)
  const { username, currentPassword } = req.body
  const data = await AuthService.changeUsername(req.user!.userId, username, currentPassword, req.user)
  res.json({ success: true, data })
}

export async function updateTheme(req: Request, res: Response): Promise<void> {
  const { theme } = req.body
  if (!['dark', 'light'].includes(theme)) {
    throw new ValidationError('Theme must be dark or light')
  }
  await AuthService.updateTheme(req.user!.userId, theme)
  res.json({ success: true })
}
