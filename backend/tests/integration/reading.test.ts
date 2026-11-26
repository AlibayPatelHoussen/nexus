import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { FIXTURES, makeToken } from '../helpers'

const user = { Authorization: `Bearer ${makeToken('user')}` }
const other = { Authorization: `Bearer ${makeToken('user', 'access', FIXTURES.other.id)}` }

let mediaId: string
/** chapter id by « number/version » */
const ch: Record<string, string> = {}

beforeAll(async () => {
  await query(`UPDATE users SET can_media = TRUE WHERE id = ANY($1::uuid[])`, [[FIXTURES.user.id, FIXTURES.other.id]])
  const { rows } = await query<{ id: string }>(
    `INSERT INTO media_items (type, title, file_path) VALUES ('manga', 'Progress Test', '/tmp/nexus-reading-test') RETURNING id`)
  mediaId = rows[0].id
  for (const version of ['VF', 'VF Noir et blanc']) {
    for (const n of [1, 2, 3, 4, 5]) {
      const { rows: c } = await query<{ id: string }>(
        `INSERT INTO chapters (media_item_id, chapter_number, folder_path, page_count, language) VALUES ($1, $2, $3, 20, $4) RETURNING id`,
        [mediaId, n, `/tmp/nexus-reading-test/${version}/${n}`, version])
      ch[`${n}/${version}`] = c[0].id
    }
  }
})
afterAll(async () => {
  await query('DELETE FROM media_items WHERE id = $1', [mediaId])
})
afterEach(async () => {
  await query('DELETE FROM read_history WHERE media_item_id = $1', [mediaId])
})

const reading = async (who = user) => (await request(app).get(`/api/media/${mediaId}/reading`).set(who)).body.data as
  { chapterId: string; currentPage: number; completed: boolean }[]
const save = (chapterId: string, page: number, total = 20, who = user) =>
  request(app).post(`/api/media/chapters/${chapterId}/reading`).set(who).send({ page, total })

describe('reading progress (mangas)', () => {
  it('the page reached is kept; the last page makes the chapter read, going back keeps it read', async () => {
    expect((await save(ch['2/VF'], 7)).status).toBe(200)
    expect(await reading()).toEqual([expect.objectContaining({ chapterId: ch['2/VF'], currentPage: 7, completed: false })])
    await save(ch['2/VF'], 19)
    expect((await reading())[0]).toMatchObject({ currentPage: 19, completed: true })
    await save(ch['2/VF'], 3)
    expect((await reading())[0]).toMatchObject({ currentPage: 3, completed: true })
    // the most recent first
    await save(ch['3/VF'], 1)
    expect((await reading()).map((r) => r.chapterId)).toEqual([ch['3/VF'], ch['2/VF']])
  })

  it('each account has its own progress', async () => {
    await save(ch['1/VF'], 19)
    expect(await reading(other)).toEqual([])
    expect(await reading()).toHaveLength(1)
  })

  it('« Marquer comme lu » for a selection; « non lu » also clears that number in the other version', async () => {
    const ids = [ch['1/VF'], ch['2/VF'], ch['3/VF']]
    await save(ch['3/VF'], 5)
    const marked = await request(app).post(`/api/media/${mediaId}/reading`).set(user).send({ chapterIds: ids, read: true })
    expect(marked.status).toBe(200)
    expect(marked.body.data.filter((r: { completed: boolean }) => r.completed)).toHaveLength(3)
    // a chapter started keeps its page
    expect(marked.body.data.find((r: { chapterId: string }) => r.chapterId === ch['3/VF'])).toMatchObject({ currentPage: 5, completed: true })
    await save(ch['2/VF Noir et blanc'], 19)
    const unread = await request(app).post(`/api/media/${mediaId}/reading`).set(user).send({ chapterIds: [ch['2/VF']], read: false })
    expect(unread.body.data.map((r: { chapterId: string }) => r.chapterId).sort()).toEqual([ch['1/VF'], ch['3/VF']].sort())
  })

  it('refuses what is not right: a chapter of another title, a page out of range, a missing « read »', async () => {
    const { rows } = await query<{ id: string }>(`INSERT INTO media_items (type, title, file_path) VALUES ('manga', 'Autre', '/tmp/nexus-reading-other') RETURNING id`)
    try {
      expect((await request(app).post(`/api/media/${rows[0].id}/reading`).set(user).send({ chapterIds: [ch['1/VF']], read: true })).status).toBe(404)
    } finally {
      await query('DELETE FROM media_items WHERE id = $1', [rows[0].id])
    }
    expect((await save(ch['1/VF'], 20, 20)).status).toBe(422)
    expect((await save(ch['1/VF'], -1)).status).toBe(422)
    expect((await request(app).post(`/api/media/chapters/${ch['1/VF']}/reading`).set(user).send({ page: '3', total: 20 })).status).toBe(422)
    expect((await request(app).post(`/api/media/${mediaId}/reading`).set(user).send({ chapterIds: [ch['1/VF']] })).status).toBe(422)
    expect((await request(app).post(`/api/media/${mediaId}/reading`).set(user).send({ chapterIds: ['nope'], read: true })).status).toBe(422)
    expect((await request(app).post('/api/media/chapters/00000000-0000-4000-8000-0000000000ff/reading').set(user).send({ page: 1, total: 2 })).status).toBe(404)
    expect((await request(app).get(`/api/media/${mediaId}/reading`)).status).toBe(401)
  })
})
