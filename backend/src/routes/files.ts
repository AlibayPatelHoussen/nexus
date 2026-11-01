import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate, authenticateStream, requireAdmin } from '../middleware/auth'
import { FilesService, isInsideDir, sanitizePath } from '../services/files'
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'

const router = Router()

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
}

/** Parse a single `bytes=start-end` range. Returns null when unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null

  let start: number
  let end: number
  if (m[1] === '') {
    // Suffix range: last N bytes
    const suffix = parseInt(m[2], 10)
    if (suffix === 0) return null
    start = Math.max(size - suffix, 0)
    end   = size - 1
  } else {
    start = parseInt(m[1], 10)
    end   = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1)
  }

  if (start > end || start >= size) return null
  return { start, end }
}

/**
 * Resolve a requested path for read-only media access.
 * Admins can read anything; other users are confined to MEDIA_ROOT.
 */
async function resolveReadable(req: Request): Promise<string> {
  const raw = req.query.path
  if (typeof raw !== 'string' || !raw) throw new ValidationError('path is required')
  const filePath = sanitizePath(raw)

  if (req.user!.role !== 'admin' && !(await isInsideDir(MEDIA_ROOT, filePath))) {
    throw new ForbiddenError('Access outside the media library is not allowed')
  }
  return filePath
}

async function statFile(filePath: string): Promise<fs.Stats> {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) throw new ValidationError('Not a file')
    return stat
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new NotFoundError('File')
  }
}

// ─── STREAM (video, PDF, images) — used by players & manga reader ──────────
router.get('/stream', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const filePath = await resolveReadable(req)
  const { size } = await statFile(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME[ext] || 'application/octet-stream'
  const isPdf = ext === '.pdf'

  const rangeHeader = req.headers.range
  if (rangeHeader && !isPdf) {
    const range = parseRange(rangeHeader, size)
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'Content-Range':  `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': range.end - range.start + 1,
      'Content-Type':   contentType,
    })
    fs.createReadStream(filePath, range).pipe(res)
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Length': size,
    'Content-Type':   contentType,
    'Accept-Ranges':  'bytes',
  }
  if (isPdf) headers['Content-Disposition'] = 'inline'
  res.writeHead(200, headers)
  fs.createReadStream(filePath).pipe(res)
}))

// ─── DOWNLOAD ───────────────────────────────────────────────────────────────
router.get('/download', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const filePath = await resolveReadable(req)
  await statFile(filePath)
  res.download(filePath, path.basename(filePath))
}))

// ─── Everything below is the server file manager: admin only ───────────────
router.use(authenticate, requireAdmin)

// Multer — upload into the requested (existing or new) directory
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const raw = req.query.path
    if (typeof raw !== 'string' || !raw) {
      cb(new ValidationError('path is required'), '')
      return
    }
    const dest = sanitizePath(raw)
    fs.promises.mkdir(dest, { recursive: true }).then(() => cb(null, dest), (err) => cb(err, ''))
  },
  // Never trust the client filename for directories
  filename: (_req, file, cb) => {
    const name = path.basename(file.originalname)
    if (!name || name === '.' || name === '..') cb(new ValidationError('Invalid file name'), '')
    else cb(null, name)
  },
})
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } }) // 5GB

// LIST
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const dirPath = (req.query.path as string) || '/'
  const entries = await FilesService.list(dirPath)
  res.json({ success: true, data: entries })
}))

// INFO
router.get('/info', asyncHandler(async (req: Request, res: Response) => {
  const filePath = req.query.path as string
  if (!filePath) throw new ValidationError('path is required')
  const info = await FilesService.getInfo(filePath)
  res.json({ success: true, data: info })
}))

// READ FILE CONTENT
router.get('/read', asyncHandler(async (req: Request, res: Response) => {
  const filePath = req.query.path as string
  if (!filePath) throw new ValidationError('path is required')
  const content = await FilesService.readFile(filePath)
  res.json({ success: true, data: content })
}))

// CREATE DIR
router.post('/mkdir', asyncHandler(async (req: Request, res: Response) => {
  const { path: dirPath } = req.body
  if (!dirPath) throw new ValidationError('path is required')
  await FilesService.createDir(dirPath)
  res.status(201).json({ success: true })
}))

// CREATE FILE
router.post('/touch', asyncHandler(async (req: Request, res: Response) => {
  const { path: filePath, content } = req.body
  if (!filePath) throw new ValidationError('path is required')
  await FilesService.createFile(filePath, content)
  res.status(201).json({ success: true })
}))

// WRITE FILE
router.put('/write', asyncHandler(async (req: Request, res: Response) => {
  const { path: filePath, content } = req.body
  if (!filePath) throw new ValidationError('path is required')
  await FilesService.writeFile(filePath, content)
  res.json({ success: true })
}))

// RENAME
router.patch('/rename', asyncHandler(async (req: Request, res: Response) => {
  const { path: oldPath, newName } = req.body
  if (!oldPath || !newName) throw new ValidationError('path and newName are required')
  await FilesService.rename(oldPath, newName)
  res.json({ success: true })
}))

// MOVE
router.patch('/move', asyncHandler(async (req: Request, res: Response) => {
  const { src, dest } = req.body
  if (!src || !dest) throw new ValidationError('src and dest are required')
  await FilesService.move(src, dest)
  res.json({ success: true })
}))

// DELETE
router.delete('/', asyncHandler(async (req: Request, res: Response) => {
  const filePath = req.query.path as string
  if (!filePath) throw new ValidationError('path is required')
  if (sanitizePath(filePath) === '/') throw new ValidationError('Refusing to delete /')
  await FilesService.delete(filePath)
  res.json({ success: true })
}))

// UPLOAD
router.post('/upload', upload.array('files'), asyncHandler((_req: Request, res: Response) => {
  res.status(201).json({ success: true, message: 'Files uploaded' })
}))

export default router
