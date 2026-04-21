import { Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { AuthService } from '../services/auth'
import { ValidationError } from '../utils/errors'

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

export const registerValidators = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3–50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, _ and -'),
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and a number'),
]

// ─── Handlers ─────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  validate(req)
  const { username, password } = req.body
  const result = await AuthService.login(username, password)
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
  const result = await AuthService.refresh(refreshToken)
  res.json({ success: true, data: result })
}

export async function register(req: Request, res: Response): Promise<void> {
  validate(req)
  const user = await AuthService.register(req.body)
  res.status(201).json({ success: true, data: user })
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: req.user })
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body
  await AuthService.changePassword(req.user!.userId, currentPassword, newPassword)
  res.json({ success: true, message: 'Password updated' })
}

export async function updateTheme(req: Request, res: Response): Promise<void> {
  const { theme } = req.body
  if (!['dark', 'light'].includes(theme)) {
    throw new ValidationError('Theme must be dark or light')
  }
  await AuthService.updateTheme(req.user!.userId, theme)
  res.json({ success: true })
}
