import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import { ServicesService } from '../services/services'
import { ValidationError } from '../utils/errors'

const router = Router()

router.use(authenticate)

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const services = await ServicesService.getAll()
  res.json({ success: true, data: services })
}))

router.post('/:name/toggle', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params
  const { action } = req.body

  if (!['start', 'stop', 'restart'].includes(action)) {
    throw new ValidationError('Action must be start, stop, or restart')
  }

  await ServicesService.toggle(name, action)
  res.json({ success: true })
}))

router.get('/:name/logs', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params
  const lines = parseInt(req.query.lines as string || '50')
  const logs = await ServicesService.getLogs(name, lines)
  res.json({ success: true, data: logs })
}))

export default router
