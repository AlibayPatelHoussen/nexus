import os from 'os'
import path from 'path'
import request from 'supertest'
import webpush from 'web-push'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { sendPush } from '../../src/services/push'
import { makeToken } from '../helpers'

process.env.VAPID_FILE = path.join(os.tmpdir(), `nexus-vapid-${process.pid}.json`)
let userId = ''
let auth: Record<string, string> = {}
const sub = (n: number) => ({ endpoint: `https://push.example.com/send/device-${n}-abcdefghij`, keys: { p256dh: 'BPublicKeyOfTheDevice', auth: 'authsecret' } })

beforeAll(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('push-user', 'push@test.io', 'x', 'admin')
     ON CONFLICT (username) DO UPDATE SET role = 'admin' RETURNING id`)
  userId = rows[0].id
  auth = { Authorization: `Bearer ${makeToken('admin', 'access', userId)}` }
  await query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId])
})
afterEach(() => jest.restoreAllMocks())

describe('Push notifications', () => {
  it('gives the server public key (keys generated once)', async () => {
    const a = await request(app).get('/api/push/key').set(auth)
    const b = await request(app).get('/api/push/key').set(auth)
    expect(a.status).toBe(200)
    expect(a.body.data.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    expect(b.body.data.publicKey).toBe(a.body.data.publicKey)
    expect((await request(app).get('/api/push/key')).status).toBe(401)
  })

  it('registers devices and refuses odd subscriptions', async () => {
    expect((await request(app).post('/api/push/subscribe').set(auth).send({ subscription: sub(1) })).status).toBe(201)
    expect((await request(app).post('/api/push/subscribe').set(auth).send({ subscription: sub(1) })).status).toBe(201)   // same device again
    expect((await request(app).post('/api/push/subscribe').set(auth).send({ subscription: sub(2) })).status).toBe(201)
    expect((await request(app).post('/api/push/subscribe').set(auth).send({ subscription: { endpoint: 'http://evil', keys: {} } })).status).toBe(422)
    expect((await request(app).get('/api/push/key').set(auth)).body.data.devices).toBe(2)
  })

  it('sends to every device and forgets the ones that unsubscribed (410)', async () => {
    const send = jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s) => {
      if (s.endpoint.includes('device-2')) throw Object.assign(new Error('Gone'), { statusCode: 410 })
      return { statusCode: 201, body: '', headers: {} }
    })
    expect(await sendPush([userId], { title: 'Téléchargement terminé', body: 'One Piece · chapitre 1' })).toBe(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(send.mock.calls[0][1]))).toEqual({ title: 'Téléchargement terminé', body: 'One Piece · chapitre 1' })
    expect((await request(app).get('/api/push/key').set(auth)).body.data.devices).toBe(1)
  })

  it('unsubscribes a device', async () => {
    await request(app).post('/api/push/unsubscribe').set(auth).send({ endpoint: sub(1).endpoint })
    expect((await request(app).get('/api/push/key').set(auth)).body.data.devices).toBe(0)
  })
})
