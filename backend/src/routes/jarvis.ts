import { Router, Request, Response } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate } from '../middleware/auth'
import { ValidationError } from '../utils/errors'
import { jarvisFetch, jarvisJson, jarvisStatus } from '../services/jarvis'

/**
 * Relay to the Jarvis API for the logged-in user (see services/jarvis.ts).
 * Every Nexus account may talk to Jarvis; what Jarvis may do for it depends on
 * its Nexus role (terminal, files, Docker and services: admins only).
 */
const router = Router()
router.use(authenticate)

router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await jarvisStatus() })
}))

router.get('/history', asyncHandler(async (req: Request, res: Response) => {
  const data = await jarvisJson<{ messages: unknown[] }>(req.user!, '/api/history')
  res.json({ success: true, data: data.messages })
}))

router.post('/clear', asyncHandler(async (req: Request, res: Response) => {
  await jarvisFetch(req.user!, '/api/conversation/clear', { method: 'POST' })
  res.json({ success: true })
}))

router.get('/approvals', asyncHandler(async (req: Request, res: Response) => {
  const data = await jarvisJson<{ approvals: unknown[] }>(req.user!, '/api/approvals')
  res.json({ success: true, data: data.approvals })
}))

router.post('/approvals/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Demande invalide')
  if (typeof req.body?.approved !== 'boolean') throw new ValidationError('approved doit valoir true ou false')
  const data = await jarvisJson<{ approved: boolean; result: string }>(
    req.user!, `/api/approvals/${id}`, { method: 'POST', body: { approved: req.body.approved } })
  res.json({ success: true, data })
}))

router.post('/chat/confirm', asyncHandler(async (req: Request, res: Response) => {
  const id = req.body?.id
  if (typeof id !== 'string' || !/^[a-f0-9]{8,64}$/.test(id)) throw new ValidationError('Demande invalide')
  if (typeof req.body?.approved !== 'boolean') throw new ValidationError('approved doit valoir true ou false')
  await jarvisFetch(req.user!, '/api/chat/confirm', { method: 'POST', body: { id, approved: req.body.approved } })
  res.json({ success: true })
}))

/**
 * Message → answer streamed as Server-Sent Events, relayed as is:
 * token {text} · tool {name, arguments} · confirm {id, action} · done {response} · error {message}
 */
router.post('/chat', asyncHandler(async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!message) throw new ValidationError('Message vide')
  if (message.length > 20_000) throw new ValidationError('Message trop long')

  // No timeout: a local model can think for a while (the stream stays open)
  const upstream = await jarvisFetch(req.user!, '/api/chat', { method: 'POST', body: { message } }, null)
  if (!upstream.body) throw new ValidationError('Réponse vide de Jarvis')

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform: compression() must not buffer the stream
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  })
  res.flushHeaders()

  const reader = upstream.body.getReader()
  let closed = false
  req.on('close', () => {
    closed = true
    reader.cancel().catch(() => {})
  })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || closed) break
      res.write(Buffer.from(value))
    }
  } catch {
    if (!closed) res.write(`event: error\ndata: ${JSON.stringify({ message: 'Connexion à Jarvis interrompue.' })}\n\n`)
  }
  res.end()
}))

export default router
