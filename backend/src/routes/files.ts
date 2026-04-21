import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import multer from 'multer'
import path from 'path'
import { authenticate } from '../middleware/auth'
import { FilesService } from '../services/files'
import { ValidationError } from '../utils/errors'
import fs from 'fs'

const router = Router()
router.use(authenticate)

// Multer — upload to requested path
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dest = (req.query.path as string) || '/tmp'
    fs.mkdirSync(dest, { recursive: true })
    cb(null, dest)
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
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

// DOWNLOAD
router.get('/download', asyncHandler(async (req: Request, res: Response) => {
  const filePath = req.query.path as string
  if (!filePath) throw new ValidationError('path is required')
  res.download(filePath, path.basename(filePath))
}))

// STREAM (for video)
router.get('/stream', authenticate, (req: Request, res: Response) => {
  const filePath = req.query.path as string
  if (!filePath) { res.status(400).json({ error: 'path required' }); return }

  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const range = req.headers.range

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1
    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   'video/mp4',
    })
    fs.createReadStream(filePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   'video/mp4',
    })
    fs.createReadStream(filePath).pipe(res)
  }
})

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
  await FilesService.delete(filePath)
  res.json({ success: true })
}))

// UPLOAD
router.post('/upload', upload.array('files'), asyncHandler(async (_req: Request, res: Response) => {
  res.status(201).json({ success: true, message: 'Files uploaded' })
}))

export default router
