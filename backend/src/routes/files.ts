import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { owner, sudoRun, withSudo } from '../utils/sudo'

import { authenticate, authenticateStream, requireAdmin } from '../middleware/auth'
import { forgetPaths } from '../services/libraryDelete'
import { sudoLimiter } from '../middleware/rateLimit'
import { elevatedDelete } from '../services/elevatedDelete'
import { FilesService, isInsideDir, sanitizePath } from '../services/files'
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'
import { query } from '../config/database'
import { archivePages, chapterKind } from '../services/chapters'
import {
  decide, getJob, hasFfmpeg, jobStatus, probe, rewritePlaylist, segmentFile, startJob, stopJob,
  vodPlaylist, waitForPlaylist, type ClientCaps,
} from '../services/transcode'

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'

/** Upload into a folder Nexus cannot write to: received in `tmp`, moved with sudo */
interface SudoUploadRequest extends Request {
  uploadDir?:  Promise<string>
  sudoUpload?: { tmp: string; dest: string }
}

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

  // Range requests for every file, PDFs included: PDF.js and Safari's viewer
  // fetch big PDFs piece by piece (first pages first)
  const rangeHeader = req.headers.range
  if (rangeHeader) {
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
      ...(isPdf ? { 'Content-Disposition': 'inline' } : {}),
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

// ─── PLAYBACK: direct when the browser can read the file, HLS conversion otherwise ──
const capsFrom = (req: Request): ClientCaps => ({ webm: req.query.webm === '1' })

/** How the player should read this video: direct stream, or converted (remux/transcode). */
router.get('/play-info', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const filePath = await resolveReadable(req)
  await statFile(filePath)
  if (!(await hasFfmpeg())) {
    res.json({ success: true, data: { mode: 'direct', duration: null, video: null, audio: null, reason: 'ffmpeg not installed', ffmpeg: false } })
    return
  }
  try {
    const decision = decide(await probe(filePath), capsFrom(req))
    res.json({ success: true, data: { ...decision, ffmpeg: true } })
  } catch (err) {
    // Unreadable by ffprobe: let the browser try the file as-is
    res.json({ success: true, data: { mode: 'direct', duration: null, video: null, audio: null, reason: `probe failed: ${(err as Error).message}`, ffmpeg: true } })
  }
}))

/** Start a conversion at `start` seconds; returns the HLS playlist URL. */
router.post('/transcode', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const filePath = await resolveReadable(req)
  await statFile(filePath)
  if (!(await hasFfmpeg())) throw new AppError('ffmpeg is not installed on the server', 501)

  const decision = decide(await probe(filePath), capsFrom(req))
  const mode = decision.mode === 'direct' ? 'remux' : decision.mode
  let start = Math.max(0, Number(req.query.start) || 0)
  if (decision.duration) start = Math.min(start, Math.max(0, decision.duration - 1))

  const job = await startJob(req.user!.userId, filePath, mode, start, decision.duration, !!decision.audioCopy)
  res.status(201).json({
    success: true,
    data: {
      id:       job.id,
      mode,
      // Timeline start of the stream (0: the whole film is in the playlist; the player seeks to `at`)
      start:    job.start,
      at:       start,
      vod:      job.vod,
      duration: decision.duration,
      playlist: `/api/files/transcode/${job.id}/index.m3u8`,
    },
  })
}))

function ownJob(req: Request) {
  const job = getJob(req.params.id)
  if (!job || job.userId !== req.user!.userId) throw new NotFoundError('Transcode')
  return job
}

/** Conversion progress: a remux is played once complete (the whole film is then seekable). */
router.get('/transcode/:id/status', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await jobStatus(ownJob(req)) })
}))

router.get('/transcode/:id/index.m3u8', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const job = ownJob(req)
  // Remux on demand: the playlist needs the file's keyframe index (the player waits for it)
  if (job.indexing) await job.indexing
  if (job.vod) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-cache')
    res.send(vodPlaylist(job, String(req.query.token ?? '')))
    return
  }
  const text = await waitForPlaylist(job)
  if (!text) throw new AppError(job.failed ? `Conversion failed: ${job.failed}` : 'Conversion did not start in time', 502)
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
  res.setHeader('Cache-Control', 'no-cache')
  res.send(rewritePlaylist(text, String(req.query.token ?? '')))
}))

router.get('/transcode/:id/:segment', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const m = /^seg(\d{5})\.ts$/.exec(req.params.segment)
  if (!m) throw new NotFoundError('Segment')
  const job = ownJob(req)
  const file = await segmentFile(job, Number(m[1]))
  if (!file) throw new NotFoundError('Segment')
  res.setHeader('Content-Type', 'video/mp2t')
  res.setHeader('Cache-Control', 'no-cache')
  fs.createReadStream(file).pipe(res)
}))

/** Player closed / seeked elsewhere: stop ffmpeg right away. */
router.delete('/transcode/:id', authenticateStream, asyncHandler((req: Request, res: Response) => {
  const job = getJob(req.params.id)
  if (job && job.userId === req.user!.userId) stopJob(job.id, 'client closed the player')
  res.json({ success: true })
}))

// ─── One page of a CBZ / ZIP manga chapter (used by <img> in the reader) ────
router.get('/archive-page', authenticateStream, asyncHandler(async (req: Request, res: Response) => {
  const { rows } = await query('SELECT folder_path FROM chapters WHERE id = $1', [String(req.query.chapter ?? '')])
  const file = rows[0]?.folder_path as string | undefined
  if (!file || chapterKind(file) !== 'archive') throw new NotFoundError('Chapter')
  if (req.user!.role !== 'admin' && !(await isInsideDir(MEDIA_ROOT, file))) throw new ForbiddenError('Outside the media library')

  const { zip, pages } = await archivePages(file)
  const name = pages[Number(req.query.page)]
  if (!name) throw new NotFoundError('Page')
  const data = zip.readFile(name)
  if (!data) throw new NotFoundError('Page')
  res.setHeader('Content-Type', MIME[path.extname(name).toLowerCase()] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.end(data)
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
    const r = req as SudoUploadRequest
    // Called once per file, possibly concurrently: decide the folder once per request
    r.uploadDir ??= withSudo(
      async () => {
        await fs.promises.mkdir(dest, { recursive: true })
        await fs.promises.access(dest, fs.constants.W_OK)
        return dest
      },
      // Folder Nexus cannot write to: receive into a temporary folder, then move with sudo
      async () => {
        const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexus-upload-'))
        r.sudoUpload = { tmp, dest }
        return tmp
      },
    )
    r.uploadDir.then((d) => cb(null, d), (err) => cb(err, ''))
  },
  // Never trust the client filename for directories
  filename: (_req, file, cb) => {
    // Busboy decodes multipart file names as latin1: "Épisode" arrived as "Ã\x89pisode"
    const name = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'))
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

// DELETE (one)
router.delete('/', asyncHandler(async (req: Request, res: Response) => {
  const filePath = req.query.path as string
  if (!filePath) throw new ValidationError('path is required')
  await FilesService.delete(filePath)
  await forgetPaths([filePath])        // the library forgets what was in it at once (no rescan needed)
  res.json({ success: true })
}))

// DELETE (several): every result is reported, a failure does not stop the others
router.post('/delete', asyncHandler(async (req: Request, res: Response) => {
  const paths = req.body?.paths
  if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === 'string' && p)) {
    throw new ValidationError('paths must be a non-empty array of paths')
  }
  if (paths.length > 1000) throw new ValidationError('Too many paths at once (max 1000)')
  const result = await FilesService.deleteMany([...new Set(paths as string[])])
  await forgetPaths(result.deleted)
  res.status(result.failed.length && !result.deleted.length ? 422 : 200).json({ success: result.failed.length === 0, data: result })
}))

// DELETE forced with the server's sudo password (library entries owned by root…)
router.post('/delete-elevated', sudoLimiter, asyncHandler(async (req: Request, res: Response) => {
  const paths = req.body?.paths
  const password = req.body?.password
  if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === 'string' && p)) {
    throw new ValidationError('paths must be a non-empty array of paths')
  }
  if (paths.length > 1000) throw new ValidationError('Too many paths at once (max 1000)')
  if (typeof password !== 'string' || !password) throw new ValidationError('password is required')
  const result = await elevatedDelete([...new Set(paths as string[])], password)
  await forgetPaths(result.deleted)
  res.status(result.failed.length && !result.deleted.length ? 422 : 200).json({ success: result.failed.length === 0, data: result })
}))

// UPLOAD
router.post('/upload', upload.array('files'), asyncHandler(async (req: Request, res: Response) => {
  const job = (req as SudoUploadRequest).sudoUpload
  if (job) {
    try {
      const [uid, gid] = owner.split(':')
      await sudoRun(['install', '-d', '-o', uid, '-g', gid, '--', job.dest])
      for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) {
        const target = path.join(job.dest, f.filename)
        await sudoRun(['mv', '-f', '--', f.path, target])
        await sudoRun(['chown', owner, '--', target])
      }
    } finally {
      await fs.promises.rm(job.tmp, { recursive: true, force: true })
    }
  }
  res.status(201).json({ success: true, message: 'Files uploaded' })
}))

export default router
