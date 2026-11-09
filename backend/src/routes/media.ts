import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import { syncImdb } from '../services/imdb'
import { indexLibrarySoon } from '../services/keyframeIndexer'
import { logger } from '../utils/logger'
import { MediaService } from '../services/media'
import { deleteMediaEverywhere } from '../services/libraryDelete'
import { MediaScanner, hasTmdbKey } from '../services/scanner'
import { ConflictError } from '../utils/errors'

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

// « À la une »: a new random draw among every title of this type at each visit
router.get('/featured', asyncHandler(async (req: Request, res: Response) => {
  const type = String(req.query.type ?? '')
  if (!['film', 'serie', 'anime', 'manga', 'webtoon', 'youtube'].includes(type)) {
    res.status(400).json({ success: false, error: 'Unknown type' }); return
  }
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, data: await MediaService.getFeatured(type, Number(req.query.count) || 8) })
}))

router.get('/recent',   asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaService.getRecentlyAdded(req.query.type as string, parseInt(req.query.limit as string || '12'))
  res.json({ success: true, data: items })
}))

// Whether metadata (posters, synopsis) can be fetched — shown in the UI when missing
router.get('/metadata/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: { tmdb: hasTmdbKey() } })
})

router.get('/continue', asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaService.getContinueWatching(req.user!.userId)
  res.json({ success: true, data: items })
}))

router.delete('/:id/continue', asyncHandler(async (req: Request, res: Response) => {
  await MediaService.dismissContinue(req.user!.userId, req.params.id)
  res.json({ success: true })
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

router.get('/:id/episodes/progress', asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaService.getEpisodesProgress(req.user!.userId, req.params.id)
  res.json({ success: true, data: items })
}))

router.get('/:id/progress', asyncHandler(async (req: Request, res: Response) => {
  const prog = await MediaService.getProgress(req.user!.userId, req.params.id, req.query.episodeId as string)
  res.json({ success: true, data: prog })
}))

// Scans stay available to every logged-in user, but only one can run at a time
router.post('/scan',       asyncHandler((_req, res) => {
  const running = MediaScanner.isRunning()
  if (running) throw new ConflictError(`A scan is already running (${running})`)
  MediaScanner.exclusive('all', () => MediaScanner.scanAll())
    .catch((err: unknown) => logger.error('Scan error', { err }))
  res.status(202).json({ success: true, message: 'Scan started' })
}))

// IMDb ids + ratings now (otherwise daily)
router.post('/imdb/refresh', requireAdmin, asyncHandler(async (_req, res: Response) => {
  res.json({ success: true, data: await syncImdb() })
}))

router.post('/prune', asyncHandler(async (_req, res: Response) => {
  const removed = await MediaScanner.exclusive('prune', () => MediaScanner.pruneDeleted())
  res.json({ success: true, data: { removed } })
}))

// Automatic scan when a library page opens: quick (no online lookup for known titles),
// skipped while another scan runs or when this library was scanned less than 30 s ago
const AUTO_SCANS: Record<string, [string, () => Promise<number>]> = {
  films: ['film', () => MediaScanner.scanFilms()],
  series: ['serie', () => MediaScanner.scanSeries()],
  animes: ['anime', () => MediaScanner.scanAnimes()],
  manga: ['manga', () => MediaScanner.scanManga()],
  youtube: ['youtube', () => MediaScanner.scanYoutube()],
}
const AUTO_SCAN_MIN_MS = () => Number(process.env.AUTO_SCAN_MIN_MS) || 30_000

router.post('/scan/:type/auto', asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type
  const scan = AUTO_SCANS[type]
  if (!scan) { res.status(400).json({ success: false, error: 'Unknown type' }); return }
  if (MediaScanner.isRunning()) { res.json({ success: true, data: { skipped: 'running' } }); return }
  const last = Math.max(MediaScanner.lastDone.get(type) ?? 0, MediaScanner.lastDone.get('all') ?? 0)
  if (Date.now() - last < AUTO_SCAN_MIN_MS()) { res.json({ success: true, data: { skipped: 'recent' } }); return }
  try {
    const scanned = await MediaScanner.quickly(type, async () => {
      await MediaScanner.pruneDeleted(scan[0])
      return scan[1]()
    })
    if (['films', 'series', 'animes'].includes(type)) indexLibrarySoon()
    res.json({ success: true, data: { scanned } })
  } catch (err) {
    if (err instanceof ConflictError) { res.json({ success: true, data: { skipped: 'running' } }); return }
    throw err
  }
}))

router.post('/scan/:type', asyncHandler(async (req: Request, res: Response) => {
  const typeMap: Record<string, string> = {
    films: 'film', series: 'serie', animes: 'anime', manga: 'manga', youtube: 'youtube',
  }
  const map: Record<string, () => Promise<number>> = {
    films: () => MediaScanner.scanFilms(),
    series: () => MediaScanner.scanSeries(),
    animes: () => MediaScanner.scanAnimes(),
    manga: () => MediaScanner.scanManga(),
    youtube: () => MediaScanner.scanYoutube(),
  }
  const fn = map[req.params.type]
  if (!fn) { res.status(400).json({ success: false, error: 'Unknown type' }); return }
  const dbType = typeMap[req.params.type]
  const count = await MediaScanner.exclusive(req.params.type, async () => {
    await MediaScanner.pruneDeleted(dbType)
    return fn()
  })
  // New titles get their IMDb rating and artwork in the background
  if (['films', 'series', 'animes'].includes(req.params.type) && process.env.IMDB_SYNC !== 'off') {
    void syncImdb().catch((err) => logger.warn(`Enrichment after scan failed: ${err}`))
  }
  // MKV films / episodes get their keyframe index (start at once, whole film) in the background
  if (['films', 'series', 'animes'].includes(req.params.type)) indexLibrarySoon()
  res.json({ success: true, data: { scanned: count } })
}))

// Deletes the title everywhere: files on the disk, library, downloads, follow (services/libraryDelete.ts)
router.delete('/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await deleteMediaEverywhere(req.params.id) })
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const item = await MediaService.getById(req.params.id)
  if (!item) { res.status(404).json({ success: false, error: 'Not found' }); return }
  res.json({ success: true, data: item })
}))

export default router
