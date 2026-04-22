import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import { logger } from '../utils/logger'
import { MediaService } from '../services/media'
import { MediaScanner } from '../services/scanner'

const router = Router()
router.use(authenticate)

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { type, genre, year, search, page, limit, sortBy, sortDir } = req.query
  const result = await MediaService.getAll({
    type: type as string, genre: genre as string, search: search as string,
    year: year ? parseInt(year as string) : undefined,
    page: page ? parseInt(page as string) : 1,
    limit: limit ? parseInt(limit as string) : 24,
    sortBy: sortBy as 'title' | 'year' | 'rating' | 'created_at',
    sortDir: sortDir as 'asc' | 'desc',
  })
  res.json({ success: true, data: result })
}))

router.get('/recent',   asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaService.getRecentlyAdded(req.query.type as string, parseInt(req.query.limit as string || '12'))
  res.json({ success: true, data: items })
}))

router.get('/continue', asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaService.getContinueWatching(req.user!.userId)
  res.json({ success: true, data: items })
}))

router.get('/favorites', asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaService.getFavorites(req.user!.userId)
  res.json({ success: true, data: items })
}))

router.post('/:id/favorite', asyncHandler(async (req: Request, res: Response) => {
  const isFav = await MediaService.toggleFavorite(req.user!.userId, req.params.id)
  res.json({ success: true, data: { isFavorite: isFav } })
}))

router.get('/genres', asyncHandler(async (req: Request, res: Response) => {
  const genres = await MediaService.getGenres(req.query.type as string)
  res.json({ success: true, data: genres })
}))

router.post('/:id/progress', asyncHandler(async (req: Request, res: Response) => {
  const { progress, duration, episodeId } = req.body
  await MediaService.saveProgress(req.user!.userId, req.params.id, progress, duration, episodeId)
  res.json({ success: true })
}))

router.get('/:id/progress', asyncHandler(async (req: Request, res: Response) => {
  const prog = await MediaService.getProgress(req.user!.userId, req.params.id, req.query.episodeId as string)
  res.json({ success: true, data: prog })
}))

router.post('/scan',       requireAdmin, asyncHandler((_req, res) => {
  MediaScanner.scanAll().catch((err: unknown) => logger.error('Scan error', { err }))
  res.json({ success: true, message: 'Scan started' })
}))

router.post('/scan/:type', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const map: Record<string, () => Promise<number>> = {
    films: () => MediaScanner.scanFilms(),
    series: () => MediaScanner.scanSeries(),
    animes: () => MediaScanner.scanAnimes(),
    manga: () => MediaScanner.scanManga(),
  }
  const fn = map[req.params.type]
  if (!fn) { res.status(400).json({ success: false, error: 'Unknown type' }); return }
  const count = await fn()
  res.json({ success: true, data: { scanned: count } })
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const item = await MediaService.getById(req.params.id)
  if (!item) { res.status(404).json({ success: false, error: 'Not found' }); return }
  res.json({ success: true, data: item })
}))

export default router
