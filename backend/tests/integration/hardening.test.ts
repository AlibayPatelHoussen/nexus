import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { NEXUS_ROOT, assertAllowed } from '../../src/services/files'
import { makeToken } from '../helpers'

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
const admin = () => bearer(makeToken('admin'))

/** A folder of the test with a secret, a harmless file and a symlink to the secret */
let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-hardening-'))
  fs.writeFileSync(path.join(dir, '.env'), 'JWT_SECRET=do-not-show')
  fs.writeFileSync(path.join(dir, '.env.example'), 'JWT_SECRET=change-me')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello')
  fs.symlinkSync(path.join(dir, '.env'), path.join(dir, 'innocent.txt'))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('File manager: secrets are never handed out, even to an admin', () => {
  it.each(['.env', 'innocent.txt'])('read %s → 403 PROTECTED_FILE', async (name) => {
    const res = await request(app).get('/api/files/read').query({ path: path.join(dir, name) }).set(admin())
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PROTECTED_FILE')
    expect(JSON.stringify(res.body)).not.toContain('do-not-show')
  })

  it('download and stream of a .env → 403', async () => {
    for (const route of ['/api/files/download', '/api/files/stream']) {
      const res = await request(app).get(route).query({ path: path.join(dir, '.env') }).set(admin())
      expect(res.status).toBe(403)
      expect(res.text).not.toContain('do-not-show')
    }
  })

  it('an example file and ordinary files stay readable', async () => {
    const ex = await request(app).get('/api/files/read').query({ path: path.join(dir, '.env.example') }).set(admin())
    expect(ex.status).toBe(200)
    const notes = await request(app).get('/api/files/read').query({ path: path.join(dir, 'notes.txt') }).set(admin())
    expect(notes.status).toBe(200)
  })

  it('a .env cannot be written, renamed to, deleted or uploaded', async () => {
    const write = await request(app).put('/api/files/write').set(admin()).send({ path: path.join(dir, '.env'), content: 'x' })
    expect(write.status).toBe(403)
    const rename = await request(app).patch('/api/files/rename').set(admin()).send({ path: path.join(dir, 'notes.txt'), newName: '.env.local' })
    expect(rename.status).toBe(403)
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true)
    const del = await request(app).delete('/api/files').query({ path: path.join(dir, '.env') }).set(admin())
    expect(del.status).toBe(403)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toBe('JWT_SECRET=do-not-show')
    const up = await request(app).post('/api/files/upload').query({ path: dir }).set(admin())
      .attach('files', Buffer.from('X=1'), '.env')
    expect(up.status).toBe(403)
  })
})

describe('File manager: the Nexus installation is read-only', () => {
  it('nothing is created or written inside it', async () => {
    const target = path.join(NEXUS_ROOT, 'hardening-should-not-exist.txt')
    try {
      const touch = await request(app).post('/api/files/touch').set(admin()).send({ path: target })
      expect(touch.status).toBe(403)
      const write = await request(app).put('/api/files/write').set(admin()).send({ path: path.join(NEXUS_ROOT, '.gitignore'), content: '' })
      expect(write.status).toBe(403)
      expect(fs.existsSync(target)).toBe(false)
    } finally { fs.rmSync(target, { force: true }) }
  })

  it('its files can still be read (not the secrets)', async () => {
    const res = await request(app).get('/api/files/read').query({ path: path.join(NEXUS_ROOT, '.gitignore') }).set(admin())
    expect(res.status).toBe(200)
  })

  it('a folder that holds it, or Git files elsewhere, cannot be changed (checked without touching them)', async () => {
    await expect(assertAllowed(path.dirname(NEXUS_ROOT), 'write')).rejects.toMatchObject({ code: 'PROTECTED_FILE' })
    await expect(assertAllowed(path.join(dir, 'repo', '.git', 'config'), 'write')).rejects.toMatchObject({ code: 'PROTECTED_FILE' })
    await expect(assertAllowed(path.join(dir, 'notes.txt'), 'write')).resolves.toBeUndefined()
  })
})

describe('Sign-in answers', () => {
  beforeAll(async () => {
    await request(app).post('/api/users').set(admin())
      .send({ username: 'hardening', email: 'hardening@example.com', password: 'Harden123' })
  })

  it('an unknown name and a wrong password get the very same answer', async () => {
    const unknown = await request(app).post('/api/auth/login').send({ username: 'no-such-account', password: 'Whatever123' })
    const wrong = await request(app).post('/api/auth/login').send({ username: 'hardening', password: 'Whatever123' })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(unknown.body).toEqual(wrong.body)
  })

  it('only strings are taken as a name and a password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: { $ne: '' }, password: ['x'] })
    expect(res.status).toBe(422)
  })

  it('a password over 72 bytes is refused (bcrypt would cut it)', async () => {
    const res = await request(app).post('/api/users').set(admin())
      .send({ username: 'toolong', email: 'toolong@example.com', password: `Aa1${'x'.repeat(70)}` })
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/72/)
  })
})

describe('Requests', () => {
  it('a body over 1 MB → 413, never a server error', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json')
      .send(JSON.stringify({ username: 'x', password: 'y'.repeat(1_200_000) }))
    expect(res.status).toBe(413)
  })

  it('broken JSON → 400 without details', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"username":')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ success: false, error: 'Requête invalide' })
  })

  it('a visitor who came over http through Cloudflare is sent to https', async () => {
    const res = await request(app).get('/api/health?x=1').set('X-Forwarded-Proto', 'http').set('CF-Ray', '8f00-CDG')
      .set('Host', 'nexus.example.com')
    expect(res.status).toBe(308)
    expect(res.headers.location).toBe('https://nexus.example.com/api/health?x=1')
    // The local network (no Cloudflare, even behind another proxy) keeps http
    expect((await request(app).get('/api/health')).status).toBe(200)
    expect((await request(app).get('/api/health').set('X-Forwarded-Proto', 'http')).status).toBe(200)
  })

  it('HTTPS is remembered by browsers (HSTS)', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/)
  })
})

describe('Access tokens never live long', () => {
  const saved = process.env.JWT_EXPIRES_IN
  afterEach(() => { process.env.JWT_EXPIRES_IN = saved })

  it('15 minutes by default, at most an hour whatever .env says', async () => {
    const { accessLifetime, durationSeconds } = await import('../../src/services/auth')
    expect(durationSeconds('15m')).toBe(900)
    expect(durationSeconds('7d')).toBe(604_800)
    expect(durationSeconds('soon')).toBeNull()
    delete process.env.JWT_EXPIRES_IN
    expect(accessLifetime()).toBe('15m')
    process.env.JWT_EXPIRES_IN = '7d'
    expect(accessLifetime()).toBe(3600)
    process.env.JWT_EXPIRES_IN = '30m'
    expect(accessLifetime()).toBe(1800)
  })

  it('a token from sign-in expires within the hour', async () => {
    process.env.JWT_EXPIRES_IN = '7d'
    await request(app).post('/api/users').set(admin()).send({ username: 'shortlived', email: 'shortlived@example.com', password: 'Short1234' })
    const res = await request(app).post('/api/auth/login').send({ username: 'shortlived', password: 'Short1234' })
    expect(res.status).toBe(200)
    const { exp, iat } = JSON.parse(Buffer.from(res.body.data.accessToken.split('.')[1], 'base64url').toString())
    expect(exp - iat).toBeLessThanOrEqual(3600)
  })
})
