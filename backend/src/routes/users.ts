import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import * as controller from '../controllers/auth'
import { AuthService } from '../services/auth'
import {
  deleteAccount, deleteLoginEvents, listAccounts, listLoginEvents, listSessions, revokeSession, setAccess, setExpiry,
} from '../services/users'

// Réglages › Utilisateurs, Appareils connectés, Journal des connexions: admins only
const router = Router()
router.use(authenticate, requireAdmin)

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listAccounts() })
}))

/** New « user » account (médias, manga, its own downloads), optionally for a limited time. */
router.post('/', controller.registerValidators, asyncHandler(controller.register))

// (before /:id, which would take « logins » for an account id)
/** Removes one entry of the journal. */
router.delete('/logins/:id', asyncHandler(async (req: Request, res: Response) => {
  await deleteLoginEvents({ id: req.params.id })
  res.json({ success: true })
}))

/** Clears the journal (?user=<id>: one account's entries only). */
router.delete('/logins', asyncHandler(async (req: Request, res: Response) => {
  const user = typeof req.query.user === 'string' ? req.query.user : undefined
  res.json({ success: true, data: { removed: await deleteLoginEvents({ userId: user }) } })
}))

/** Changes an account's end date (expiresAt) and / or what it opens (access). */
router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (!('expiresAt' in body) && !('access' in body)) { res.status(422).json({ success: false, error: 'Rien à changer' }); return }
  if ('access' in body) await setAccess(req.params.id, body.access)
  if ('expiresAt' in body) await setExpiry(req.params.id, body.expiresAt)
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
