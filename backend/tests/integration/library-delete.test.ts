import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'

const admin = { Authorization: `Bearer ${makeToken('admin')}` }
const user = { Authorization: `Bearer ${makeToken('user')}` }
const ROOT = path.join(process.env.MEDIA_ROOT!, 'library-delete')

const write = (f: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x') }

async function media(type: string, filePath: string, title = 'Titre test'): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO media_items (type, title, file_path) VALUES ($1, $2, $3)
     ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [type, title, filePath])
  return rows[0].id
}

async function download(sourceId: string, files: string[], status = 'done'): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO downloads (kind, source_script, source_id, title, status, progress)
     VALUES ('serie', 'movix', $1, 'Titre test', $2, $3) RETURNING id`, [sourceId, status, JSON.stringify({ files })])
  return rows[0].id
}

const exists = async (table: string, id: string) =>
  (await query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rows.length > 0

beforeEach(() => { fs.rmSync(ROOT, { recursive: true, force: true }) })
afterAll(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  await query(`DELETE FROM media_items WHERE file_path LIKE $1 || '%'`, [ROOT])
  await query(`DELETE FROM downloads WHERE source_id LIKE 'movix:tv:9900%'`)
  await query(`DELETE FROM follows WHERE source_id LIKE 'movix:tv:9900%'`)
})

describe('DELETE /api/media/:id — deleted everywhere', () => {
  it('a series: its folder, its row, episodes, downloads and follow', async () => {
    const dir = path.join(ROOT, 'series', 'Ma Série')
    const ep = path.join(dir, 'VF', 'Saison_1', 'E01.mp4')
    write(ep)
    const id = await media('serie', dir)
    const epRow = await query<{ id: string }>(
      `INSERT INTO episodes (media_item_id, season, episode_number, file_path) VALUES ($1, 1, 1, $2) RETURNING id`, [id, ep])
    const dl = await download('movix:tv:990001', [ep])
    const other = await download('movix:tv:990002', [path.join(ROOT, 'series', 'Autre', 'E01.mp4')])
    await query(`INSERT INTO follows (source_id, source_script, kind, title) VALUES ('movix:tv:990001', 'movix', 'serie', 'Ma Série')`)

    const res = await request(app).delete(`/api/media/${id}`).set(admin)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ files: [dir], downloads: 1, follows: 1 })
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'series'))).toBe(true)
    expect(await exists('media_items', id)).toBe(false)
    expect(await exists('episodes', epRow.rows[0].id)).toBe(false)
    expect(await exists('downloads', dl)).toBe(false)
    expect(await exists('downloads', other)).toBe(true)          // another title's download stays
    expect((await query(`SELECT 1 FROM follows WHERE source_id = 'movix:tv:990001'`)).rows).toHaveLength(0)
  })

  it('a film alone in its folder: the whole folder', async () => {
    const film = path.join(ROOT, 'films', 'Film (2024)', 'Film.2024.1080p.mkv')
    write(film)
    write(path.join(ROOT, 'films', 'Film (2024)', 'Film.srt'))
    const id = await media('film', film)
    expect((await request(app).delete(`/api/media/${id}`).set(admin)).status).toBe(200)
    expect(fs.existsSync(path.dirname(film))).toBe(false)
    expect(await exists('media_items', id)).toBe(false)
  })

  it('a film next to others (language folder, collection): only its file and what goes with it', async () => {
    const dir = path.join(ROOT, 'films', 'VF')
    const film = path.join(dir, 'Titre_2020.mp4')
    for (const f of ['Titre_2020.mp4', 'Titre_2020.fr.srt', '.Titre_2020.mp4.nexus.json', 'Titre_2020.part2.mp4', 'Autre_2019.mp4']) {
      write(path.join(dir, f))
    }
    const id = await media('film', film)
    expect((await request(app).delete(`/api/media/${id}`).set(admin)).status).toBe(200)
    expect(fs.readdirSync(dir).sort()).toEqual(['Autre_2019.mp4', 'Titre_2020.part2.mp4'])

    // A collection folder with another film in a sub-folder is not deleted whole
    const coll = path.join(ROOT, 'films', 'Collection')
    write(path.join(coll, 'Un.mkv'))
    write(path.join(coll, 'Deux', 'Deux.mkv'))
    const id2 = await media('film', path.join(coll, 'Un.mkv'))
    expect((await request(app).delete(`/api/media/${id2}`).set(admin)).status).toBe(200)
    expect(fs.existsSync(path.join(coll, 'Deux', 'Deux.mkv'))).toBe(true)
    expect(fs.existsSync(path.join(coll, 'Un.mkv'))).toBe(false)
  })

  it('files already gone: the title is still removed', async () => {
    const id = await media('film', path.join(ROOT, 'films', 'Parti.mkv'))
    expect((await request(app).delete(`/api/media/${id}`).set(admin)).status).toBe(200)
    expect(await exists('media_items', id)).toBe(false)
  })

  it('never outside the library, nor a library folder itself', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-outside-'))
    const file = path.join(outside, 'film.mkv')
    write(file)
    const id = await media('film', file)
    const res = await request(app).delete(`/api/media/${id}`).set(admin)
    expect(res.status).toBe(403)
    expect(fs.existsSync(file)).toBe(true)
    expect(await exists('media_items', id)).toBe(true)
    await query('DELETE FROM media_items WHERE id = $1', [id])
    fs.rmSync(outside, { recursive: true, force: true })

    const rootId = await media('serie', process.env.MEDIA_ROOT!)
    expect((await request(app).delete(`/api/media/${rootId}`).set(admin)).status).toBe(403)
    expect(fs.existsSync(process.env.MEDIA_ROOT!)).toBe(true)
    await query('DELETE FROM media_items WHERE id = $1', [rootId])
  })

  it('admin only', async () => {
    const film = path.join(ROOT, 'films', 'Garde.mkv')
    write(film)
    const id = await media('film', film)
    expect((await request(app).delete(`/api/media/${id}`).set(user)).status).toBe(403)
    expect(fs.existsSync(film)).toBe(true)
  })
})

describe('File manager deletion', () => {
  it('the library forgets the deleted title at once (no rescan)', async () => {
    const dir = path.join(ROOT, 'animes', 'Mon Anime')
    write(path.join(dir, 'ep01.mp4'))
    const id = await media('anime', dir)
    const dl = await download('movix:tv:990003', [path.join(dir, 'ep01.mp4')])
    const res = await request(app).post('/api/files/delete').set(admin).send({ paths: [dir] })
    expect(res.status).toBe(200)
    expect(await exists('media_items', id)).toBe(false)
    expect(await exists('downloads', dl)).toBe(false)
  })
})
