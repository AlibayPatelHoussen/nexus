import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import express, { Router, Request, Response } from 'express'
import { logger } from '../utils/logger'

/**
 * GitHub webhook → immediate deployment.
 *
 * GitHub calls POST /api/deploy/webhook (signed with DEPLOY_WEBHOOK_SECRET)
 * when the CI of main finishes ("Workflow runs" event). Nexus only writes a
 * request file; the systemd unit nexus-auto-deploy.path (scripts/auto-deploy.sh)
 * sees it and runs the deployment OUTSIDE Nexus — deploying restarts Nexus.
 * The deployment itself re-checks GitHub (new commit, green CI), so a
 * forged or replayed call can at most trigger a harmless check.
 */

const router = Router()

/** Root of the installation (backend/dist/routes or backend/src/routes → ../../..) */
const ROOT = path.resolve(__dirname, '../../..')
export const requestFile = () =>
  process.env.AUTO_DEPLOY_REQUEST_FILE || path.join(ROOT, 'logs', '.deploy-request')

export function validSignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'))
  const got = Buffer.from(header)
  return got.length === expected.length && crypto.timingSafeEqual(got, expected)
}

interface Payload {
  ref?: string
  after?: string
  action?: string
  workflow_run?: { conclusion?: string | null; head_branch?: string; head_sha?: string; event?: string; name?: string }
}

/** Why this event should (or not) trigger a deployment. */
export function decide(event: string, p: Payload): { deploy: boolean; reason: string; sha?: string } {
  if (event === 'ping') return { deploy: false, reason: 'pong — webhook OK' }
  if (event === 'workflow_run') {
    const r = p.workflow_run
    if (p.action !== 'completed' || !r) return { deploy: false, reason: `workflow ${p.action ?? '?'}: waiting for completion` }
    if (r.head_branch !== 'main' || r.event !== 'push') return { deploy: false, reason: `not a push to main (${r.event} on ${r.head_branch})` }
    if (r.conclusion !== 'success') return { deploy: false, reason: `CI ${r.conclusion}: not deployed` }
    return { deploy: true, reason: 'CI green on main', sha: r.head_sha }
  }
  if (event === 'push') {
    // Useful if only "push" is subscribed; the deployment waits for the CI itself
    if (p.ref !== 'refs/heads/main') return { deploy: false, reason: `push to ${p.ref}` }
    return { deploy: true, reason: 'push to main', sha: p.after }
  }
  return { deploy: false, reason: `event ${event} ignored` }
}

router.post('/webhook', express.raw({ type: '*/*', limit: '5mb' }), (req: Request, res: Response) => {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET
  if (!secret) {
    res.status(503).json({ success: false, error: 'Automatic deployment not configured (DEPLOY_WEBHOOK_SECRET)' })
    return
  }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  if (!validSignature(secret, body, req.get('x-hub-signature-256'))) {
    logger.warn('Deploy webhook: invalid signature')
    res.status(401).json({ success: false, error: 'Invalid signature' })
    return
  }
  let payload: Payload = {}
  try { payload = JSON.parse(body.toString('utf8') || '{}') } catch { /* not JSON */ }

  const event = req.get('x-github-event') || ''
  const d = decide(event, payload)
  if (!d.deploy) {
    res.json({ success: true, deploy: false, reason: d.reason })
    return
  }
  try {
    const file = requestFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${new Date().toISOString()} ${event} ${d.sha ?? ''}\n`)
  } catch (err) {
    logger.error('Deploy webhook: cannot write the request file', { err })
    res.status(500).json({ success: false, error: 'Cannot queue the deployment' })
    return
  }
  logger.info(`Deploy webhook: deployment requested (${d.reason}, ${d.sha?.slice(0, 7) ?? '?'})`)
  res.status(202).json({ success: true, deploy: true, reason: d.reason })
})

export default router
