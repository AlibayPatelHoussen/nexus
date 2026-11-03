import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, authenticateStream } from '../middleware/auth'
import { query } from '../config/database'
import fs from 'fs/promises'
import { chapterKind } from '../services/chapters'
import { isInsideDir } from '../services/files'
import { hasPdfTools, pageCount, pageImage, pageWidth, warmNext } from '../services/pageImages'

const router = Router()
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'

async function chapterPath(id: string): Promise<string | null> {
  const { rows } = await query('SELECT folder_path FROM chapters WHERE id = $1', [id])
  return (rows[0]?.folder_path as string | undefined) ?? null
}

// ─── One page, ready to read (WebP at the reader's width, converted once) ───
// Media elements cannot send headers: stream token in the query string.
router.get('/chapters/:id/page/:n', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const file = await chapterPath(req.params.id)
  if (!file) { res.status(404).json({ success: false, error: 'Chapter not found' }); return }
  if (req.user!.role !== 'admin' && !(await isInsideDir(MEDIA_ROOT, file))) {
    res.status(403).json({ success: false, error: 'Outside the media library' }); return
  }
  const n = Number(req.params.n)
  if (!Number.isInteger(n) || n < 1) { res.status(400).json({ success: false, error: 'Bad page number' }); return }
  if (chapterKind(file) === 'pdf' && !(await hasPdfTools())) {
    res.status(501).json({ success: false, error: 'poppler-utils manquant sur le serveur' }); return
  }
  const width = pageWidth(req.query.w)
  try {
    const out = await pageImage(req.params.id, file, n, width)
    res.setHeader('Content-Type', 'image/webp')
    // Same URL = same image (the file version is in the cache name): keep it
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.sendFile(out)
    pageCount(file).then((total) => warmNext(req.params.id, file, n, width, total)).catch(() => {})
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    res.status(status).json({ success: false, error: status === 404 ? 'Page introuvable' : 'Page illisible' })
  }
}))

router.use(authenticate)

router.get('/chapters/:id/pages', asyncHandler(async (req: Request, res: Response) => {
  const { rows } = await query(
    'SELECT folder_path FROM chapters WHERE id = $1',
    [req.params.id],
  )

  if (!rows[0]) { res.status(404).json({ success: false, error: 'Chapter not found' }); return }

  const folderPath = rows[0].folder_path as string
  const kind = chapterKind(folderPath)

  try {
    // PDF without poppler on the server: the reader draws it (PDF.js)
    if (kind === 'pdf' && !(await hasPdfTools())) {
      await fs.access(folderPath)
      res.json({ success: true, type: 'pdf', pdfUrl: `/api/files/stream?path=${encodeURIComponent(folderPath)}`, data: [] })
      return
    }
    // Every kind (image folder, CBZ, PDF): light pages prepared by the server
    const total = await pageCount(folderPath)
    res.json({
      success: true,
      type: 'images',
      data: Array.from({ length: total }, (_, i) => ({ name: `page-${i + 1}`, url: `/api/media/chapters/${req.params.id}/page/${i + 1}` })),
    })
  } catch {
    res.status(404).json({ success: false, error: 'Fichiers du chapitre introuvables : relance un scan du manga' })
  }
}))

export default router
