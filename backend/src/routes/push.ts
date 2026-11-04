import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate } from '../middleware/auth'
import { deviceCount, publicKey, sendPush, subscribe, unsubscribe } from '../services/push'

const router = Router()
router.use(authenticate)

router.get('/key', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: { publicKey: publicKey(), devices: await deviceCount(req.user!.userId) } })
}))

router.post('/subscribe', asyncHandler(async (req: Request, res: Response) => {
  await subscribe(req.user!.userId, req.body?.subscription, req.get('user-agent'))
  res.status(201).json({ success: true })
}))

router.post('/unsubscribe', asyncHandler(async (req: Request, res: Response) => {
  await unsubscribe(req.user!.userId, req.body?.endpoint)
  res.json({ success: true })
}))

router.post('/test', asyncHandler(async (req: Request, res: Response) => {
  const sent = await sendPush([req.user!.userId], { title: 'Nexus', body: 'Les notifications fonctionnent sur cet appareil.', url: '/settings', tag: 'test' })
  res.json({ success: true, data: { sent } })
}))

export default router
