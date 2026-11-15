import request from 'supertest'
import { app } from '../../src/index'

describe('POST /api/auth/login', () => {
  it('should return 422 with missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
  })

  it('should return 401 with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrongpass' })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })
})

describe('GET /api/auth/me', () => {
  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('should return 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here')

    expect(res.status).toBe(401)
  })
})

describe('GET /api/health', () => {
  it('should return 200', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
