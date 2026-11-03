import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { makeToken } from '../helpers'

const MEDIA_ROOT   = process.env.MEDIA_ROOT!
const SCRIPTS_PATH = process.env.SCRIPTS_PATH!
const mediaFile    = path.join(MEDIA_ROOT, 'sample.mp4')
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

beforeAll(() => {
  fs.writeFileSync(mediaFile, Buffer.alloc(1000, 1))
  fs.writeFileSync(path.join(SCRIPTS_PATH, 'hello.sh'), '# Say hello\necho hello-from-sh\n')
})

describe('File manager is admin-only', () => {
  const user = makeToken('user')

  it.each([
    ['get',    '/api/files?path=/tmp'],
    ['get',    '/api/files/read?path=/etc/hostname'],
    ['get',    '/api/files/info?path=/tmp'],
    ['put',    '/api/files/write'],
    ['post',   '/api/files/mkdir'],
    ['post',   '/api/files/touch'],
    ['patch',  '/api/files/rename'],
    ['patch',  '/api/files/move'],
    ['delete', '/api/files?path=/tmp/x'],
    ['post',   '/api/files/upload?path=/tmp'],
  ] as const)('%s %s → 403 for role user', async (method, url) => {
    const res = await request(app)[method](url).set(bearer(user)).send({ path: '/tmp/x', content: 'x' })
    expect(res.status).toBe(403)
  })

  it('admin can still list', async () => {
    const res = await request(app).get('/api/files?path=/tmp').set(bearer(makeToken('admin')))
    expect(res.status).toBe(200)
  })

  it('rename rejects names containing a path', async () => {
    const res = await request(app).patch('/api/files/rename')
      .set(bearer(makeToken('admin'))).send({ path: mediaFile, newName: '../escape.mp4' })
    expect(res.status).toBe(422)
    expect(fs.existsSync(mediaFile)).toBe(true)
  })
})

describe('Streaming access', () => {
  it('user can stream inside MEDIA_ROOT', async () => {
    const res = await request(app).get(`/api/files/stream?path=${encodeURIComponent(mediaFile)}`)
      .set(bearer(makeToken('user')))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('video/mp4')
  })

  it('user cannot stream outside MEDIA_ROOT', async () => {
    const res = await request(app).get('/api/files/stream?path=/etc/passwd').set(bearer(makeToken('user')))
    expect(res.status).toBe(403)
  })

  it('user cannot escape MEDIA_ROOT with ..', async () => {
    const p = `${MEDIA_ROOT}/../../etc/passwd`
    const res = await request(app).get(`/api/files/download?path=${encodeURIComponent(p)}`)
      .set(bearer(makeToken('user')))
    expect(res.status).toBe(403)
  })

  it('accepts a stream token in the query string', async () => {
    const res = await request(app)
      .get(`/api/files/stream?path=${encodeURIComponent(mediaFile)}&token=${makeToken('user', 'stream')}`)
    expect(res.status).toBe(200)
  })

  it('rejects an access token in the query string', async () => {
    const res = await request(app)
      .get(`/api/files/stream?path=${encodeURIComponent(mediaFile)}&token=${makeToken('admin')}`)
    expect(res.status).toBe(401)
  })

  it('returns 404 for a missing file', async () => {
    const res = await request(app).get(`/api/files/stream?path=${encodeURIComponent(MEDIA_ROOT + '/nope.mp4')}`)
      .set(bearer(makeToken('admin')))
    expect(res.status).toBe(404)
  })

  it('serves a valid range with 206', async () => {
    const res = await request(app).get(`/api/files/stream?path=${encodeURIComponent(mediaFile)}`)
      .set(bearer(makeToken('user'))).set('Range', 'bytes=0-99')
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 0-99/1000')
    expect(res.headers['content-length']).toBe('100')
  })

  it('serves PDFs piece by piece too (206, inline) — PDF.js / Safari read big PDFs by ranges', async () => {
    const pdf = path.join(path.dirname(mediaFile), 'chapitre.pdf')
    fs.writeFileSync(pdf, Buffer.alloc(5000, 1))
    const res = await request(app).get(`/api/files/stream?path=${encodeURIComponent(pdf)}`)
      .set(bearer(makeToken('user'))).set('Range', 'bytes=1000-1999')
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 1000-1999/5000')
    expect(res.headers['content-length']).toBe('1000')
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toBe('inline')
    const whole = await request(app).get(`/api/files/stream?path=${encodeURIComponent(pdf)}`).set(bearer(makeToken('user')))
    expect(whole.status).toBe(200)
    expect(whole.headers['content-length']).toBe('5000')
  })

  it('rejects an unsatisfiable range with 416', async () => {
    const res = await request(app).get(`/api/files/stream?path=${encodeURIComponent(mediaFile)}`)
      .set(bearer(makeToken('user'))).set('Range', 'bytes=5000-6000')
    expect(res.status).toBe(416)
    expect(res.headers['content-range']).toBe('bytes */1000')
  })
})

describe('Token types', () => {
  it('a stream token cannot be used as an access token', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(makeToken('admin', 'stream')))
    expect(res.status).toBe(401)
  })

  it('a refresh token cannot be used as an access token', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(makeToken('admin', 'refresh')))
    expect(res.status).toBe(401)
  })

  it('the query-string token is ignored on regular API routes', async () => {
    const res = await request(app).get(`/api/auth/me?token=${makeToken('admin')}`)
    expect(res.status).toBe(401)
  })

  it('issues a stream token to a logged-in user', async () => {
    const res = await request(app).get('/api/auth/stream-token').set(bearer(makeToken('user')))
    expect(res.status).toBe(200)
    expect(typeof res.body.data.token).toBe('string')
  })
})

describe('Scripts', () => {
  const admin = makeToken('admin')

  it('rejects path traversal in the script name', async () => {
    const res = await request(app).post(`/api/scripts/${encodeURIComponent('../../tmp/evil')}/run`).set(bearer(admin))
    expect(res.status).toBe(404)
  })

  it('rejects unknown scripts', async () => {
    const res = await request(app).post('/api/scripts/does-not-exist/run').set(bearer(admin))
    expect(res.status).toBe(404)
  })

  it('runs .sh scripts', async () => {
    const res = await request(app).post('/api/scripts/hello.sh/run').set(bearer(admin))
    expect(res.status).toBe(200)
    expect(res.text).toContain('hello-from-sh')
    expect(res.text).toContain('event: exit')
  })

  it('is admin-only', async () => {
    const res = await request(app).post('/api/scripts/hello.sh/run').set(bearer(makeToken('user')))
    expect(res.status).toBe(403)
  })
})
