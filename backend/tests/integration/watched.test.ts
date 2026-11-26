import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { FIXTURES, makeToken } from '../helpers'

const user = { Authorization: `Bearer ${makeToken('user')}` }
const other = { Authorization: `Bearer ${makeToken('user', 'access', FIXTURES.other.id)}` }

let mediaId: string
/** episode id by « season/episode » */
const ep: Record<string, string> = {}

beforeAll(async () => {
  await query(`UPDATE users SET can_media = TRUE WHERE id = ANY($1::uuid[])`, [[FIXTURES.user.id, FIXTURES.other.id]])
  const { rows } = await query<{ id: string }>(
    `INSERT INTO media_items (type, title, file_path) VALUES ('serie', 'Watched Test', '/tmp/nexus-watched-test') RETURNING id`)
  mediaId = rows[0].id
  for (const season of [1, 2]) {
    for (const n of [1, 2, 3]) {
      const { rows: e } = await query<{ id: string }>(
        `INSERT INTO episodes (media_item_id, season, episode_number, file_path, duration) VALUES ($1, $2, $3, $4, 1500) RETURNING id`,
        [mediaId, season, n, `/tmp/nexus-watched-test/S0${season}E0${n}.mkv`])
      ep[`${season}/${n}`] = e[0].id
    }
  }
})
afterAll(async () => {
  await query('DELETE FROM media_items WHERE id = $1', [mediaId])
})
afterEach(async () => {
  await query('DELETE FROM watch_history WHERE media_item_id = $1', [mediaId])
})

const progress = async (who = user) => (await request(app).get(`/api/media/${mediaId}/episodes/progress`).set(who)).body.data as
  { episodeId: string; progress: number; completed: boolean }[]
const mark = (episodeIds: unknown, watched: unknown, who = user) =>
  request(app).post(`/api/media/${mediaId}/episodes/watched`).set(who).send({ episodeIds, watched })
const play = (episodeId: string, seconds: number) =>
  request(app).post(`/api/media/${mediaId}/progress`).set(user).send({ episodeId, progress: seconds, duration: 1500 })

describe('episodes marked as watched (séries, animes)', () => {
  it('« Marquer comme vu » for a selection: every episode watched, a position reached is kept', async () => {
    await play(ep['1/3'], 600)
    const res = await mark([ep['1/1'], ep['1/2'], ep['1/3']], true)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(3)
    expect(res.body.data.every((r: { completed: boolean }) => r.completed)).toBe(true)
    expect(res.body.data.find((r: { episodeId: string }) => r.episodeId === ep['1/3'])).toMatchObject({ progress: 600, completed: true })
    // Out of « Reprendre »
    const cont = await request(app).get('/api/media/continue').set(user)
    expect(cont.body.data.some((m: { id: string }) => m.id === mediaId)).toBe(false)
    // Marked again: nothing changes
    expect((await mark([ep['1/1']], true)).body.data).toHaveLength(3)
  })

  it('« Marquer comme non vu »: as if never opened (the position goes too)', async () => {
    await play(ep['2/1'], 300)
    await mark([ep['1/1'], ep['1/2']], true)
    const res = await mark([ep['1/2'], ep['2/1']], false)
    expect(res.body.data.map((r: { episodeId: string }) => r.episodeId)).toEqual([ep['1/1']])
  })

  it('each account has its own', async () => {
    await mark([ep['1/1']], true)
    expect(await progress(other)).toEqual([])
    expect(await progress()).toHaveLength(1)
  })

  it('refuses what is not right: an episode of another title, bad ids, a missing « watched », no account', async () => {
    const { rows } = await query<{ id: string }>(`INSERT INTO media_items (type, title, file_path) VALUES ('serie', 'Autre', '/tmp/nexus-watched-other') RETURNING id`)
    try {
      expect((await request(app).post(`/api/media/${rows[0].id}/episodes/watched`).set(user).send({ episodeIds: [ep['1/1']], watched: true })).status).toBe(404)
    } finally {
      await query('DELETE FROM media_items WHERE id = $1', [rows[0].id])
    }
    expect((await mark(['nope'], true)).status).toBe(422)
    expect((await mark([], true)).status).toBe(422)
    expect((await mark([ep['1/1']], 'yes')).status).toBe(422)
    expect((await mark(['00000000-0000-4000-8000-0000000000ff'], true)).status).toBe(404)
    expect((await request(app).post(`/api/media/${mediaId}/episodes/watched`).send({ episodeIds: [ep['1/1']], watched: true })).status).toBe(401)
  })
})
