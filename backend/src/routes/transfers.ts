import { Router, Request, Response, NextFunction } from 'express'
import asyncHandler from 'express-async-handler'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { authenticate, authenticateStream, requireAdmin } from '../middleware/auth'
import { AppError, ValidationError } from '../utils/errors'
import { clientInfo } from '../utils/device'
import { contentDisposition } from '../utils/contentDisposition'
import {
  MAX_TRANSFER_BYTES, MAX_TRANSFER_FILES, addTransfers, clearTransfers, ensureDirs, freeBytes, incomingDir,
  listTransfers, removeTransfer, transferFile, type Sender,
} from '../services/transfers'

// « Transferts » (Aperçu, admins): send a file from one device, take it on another
const router = Router()

/** Images shown in the list (never HTML, SVG… sent by a browser: those are downloaded only) */
const INLINE = /^image\/(jpeg|png|gif|webp|avif|heic|heif)$/

// The file itself: a link (<a download>, <img>) cannot send a header, so a stream token is enough
router.get('/:id/file', authenticateStream, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const t = await transferFile(req.user!.userId, req.params.id)
  const inline = req.query.inline === '1' && INLINE.test(t.mime ?? '')
  res.setHeader('Cache-Control', 'private, no-store')
  // An image: its own type (checked above); anything else is downloaded, never guessed from its name
  res.setHeader('Content-Type', inline ? t.mime! : 'application/octet-stream')
  res.setHeader('Content-Disposition', contentDisposition(t.name, inline ? 'inline' : 'attachment'))
  res.sendFile(t.file, { dotfiles: 'allow' })
}))

router.use(authenticate, requireAdmin)

const sender = (req: Request): Sender => ({
  userId: req.user!.userId, sid: req.user!.sid, client: req.get('x-nexus-client') ?? undefined,
})

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await listTransfers(req.user!.userId) })
}))

/** Room left on the disk after a transfer (the server keeps working) */
const KEEP_FREE = 2 * 1024 * 1024 * 1024

// Refused before a byte is received when it cannot fit
const roomFor = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const length = Number(req.get('content-length'))
  const free = await freeBytes()
  if (free !== null && Number.isFinite(length) && length > free - KEEP_FREE) {
    throw new AppError('Pas assez de place sur le serveur pour ce transfert', 507, true, 'NO_SPACE')
  }
  next()
})

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { ensureDirs(); cb(null, incomingDir()) } catch (err) { cb(err as Error, '') }
    },
    // The name given by the browser is never a path on the server
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: MAX_TRANSFER_BYTES, files: MAX_TRANSFER_FILES, fields: 5, fieldSize: 1024 },
})
const GB = MAX_TRANSFER_BYTES / 1024 ** 3
const receive = (req: Request, res: Response, next: NextFunction) => {
  upload.array('files')(req, res, (err?: unknown) => {
    if (!err) { next(); return }
    const code = (err as { code?: string }).code
    if (code === 'LIMIT_FILE_SIZE') next(new AppError(`Fichier trop gros (${GB} Go au plus)`, 413))
    else if (code === 'LIMIT_FILE_COUNT') next(new AppError(`Trop de fichiers à la fois (${MAX_TRANSFER_FILES} au plus)`, 413))
    else if ((err as Error).name === 'MulterError') next(new ValidationError('Envoi refusé'))
    else next(err)
  })
}

router.post('/', roomFor, receive, asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (!files.length) throw new ValidationError('Aucun fichier reçu')
  const added = await addTransfers(sender(req), files, clientInfo(req).device)
  res.status(201).json({ success: true, data: added })
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await removeTransfer(sender(req), req.params.id)
  res.json({ success: true })
}))

router.delete('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: { removed: await clearTransfers(sender(req)) } })
}))

export default router
