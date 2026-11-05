import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { query } from '../config/database'
import path from 'path'
import { cachedImage, isRemote, validSignature } from '../services/images'
import { isInsideDir } from '../services/files'

const LOCAL_IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i
const libraryRoots = () => [process.env.MEDIA_ROOT || '/media', process.env.YOUTUBE_PATH, process.env.FILMS_PATH,
  process.env.SERIES_PATH, process.env.ANIMES_PATH, process.env.MANGA_PATH].filter((v): v is string => !!v)

/** A local image of the library (never anything else on the disk). */
async function sendLocal(res: Response, file: string) {
  if (!path.isAbsolute(file) || !LOCAL_IMAGE.test(file)) { res.status(404).end(); return }
  for (const root of libraryRoots()) {
    if (await isInsideDir(root, file)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
      res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end() })
      return
    }
  }
  res.status(404).end()
}

// Public on purpose: <img> tags cannot send an Authorization header, and only
// artwork of titles already in the library (looked up by UUID) can be served.
const router = Router()

const UUID = /^[0-9a-f-]{36}$/i

async function send(res: Response, url: string | null | undefined, trusted = false) {
  if (url && !trusted && url.startsWith('/') && !url.startsWith('/api/')) { await sendLocal(res, url); return }
  if (!url || !isRemote(url)) { res.status(404).end(); return }
  try {
    const { file, type } = await cachedImage(url, trusted)
    res.setHeader('Content-Type', type)
    // The ?v= parameter changes with the source URL, so the response can be cached long
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    res.sendFile(file)
  } catch {
    res.status(404).end()
  }
}

const MEDIA_FIELDS: Record<string, string> = {
  poster: 'poster_path', backdrop: 'backdrop_path', keyart: 'key_art_path', logo: 'logo_path', herobackdrop: 'hero_backdrop_path',
}
router.get('/media/:id/:field(poster|backdrop|keyart|logo|herobackdrop)', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) { res.status(404).end(); return }
  const col = MEDIA_FIELDS[req.params.field]
  const { rows } = await query(`SELECT ${col} AS url FROM media_items WHERE id = $1`, [req.params.id])
  await send(res, rows[0]?.url as string | undefined)
}))

router.get('/episode/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) { res.status(404).end(); return }
  const { rows } = await query('SELECT thumbnail_path AS url FROM episodes WHERE id = $1', [req.params.id])
  await send(res, rows[0]?.url as string | undefined)
}))

// Artwork of download search results: only URLs signed by this server
router.get('/remote', asyncHandler(async (req: Request, res: Response) => {
  const { u, s } = req.query
  if (!validSignature(u, s)) { res.status(404).end(); return }
  await send(res, u, true)
}))

export default router
