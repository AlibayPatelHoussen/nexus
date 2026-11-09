import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'
import { MediaService } from '../../src/services/media'

const auth = { Authorization: `Bearer ${makeToken('user')}` }
// webtoon: a type no other test file fills, so this file owns what the draw can return
const PREFIX = '/tmp/nexus-featured-test/'

beforeAll(async () => {
  await query(`DELETE FROM media_items WHERE type = 'webtoon'`)
  for (let n = 0; n < 12; n++) {
    await query(`INSERT INTO media_items (type, title, file_path, backdrop_path, overview) VALUES ('webtoon', $1, $2, $3, $4)`,
      [`Avec visuel ${n}`, `${PREFIX}a${n}`, '/b.jpg', 'Synopsis'])
  }
  for (let n = 0; n < 5; n++) {
    await query(`INSERT INTO media_items (type, title, file_path) VALUES ('webtoon', $1, $2)`, [`Sans visuel ${n}`, `${PREFIX}b${n}`])
  }
})
afterAll(async () => { await query(`DELETE FROM media_items WHERE file_path LIKE $1 || '%'`, [PREFIX]) })

const draw = async (count?: number) =>
  ((await request(app).get('/api/media/featured').set(auth).query({ type: 'webtoon', ...(count ? { count } : {}) })).body.data as { title: string; type: string }[])

describe('« À la une »', () => {
  it('draws at random among every title of the type, those with a backdrop and a synopsis first', async () => {
    const first = await draw()
    expect(first).toHaveLength(8)
    expect(first.every((m) => m.type === 'webtoon' && m.title.startsWith('Avec visuel'))).toBe(true)
    // The same titles all hour long (every visit), others the next hours
    const hour = Math.floor(Date.now() / 3_600_000) + 100
    const titles = async (h: number) => (await MediaService.getFeatured('webtoon', 8, h)).map((m) => m.title)
    expect(await titles(hour)).toEqual(await titles(hour))
    const hours = new Set<string>()
    for (let h = 1; h <= 6; h++) hours.add((await titles(hour + h)).join('|'))
    expect(hours.size).toBeGreaterThan(1)
    // A later hour still puts the titles with artwork first
    expect((await MediaService.getFeatured('webtoon', 8, hour + 1)).every((m) => m.title.startsWith('Avec visuel'))).toBe(true)
  })

  it('fills with the other titles when too few have artwork; bounded count; known types only', async () => {
    const all = await draw(20)
    expect(all).toHaveLength(17)
    expect(all.slice(0, 12).every((m) => m.title.startsWith('Avec visuel'))).toBe(true)
    expect(all.slice(12).every((m) => m.title.startsWith('Sans visuel'))).toBe(true)
    expect(await draw(500)).toHaveLength(17)
    expect((await request(app).get('/api/media/featured').set(auth).query({ type: 'x; DROP' })).status).toBe(400)
    expect((await request(app).get('/api/media/featured').query({ type: 'film' })).status).toBe(401)
  })
})
