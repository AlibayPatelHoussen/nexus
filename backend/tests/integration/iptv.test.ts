import http from 'http'
import { AddressInfo } from 'net'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'
import { checkChannel, importCatalogue, refreshCatalogue } from '../../src/services/iptv'
import { rewritePlaylist } from '../../src/services/iptvProxy'

/*
 * IPTV: catalogue queries and filters, favourites / history per user, settings, the stream
 * relay (against a local fake IPTV server), and the Python module driven by the server.
 */

let alice = { Authorization: '' }, bob = { Authorization: '' }
let aliceId = ''
const admin = { Authorization: `Bearer ${makeToken('admin')}` }

// ─── A local fake IPTV server ────────────────────────────────────────────────
const hits: { path: string; ua?: string; referer?: string }[] = []
let base = ''
const server = http.createServer((req, res) => {
  hits.push({ path: req.url!, ua: req.headers['user-agent'], referer: req.headers.referer })
  const u = req.url!.split('?')[0]
  const send = (code: number, body: string | Buffer, type = 'application/vnd.apple.mpegurl') => { res.writeHead(code, { 'Content-Type': type }); res.end(body) }
  if (u === '/live/master.m3u8') return send(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs/fr.m3u8"\n')
  if (u === '/live/low/index.m3u8') return send(200, '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nhttps://cdn.example/abs.ts\n')
  if (u === '/live/low/seg1.ts') return send(200, Buffer.alloc(376, 0x47), 'video/mp2t')
  if (u === '/redirect.m3u8') { res.writeHead(302, { Location: '/live/master.m3u8' }); return res.end() }
  if (u === '/php/stream.php') return send(200, '#EXTM3U\n#EXTINF:6,\nseg.ts\n', 'text/plain')
  if (u === '/geo.m3u8') return send(403, 'no')
  if (u === '/html.m3u8') return send(200, '<html>nope</html>', 'text/html')
  // iptv-org API / playlist for the refresh test
  const api: Record<string, unknown> = {
    '/api/channels.json': [{ id: 'Remote.fr', name: 'Remote TV', country: 'FR', categories: ['news'], is_nsfw: false, closed: null }],
    '/api/streams.json': [{ channel: 'Remote.fr', feed: null, title: 'Remote', url: `${base}/live/master.m3u8`, labels: [] }],
    '/api/feeds.json': [{ channel: 'Remote.fr', id: 'SD', is_main: true, languages: ['fra'] }],
    '/api/logos.json': [], '/api/blocklist.json': [], '/api/categories.json': [{ id: 'news', name: 'News' }],
    '/api/countries.json': [{ code: 'FR', name: 'France', flag: '🇫🇷' }], '/api/languages.json': [{ code: 'fra', name: 'French' }],
  }
  if (u in api) return send(200, JSON.stringify(api[u]), 'application/json')
  if (u === '/index.m3u') return send(200, '#EXTM3U\n')
  send(404, 'missing', 'text/plain')
})

const channel = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, alt_names: [], country: null, categories: [], languages: [], logo: null, website: null, network: null,
  streams: [{ url: `${base}/live/master.m3u8`, title: name, quality: '720p', labels: [] }], ...extra,
})

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.IPTV_ALLOW_PRIVATE = '1'
  for (const [name, set] of [['iptv-alice', (h: typeof alice) => { alice = h }], ['iptv-bob', (h: typeof bob) => { bob = h }]] as const) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, email, password, role) VALUES ($1, $2, 'x', 'user')
       ON CONFLICT (username) DO UPDATE SET role = 'user' RETURNING id`, [name, `${name}@test.io`])
    if (name === 'iptv-alice') aliceId = rows[0].id
    await query('DELETE FROM iptv_favorites WHERE user_id = $1', [rows[0].id])
    await query('DELETE FROM iptv_history WHERE user_id = $1', [rows[0].id])
    set({ Authorization: `Bearer ${makeToken('user', 'access', rows[0].id)}` })
  }
  await importCatalogue({
    generated_at: new Date().toISOString(), source: 'api',
    channels: [
      channel('TF1.fr', 'TF1', { country: 'FR', categories: ['general'], languages: ['fra'], logo: 'https://img.example/tf1.png', alt_names: ['La Une'] }),
      channel('France24.fr', 'France 24', { country: 'FR', categories: ['news'], languages: ['fra', 'eng'], network: 'France Médias Monde' }),
      channel('BBCNews.uk', 'BBC News', { country: 'GB', categories: ['news'], languages: ['eng'] }),
      channel('Cartoon.us', 'Cartoon 100%', { country: 'US', categories: ['kids'], languages: ['eng'] }),
      channel('stream-abc123', 'Local TV'),
      channel('Php.fr', 'Php TV', { streams: [{ url: `${base}/php/stream.php`, user_agent: 'Agent/7', referrer: 'https://ref.example/page' }] }),
      channel('Geo.fr', 'Geo TV', { streams: [{ url: `${base}/geo.m3u8` }, { url: `${base}/redirect.m3u8` }] }),
      channel('Html.fr', 'Html TV', { streams: [{ url: `${base}/html.m3u8` }] }),
      { ...channel('Empty.fr', 'No streams'), streams: [] },
    ],
    countries: [{ code: 'FR', name: 'France', flag: '🇫🇷', count: 2 }],
    categories: [{ id: 'news', name: 'News', count: 2 }], languages: [{ code: 'fra', name: 'French', count: 2 }],
  })
})
afterAll(async () => {
  server.close()
  delete process.env.IPTV_ALLOW_PRIVATE
  await query(`DELETE FROM iptv_meta WHERE key = 'settings'`)
})

const list = async (qs: string, h = alice) => (await request(app).get(`/api/iptv/channels?${qs}`).set(h)).body.data

describe('IPTV catalogue', () => {
  it('lists real channels (channels without streams left out), logos through the image cache', async () => {
    const all = await list('')
    expect(all.total).toBe(8)
    const tf1 = all.items.find((c: { id: string }) => c.id === 'TF1.fr')
    expect(tf1).toMatchObject({ name: 'TF1', country: 'FR', categories: ['general'], status: 'unknown', favorite: false })
    expect(tf1.logo).toMatch(/^\/api\/images\/remote\?u=/)
    expect(tf1.streams).toEqual([{ quality: '720p', labels: [], title: 'TF1' }])
    expect(JSON.stringify(all)).not.toContain('/live/master.m3u8')        // stream addresses stay on the server
    expect(all.items.find((c: { id: string }) => c.id === 'stream-abc123').logo).toBeNull()
  })

  it('filters by country, category, language, search (name, other names, network); sorts and pages', async () => {
    expect((await list('country=fr')).items.map((c: { id: string }) => c.id)).toEqual(['France24.fr', 'TF1.fr'])
    expect((await list('category=news')).total).toBe(2)
    expect((await list('language=eng')).items.map((c: { id: string }) => c.id)).toEqual(['BBCNews.uk', 'Cartoon.us', 'France24.fr'])
    expect((await list('category=news&language=fra')).items.map((c: { id: string }) => c.id)).toEqual(['France24.fr'])
    expect((await list('q=une')).items.map((c: { id: string }) => c.id)).toEqual(['TF1.fr'])
    expect((await list('q=médias')).items.map((c: { id: string }) => c.id)).toEqual(['France24.fr'])
    expect((await list('q=100%25')).items.map((c: { id: string }) => c.id)).toEqual(['Cartoon.us'])   // % taken literally
    expect((await list('q=%25')).total).toBe(1)
    const desc = await list('sort=-name&limit=2&page=1')
    expect(desc.items.map((c: { name: string }) => c.name)).toEqual(['TF1', 'Php TV'])
    expect((await list('sort=-name&limit=2&page=2')).items.map((c: { name: string }) => c.name)).toEqual(['Local TV', 'Html TV'])
    expect((await list('status=online')).total).toBe(0)                    // nothing checked yet
  })

  it('facets and one channel; unknown ids', async () => {
    const f = (await request(app).get('/api/iptv/facets').set(alice)).body.data
    expect(f.countries[0]).toEqual({ code: 'FR', name: 'France', flag: '🇫🇷', count: 2 })
    const one = (await request(app).get('/api/iptv/channels/TF1.fr').set(alice)).body.data
    expect(one).toMatchObject({ id: 'TF1.fr', guide: [] })                // no guide configured: nothing made up
    expect((await request(app).get('/api/iptv/channels/Nope.fr').set(alice)).status).toBe(404)
    expect((await request(app).get('/api/iptv/channels/..%2Fetc').set(alice)).status).toBe(422)
    expect((await request(app).get('/api/iptv/channels')).status).toBe(401)
  })
})

describe('IPTV favourites and history', () => {
  it('per user: add, order, remove; kept as they are', async () => {
    for (const id of ['TF1.fr', 'BBCNews.uk', 'France24.fr']) expect((await request(app).put(`/api/iptv/favorites/${id}`).set(alice)).status).toBe(200)
    await request(app).put('/api/iptv/favorites/TF1.fr').set(alice)                 // twice: no duplicate
    expect((await request(app).put('/api/iptv/favorites/Nope.fr').set(alice)).status).toBe(404)
    let favs = (await request(app).get('/api/iptv/favorites').set(alice)).body.data
    expect(favs.map((c: { id: string }) => c.id)).toEqual(['TF1.fr', 'BBCNews.uk', 'France24.fr'])
    favs = (await request(app).put('/api/iptv/favorites/order').set(alice).send({ ids: ['France24.fr', 'TF1.fr'] })).body.data
    expect(favs.map((c: { id: string }) => c.id)).toEqual(['France24.fr', 'TF1.fr', 'BBCNews.uk'])
    expect((await list('country=FR')).items.every((c: { favorite: boolean }) => c.favorite)).toBe(true)
    expect((await list('country=FR', bob)).items.some((c: { favorite: boolean }) => c.favorite)).toBe(false)
    await request(app).delete('/api/iptv/favorites/TF1.fr').set(alice)
    favs = (await request(app).get('/api/iptv/favorites').set(alice)).body.data
    expect(favs.map((c: { id: string }) => c.id)).toEqual(['France24.fr', 'BBCNews.uk'])
    expect((await request(app).get('/api/iptv/favorites').set(bob)).body.data).toEqual([])
    expect((await request(app).put('/api/iptv/favorites/order').set(alice).send({ ids: 'x' })).status).toBe(422)
  })

  it('recently watched and « most watched on this server » come from real plays', async () => {
    await request(app).post('/api/iptv/history/BBCNews.uk').set(alice)
    await request(app).post('/api/iptv/history/TF1.fr').set(alice)
    await request(app).post('/api/iptv/history/TF1.fr').set(bob)
    const sum = (await request(app).get('/api/iptv/summary').set(alice)).body.data
    expect(sum.recent.map((c: { id: string }) => c.id)).toEqual(['TF1.fr', 'BBCNews.uk'])
    expect(sum.popular[0].id).toBe('TF1.fr')
    expect(sum).toMatchObject({ total: 8, online: 0, checked: 0 })
    expect(sum.favorites.map((c: { id: string }) => c.id)).toEqual(['France24.fr', 'BBCNews.uk'])
    const { rows } = await query('SELECT plays FROM iptv_history WHERE user_id = $1 AND channel_id = $2', [aliceId, 'TF1.fr'])
    expect(rows[0]).toEqual({ plays: 1 })
  })
})

describe('IPTV settings', () => {
  it('admin only; guide address validated', async () => {
    expect((await request(app).put('/api/iptv/settings').set(alice).send({ hideOffline: true })).status).toBe(403)
    expect((await request(app).put('/api/iptv/settings').set(admin).send({ epgUrl: 'javascript:alert(1)' })).status).toBe(422)
    const s = (await request(app).put('/api/iptv/settings').set(admin).send({ hideOffline: true, autoRefresh: false })).body.data
    expect(s).toEqual({ hideOffline: true, autoRefresh: false, epgUrl: null })
    expect((await request(app).post('/api/iptv/refresh').set(alice)).status).toBe(403)
    await request(app).put('/api/iptv/settings').set(admin).send({ hideOffline: false })
  })
})

describe('IPTV relay (player)', () => {
  const token = () => makeToken('user', 'stream')

  it('rewrites playlists to signed relay addresses, then serves variants, keys and segments', async () => {
    const master = await request(app).get(`/api/iptv/play/TF1.fr/0/index.m3u8?token=${token()}`)
    expect(master.status).toBe(200)
    expect(master.headers['content-type']).toMatch(/mpegurl/)
    const lines = master.text.split('\n')
    expect(lines[2]).toMatch(/^\/api\/iptv\/play\/TF1\.fr\/0\/seg\?u=.+&k=[\w-]{24}&token=/)
    expect(master.text).toMatch(/URI="\/api\/iptv\/play\/TF1\.fr\/0\/seg\?u=[^"]+subs%2Ffr\.m3u8/)
    const variant = await request(app).get(lines[2])
    expect(variant.status).toBe(200)
    expect(variant.text).toMatch(/URI="\/api\/iptv\/play\/TF1\.fr\/0\/seg\?u=[^"]*key\.bin/)
    const segLine = variant.text.split('\n').find((l) => l.includes('seg1.ts'))!
    const seg = await request(app).get(segLine).buffer(true)
    expect(seg.status).toBe(200)
    expect(seg.headers['content-type']).toBe('video/mp2t')
    expect(seg.body.length).toBe(376)
    // An absolute URL of the playlist is relayed too
    expect(variant.text).toContain(encodeURIComponent('https://cdn.example/abs.ts'))
  })

  it('never an open proxy: unsigned or tampered addresses, other channels, no token', async () => {
    const u = encodeURIComponent(`${base}/live/low/seg1.ts`)
    expect((await request(app).get(`/api/iptv/play/TF1.fr/0/seg?u=${u}&k=AAAAAAAAAAAAAAAAAAAAAAAA&token=${token()}`)).status).toBe(403)
    const master = await request(app).get(`/api/iptv/play/TF1.fr/0/index.m3u8?token=${token()}`)
    const signed = master.text.split('\n')[2]
    expect((await request(app).get(signed.replace('/TF1.fr/', '/BBCNews.uk/'))).status).toBe(403)       // signature bound to the channel
    expect((await request(app).get(signed.replace(/&token=[^&]+/, ''))).status).toBe(401)
    expect((await request(app).get('/api/iptv/play/TF1.fr/9/index.m3u8').query({ token: token() })).status).toBe(404)
    delete process.env.IPTV_ALLOW_PRIVATE
    const local = await request(app).get(`/api/iptv/play/TF1.fr/0/index.m3u8?token=${token()}`)
    expect(local.status).toBe(502)
    expect(local.body.error).toMatch(/adresse locale refusée/)
    process.env.IPTV_ALLOW_PRIVATE = '1'
  })

  it('sends the catalogue Referer / User-Agent; playlists without .m3u8; errors explained; redirects followed', async () => {
    hits.length = 0
    const php = await request(app).get(`/api/iptv/play/Php.fr/0/index.m3u8?token=${token()}`)
    expect(php.status).toBe(200)
    expect(php.text).toContain('/api/iptv/play/Php.fr/0/seg?u=')
    expect(hits[0]).toMatchObject({ ua: 'Agent/7', referer: 'https://ref.example/page' })
    const geo = await request(app).get(`/api/iptv/play/Geo.fr/0/index.m3u8?token=${token()}`)
    expect(geo.status).toBe(502)
    expect(geo.body.error).toMatch(/géo-bloqué/)
    const redirected = await request(app).get(`/api/iptv/play/Geo.fr/1/index.m3u8?token=${token()}`)
    expect(redirected.status).toBe(200)
    expect(redirected.text).toContain(encodeURIComponent(`${base}/live/low/index.m3u8`))   // resolved against the final address
    // A .m3u8 address answering a web page (portal, block page): said so, not passed on
    const html = await request(app).get(`/api/iptv/play/Html.fr/0/index.m3u8?token=${token()}`)
    expect(html.status).toBe(502)
    expect(html.body.error).toMatch(/pas une playlist HLS/)
  })

  it('rewritePlaylist keeps comments, data: keys and blank lines', () => {
    const out = rewritePlaylist('#EXTM3U\n\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AA"\n#EXTINF:4,\na.ts', 'https://h.example/x/i.m3u8', (a) => `R(${a})`)
    expect(out).toBe('#EXTM3U\n\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AA"\n#EXTINF:4,\nR(https://h.example/x/a.ts)')
  })
})

describe('IPTV with the Python module', () => {
  it('checks a channel for real (online / offline with the reason)', async () => {
    const tf1 = await checkChannel(aliceId, 'TF1.fr')
    expect(tf1).toMatchObject({ status: 'online', statusReason: null })
    expect(tf1.checkedAt).toBeTruthy()
    const geo = await checkChannel(aliceId, 'Html.fr')
    expect(geo.status).toBe('offline')
    expect(geo.statusReason).toMatch(/playlist/)
    expect((await list('status=online')).items.map((c: { id: string }) => c.id)).toEqual(['TF1.fr'])
  }, 60_000)

  it('refresh downloads the iptv-org files, builds and imports the catalogue (favourites kept)', async () => {
    process.env.IPTV_API_BASE = `${base}/api`
    process.env.IPTV_PLAYLIST_URL = `${base}/index.m3u`
    process.env.IPTV_DATA_DIR = `/tmp/nexus-iptv-test-${process.pid}`
    try {
      const state = await refreshCatalogue()
      expect(state).toMatchObject({ ok: true, source: 'api' })
      expect(state.stats).toMatchObject({ channels: 1, imported: 1 })
      expect((await list('')).items.map((c: { id: string }) => c.id)).toEqual(['Remote.fr'])
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM iptv_favorites WHERE user_id = $1', [aliceId])
      expect(rows[0].n).toBe(2)                       // kept even while their channels are gone
      expect((await request(app).get('/api/iptv/favorites').set(alice)).body.data).toEqual([])
    } finally {
      delete process.env.IPTV_API_BASE; delete process.env.IPTV_PLAYLIST_URL; delete process.env.IPTV_DATA_DIR
    }
  }, 120_000)
})
