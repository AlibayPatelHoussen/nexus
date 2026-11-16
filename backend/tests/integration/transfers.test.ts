import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import AdmZip from 'adm-zip'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { cleanFileName, cleanTransfers } from '../../src/services/transfers'
import { contentDisposition } from '../../src/utils/contentDisposition'
import { makeToken } from '../helpers'

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
const admin = () => bearer(makeToken('admin'))

let dir: string
let otherAdmin = ''
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-transfers-'))
  process.env.TRANSFERS_DIR = path.join(dir, 'box')
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('transfer-admin2', 'transfer2@test.io', 'x', 'admin')
     ON CONFLICT (username) DO UPDATE SET role = 'admin' RETURNING id`)
  otherAdmin = rows[0].id
  await query('DELETE FROM transfers')
})
afterAll(() => {
  delete process.env.TRANSFERS_DIR
  fs.rmSync(dir, { recursive: true, force: true })
})
afterEach(() => jest.restoreAllMocks())

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082', 'hex')

describe('Transferts (Aperçu)', () => {
  it('admins only, signed in', async () => {
    expect((await request(app).get('/api/transfers')).status).toBe(401)
    expect((await request(app).get('/api/transfers').set(bearer(makeToken('user')))).status).toBe(403)
    const up = await request(app).post('/api/transfers').set(bearer(makeToken('user'))).attach('files', Buffer.from('x'), 'a.txt')
    expect(up.status).toBe(403)
  })

  it('a file sent is listed, downloaded under its own name, then erased', async () => {
    const up = await request(app).post('/api/transfers').set(admin())
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
      .attach('files', Buffer.from('bonjour'), 'Écran été.txt')
      .attach('files', PNG, { filename: 'photo.png', contentType: 'image/png' })
    expect(up.status).toBe(201)
    expect(up.body.data).toHaveLength(2)
    const [text, image] = up.body.data
    expect(text).toMatchObject({ name: 'Écran été.txt', size: 7, device: expect.stringMatching(/iPhone/) })
    // Kept under its id, never under the browser's name
    expect(fs.readdirSync(process.env.TRANSFERS_DIR!).sort()).toEqual(['.incoming', image.id, text.id].sort())
    expect(fs.readdirSync(path.join(process.env.TRANSFERS_DIR!, '.incoming'))).toEqual([])

    const list = await request(app).get('/api/transfers').set(admin())
    expect(list.body.data.map((t: { id: string }) => t.id).sort()).toEqual([text.id, image.id].sort())
    // Not another admin's
    expect((await request(app).get('/api/transfers').set(bearer(makeToken('admin', 'access', otherAdmin)))).body.data).toEqual([])
    expect((await request(app).get(`/api/transfers/${text.id}/file`).set(bearer(makeToken('admin', 'access', otherAdmin)))).status).toBe(404)

    // A link: the stream token is enough
    const file = await request(app).get(`/api/transfers/${text.id}/file`).query({ token: makeToken('admin', 'stream') })
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('application/octet-stream')
    // Whole in every browser: UTF-8 (filename*), and a plain copy
    expect(file.headers['content-disposition']).toBe(`attachment; filename="Ecran ete.txt"; filename*=UTF-8''%C3%89cran%20%C3%A9t%C3%A9.txt`)
    expect(file.body.toString()).toBe('bonjour')
    // An image can be shown; anything else is never shown inline (HTML from a browser…)
    const img = await request(app).get(`/api/transfers/${image.id}/file`).query({ inline: '1' }).set(admin())
    expect(img.headers['content-type']).toBe('image/png')
    expect(img.headers['content-disposition']).toMatch(/^inline/)
    const notInline = await request(app).get(`/api/transfers/${text.id}/file`).query({ inline: '1' }).set(admin())
    expect(notInline.headers['content-disposition']).toMatch(/^attachment/)

    expect((await request(app).delete(`/api/transfers/${text.id}`).set(bearer(makeToken('admin', 'access', otherAdmin)))).status).toBe(404)
    expect((await request(app).delete(`/api/transfers/${text.id}`).set(admin())).status).toBe(200)
    expect(fs.existsSync(path.join(process.env.TRANSFERS_DIR!, text.id))).toBe(false)
    const clear = await request(app).delete('/api/transfers').set(admin())
    expect(clear.body.data.removed).toBe(1)
    expect(fs.existsSync(path.join(process.env.TRANSFERS_DIR!, image.id))).toBe(false)
    expect((await request(app).get(`/api/transfers/${image.id}/file`).set(admin())).status).toBe(404)
  })

  it('nothing received: 422; an odd id: 404', async () => {
    expect((await request(app).post('/api/transfers').set(admin()).field('x', '1')).status).toBe(422)
    expect((await request(app).get('/api/transfers/not-an-id/file').set(admin())).status).toBe(404)
    expect((await request(app).delete('/api/transfers/not-an-id').set(admin())).status).toBe(404)
  })

  it('refused before receiving it when the disk is too full', async () => {
    jest.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1024, bsize: 4096 } as fs.StatsFs)
    const up = await request(app).post('/api/transfers').set(admin()).attach('files', Buffer.alloc(1024), 'big.bin')
    expect(up.status).toBe(507)
    expect(up.body.code).toBe('NO_SPACE')
  })

  it('expired transfers and files left alone are cleaned up', async () => {
    const up = await request(app).post('/api/transfers').set(admin()).attach('files', Buffer.from('old'), 'old.txt')
    const id = up.body.data[0].id
    await query(`UPDATE transfers SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id])
    const orphan = path.join(process.env.TRANSFERS_DIR!, '11111111-2222-4333-8444-555555555555')
    fs.writeFileSync(orphan, 'x')
    const cut = path.join(process.env.TRANSFERS_DIR!, '.incoming', 'cut-off')
    fs.writeFileSync(cut, 'x')
    const old = new Date(Date.now() - 2 * 24 * 3600_000)
    fs.utimesSync(cut, old, old)
    expect(await cleanTransfers()).toBe(1)
    expect(fs.existsSync(path.join(process.env.TRANSFERS_DIR!, id))).toBe(false)
    expect(fs.existsSync(orphan)).toBe(false)
    expect(fs.existsSync(cut)).toBe(false)
  })

  it('a name with accents, quotes or emoji stays whole for the browser', () => {
    expect(contentDisposition('Épisode "1" (VF) 🎬.mkv')).toBe(
      `attachment; filename="Episode _1_ (VF) _.mkv"; filename*=UTF-8''%C3%89pisode%20%221%22%20%28VF%29%20%F0%9F%8E%AC.mkv`)
    expect(contentDisposition('a.jpg', 'inline')).toMatch(/^inline; /)
  })

  it('names from a browser are only names', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('C:\\Users\\moi\\photo.jpg')).toBe('photo.jpg')
    expect(cleanFileName(Buffer.from('Épisode 1.mkv').toString('latin1'))).toBe('Épisode 1.mkv')
    expect(cleanFileName('a\u0000b\u001f.txt')).toBe('ab.txt')
    expect(cleanFileName('..')).toBe('fichier')
    expect(cleanFileName(`${'x'.repeat(300)}.jpeg`)).toHaveLength(200)
    expect(cleanFileName(`${'x'.repeat(300)}.jpeg`).endsWith('.jpeg')).toBe(true)
  })
})

describe('Fichiers › Télécharger (.zip)', () => {
  let root: string
  beforeAll(() => {
    root = path.join(dir, 'zip')
    fs.mkdirSync(path.join(root, 'Films', 'Vide'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Films', 'Saison 1'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Films', 'a.mkv'), 'AAAA')
    fs.writeFileSync(path.join(root, 'Films', 'Saison 1', 'é1.mkv'), 'BB')
    fs.writeFileSync(path.join(root, 'Films', '.env'), 'JWT_SECRET=do-not-zip')
    fs.symlinkSync('/etc/hostname', path.join(root, 'Films', 'link'))
    fs.writeFileSync(path.join(root, 'notes.txt'), 'hello')
  })

  const zipOf = async (q: Record<string, string | string[]>) => {
    const res = await request(app).get('/api/files/zip').query({ ...q, token: makeToken('admin', 'stream') })
      .buffer(true).parse((r, cb) => { const parts: Buffer[] = []; r.on('data', (c: Buffer) => parts.push(c)); r.on('end', () => cb(null, Buffer.concat(parts))) })
    return res
  }

  it('a whole folder: its files and empty folders, never secrets or links; the size is known', async () => {
    const res = await zipOf({ dir: path.join(root, 'Films') })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="Films.zip"; filename*=UTF-8''Films.zip`)
    expect(Number(res.headers['content-length'])).toBe((res.body as Buffer).length)
    const zip = new AdmZip(res.body as Buffer)
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(['Films/Saison 1/é1.mkv', 'Films/Vide/', 'Films/a.mkv'])
    expect(zip.readAsText('Films/a.mkv')).toBe('AAAA')
    expect(JSON.stringify(zip.getEntries().map((e) => e.getData().toString()))).not.toContain('do-not-zip')
  })

  it('a few chosen items of a folder', async () => {
    const res = await zipOf({ dir: root, name: ['notes.txt', 'Films'] })
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/Nexus-\d{4}-\d{2}-\d{2}\.zip/)
    const names = new AdmZip(res.body as Buffer).getEntries().map((e) => e.entryName)
    expect(names).toContain('notes.txt')
    expect(names).toContain('Films/a.mkv')
  })

  it('admins only; names are names; a chosen secret is refused', async () => {
    const user = await request(app).get('/api/files/zip').query({ dir: root, token: makeToken('user', 'stream') })
    expect(user.status).toBe(403)
    expect((await zipOf({ dir: root, name: '../etc' })).status).toBe(422)
    expect((await zipOf({ dir: root })).status).toBe(200)
    expect((await zipOf({})).status).toBe(422)
    const secret = await zipOf({ dir: path.join(root, 'Films'), name: '.env' })
    expect(secret.status).toBe(403)
    expect((await zipOf({ dir: path.join(root, 'nothing-here') })).status).toBe(404)
  })
})
