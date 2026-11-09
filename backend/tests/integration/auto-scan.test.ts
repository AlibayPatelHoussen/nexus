import fs from 'fs'
import os from 'os'
import path from 'path'
import axios from 'axios'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { MediaScanner } from '../../src/services/scanner'
import { makeToken } from '../helpers'

const auth = { Authorization: `Bearer ${makeToken('user')}` }
const SCANS = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-autoscan-'))
const MANGA = path.join(SCANS, 'Mon Manga')
const write = (f: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '%PDF-1.4\n') }

let previous: string | undefined
beforeAll(() => {
  previous = process.env.MANGA_PATH
  process.env.MANGA_PATH = SCANS
  process.env.AUTO_SCAN_MIN_MS = '1'
})
afterAll(async () => {
  process.env.MANGA_PATH = previous
  delete process.env.AUTO_SCAN_MIN_MS
  await query(`DELETE FROM media_items WHERE file_path LIKE $1 || '%'`, [SCANS])
  fs.rmSync(SCANS, { recursive: true, force: true })
})

const autoScan = () => request(app).post('/api/media/scan/manga/auto').set(auth)
const chapters = async () => (await query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM chapters c JOIN media_items m ON m.id = c.media_item_id WHERE m.file_path = $1`, [MANGA])).rows[0].n

describe('Automatic scan when a page opens', () => {
  it('adds a new title, then only new chapters of known titles, without asking MangaDex again', async () => {
    const mangadex = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [] } })
    try {
      write(path.join(MANGA, 'Chapitre 1.pdf'))
      const first = await autoScan()
      expect(first.status).toBe(200)
      expect(first.body.data.scanned).toBeGreaterThanOrEqual(1)
      expect(await chapters()).toBe(1)
      const lookups = mangadex.mock.calls.length
      expect(lookups).toBeGreaterThan(0)              // a new title is looked up

      // A chapter finished downloading: the next page opened shows it, no online lookup
      write(path.join(MANGA, 'Chapitre 2.pdf'))
      await new Promise((r) => setTimeout(r, 5))
      expect((await autoScan()).status).toBe(200)
      expect(await chapters()).toBe(2)
      expect(mangadex.mock.calls.length).toBe(lookups)
    } finally {
      mangadex.mockRestore()
    }
  })

  it('is skipped right after another scan of this library, or while one runs', async () => {
    process.env.AUTO_SCAN_MIN_MS = '60000'
    try {
      expect((await autoScan()).body.data).toEqual({ skipped: 'recent' })
    } finally {
      process.env.AUTO_SCAN_MIN_MS = '1'
    }
    const scan = MediaScanner.exclusive('films', () => new Promise((r) => setTimeout(r, 300)))
    expect((await autoScan()).body.data).toEqual({ skipped: 'running' })
    await scan
  })

  it('known libraries only, signed in', async () => {
    expect((await request(app).post('/api/media/scan/etc/auto').set(auth)).status).toBe(400)
    expect((await request(app).post('/api/media/scan/manga/auto')).status).toBe(401)
  })
})
