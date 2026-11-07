import request from 'supertest'
import { app } from '../../src/index'
import { makeToken } from '../helpers'

const token = (role: 'admin' | 'user' = 'admin') => makeToken(role)

describe('GET /api/services', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/services')
    expect(res.status).toBe(401)
  })

  it('returns service list with valid token', async () => {
    const res = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('each service has required fields', async () => {
    const res = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${token()}`)

    if (res.body.data.length > 0) {
      const svc = res.body.data[0]
      expect(svc).toHaveProperty('name')
      expect(svc).toHaveProperty('displayName')
      expect(svc).toHaveProperty('status')
      expect(svc).toHaveProperty('icon')
    }
  })
})

describe('POST /api/services/:name/toggle', () => {
  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .post('/api/services/jellyfin/toggle')
      .set('Authorization', `Bearer ${token('user')}`)
      .send({ action: 'restart' })

    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid action', async () => {
    const res = await request(app)
      .post('/api/services/jellyfin/toggle')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ action: 'invalid' })

    expect(res.status).toBe(422)
  })
})

describe('logs are admin-only', () => {
  it('GET /api/services/:name/logs returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/services/jellyfin/logs')
      .set('Authorization', `Bearer ${token('user')}`)
    expect(res.status).toBe(403)
  })

  it('GET /api/system/logs returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/system/logs')
      .set('Authorization', `Bearer ${token('user')}`)
    expect(res.status).toBe(403)
  })

  it('GET /api/system/logs works for admin', async () => {
    const res = await request(app)
      .get('/api/system/logs?lines=5')
      .set('Authorization', `Bearer ${token('admin')}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })
})
