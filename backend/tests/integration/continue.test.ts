import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'

let auth: Record<string, string> = {}
let mediaId = ''

beforeAll(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('continue-user', 'continue@test.io', 'x', 'user')
     ON CONFLICT (username) DO UPDATE SET role = 'user' RETURNING id`)
  auth = { Authorization: `Bearer ${makeToken('user', 'access', rows[0].id)}` }
  await query('DELETE FROM watch_history WHERE user_id = $1', [rows[0].id])
  const media = await query<{ id: string }>(
    `INSERT INTO media_items (type, title, file_path) VALUES ('film', 'Reprendre test', '/tmp/nexus-continue-test.mkv')
     ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`)
  mediaId = media.rows[0].id
})
afterAll(async () => { await query('DELETE FROM media_items WHERE id = $1', [mediaId]) })

const ids = async () => ((await request(app).get('/api/media/continue').set(auth)).body.data as { id: string }[]).map((m) => m.id)

describe('Reprendre', () => {
  it('« Retirer de Reprendre » hides the title, watching it again brings it back', async () => {
    await request(app).post(`/api/media/${mediaId}/progress`).set(auth).send({ progress: 600, duration: 6000 })
    expect(await ids()).toContain(mediaId)

    expect((await request(app).delete(`/api/media/${mediaId}/continue`).set(auth)).status).toBe(200)
    expect(await ids()).not.toContain(mediaId)

    await request(app).post(`/api/media/${mediaId}/progress`).set(auth).send({ progress: 660, duration: 6000 })
    const list = (await request(app).get('/api/media/continue').set(auth)).body.data as { id: string; progress: number }[]
    expect(list.find((m) => m.id === mediaId)?.progress).toBe(660)
  })

  it('needs to be signed in', async () => {
    expect((await request(app).delete(`/api/media/${mediaId}/continue`)).status).toBe(401)
  })
})
