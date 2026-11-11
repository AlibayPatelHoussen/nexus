import http from 'http'
import type { AddressInfo } from 'net'
import request from 'supertest'
import { app } from '../../src/index'
import { makeToken } from '../helpers'

/**
 * A fake Jarvis API (same routes and formats as jarvis-backend) to check what
 * Nexus relays: identity headers, SSE stream, approvals, errors.
 */
interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }
let seen: Seen[] = []
let reply: { status: number; body: string; type?: string } | null = null
let server: http.Server

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body })
      if (reply) {
        res.writeHead(reply.status, { 'Content-Type': reply.type || 'application/json' })
        res.end(reply.body)
        return
      }
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', model: 'qwen2.5:7b', llm_ready: true, warning: null }))
      } else if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('event: tool\ndata: {"name": "infos_systeme", "arguments": {}}\n\n')
        res.write('event: token\ndata: {"text": "Tout va "}\n\n')
        res.write('event: token\ndata: {"text": "bien."}\n\n')
        res.end('event: done\ndata: {"response": "Tout va bien."}\n\n')
      } else if (req.url === '/api/history') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ messages: [{ role: 'user', content: 'Salut' }] }))
      } else if (req.url === '/api/approvals') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ approvals: [{ id: 3, action: "redemarrer_conteneur(nom='jellyfin')", source: 'telephone', created: '2026-11-12T10:00:00' }] }))
      } else if (req.url === '/api/approvals/3') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ approved: true, result: 'jellyfin redémarré' }))
      } else if (req.url === '/api/approvals/9') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Demande inconnue ou expirée.' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

beforeEach(() => {
  seen = []
  reply = null
  process.env.JARVIS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.JARVIS_API_KEY = 'jv_cle_de_test'
  delete process.env.JARVIS_OWNER
})

const auth = (role: 'admin' | 'user' = 'admin', userId = 'test-uuid') => `Bearer ${makeToken(role, 'access', userId)}`

describe('Jarvis relay', () => {
  it('requires a Nexus session', async () => {
    expect((await request(app).get('/api/jarvis/status')).status).toBe(401)
    expect((await request(app).post('/api/jarvis/chat').send({ message: 'x' })).status).toBe(401)
  })

  it('reports the Jarvis status', async () => {
    const res = await request(app).get('/api/jarvis/status').set('Authorization', auth())
    expect(res.body.data).toEqual({ configured: true, online: true, model: 'qwen2.5:7b', warning: null })
  })

  it('says when Jarvis is not configured or stopped', async () => {
    delete process.env.JARVIS_API_KEY
    const notConfigured = await request(app).get('/api/jarvis/status').set('Authorization', auth())
    expect(notConfigured.body.data).toEqual({ configured: false, online: false })
    const chat = await request(app).post('/api/jarvis/chat').set('Authorization', auth()).send({ message: 'Salut' })
    expect(chat.status).toBe(503)

    process.env.JARVIS_API_KEY = 'jv_cle_de_test'
    process.env.JARVIS_URL = 'http://127.0.0.1:9'
    const stopped = await request(app).get('/api/jarvis/status').set('Authorization', auth())
    expect(stopped.body.data).toEqual({ configured: true, online: false })
    const history = await request(app).get('/api/jarvis/history').set('Authorization', auth())
    expect(history.status).toBe(503)
    expect(history.body.error || history.body.message).toMatch(/Jarvis ne répond pas/)
  })

  it('sends the user identity and role, never the browser token', async () => {
    await request(app).get('/api/jarvis/history').set('Authorization', auth('user', 'uuid-alice'))
    const h = seen[0].headers
    expect(h.authorization).toBe('Bearer jv_cle_de_test')
    expect(h['x-jarvis-user']).toBe('uuid-alice')
    expect(h['x-jarvis-name']).toBe('testuser')
    expect(h['x-jarvis-role']).toBe('user')
  })

  it('links the JARVIS_OWNER account to the Jarvis owner', async () => {
    process.env.JARVIS_OWNER = 'TestAdmin'
    await request(app).get('/api/jarvis/history').set('Authorization', auth('admin'))
    expect(seen[0].headers['x-jarvis-user']).toBe('owner')
    await request(app).get('/api/jarvis/history').set('Authorization', auth('user'))
    expect(seen[1].headers['x-jarvis-user']).toBe('test-uuid')
  })

  it('relays the answer as a stream', async () => {
    const res = await request(app).post('/api/jarvis/chat').set('Authorization', auth()).send({ message: '  Comment va le serveur ?  ' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    expect(res.headers['cache-control']).toMatch(/no-transform/)
    expect(res.text).toContain('event: tool')
    expect(res.text).toContain('event: done\ndata: {"response": "Tout va bien."}')
    expect(JSON.parse(seen[0].body)).toEqual({ message: 'Comment va le serveur ?' })
  })

  it('validates messages and confirmations', async () => {
    const empty = await request(app).post('/api/jarvis/chat').set('Authorization', auth()).send({ message: '   ' })
    expect(empty.status).toBe(422)
    const badId = await request(app).post('/api/jarvis/chat/confirm').set('Authorization', auth()).send({ id: '../x', approved: true })
    expect(badId.status).toBe(422)
    const ok = await request(app).post('/api/jarvis/chat/confirm').set('Authorization', auth()).send({ id: 'abcdef0123456789', approved: false })
    expect(ok.status).toBe(200)
    expect(JSON.parse(seen[0].body)).toEqual({ id: 'abcdef0123456789', approved: false })
    expect(seen).toHaveLength(1)
  })

  it('lists and decides approvals', async () => {
    const list = await request(app).get('/api/jarvis/approvals').set('Authorization', auth())
    expect(list.body.data[0].action).toBe("redemarrer_conteneur(nom='jellyfin')")
    const decided = await request(app).post('/api/jarvis/approvals/3').set('Authorization', auth()).send({ approved: true })
    expect(decided.body.data).toEqual({ approved: true, result: 'jellyfin redémarré' })
    const unknown = await request(app).post('/api/jarvis/approvals/9').set('Authorization', auth()).send({ approved: true })
    expect(unknown.status).toBe(404)
    const invalid = await request(app).post('/api/jarvis/approvals/abc').set('Authorization', auth()).send({ approved: true })
    expect(invalid.status).toBe(422)
  })

  it('explains a rejected Nexus key', async () => {
    reply = { status: 401, body: JSON.stringify({ detail: 'Clé d’accès invalide.' }) }
    const res = await request(app).get('/api/jarvis/history').set('Authorization', auth())
    expect(res.status).toBe(502)
    expect(res.body.error || res.body.message).toMatch(/JARVIS_API_KEY/)
  })

  it('relays history and clear', async () => {
    const history = await request(app).get('/api/jarvis/history').set('Authorization', auth())
    expect(history.body.data).toEqual([{ role: 'user', content: 'Salut' }])
    const clear = await request(app).post('/api/jarvis/clear').set('Authorization', auth())
    expect(clear.status).toBe(200)
    expect(seen[1].url).toBe('/api/conversation/clear')
  })
})
