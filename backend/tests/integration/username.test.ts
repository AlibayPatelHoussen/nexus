import bcrypt from 'bcryptjs'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'

let id = ''
const auth = () => ({ Authorization: `Bearer ${makeToken('user', 'access', id)}` })

beforeAll(async () => {
  await query(`DELETE FROM users WHERE username IN ('renommage', 'nouveau_nom', 'pris') OR email IN ('renommage@test.local', 'pris@test.local')`)
  const hash = await bcrypt.hash('Secret123', 4)
  id = (await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('renommage', 'renommage@test.local', $1, 'user') RETURNING id`, [hash])).rows[0].id
  await query(`INSERT INTO users (username, email, password, role) VALUES ('pris', 'pris@test.local', $1, 'user')`, [hash])
})
afterAll(async () => {
  await query(`DELETE FROM users WHERE email IN ('renommage@test.local', 'pris@test.local')`)
})

describe('PATCH /api/auth/username', () => {
  it('needs the current password, a valid and free name', async () => {
    const send = (body: object) => request(app).patch('/api/auth/username').set(auth()).send(body)
    expect((await send({ username: 'nouveau_nom', currentPassword: 'mauvais' })).status).toBe(401)
    expect((await send({ username: 'a b', currentPassword: 'Secret123' })).status).toBe(422)
    expect((await send({ username: 'PRIS', currentPassword: 'Secret123' })).status).toBe(409)
    expect((await send({ username: 'pris@test.local', currentPassword: 'Secret123' })).status).toBe(422)
    expect((await request(app).patch('/api/auth/username').send({ username: 'x' })).status).toBe(401)
  })

  it('renames the account: new token, login with the new name', async () => {
    const res = await request(app).patch('/api/auth/username').set(auth()).send({ username: ' nouveau_nom ', currentPassword: 'Secret123' })
    expect(res.status).toBe(200)
    expect(res.body.data.user).toMatchObject({ id, username: 'nouveau_nom' })
    const me = await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${res.body.data.accessToken}` })
    expect(me.body.data.username).toBe('nouveau_nom')
    expect((await request(app).post('/api/auth/login').send({ username: 'nouveau_nom', password: 'Secret123' })).status).toBe(200)
    expect((await request(app).post('/api/auth/login').send({ username: 'renommage', password: 'Secret123' })).status).toBe(401)
  })
})
