import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import * as controller from '../controllers/auth'
import { AuthService } from '../services/auth'
import {
  deleteAccount, listAccounts, listLoginEvents, listSessions, revokeSession, setExpiry,
} from '../services/users'

// Réglages › Utilisateurs, Appareils connectés, Journal des connexions: admins only
const router = Router()
router.use(authenticate, requireAdmin)

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listAccounts() })
}))

/** New « user » account (médias, manga, its own downloads), optionally for a limited time. */
router.post('/', controller.registerValidators, asyncHandler(controller.register))

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  await setExpiry(req.params.id, req.body?.expiresAt)
  res.json({ success: true })
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await deleteAccount(req.params.id, req.user!.userId)
  res.json({ success: true })
}))

/** « Déconnecter tous les appareils » of an account (new session version). */
router.post('/:id/sign-out', asyncHandler(async (req: Request, res: Response) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(404).json({ success: false, error: 'User not found' }); return }
  res.json({ success: true, data: { removed: await AuthService.signOutEverywhere(req.params.id) } })
}))

router.get('/sessions', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await listSessions(req.user!.sid) })
}))

router.delete('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  await revokeSession(req.params.id)
  res.json({ success: true })
}))

router.get('/logins', asyncHandler(async (req: Request, res: Response) => {
  const user = typeof req.query.user === 'string' ? req.query.user : undefined
  res.json({ success: true, data: await listLoginEvents(Number(req.query.limit) || 100, user) })
}))

export default router
