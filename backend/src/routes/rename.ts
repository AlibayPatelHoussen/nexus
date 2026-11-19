import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import path from 'path'
import { authenticate, requireAdmin } from '../middleware/auth'
import { ValidationError } from '../utils/errors'
import {
  applyRenames, planRenames, renameHistory, renameSettings, setRenameSettings, undoRenames, type TitlePlan,
} from '../services/renamer'

// Réglages › Bibliothèque › Noms pour Jellyfin (admins): preview, rename, undo, automatic switch
const router = Router()
router.use(authenticate, requireAdmin)

const TYPES = new Set(['film', 'serie', 'anime'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function typeOf(v: unknown): 'film' | 'serie' | 'anime' | undefined {
  if (v === undefined || v === '' || v === null) return undefined
  if (typeof v !== 'string' || !TYPES.has(v)) throw new ValidationError('Type invalide')
  return v as 'film' | 'serie' | 'anime'
}

function idsOf(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > 5000 || !v.every((x) => typeof x === 'string' && UUID.test(x))) throw new ValidationError('Titres invalides')
  return v as string[]
}

/** What the page shows: names inside the library folder, the files moved, why some are left */
const view = (p: TitlePlan) => ({
  mediaId: p.mediaId,
  type: p.type,
  title: p.title,
  from: path.basename(p.from),
  to: path.basename(p.to),
  files: p.moves.length,
  merge: !!p.mergeInto,
  examples: p.moves.slice(0, 4).map((m) => ({ from: path.basename(m.from), to: path.basename(m.to) })),
  skipped: p.skipped.map((s) => ({ name: path.basename(s.path), reason: s.reason })),
})

router.get('/plan', asyncHandler(async (req: Request, res: Response) => {
  const plans = await planRenames({ type: typeOf(req.query.type) })
  const titles = plans.map(view)
  res.json({ success: true, data: { titles, files: titles.reduce((n, t) => n + t.files, 0) } })
}))

router.post('/apply', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await applyRenames({ mediaIds: idsOf(req.body?.mediaIds), type: typeOf(req.body?.type) }) })
}))

router.get('/history', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await renameHistory() })
}))

router.post('/undo/:batch', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await undoRenames(req.params.batch) })
}))

router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await renameSettings() })
}))

router.put('/settings', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await setRenameSettings(req.body?.auto) })
}))

export default router
