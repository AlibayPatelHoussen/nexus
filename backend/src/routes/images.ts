import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { query } from '../config/database'
import { cachedImage, isRemote } from '../services/images'

// Public on purpose: <img> tags cannot send an Authorization header, and only
// artwork of titles already in the library (looked up by UUID) can be served.
const router = Router()

const UUID = /^[0-9a-f-]{36}$/i

async function send(res: Response, url: string | null | undefined) {
  if (!url || !isRemote(url)) { res.status(404).end(); return }
  try {
    const { file, type } = await cachedImage(url)
    res.setHeader('Content-Type', type)
    // The ?v= parameter changes with the source URL, so the response can be cached long
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    res.sendFile(file)
  } catch {
    res.status(404).end()
  }
}

router.get('/media/:id/:field(poster|backdrop)', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) { res.status(404).end(); return }
  const col = req.params.field === 'poster' ? 'poster_path' : 'backdrop_path'
  const { rows } = await query(`SELECT ${col} AS url FROM media_items WHERE id = $1`, [req.params.id])
  await send(res, rows[0]?.url as string | undefined)
}))

router.get('/episode/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) { res.status(404).end(); return }
  const { rows } = await query('SELECT thumbnail_path AS url FROM episodes WHERE id = $1', [req.params.id])
  await send(res, rows[0]?.url as string | undefined)
}))

export default router
