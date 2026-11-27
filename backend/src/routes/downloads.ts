import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin, requireMedia } from '../middleware/auth'
import {
  actOn, assertOwner, createDownload, deleteDownload, getDetails, listDownloads, openTarget, startSearch, type CreateInput,
} from '../services/downloads'
import { ValidationError } from '../utils/errors'
import { catalogueInfo, refreshCatalogue } from '../services/catalogue'
import { filmsSite, setFilmsSite } from '../services/filmsSite'
import { checkDueFollows, followTarget, getFollow, listFollows, setFollow, type FollowInput } from '../services/follows'

// « Téléchargements »: every account searches and downloads; a « user » account sees and
// acts on its own downloads only, admins on all. Automatic downloads (one per title, shared
// like the library): every account. Rebuilding the catalogue, checking every follow now: admins.
const router = Router()
router.use(authenticate, requireMedia)

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

// Where a library title comes from (its « Télécharger » button, its follow switch)
router.get('/follows/media/:mediaId', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await followTarget(req.params.mediaId) })
}))

router.put('/follows', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setFollow((req.body ?? {}) as FollowInput, req.user!.userId) })
}))

router.post('/follows/check', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { queued: await checkDueFollows(true) } })
}))

// anime-sama catalogue: size, last update, rebuild now
// The films site's address (it moves; films.py follows it, an admin can paste the new one)
router.get('/films-site', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await filmsSite() })
}))
router.put('/films-site', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setFilmsSite(req.body?.url) })
}))

router.get('/catalogue', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await catalogueInfo() })
}))

router.post('/catalogue/refresh', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  void refreshCatalogue()
  res.status(202).json({ success: true, data: await catalogueInfo() })
}))

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await listDownloads(req.user!.role === 'admin' ? undefined : req.user!.userId) })
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as CreateInput
  res.status(201).json({ success: true, data: await createDownload(body, req.user!.userId) })
}))

router.get('/:id/open', asyncHandler(async (req: Request, res: Response) => {
  await assertOwner(req.params.id, req.user!)
  res.json({ success: true, data: await openTarget(req.params.id) })
}))

router.post('/:id/:action', asyncHandler(async (req: Request, res: Response) => {
  const action = req.params.action
  if (action !== 'pause' && action !== 'resume' && action !== 'cancel' && action !== 'retry') {
    throw new ValidationError('Action inconnue')
  }
  await assertOwner(req.params.id, req.user!)
  res.json({ success: true, data: await actOn(req.params.id, action) })
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await assertOwner(req.params.id, req.user!)
  await deleteDownload(req.params.id)
  res.json({ success: true })
}))

export default router
