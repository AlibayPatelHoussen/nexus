import request from 'supertest'
import { app } from '../../src/index'
import jwt from 'jsonwebtoken'

// Generate a test admin token
function adminToken(): string {
  return jwt.sign(
    { userId: 'test-uuid', username: 'testadmin', role: 'admin' },
    process.env.JWT_SECRET || 'test_secret',
    { expiresIn: '1h' },
  )
}

describe('GET /api/files', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/files?path=/')
    expect(res.status).toBe(401)
  })

  it('returns 200 with valid token and existing path', async () => {
    const res = await request(app)
      .get('/api/files?path=/tmp')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('returns file entries with required fields', async () => {
    const res = await request(app)
      .get('/api/files?path=/tmp')
      .set('Authorization', `Bearer ${adminToken()}`)

    if (res.body.data.length > 0) {
      const entry = res.body.data[0]
      expect(entry).toHaveProperty('name')
      expect(entry).toHaveProperty('path')
      expect(entry).toHaveProperty('type')
      expect(entry).toHaveProperty('modified')
    }
  })
})

describe('GET /api/system/stats', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/system/stats')
    expect(res.status).toBe(401)
  })

  it('returns system stats with valid token', async () => {
    const res = await request(app)
      .get('/api/system/stats')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('cpu')
    expect(res.body.data).toHaveProperty('memory')
    expect(res.body.data).toHaveProperty('disk')
  })
})
