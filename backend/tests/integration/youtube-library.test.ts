import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { MediaScanner } from '../../src/services/scanner'
import { makeToken } from '../helpers'

const YT = path.join(process.env.MEDIA_ROOT!, 'youtube-test')
const FILMS = path.join(process.env.MEDIA_ROOT!, 'films-lang-test')
const bearer = { Authorization: `Bearer ${makeToken('user')}` }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

beforeAll(async () => {
  process.env.YOUTUBE_PATH = YT
  process.env.FILMS_PATH = FILMS
  fs.rmSync(YT, { recursive: true, force: true }); fs.rmSync(FILMS, { recursive: true, force: true })
  // New layout: {Chaîne}/{Titre} [id].mp4 + .jpg + .info.json
  const ch = path.join(YT, 'Chaîne Test')
  fs.mkdirSync(ch, { recursive: true })
  fs.writeFileSync(path.join(ch, 'Ma vidéo [abcdefghijk].mp4'), Buffer.alloc(2048, 1))
  fs.writeFileSync(path.join(ch, 'Ma vidéo [abcdefghijk].jpg'), PNG)
  fs.writeFileSync(path.join(ch, 'Ma vidéo [abcdefghijk].info.json'),
    JSON.stringify({ title: 'Ma vidéo', channel: 'Chaîne Test', duration: 212.4, upload_date: '20240512', description: 'Description' }))
  // Being downloaded: ignored
  fs.writeFileSync(path.join(ch, '.part-Autre [bbbbbbbbbbb].mp4'), Buffer.alloc(10))
  // Old layout of youtube.py: directly in the folder, no metadata
  fs.writeFileSync(path.join(YT, 'Vieille_video.mp4'), Buffer.alloc(1024, 1))
  // movix.py films: /media/films/VF/Titre_2020.mp4
  fs.mkdirSync(path.join(FILMS, 'VF'), { recursive: true })
  fs.writeFileSync(path.join(FILMS, 'VF', 'Matrix_1999.mp4'), Buffer.alloc(1024, 1))
  fs.writeFileSync(path.join(FILMS, 'VF', 'Inception_2010.mp4'), Buffer.alloc(1024, 1))
  await query(`DELETE FROM media_items WHERE file_path LIKE $1 OR file_path LIKE $2`, [`${YT}%`, `${FILMS}%`])
})

describe('YouTube library', () => {
  it('indexes the videos with title, channel, duration, date and thumbnail', async () => {
    expect(await MediaScanner.scanYoutube()).toBe(2)
    const res = await request(app).get('/api/media').set(bearer).query({ type: 'youtube', sortBy: 'created_at', sortDir: 'desc' })
    expect(res.status).toBe(200)
    const items = res.body.data.items ?? res.body.data
    const video = items.find((i: { title: string }) => i.title === 'Ma vidéo')
    expect(video).toEqual(expect.objectContaining({ type: 'youtube', channel: 'Chaîne Test', duration: 212, year: 2024 }))
    expect(video.posterPath).toMatch(/^\/api\/images\/media\/[0-9a-f-]+\/poster\?v=/)
    const old = items.find((i: { title: string }) => i.title === 'Vieille video')
    expect(old).toEqual(expect.objectContaining({ channel: null, posterPath: null }))
  })

  it('serves the local thumbnail, and nothing outside the library', async () => {
    const { rows } = await query<{ id: string }>(`SELECT id FROM media_items WHERE title = 'Ma vidéo'`)
    const img = await request(app).get(`/api/images/media/${rows[0].id}/poster`)
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toMatch(/image\/(jpeg|png)/)
    await query(`UPDATE media_items SET poster_path = '/etc/passwd' WHERE id = $1`, [rows[0].id])
    expect((await request(app).get(`/api/images/media/${rows[0].id}/poster`)).status).toBe(404)
    await query(`UPDATE media_items SET poster_path = '/etc/hostname.jpg' WHERE id = $1`, [rows[0].id])
    expect((await request(app).get(`/api/images/media/${rows[0].id}/poster`)).status).toBe(404)
  })

  it('forgets videos that were deleted', async () => {
    fs.rmSync(path.join(YT, 'Vieille_video.mp4'))
    await MediaScanner.pruneDeleted('youtube')
    const { rows } = await query(`SELECT 1 FROM media_items WHERE file_path = $1`, [path.join(YT, 'Vieille_video.mp4')])
    expect(rows).toHaveLength(0)
  })
})

describe('Films in language folders', () => {
  it('turns every video of /films/VF/ into its own film instead of one title "VF"', async () => {
    await MediaScanner.scanFilms()
    const { rows } = await query<{ title: string }>(`SELECT title FROM media_items WHERE file_path LIKE $1 ORDER BY title`, [`${FILMS}%`])
    expect(rows.map((r) => r.title)).toEqual(['Inception', 'Matrix'])
  })
})
