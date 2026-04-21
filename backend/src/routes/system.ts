import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate } from '../middleware/auth'
import { SystemService } from '../services/system'

const router = Router()

router.use(authenticate)

router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
  const stats = await SystemService.getStats()
  res.json({ success: true, data: stats })
}))

router.get('/logs', asyncHandler(async (req: Request, res: Response) => {
  const lines = parseInt(req.query.lines as string || '100')
  const logs = await SystemService.getLogs(lines)
  res.json({ success: true, data: logs })
}))

export default router
