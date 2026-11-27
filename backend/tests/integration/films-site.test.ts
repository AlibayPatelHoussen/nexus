import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import * as push from '../../src/services/push'
import { syncFilmsSite } from '../../src/services/filmsSite'
import { makeToken } from '../helpers'

const admin = { Authorization: `Bearer ${makeToken('admin')}` }
const user = { Authorization: `Bearer ${makeToken('user')}` }
let dir = ''
let before: string | undefined
const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'data', 'films_site.json'), 'utf8'))

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-films-site-'))
  fs.writeFileSync(path.join(dir, 'films.py'), 'DEFAULT_SITE_URL = "https://zotrof.com/770fbb7/home/zotrof"\n')
  before = process.env.DOWNLOADERS_DIR
  process.env.DOWNLOADERS_DIR = dir
})
afterAll(() => {
  process.env.DOWNLOADERS_DIR = before
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('the films site address (Réglages › Bibliothèque › Site de films)', () => {
  it('the address written in the script, until the script finds another one', async () => {
    const res = await request(app).get('/api/downloads/films-site').set(admin)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ url: 'https://zotrof.com/770fbb7/home/zotrof', host: 'zotrof.com', how: 'default' })
    // The script followed the site to its new domain
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data', 'films_site.json'), JSON.stringify({
      url: 'https://nouveau.example/abc1234/home/nouveau', how: 'redirect', found: '2026-11-27T10:00:00Z',
      previous: 'https://zotrof.com/770fbb7/home/zotrof', seen: ['https://miroir.example/'],
    }))
    const moved = await request(app).get('/api/downloads/films-site').set(admin)
    expect(moved.body.data).toMatchObject({ host: 'nouveau.example', how: 'redirect', found: '2026-11-27T10:00:00Z' })
  })

  it('an admin pastes the new link: kept for the script (what it saw stays)', async () => {
    const res = await request(app).put('/api/downloads/films-site').set(admin).send({ url: ' autre.example/9f8e7d6/home/autre ' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ url: 'https://autre.example/9f8e7d6/home/autre', host: 'autre.example', how: 'manual' })
    expect(saved()).toMatchObject({
      url: 'https://autre.example/9f8e7d6/home/autre', how: 'manual',
      previous: 'https://nouveau.example/abc1234/home/nouveau', seen: ['https://miroir.example/'],
    })
  })

  it('refuses what is not an address, and other accounts', async () => {
    for (const url of ['', 'pas une adresse', 'ftp://x.example/', 'https://moi:secret@x.example/', 42, 'x'.repeat(501)]) {
      expect((await request(app).put('/api/downloads/films-site').set(admin).send({ url })).status).toBe(422)
    }
    expect((await request(app).get('/api/downloads/films-site').set(user)).status).toBe(403)
    expect((await request(app).put('/api/downloads/films-site').set(user).send({ url: 'https://x.example/' })).status).toBe(403)
  })
})

describe('the admins are told when the films site goes down, moves, comes back', () => {
  const write = (data: object) => {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data', 'films_site.json'), JSON.stringify(data))
  }
  let sent: jest.SpyInstance
  beforeAll(async () => { await query(`DELETE FROM app_settings WHERE key = 'films_site'`) })
  beforeEach(() => { sent = jest.spyOn(push, 'sendPush').mockResolvedValue(1) })
  afterEach(() => sent.mockRestore())

  it('nothing when it works (the first time: nothing to compare)', async () => {
    write({ url: 'https://zotrof.com/770fbb7/home/zotrof', ok: true })
    expect(await syncFilmsSite()).toEqual([])
    expect(sent).not.toHaveBeenCalled()
  })

  it('down and not found by itself: « en panne », then « à toi de jouer » — once', async () => {
    write({ url: 'https://zotrof.com/770fbb7/home/zotrof', ok: false, down_since: '2026-11-27T08:00:00Z' })
    expect(await syncFilmsSite()).toEqual(['Site de films en panne', 'Site de films : à toi de jouer'])
    expect(sent.mock.calls[0][1].body).toContain('zotrof.com ne répond plus')
    expect(sent.mock.calls[1][1].body).toContain('Réglages › Bibliothèque › Site de films')
    const { rows } = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`)
    expect(sent.mock.calls[0][0].sort()).toEqual(rows.map((r) => r.id).sort())
    expect(await syncFilmsSite()).toEqual([])      // still down: not told again
  })

  it('a link pasted that works: « ça remarche »', async () => {
    write({ url: 'https://colle.example/aaaa111/home/colle', ok: true, how: 'manual' })
    expect(await syncFilmsSite()).toEqual(['Site de films : ça remarche'])
  })

  it('the old address dead, the new one found by itself: « en panne », then « nouvelle adresse »', async () => {
    write({ url: 'https://nouveau.example/abc1234/home/nouveau', ok: true, how: 'mirror', lost: 'https://colle.example/aaaa111/home/colle' })
    expect(await syncFilmsSite()).toEqual(['Site de films en panne', 'Site de films : nouvelle adresse'])
    expect(sent.mock.calls[1][1].body).toBe('Nexus est passé tout seul de colle.example à nouveau.example. Rien à faire.')
  })

  it('a redirect to a new domain (the old one still leads there): « nouvelle adresse » only', async () => {
    write({ url: 'https://autre.example/9f8e7d6/home/autre', ok: true, how: 'redirect', lost: null })
    expect(await syncFilmsSite()).toEqual(['Site de films : nouvelle adresse'])
  })
})
