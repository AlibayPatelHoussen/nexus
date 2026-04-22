import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate } from '../middleware/auth'
import { query } from '../config/database'
import fs from 'fs/promises'
import path from 'path'

const router = Router()
router.use(authenticate)

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']

router.get('/chapters/:id/pages', asyncHandler(async (req: Request, res: Response) => {
  const { rows } = await query(
    'SELECT folder_path FROM chapters WHERE id = $1',
    [req.params.id],
  )

  if (!rows[0]) { res.status(404).json({ success: false, error: 'Chapter not found' }); return }

  const folderPath = rows[0].folder_path as string
  const files = await fs.readdir(folderPath)

  const pages = files
    .filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0')
      const numB = parseInt(b.match(/\d+/)?.[0] || '0')
      return numA - numB
    })
    .map((f) => ({
      name: f,
      url:  `/api/files/stream?path=${encodeURIComponent(path.join(folderPath, f))}`,
    }))

  res.json({ success: true, data: pages })
}))

export default router
