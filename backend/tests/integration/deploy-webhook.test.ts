import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'

const SECRET = 'test-webhook-secret'
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-deploy-')), 'logs', '.deploy-request')
process.env.DEPLOY_WEBHOOK_SECRET = SECRET
process.env.AUTO_DEPLOY_REQUEST_FILE = FILE
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { app } = require('../../src/index')

const sign = (body: string, secret = SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
const send = (event: string, payload: object, signature?: string) => {
  const body = JSON.stringify(payload)
  return request(app).post('/api/deploy/webhook')
    .set('Content-Type', 'application/json').set('X-GitHub-Event', event)
    .set('X-Hub-Signature-256', signature ?? sign(body)).send(body)
}
const run = (over: object) => ({ action: 'completed', workflow_run: { conclusion: 'success', head_branch: 'main', event: 'push', head_sha: 'abc1234def', ...over } })

beforeEach(() => fs.rmSync(FILE, { force: true }))

describe('POST /api/deploy/webhook', () => {
  it('rejects a missing or wrong signature', async () => {
    expect((await send('workflow_run', run({}), 'sha256=00')).status).toBe(401)
    expect((await send('workflow_run', run({}), sign('{}', 'other-secret'))).status).toBe(401)
    expect(fs.existsSync(FILE)).toBe(false)
  })
  it('answers the GitHub ping', async () => {
    const res = await send('ping', { zen: 'hi' })
    expect(res.status).toBe(200)
    expect(res.body.reason).toMatch(/pong/)
  })
  it('green CI on main → deployment requested', async () => {
    const res = await send('workflow_run', run({}))
    expect(res.status).toBe(202)
    expect(fs.readFileSync(FILE, 'utf8')).toContain('abc1234def')
  })
  it.each([
    ['red CI', run({ conclusion: 'failure' })],
    ['another branch', run({ head_branch: 'develop' })],
    ['a pull request', run({ event: 'pull_request' })],
    ['still running', { action: 'requested', workflow_run: run({}).workflow_run }],
  ])('%s → nothing', async (_n, payload) => {
    const res = await send('workflow_run', payload)
    expect(res.status).toBe(200)
    expect(res.body.deploy).toBe(false)
    expect(fs.existsSync(FILE)).toBe(false)
  })
  it('push to main → requested (the deployment waits for the CI itself)', async () => {
    expect((await send('push', { ref: 'refs/heads/main', after: 'fff' })).status).toBe(202)
    expect((await send('push', { ref: 'refs/heads/develop' })).body.deploy).toBe(false)
  })
})
