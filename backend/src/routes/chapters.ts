import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate } from '../middleware/auth'
import { query } from '../config/database'
import fs from 'fs/promises'
import path from 'path'
import { IMAGE_EXTS, archivePages, chapterKind } from '../services/chapters'

const router = Router()
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
    // PDF chapter — a single PDF URL for the reader
    if (kind === 'pdf') {
      await fs.access(folderPath)
      res.json({ success: true, type: 'pdf', pdfUrl: `/api/files/stream?path=${encodeURIComponent(folderPath)}`, data: [] })
      return
    }

    // CBZ / ZIP — pages are extracted on demand
    if (kind === 'archive') {
      const { pages } = await archivePages(folderPath)
      res.json({
        success: true,
        type: 'images',
        data: pages.map((name, i) => ({ name: path.basename(name), url: `/api/files/archive-page?chapter=${req.params.id}&page=${i}` })),
      })
      return
    }

    // Folder of images — natural order (1, 2, …, 10)
    const files = await fs.readdir(folderPath)
    const pages = files
      .filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((f) => ({ name: f, url: `/api/files/stream?path=${encodeURIComponent(path.join(folderPath, f))}` }))
    res.json({ success: true, type: 'images', data: pages })
  } catch {
    res.status(404).json({ success: false, error: 'Fichiers du chapitre introuvables : relance un scan du manga' })
  }
}))

export default router
