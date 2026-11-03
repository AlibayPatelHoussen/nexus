import fs from 'fs'
import path from 'path'
import request from 'supertest'
import sharp from 'sharp'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'

const ROOT = path.join(process.env.MEDIA_ROOT!, 'manga-pages-test')
const bearer = { Authorization: `Bearer ${makeToken('user')}` }
const stream = () => `token=${makeToken('user', 'stream')}`
let folderChapter = ''
let pdfChapter = ''

// Minimal valid 2-page PDF (A5-ish pages with a filled rectangle)
function tinyPdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 5 0 R >>',
    '<< /Length 33 >>\nstream\n0.2 0.4 0.8 rg 20 20 380 555 re f\nendstream',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

beforeAll(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  const dir = path.join(ROOT, 'Chapitre 1')
  fs.mkdirSync(dir, { recursive: true })
  // Two big "scans" (PNG, 2000 px wide)
  for (const n of [1, 2]) {
    await sharp({ create: { width: 2000, height: 2800, channels: 3, background: { r: 30 * n, g: 120, b: 200 } } }).png().toFile(path.join(dir, `${n}.png`))
  }
  fs.writeFileSync(path.join(ROOT, 'Chapitre 2.pdf'), tinyPdf())
  const { rows } = await query(
    `INSERT INTO media_items (type, title, file_path) VALUES ('manga', 'Pages test', $1)
     ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [ROOT])
  const media = rows[0].id
  const c1 = await query(`INSERT INTO chapters (media_item_id, chapter_number, folder_path) VALUES ($1, 1, $2)
    ON CONFLICT (folder_path) DO UPDATE SET chapter_number = 1 RETURNING id`, [media, dir])
  const c2 = await query(`INSERT INTO chapters (media_item_id, chapter_number, folder_path) VALUES ($1, 2, $2)
    ON CONFLICT (folder_path) DO UPDATE SET chapter_number = 2 RETURNING id`, [media, path.join(ROOT, 'Chapitre 2.pdf')])
  folderChapter = String(c1.rows[0].id)
  pdfChapter = String(c2.rows[0].id)
})

describe('manga pages prepared by the server', () => {
  it('lists the pages of an image chapter', async () => {
    const res = await request(app).get(`/api/media/chapters/${folderChapter}/pages`).set(bearer)
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('images')
    expect(res.body.data.map((p: { url: string }) => p.url)).toEqual([
      `/api/media/chapters/${folderChapter}/page/1`, `/api/media/chapters/${folderChapter}/page/2`,
    ])
  })

  it('serves a light WebP at the reader width (stream token in the URL), cached', async () => {
    const url = `/api/media/chapters/${folderChapter}/page/1?w=1080&${stream()}`
    const first = await request(app).get(url).buffer(true).parse((r, cb) => { const b: Buffer[] = []; r.on('data', (c) => b.push(c)); r.on('end', () => cb(null, Buffer.concat(b))) })
    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toBe('image/webp')
    expect(first.headers['cache-control']).toContain('immutable')
    const meta = await sharp(first.body as Buffer).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(1120)   // 1080 rounded to the 160 px steps
    const original = fs.statSync(path.join(ROOT, 'Chapitre 1', '1.png')).size
    expect((first.body as Buffer).length).toBeLessThan(original)
    const t = Date.now()
    expect((await request(app).get(url)).status).toBe(200)
    expect(Date.now() - t).toBeLessThan(500)   // from the disk cache
  })

  it('turns PDF pages into images too (poppler)', async () => {
    const list = await request(app).get(`/api/media/chapters/${pdfChapter}/pages`).set(bearer)
    expect(list.status).toBe(200)
    expect(list.body.type).toBe('images')
    expect(list.body.data).toHaveLength(2)
    const res = await request(app).get(`/api/media/chapters/${pdfChapter}/page/2?w=800&${stream()}`)
      .buffer(true).parse((r, cb) => { const b: Buffer[] = []; r.on('data', (c) => b.push(c)); r.on('end', () => cb(null, Buffer.concat(b))) })
    expect(res.status).toBe(200)
    expect((await sharp(res.body as Buffer).metadata()).width).toBe(800)
  })

  it('refuses missing pages and requests without a token', async () => {
    expect((await request(app).get(`/api/media/chapters/${folderChapter}/page/9?${stream()}`)).status).toBe(404)
    expect((await request(app).get(`/api/media/chapters/${folderChapter}/page/1`)).status).toBe(401)
    expect((await request(app).get(`/api/media/chapters/${folderChapter}/page/0?${stream()}`)).status).toBe(400)
  })
})
