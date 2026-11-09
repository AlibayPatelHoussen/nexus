import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import fs from 'fs'
import path from 'path'
import { authenticate } from '../middleware/auth'
import { AuthService } from '../services/auth'
import { isInsideDir, sanitizePath } from '../services/files'
import { baseUrlFor, castControl, castPlay, castStatus, discover, getDevice, listDevices } from '../services/cast'
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'
const router = Router()
router.use(authenticate)

const view = (d: ReturnType<typeof listDevices>[number]) => ({ id: d.id, name: d.name, kind: d.kind, model: d.model })

/** TVs on the server's network (searched again with ?refresh=1, or when none is known yet). */
router.get('/devices', asyncHandler(async (req: Request, res: Response) => {
  const known = listDevices()
  const list = req.query.refresh === '1' || !known.length ? await discover() : known
  res.json({ success: true, data: list.map(view) })
}))

/** The TV plays the file itself, from this server (stream token in the URL, like the player). */
router.post('/play', asyncHandler(async (req: Request, res: Response) => {
  const { deviceId, path: raw, title, startAt } = req.body ?? {}
  if (typeof deviceId !== 'string' || typeof raw !== 'string' || !raw) throw new ValidationError('deviceId and path are required')
  const device = getDevice(deviceId)
  const file = sanitizePath(raw)
  if (req.user!.role !== 'admin' && !(await isInsideDir(MEDIA_ROOT, file))) throw new ForbiddenError('Access outside the media library is not allowed')
  const stat = await fs.promises.stat(file).catch(() => null)
  if (!stat?.isFile()) throw new NotFoundError('File')

  const token = AuthService.generateStreamToken(req.user!)
  // The file name last: some TVs guess the format from the end of the URL
  const url = `${baseUrlFor(device.host)}/api/files/stream?path=${encodeURIComponent(file)}&token=${encodeURIComponent(token)}` +
    `&name=${encodeURIComponent(path.basename(file))}`
  const at = Number(startAt)
  await castPlay(device, url, typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : path.basename(file), file,
    Number.isFinite(at) ? at : 0)
  res.json({ success: true, data: view(device) })
}))

router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const device = getDevice(String(req.query.deviceId ?? ''))
  res.json({ success: true, data: await castStatus(device) })
}))

router.post('/control', asyncHandler(async (req: Request, res: Response) => {
  const { deviceId, action, position } = req.body ?? {}
  if (!['play', 'pause', 'stop', 'seek'].includes(action)) throw new ValidationError('Unknown action')
  const pos = Number(position)
  await castControl(getDevice(String(deviceId ?? '')), action, Number.isFinite(pos) ? pos : 0)
  res.json({ success: true })
}))

export default router
