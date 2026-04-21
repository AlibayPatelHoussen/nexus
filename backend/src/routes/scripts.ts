import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import { ScriptsService } from '../services/scripts'

const router = Router()
router.use(authenticate)

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const scripts = await ScriptsService.list()
  res.json({ success: true, data: scripts })
}))

router.post('/:name/run', requireAdmin, (req: Request, res: Response) => {
  const { name } = req.params

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const send = (type: string, data: string) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ data })}\n\n`)

  let kill: (() => void) | null = null

  try {
    kill = ScriptsService.run(
      name,
      (out)  => send('output', out),
      (code) => { send('exit', String(code)); res.end() },
    )
  } catch (err) {
    send('error', String(err))
    res.end()
    return
  }

  req.on('close', () => { kill?.(); res.end() })
})

export default router
