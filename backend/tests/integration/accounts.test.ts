import os from 'os'
import path from 'path'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import webpush from 'web-push'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { forgetSessions } from '../../src/services/sessions'
import { FIXTURES, makeToken } from '../helpers'

/**
 * Accounts and their devices: the sign-in journal (device, IP, place given by Cloudflare),
 * the session version (a new password ends the other sessions at once), « Déconnecter »
 * one device, accounts opened for a limited time, and what a « user » account may see.
 */

process.env.VAPID_FILE = path.join(os.tmpdir(), `nexus-vapid-accounts-${process.pid}.json`)
const PASSWORD = 'Secret123'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const admin = { Authorization: `Bearer ${makeToken('admin')}` }
const asUser = { Authorization: `Bearer ${makeToken('user')}` }
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

let lucasId = ''

/** Signs in as Cloudflare would forward it (the tests reach Nexus from this machine, like cloudflared). */
function login(username: string, ua = IPHONE, password = PASSWORD) {
  return request(app).post('/api/auth/login')
    .set('User-Agent', ua)
    .set('CF-Connecting-IP', '203.0.113.7')
    .set('CF-IPCountry', 'FR')
    .set('CF-IPCity', 'Lyon')
    .set('CF-Region', 'Auvergne-Rhône-Alpes')
    .send({ username, password })
}

beforeAll(async () => {
  await query(`DELETE FROM users WHERE username IN ('lucas', 'invite', 'temporaire') OR email LIKE '%@accounts.test'`)
  const hash = await bcrypt.hash(PASSWORD, 4)
  lucasId = (await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('lucas', 'lucas@accounts.test', $1, 'user') RETURNING id`, [hash])).rows[0].id
})
afterAll(async () => {
  await query(`DELETE FROM users WHERE username IN ('lucas', 'invite', 'temporaire') OR email LIKE '%@accounts.test'`)
})
afterEach(() => jest.restoreAllMocks())

describe('Sign-in journal and devices', () => {
  it('records each sign-in with its device, IP and place; tells the admins about a new device', async () => {
    const push = jest.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} })
    await query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.example.com/admin-device-0001', 'k', 'a')
                 ON CONFLICT (endpoint) DO NOTHING`, [FIXTURES.admin.id])

    const res = await login('lucas')
    expect(res.status).toBe(200)
    const { sid, sv } = jwt.decode(res.body.data.accessToken) as { sid: string; sv: number }
    expect(sv).toBe(1)

    const session = (await query('SELECT device, ip, location, user_agent FROM refresh_tokens WHERE id = $1', [sid])).rows[0]
    expect(session).toMatchObject({ device: 'iPhone · Safari', ip: '203.0.113.7', location: 'Lyon, Auvergne-Rhône-Alpes, France', user_agent: IPHONE })

    const journal = await request(app).get('/api/users/logins').set(admin).query({ user: lucasId })
    expect(journal.body.data[0]).toMatchObject({ username: 'lucas', success: true, reason: 'ok', newDevice: true, device: 'iPhone · Safari', location: 'Lyon, Auvergne-Rhône-Alpes, France', ip: '203.0.113.7' })

    // The admins' devices hear about it (« lucas · iPhone · Safari · Lyon… »), not lucas'
    await new Promise((r) => setTimeout(r, 100))
    const sent = push.mock.calls.map(([s, body]) => ({ to: s.endpoint, msg: JSON.parse(String(body)) }))
    expect(sent).toContainEqual({ to: 'https://push.example.com/admin-device-0001', msg: expect.objectContaining({ title: 'Nouvel appareil connecté', body: 'lucas · iPhone · Safari · Lyon, Auvergne-Rhône-Alpes, France' }) })

    // Same device again: not new, no notification
    push.mockClear()
    await login('lucas')
    expect((await request(app).get('/api/users/logins').set(admin).query({ user: lucasId })).body.data[0].newDevice).toBe(false)
    await new Promise((r) => setTimeout(r, 100))
    expect(push).not.toHaveBeenCalled()
    await query(`DELETE FROM push_subscriptions WHERE endpoint = 'https://push.example.com/admin-device-0001'`)
  })

  it('records refused sign-ins too (wrong password, unknown name)', async () => {
    expect((await login('lucas', WINDOWS, 'Mauvais123')).status).toBe(401)
    expect((await login('personne-inconnue', WINDOWS)).status).toBe(401)
    const journal = (await request(app).get('/api/users/logins').set(admin).query({ limit: 5 })).body.data
    expect(journal[0]).toMatchObject({ username: 'personne-inconnue', success: false, reason: 'unknown', userId: null })
    expect(journal[1]).toMatchObject({ username: 'lucas', success: false, reason: 'password', device: 'Windows · Chrome' })
  })

  it('lists the signed-in devices; « Déconnecter » ends that device at once (and its notifications)', async () => {
    const phone = (await login('lucas')).body.data
    const pc = (await login('lucas', WINDOWS)).body.data
    const phoneSid = (jwt.decode(phone.accessToken) as { sid: string }).sid
    await request(app).post('/api/push/subscribe').set(bearer(phone.accessToken))
      .send({ subscription: { endpoint: 'https://push.example.com/lucas-phone-0001', keys: { p256dh: 'k', auth: 'a' } } }).expect(201)

    const sessions = (await request(app).get('/api/users/sessions').set(admin)).body.data
    expect(sessions.filter((s: { userId: string }) => s.userId === lucasId).map((s: { device: string }) => s.device))
      .toEqual(expect.arrayContaining(['iPhone · Safari', 'Windows · Chrome']))

    expect((await request(app).get('/api/auth/me').set(bearer(phone.accessToken))).status).toBe(200)
    await request(app).delete(`/api/users/sessions/${phoneSid}`).set(admin).expect(200)
    // That device: its access token, refresh token and notifications stop
    expect((await request(app).get('/api/auth/me').set(bearer(phone.accessToken))).status).toBe(401)
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: phone.refreshToken })).status).toBe(401)
    expect((await query(`SELECT 1 FROM push_subscriptions WHERE endpoint = 'https://push.example.com/lucas-phone-0001'`)).rows).toHaveLength(0)
    // The other device goes on
    expect((await request(app).get('/api/auth/me').set(bearer(pc.accessToken))).status).toBe(200)
  })

  it('a stream token (videos, pages) ends with its session too', async () => {
    const s = (await login('lucas')).body.data
    const stream = (await request(app).get('/api/auth/stream-token').set(bearer(s.accessToken))).body.data.token
    const url = `/api/media/chapters/00000000-0000-4000-8000-000000000000/page/1?token=${stream}`
    expect((await request(app).get(url)).status).not.toBe(401)
    await request(app).delete(`/api/users/sessions/${(jwt.decode(s.accessToken) as { sid: string }).sid}`).set(admin).expect(200)
    expect((await request(app).get(url)).status).toBe(401)
  })
})

describe('Session version: a new password signs the other devices out', () => {
  it('ends every other session at once; this device stays signed in with new tokens', async () => {
    const other = (await login('lucas', WINDOWS)).body.data
    const here = (await login('lucas')).body.data
    // A token from before device sessions (no sid / sv): accepted while the version is still 1
    const legacy = jwt.sign({ userId: lucasId, username: 'lucas', role: 'user', typ: 'access' }, process.env.JWT_SECRET!, { expiresIn: '1h' })
    expect((await request(app).get('/api/auth/me').set(bearer(legacy))).status).toBe(200)

    const res = await request(app).patch('/api/auth/password').set(bearer(here.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'Nouveau456' })
    expect(res.status).toBe(200)
    const fresh = res.body.data.accessToken as string
    expect((jwt.decode(fresh) as { sv: number }).sv).toBe(2)

    expect((await request(app).get('/api/auth/me').set(bearer(other.accessToken))).status).toBe(401)
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: other.refreshToken })).status).toBe(401)
    expect((await request(app).get('/api/auth/me').set(bearer(legacy))).status).toBe(401)
    // This device: the old access token is outdated, the new one and the refresh token work
    expect((await request(app).get('/api/auth/me').set(bearer(here.accessToken))).status).toBe(401)
    expect((await request(app).get('/api/auth/me').set(bearer(fresh))).status).toBe(200)
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: here.refreshToken })
    expect(refreshed.status).toBe(200)
    expect((jwt.decode(refreshed.body.data.accessToken) as { sv: number }).sv).toBe(2)

    await query('UPDATE users SET password = $2 WHERE id = $1', [lucasId, await bcrypt.hash(PASSWORD, 4)])
  })

  it('« Déconnecter tous les appareils » of an account (admin)', async () => {
    const s = (await login('lucas')).body.data
    const res = await request(app).post(`/api/users/${lucasId}/sign-out`).set(admin)
    expect(res.status).toBe(200)
    expect(res.body.data.removed).toBeGreaterThan(0)
    expect((await request(app).get('/api/auth/me').set(bearer(s.accessToken))).status).toBe(401)
    expect((await login('lucas')).status).toBe(200)
  })
})

describe('Accounts (admins)', () => {
  it('admins create « user » accounts only (admin accounts are made in the terminal)', async () => {
    const res = await request(app).post('/api/users').set(admin)
      .send({ username: 'invite', email: 'invite@accounts.test', password: PASSWORD, role: 'admin' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ username: 'invite', role: 'user', expires_at: null })
    expect((await request(app).post('/api/users').set(admin).send({ username: 'INVITE', email: 'x@accounts.test', password: PASSWORD })).status).toBe(409)
    expect((await request(app).post('/api/users').set(admin).send({ username: 'faible', email: 'f@accounts.test', password: 'court' })).status).toBe(422)
    // « user » accounts have no access to it
    expect((await request(app).post('/api/users').set(asUser).send({ username: 'pirate', email: 'p@accounts.test', password: PASSWORD })).status).toBe(403)
    expect((await request(app).get('/api/users').set(asUser)).status).toBe(403)
    expect((await request(app).get('/api/users/sessions').set(asUser)).status).toBe(403)
    expect((await request(app).post('/api/auth/register').set(asUser).send({ username: 'pirate', email: 'p@accounts.test', password: PASSWORD })).status).toBe(403)
  })

  it('an account for a limited time: refused once its date has passed, can be extended', async () => {
    const inAYear = new Date(Date.now() + 365 * 86400_000).toISOString()
    expect((await request(app).post('/api/users').set(admin)
      .send({ username: 'temporaire', email: 'tmp@accounts.test', password: PASSWORD, expiresAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(422)
    const created = await request(app).post('/api/users').set(admin)
      .send({ username: 'temporaire', email: 'tmp@accounts.test', password: PASSWORD, expiresAt: inAYear })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    const listed = (await request(app).get('/api/users').set(admin)).body.data.find((u: { id: string }) => u.id === id)
    expect(listed).toMatchObject({ username: 'temporaire', role: 'user', expired: false, devices: 0 })
    expect(new Date(listed.expiresAt).toISOString()).toBe(inAYear)

    const s = (await login('temporaire')).body.data
    expect((await request(app).get('/api/auth/me').set(bearer(s.accessToken))).status).toBe(200)

    // The year is over
    await query(`UPDATE users SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id])
    forgetSessions(id)
    const me = await request(app).get('/api/auth/me').set(bearer(s.accessToken))
    expect(me.status).toBe(401)
    expect(me.body.code).toBe('ACCOUNT_EXPIRED')
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401)
    const refused = await login('temporaire')
    expect(refused.status).toBe(401)
    expect(refused.body.code).toBe('ACCOUNT_EXPIRED')
    expect((await request(app).get('/api/users/logins').set(admin).query({ user: id })).body.data[0].reason).toBe('expired')
    expect((await request(app).get('/api/users').set(admin)).body.data.find((u: { id: string }) => u.id === id).expired).toBe(true)

    // Extended by the admin: open again
    expect((await request(app).patch(`/api/users/${id}`).set(admin).send({ expiresAt: 'demain' })).status).toBe(422)
    await request(app).patch(`/api/users/${id}`).set(admin).send({ expiresAt: inAYear }).expect(200)
    expect((await login('temporaire')).status).toBe(200)
    await request(app).patch(`/api/users/${id}`).set(admin).send({ expiresAt: null }).expect(200)
    expect((await query('SELECT expires_at FROM users WHERE id = $1', [id])).rows[0].expires_at).toBeNull()
    // Admin accounts do not expire
    expect((await request(app).patch(`/api/users/${FIXTURES.admin.id}`).set(admin).send({ expiresAt: inAYear })).status).toBe(403)
  })

  it('deletes « user » accounts (never an admin, never itself); its sessions end', async () => {
    const id = (await query<{ id: string }>(`SELECT id FROM users WHERE username = 'invite'`)).rows[0].id
    const s = (await login('invite')).body.data
    expect((await request(app).delete(`/api/users/${FIXTURES.admin.id}`).set(admin)).status).toBe(403)
    expect((await request(app).delete(`/api/users/${id}`).set(asUser)).status).toBe(403)
    await request(app).delete(`/api/users/${id}`).set(admin).expect(200)
    expect((await request(app).get('/api/auth/me').set(bearer(s.accessToken))).status).toBe(401)
    expect((await login('invite')).status).toBe(401)
    expect((await request(app).delete(`/api/users/${id}`).set(admin)).status).toBe(404)
  })
})

describe('Sign-in journal: removing entries (admins)', () => {
  it('one entry, one account\'s entries, or all of them', async () => {
    await login('lucas', WINDOWS, 'Mauvais123')
    await login('lucas')
    const lucas = (await request(app).get('/api/users/logins').set(admin).query({ user: lucasId })).body.data
    expect(lucas.length).toBeGreaterThanOrEqual(2)

    expect((await request(app).delete(`/api/users/logins/${lucas[0].id}`).set(asUser)).status).toBe(403)
    await request(app).delete(`/api/users/logins/${lucas[0].id}`).set(admin).expect(200)
    expect((await request(app).delete(`/api/users/logins/${lucas[0].id}`).set(admin)).status).toBe(404)
    const after = (await request(app).get('/api/users/logins').set(admin).query({ user: lucasId })).body.data
    expect(after.map((e: { id: string }) => e.id)).not.toContain(lucas[0].id)
    expect(after).toHaveLength(lucas.length - 1)

    // One account's entries: the others stay
    await login('personne-inconnue')
    const cleared = await request(app).delete('/api/users/logins').set(admin).query({ user: lucasId })
    expect(cleared.body.data.removed).toBe(lucas.length - 1)
    expect((await request(app).get('/api/users/logins').set(admin).query({ user: lucasId })).body.data).toHaveLength(0)
    expect((await request(app).get('/api/users/logins').set(admin)).body.data.length).toBeGreaterThan(0)

    // Everything; the devices stay signed in
    const s = (await login('lucas')).body.data
    await request(app).delete('/api/users/logins').set(admin).expect(200)
    expect((await request(app).get('/api/users/logins').set(admin)).body.data).toHaveLength(0)
    expect((await request(app).get('/api/auth/me').set(bearer(s.accessToken))).status).toBe(200)
  })
})

describe('What a « user » account sees', () => {
  it('the storage only on Aperçu; no services, Jarvis, files or terminal', async () => {
    const stats = await request(app).get('/api/system/stats').set(asUser)
    expect(stats.status).toBe(200)
    expect(Object.keys(stats.body.data).sort()).toEqual(['disk', 'mediaStorage'])
    expect(Object.keys((await request(app).get('/api/system/stats').set(admin)).body.data)).toEqual(expect.arrayContaining(['cpu', 'memory', 'network', 'os']))
    expect((await request(app).get('/api/services').set(asUser)).status).toBe(403)
    expect((await request(app).get('/api/jarvis/status').set(asUser)).status).toBe(403)
    expect((await request(app).get('/api/files').set(asUser).query({ path: '/' })).status).toBe(403)
    expect((await request(app).get('/api/system/logs').set(asUser)).status).toBe(403)
  })
})
