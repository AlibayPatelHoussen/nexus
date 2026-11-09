import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, authenticateStream, requireAdmin } from '../middleware/auth'
import { NotFoundError, ValidationError } from '../utils/errors'
import {
  addFavorite, assertChannelId, checkChannel, facets, favorites, forgetPage, getChannel, getSettings, listChannels, playable,
  recentChannels, recordWatch, refreshCatalogue, refreshState, removeFavorite, reorderFavorites, saveSettings, streamOf, summary,
  type ChannelFilters,
} from '../services/iptv'
import { relay, signUrl, validUrlSignature } from '../services/iptvProxy'

const router = Router()
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

// ─── Playback (relay) — media elements send the stream token in the URL ────────────
function playParams(req: Request) {
  const id = assertChannelId(req.params.id)
  const s = Number(req.params.s)
  if (!Number.isInteger(s) || s < 0 || s > 20) throw new ValidationError('Flux inconnu')
  return { id, s }
}
const relayPath = (req: Request, id: string, s: number) => (abs: string) => {
  const token = typeof req.query.token === 'string' ? `&token=${encodeURIComponent(req.query.token)}` : ''
  return `/api/iptv/play/${encodeURIComponent(id)}/${s}/seg?u=${encodeURIComponent(abs)}&k=${signUrl(id, s, abs)}${token}`
}

router.get('/play/:id/:s/index.m3u8', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const { id, s } = playParams(req)
  const stream = await streamOf(id, s)
  if (!stream) throw new NotFoundError('Flux')
  // A web page (a YouTube, Twitch or Dailymotion live): the stream behind it, found now or a moment ago
  const target = await playable(stream, true)
  const sent = await relay(req, res, { id, s, url: target.url, stream: target, relayPath: relayPath(req, id, s), entry: true })
  if (!sent) forgetPage(stream)
}))

router.get('/play/:id/:s/seg', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const { id, s } = playParams(req)
  const url = typeof req.query.u === 'string' ? req.query.u : ''
  if (!url || url.length > 4000 || !validUrlSignature(id, s, url, req.query.k)) { res.status(403).end(); return }
  const stream = await streamOf(id, s)
  if (!stream) throw new NotFoundError('Flux')
  // The headers of the stream (for a page: those found with it; a segment never starts a look-up)
  await relay(req, res, { id, s, url, stream: await playable(stream, false), relayPath: relayPath(req, id, s) })
}))

// ─── Catalogue ───────────────────────────────────────────────────────────────
router.use(authenticate)

router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await summary(req.user!.userId) })
}))

router.get('/facets', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await facets() })
}))

router.get('/channels', asyncHandler(async (req: Request, res: Response) => {
  const q = req.query
  const filters: ChannelFilters = {
    q: str(q.q), country: str(q.country), category: str(q.category), language: str(q.language),
    status: q.status === 'online' ? 'online' : 'all', sort: q.sort === '-name' ? '-name' : q.sort === 'name' ? 'name' : 'top',
    page: Number(q.page) || 1, limit: Number(q.limit) || 60,
  }
  res.json({ success: true, data: await listChannels(req.user!.userId, filters) })
}))

router.get('/channels/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await getChannel(req.user!.userId, assertChannelId(req.params.id)) })
}))

/** Checks the channel's streams now (at most every 5 minutes per channel). */
router.post('/channels/:id/check', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await checkChannel(req.user!.userId, assertChannelId(req.params.id)) })
}))

// ─── Favourites / history ────────────────────────────────────────────────────
router.get('/favorites', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await favorites(req.user!.userId) })
}))
router.put('/favorites/order', asyncHandler(async (req: Request, res: Response) => {
  await reorderFavorites(req.user!.userId, req.body?.ids)
  res.json({ success: true, data: await favorites(req.user!.userId) })
}))
router.put('/favorites/:id', asyncHandler(async (req: Request, res: Response) => {
  await addFavorite(req.user!.userId, assertChannelId(req.params.id))
  res.json({ success: true })
}))
router.delete('/favorites/:id', asyncHandler(async (req: Request, res: Response) => {
  await removeFavorite(req.user!.userId, assertChannelId(req.params.id))
  res.json({ success: true })
}))

router.get('/history', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await recentChannels(req.user!.userId, Number(req.query.limit) || 30) })
}))
router.post('/history/:id', asyncHandler(async (req: Request, res: Response) => {
  await recordWatch(req.user!.userId, assertChannelId(req.params.id))
  res.json({ success: true })
}))

// ─── Settings / refresh ──────────────────────────────────────────────────────
router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { settings: await getSettings(), refresh: await refreshState() } })
}))
router.put('/settings', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveSettings(req.body ?? {}) })
}))
/** Downloads the catalogue again now (answers at once; the state is in GET /settings). */
router.post('/refresh', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  void refreshCatalogue().catch(() => {})
  res.status(202).json({ success: true, data: await refreshState() })
}))

export default router
