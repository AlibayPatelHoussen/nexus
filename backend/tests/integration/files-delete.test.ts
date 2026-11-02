import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { makeToken } from '../helpers'

const admin = { Authorization: `Bearer ${makeToken('admin')}` }
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-delete-'))

function tree(root: string) {
  fs.mkdirSync(path.join(root, 'Saison 1', 'sous dossier'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Saison 1', 'Épisode 01 (1080p) #1 & co + 50%.mkv'), 'x')
  fs.writeFileSync(path.join(root, 'Saison 1', 'sous dossier', 'a.txt'), 'x')
}

describe('DELETE /api/files', () => {
  it('deletes a non-empty folder with spaces / accents (recursive)', async () => {
    const dir = path.join(BASE, 'Série à supprimer')
    tree(dir)
    const res = await request(app).delete(`/api/files?path=${encodeURIComponent(dir)}`).set(admin)
    expect(res.status).toBe(200)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('deletes a file whose name has #, &, +, % and accents', async () => {
    const dir = path.join(BASE, 'f'); tree(dir)
    const file = path.join(dir, 'Saison 1', 'Épisode 01 (1080p) #1 & co + 50%.mkv')
    const res = await request(app).delete(`/api/files?path=${encodeURIComponent(file)}`).set(admin)
    expect(res.status).toBe(200)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('removes a broken symlink itself', async () => {
    const link = path.join(BASE, 'broken-link')
    fs.symlinkSync(path.join(BASE, 'does-not-exist'), link)
    const res = await request(app).delete(`/api/files?path=${encodeURIComponent(link)}`).set(admin)
    expect(res.status).toBe(200)
    expect(fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })).toBeFalsy()
  })

  it('a missing file gives a clear 404 message', async () => {
    const res = await request(app).delete(`/api/files?path=${encodeURIComponent(path.join(BASE, 'nope.mkv'))}`).set(admin)
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/n'existe plus/)
  })

  it.each(['/', '/etc', '/usr', process.env.MEDIA_ROOT!])('refuses to delete protected folder %s', async (p) => {
    const res = await request(app).delete(`/api/files?path=${encodeURIComponent(p)}`).set(admin)
    expect(res.status).toBe(403)
    expect(fs.existsSync(p)).toBe(true)
  })

  it('"../" cannot reach a protected folder', async () => {
    const res = await request(app).delete(`/api/files?path=${encodeURIComponent(`${BASE}/../../etc`)}`).set(admin)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/files/delete (several)', () => {
  it('deletes everything it can and reports each failure', async () => {
    const a = path.join(BASE, 'multi-a'); tree(a)
    const b = path.join(BASE, 'multi b é.txt'); fs.writeFileSync(b, 'x')
    const missing = path.join(BASE, 'missing')
    const res = await request(app).post('/api/files/delete').set(admin).send({ paths: [a, missing, b] })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(false)
    expect(res.body.data.deleted.sort()).toEqual([a, b].sort())
    expect(res.body.data.failed).toEqual([{ path: missing, error: expect.stringMatching(/n'existe plus/) }])
    expect(fs.existsSync(a) || fs.existsSync(b)).toBe(false)
  })

  it('422 when nothing could be deleted', async () => {
    const res = await request(app).post('/api/files/delete').set(admin).send({ paths: ['/etc'] })
    expect(res.status).toBe(422)
    expect(res.body.data.failed[0].error).toMatch(/protégé/)
  })

  it('validates the body', async () => {
    expect((await request(app).post('/api/files/delete').set(admin).send({ paths: [] })).status).toBe(422)
    expect((await request(app).post('/api/files/delete').set(admin).send({})).status).toBe(422)
  })

  it('is admin-only', async () => {
    const res = await request(app).post('/api/files/delete').set({ Authorization: `Bearer ${makeToken('user')}` }).send({ paths: [BASE] })
    expect(res.status).toBe(403)
  })
})

afterAll(() => fs.rmSync(BASE, { recursive: true, force: true }))
