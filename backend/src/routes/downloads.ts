import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import {
  actOn, createDownload, deleteDownload, getDetails, listDownloads, openTarget, startSearch, type CreateInput,
} from '../services/downloads'
import { ValidationError } from '../utils/errors'
import { checkDueFollows, getFollow, listFollows, setFollow, type FollowInput } from '../services/follows'

// « Téléchargements »: writes on the server, so admins only
const router = Router()
router.use(authenticate, requireAdmin)

/** Starts the four scripts; results arrive over Socket.io (download:search_result). */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const data = startSearch(req.body?.query, req.user!.userId)
  res.status(202).json({ success: true, data })
}))

router.get('/details', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await getDetails(req.query.id) })
}))

// « Télécharger automatiquement les nouveautés » (off unless switched on)
router.get('/follows', asyncHandler(async (req: Request, res: Response) => {
  if (req.query.id) { res.json({ success: true, data: await getFollow(req.query.id) }); return }
  res.json({ success: true, data: await listFollows() })
}))

router.put('/follows', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setFollow((req.body ?? {}) as FollowInput, req.user!.userId) })
}))

router.post('/follows/check', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { queued: await checkDueFollows(true) } })
}))

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listDownloads() })
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as CreateInput
  res.status(201).json({ success: true, data: await createDownload(body, req.user!.userId) })
}))

router.get('/:id/open', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await openTarget(req.params.id) })
}))

router.post('/:id/:action', asyncHandler(async (req: Request, res: Response) => {
  const action = req.params.action
  if (action !== 'pause' && action !== 'resume' && action !== 'cancel' && action !== 'retry') {
    throw new ValidationError('Action inconnue')
  }
  res.json({ success: true, data: await actOn(req.params.id, action) })
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await deleteDownload(req.params.id)
  res.json({ success: true })
}))

export default router
