import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'

let auth: Record<string, string> = {}
let mediaId = ''

beforeAll(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('mylist-user', 'mylist@test.io', 'x', 'user')
     ON CONFLICT (username) DO UPDATE SET role = 'user' RETURNING id`)
  auth = { Authorization: `Bearer ${makeToken('user', 'access', rows[0].id)}` }
  await query('DELETE FROM favorites WHERE user_id = $1', [rows[0].id])
  const media = await query<{ id: string }>(
    `INSERT INTO media_items (type, title, file_path, genres, backdrop_path) VALUES ('serie', 'Ma liste test', '/tmp/nexus-mylist-test', '{Drame}', '/b.jpg')
     ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`)
  mediaId = media.rows[0].id
})
afterAll(async () => { await query('DELETE FROM media_items WHERE id = $1', [mediaId]) })

describe('Ma liste', () => {
  it('adds, lists the whole title (like the other shelves), removes', async () => {
    expect((await request(app).post(`/api/media/${mediaId}/favorite`).set(auth)).body.data).toEqual({ isFavorite: true })
    const list = (await request(app).get('/api/media/favorites').set(auth)).body.data as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: mediaId, type: 'serie', title: 'Ma liste test', genres: ['Drame'] })
    expect(list[0].backdropPath).toBeTruthy()
    expect((await request(app).post(`/api/media/${mediaId}/favorite`).set(auth)).body.data).toEqual({ isFavorite: false })
    expect((await request(app).get('/api/media/favorites').set(auth)).body.data).toEqual([])
  })
})
