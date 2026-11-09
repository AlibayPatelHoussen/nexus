import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { AddressInfo } from 'net'
import { execFileSync } from 'child_process'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { makeToken } from '../helpers'
import { checkChannel, checkDueChannels, importCatalogue, refreshCatalogue } from '../../src/services/iptv'
import { dropSoundOnlyVariants, rewritePlaylist } from '../../src/services/iptvProxy'
import { convertJobs, stopConversions } from '../../src/services/iptvConvert'

/*
 * IPTV: catalogue queries and filters, favourites / history per user, settings, the stream
 * relay (against a local fake IPTV server), and the Python module driven by the server.
 * Then the second source (Free-TV): its selection and the priority countries first, the stream
 * a check found working, and the lives given as a web page (YouTube…), looked up by a stand-in
 * for yt-dlp.
 * Last: a stream that plays with sound only (MPEG-2 video, a radio), its picture converted by
 * ffmpeg through the relay.
 */

let alice = { Authorization: '' }, bob = { Authorization: '' }
let aliceId = ''
const admin = { Authorization: `Bearer ${makeToken('admin')}` }

// ─── A local fake IPTV server ────────────────────────────────────────────────
const hits: { path: string; ua?: string; referer?: string }[] = []
let base = ''
/** Streams generated with ffmpeg for the conversion tests, served under /gen/ */
const genDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-iptv-gen-'))
const server = http.createServer((req, res) => {
  hits.push({ path: req.url!, ua: req.headers['user-agent'], referer: req.headers.referer })
  const u = req.url!.split('?')[0]
  const send = (code: number, body: string | Buffer, type = 'application/vnd.apple.mpegurl') => { res.writeHead(code, { 'Content-Type': type }); res.end(body) }
  if (u === '/live/master.m3u8') return send(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs/fr.m3u8"\n')
  if (u === '/live/low/index.m3u8') return send(200, '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nhttps://cdn.example/abs.ts\n')
  if (u === '/live/low/seg1.ts') return send(200, Buffer.alloc(376, 0x47), 'video/mp2t')
  if (u === '/redirect.m3u8') { res.writeHead(302, { Location: '/live/master.m3u8' }); return res.end() }
  // A sound-only variant listed first, as many broadcasters do for slow networks
  if (u === '/live/sound-first.m3u8') return send(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"\naudio/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n')
  if (u === '/php/stream.php') return send(200, '#EXTM3U\n#EXTINF:6,\nseg.ts\n', 'text/plain')
  if (u === '/geo.m3u8') return send(403, 'no')
  if (u === '/html.m3u8') return send(200, '<html>nope</html>', 'text/html')
  if (u === '/portal') return send(200, '<!doctype html><html><body>Regardez le direct</body></html>', 'text/html; charset=utf-8')
  if (u === '/manifest') return send(200, '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"></MPD>', 'application/dash+xml')
  if (u === '/freetv.m3u8') return send(200, [
    '#EXTM3U',
    '#EXTINF:-1 tvg-name="Remote TV" tvg-id="Remote.fr" tvg-country="FR" group-title="France",Remote TV Ⓖ',
    `${base}/redirect.m3u8`,
    '#EXTINF:-1 tvg-name="Tele Libre" tvg-country="FR" group-title="France",Télé Libre Ⓨ',
    'https://www.youtube.com/c/TeleLibre/live',
    '#EXTINF:-1 tvg-name="Dash TV" tvg-country="FR" group-title="France",Dash TV',
    `${base}/dash/manifest.mpd`,
  ].join('\n'))
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
  if (u.startsWith('/gen/') && !u.includes('..') && fs.existsSync(path.join(genDir, u.slice(5)))) {
    return send(200, fs.readFileSync(path.join(genDir, u.slice(5))), u.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
  }
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
      channel('stream-abc123', 'Local TV', { streams: [{ url: `${base}/live/master.m3u8` }, { url: `${base}/live/sound-first.m3u8` }] }),
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
    expect(tf1.streams).toEqual([{ quality: '720p', labels: [], title: 'TF1', kind: 'hls', source: 'iptv-org', page: null }])
    expect(tf1).toMatchObject({ curated: false, bestStream: null })
    expect(JSON.stringify(all)).not.toContain('/live/master.m3u8')        // stream addresses stay on the server
    expect(all.items.find((c: { id: string }) => c.id === 'stream-abc123').logo).toBeNull()
  })

  it('filters by country, category, language, search (name, other names, network); sorts and pages', async () => {
    expect((await list('country=fr')).items.map((c: { id: string }) => c.id)).toEqual(['France24.fr', 'TF1.fr'])
    expect((await list('category=news')).total).toBe(2)
    // Default order: the priority countries (CA, FR, MG, US) first; by name on request
    expect((await list('language=eng')).items.map((c: { id: string }) => c.id)).toEqual(['France24.fr', 'Cartoon.us', 'BBCNews.uk'])
    expect((await list('language=eng&sort=name')).items.map((c: { id: string }) => c.id)).toEqual(['BBCNews.uk', 'Cartoon.us', 'France24.fr'])
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
  it('admin only; guide address and priority countries validated', async () => {
    expect((await request(app).put('/api/iptv/settings').set(alice).send({ hideOffline: true })).status).toBe(403)
    expect((await request(app).put('/api/iptv/settings').set(admin).send({ epgUrl: 'javascript:alert(1)' })).status).toBe(422)
    const s = (await request(app).put('/api/iptv/settings').set(admin).send({ hideOffline: true, autoRefresh: false })).body.data
    expect(s).toEqual({ hideOffline: true, autoRefresh: false, epgUrl: null, priorityCountries: ['CA', 'FR', 'MG', 'US'] })
    expect((await request(app).post('/api/iptv/refresh').set(alice)).status).toBe(403)
    // Priority countries: typed as text or sent as a list, two-letter codes, no duplicate
    const typed = (await request(app).put('/api/iptv/settings').set(admin).send({ priorityCountries: 'be, ch;fr  BE' })).body.data
    expect(typed.priorityCountries).toEqual(['BE', 'CH', 'FR'])
    for (const bad of ['france', ['F1'], 42, Array.from({ length: 13 }, (_, i) => `A${String.fromCharCode(65 + i)}`)]) {
      expect((await request(app).put('/api/iptv/settings').set(admin).send({ priorityCountries: bad })).status).toBe(422)
    }
    const back = (await request(app).put('/api/iptv/settings').set(admin).send({ hideOffline: false, priorityCountries: ['ca', 'fr', 'mg', 'us'] })).body.data
    expect(back).toMatchObject({ hideOffline: false, priorityCountries: ['CA', 'FR', 'MG', 'US'] })
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

  it('leaves the sound-only variants out of a playlist of qualities (a player may start on one and never show the picture)', async () => {
    const inf = (attrs: string, uri: string) => `#EXT-X-STREAM-INF:${attrs}\n${uri}`
    const list = (...v: string[]) => ['#EXTM3U', ...v].join('\n')
    const audio = inf('BANDWIDTH=64000,CODECS="mp4a.40.2"', 'audio.m3u8')
    const sd = inf('AVERAGE-BANDWIDTH=700000,BANDWIDTH=800000,RESOLUTION=640x360', 'sd.m3u8')
    const hd = inf('BANDWIDTH=2500000,CODECS="avc1.64001f,mp4a.40.2"', 'hd.m3u8')
    // Announced as sound only, next to variants with a picture (or that say nothing)
    expect(dropSoundOnlyVariants(list(audio, sd, hd))).toBe(list(sd, hd))
    expect(dropSoundOnlyVariants(list(sd, audio, inf('BANDWIDTH=900000', 'x.m3u8')))).toBe(list(sd, inf('BANDWIDTH=900000', 'x.m3u8')))
    // Says nothing, under the bitrate of every variant that announces a picture
    expect(dropSoundOnlyVariants(list(inf('BANDWIDTH=96000', 'a.m3u8'), sd))).toBe(list(sd))
    // Nothing announced anywhere: a bitrate only sound fits in, next to a much larger one
    expect(dropSoundOnlyVariants(list(inf('BANDWIDTH=64000', 'a.m3u8'), inf('BANDWIDTH=1200000', 'v.m3u8')))).toBe(list(inf('BANDWIDTH=1200000', 'v.m3u8')))
    // Kept: a radio (sound-only variants only), variants that may all have a picture, a single variant, a media playlist
    for (const kept of [
      list(audio, inf('BANDWIDTH=128000,CODECS="mp4a.40.2"', 'audio-hi.m3u8')),
      list(inf('BANDWIDTH=300000', 'a.m3u8'), inf('BANDWIDTH=500000', 'b.m3u8')),
      list(audio),
      '#EXTM3U\n#EXTINF:6,\nseg1.ts\n',
    ]) expect(dropSoundOnlyVariants(kept)).toBe(kept)
    // Its tags go with it; the alternate audio of the other variants stays
    const media = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="fr",URI="fr.m3u8"'
    expect(dropSoundOnlyVariants(list(media, audio, inf('BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="a"', 'sd.m3u8'))))
      .toBe(list(media, inf('BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="a"', 'sd.m3u8')))
    // Through the relay
    const master = await request(app).get(`/api/iptv/play/stream-abc123/1/index.m3u8?token=${token()}`)
    expect(master.status).toBe(200)
    expect(master.text).not.toContain('audio%2Findex.m3u8')
    expect(master.text).toContain('low%2Findex.m3u8')
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
    process.env.IPTV_FREETV_URL = 'off'             // never the real Free-TV playlist in a test
    try {
      const state = await refreshCatalogue()
      expect(state).toMatchObject({ ok: true, source: 'api', sources: ['iptv-org'] })
      expect(state.stats).toMatchObject({ channels: 1, imported: 1 })
      expect((await list('')).items.map((c: { id: string }) => c.id)).toEqual(['Remote.fr'])
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM iptv_favorites WHERE user_id = $1', [aliceId])
      expect(rows[0].n).toBe(2)                       // kept even while their channels are gone
      expect((await request(app).get('/api/iptv/favorites').set(alice)).body.data).toEqual([])

      // With Free-TV: its streams first on the channels iptv-org knows, its own channels added
      // (a YouTube live kept as a « page » stream), DASH streams left out
      process.env.IPTV_FREETV_URL = `${base}/freetv.m3u8`
      const both = await refreshCatalogue()
      expect(both).toMatchObject({ ok: true, source: 'api', sources: ['iptv-org', 'free-tv'] })
      expect(both.stats).toMatchObject({ channels: 2, freetv_matched: 1, freetv_added: 1, freetv_dash: 1, freetv_pages: 1 })
      const items = (await list('sort=name')).items
      expect(items.map((c: { name: string }) => c.name)).toEqual(['Remote TV', 'Télé Libre'])
      expect(items[0]).toMatchObject({ id: 'Remote.fr', curated: true, labels: [] })    // one of its streams is not geo-blocked
      expect(items[0].streams.map((x: { source: string; labels: string[] }) => [x.source, x.labels])).toEqual([['free-tv', ['Geo-blocked']], ['iptv-org', []]])
      expect(items[1]).toMatchObject({ country: 'FR', curated: true })
      expect(items[1].streams).toEqual([{ quality: null, labels: [], title: 'Télé Libre', kind: 'page', source: 'free-tv', page: 'https://www.youtube.com/c/TeleLibre/live' }])
    } finally {
      delete process.env.IPTV_API_BASE; delete process.env.IPTV_PLAYLIST_URL; delete process.env.IPTV_DATA_DIR; delete process.env.IPTV_FREETV_URL
    }
  }, 180_000)
})

describe('IPTV second source (Free-TV), priority countries, web pages', () => {
  const token = () => makeToken('user', 'stream')
  const ids = (items: { id: string }[]) => items.map((c) => c.id)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-iptv-ytdlp-'))
  const calls = path.join(tmp, 'calls.log')
  const YT = 'https://www.youtube.com/c/NexusTest/live'
  const TWITCH = 'https://www.twitch.tv/nexusoffline'
  const NO_TOOL = 'https://www.dailymotion.com/video/x8nexus'
  const page = (url: string, title: string) => ({ url, kind: 'page', source: 'free-tv', title, labels: [] })

  beforeAll(async () => {
    // A stand-in for yt-dlp: answers like `yt-dlp -J <page>` and notes every call
    const script = path.join(tmp, 'fake-ytdlp.py')
    fs.writeFileSync(script, [
      'import json, sys',
      'url = sys.argv[-1]',
      `open(${JSON.stringify(calls)}, 'a').write(url + '\\n')`,
      "if 'offline' in url:",
      "    sys.stderr.write('ERROR: [twitch:stream] nexusoffline: The channel is not currently live\\n')",
      '    sys.exit(1)',
      `stream = ${JSON.stringify(`${base}/live/master.m3u8`)}`,
      "print(json.dumps({'title': 'Live', 'formats': [{'protocol': 'm3u8_native', 'url': stream, 'manifest_url': stream, 'height': 720,",
      "                  'http_headers': {'User-Agent': 'YT/1', 'Referer': 'https://www.youtube.com/'}}]}))",
    ].join('\n'))
    process.env.IPTV_YTDLP = `python3 ${script}`
    await importCatalogue({
      generated_at: new Date().toISOString(), source: 'api', sources: ['iptv-org', 'free-tv'],
      channels: [
        channel('Cbc.ca', 'CBC', { country: 'CA', curated: 5 }),
        channel('Alpha.ca', 'Alpha CA', { country: 'CA' }),
        channel('Zed.fr', 'Zed TV', { country: 'FR', curated: 1 }),
        channel('Alpha.fr', 'Alpha TV', { country: 'FR', curated: 2 }),
        channel('Beta.fr', 'Élan TV', { country: 'FR' }),       // ordered with the E, whatever the database collation
        channel('Usa.us', 'USA Live', { country: 'US', curated: 9 }),
        channel('Aaa.de', 'Aaa DE', { country: 'DE', curated: 3 }),
        channel('Bbb.de', 'Bbb DE', { country: 'DE' }),
        // Not in a priority country, no place in the selection: after everything above
        channel('Fallback.tv', 'Fallback TV', { streams: [{ url: `${base}/geo.m3u8` }, { url: `${base}/redirect.m3u8`, source: 'free-tv' }] }),
        channel('Portal.tv', 'Portal TV', { streams: [{ url: `${base}/portal` }] }),
        channel('Dash.tv', 'Dash TV', { streams: [{ url: `${base}/manifest` }] }),
        channel('Yt.tv', 'YT Live', { streams: [{ url: `${base}/geo.m3u8` }, page(YT, 'YT Live')] }),
        channel('Twitch.tv', 'Twitch Live', { streams: [page(TWITCH, 'Twitch Live')] }),
        channel('NoTool.tv', 'No Tool', { streams: [page(NO_TOOL, 'No Tool')] }),
        channel('Many.tv', 'Many streams', {
          streams: [...Array.from({ length: 12 }, (_, i) => ({ url: `${base}/live/master.m3u8?n=${i}` })),
            page('https://www.youtube.com/c/One/live', 'One'), page('https://www.youtube.com/c/Two/live', 'Two'), page('https://www.youtube.com/c/Three/live', 'Three')],
        }),
      ],
      countries: [
        { code: 'US', name: 'United States', flag: '🇺🇸', count: 1 }, { code: 'DE', name: 'Germany', flag: '🇩🇪', count: 2 },
        { code: 'FR', name: 'France', flag: '🇫🇷', count: 3 }, { code: 'CA', name: 'Canada', flag: '🇨🇦', count: 2 },
      ],
      categories: [], languages: [],
    })
  })
  afterAll(() => {
    delete process.env.IPTV_YTDLP
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('orders channels: priority countries and the Free-TV selection first; by name on request', async () => {
    expect(ids((await list('limit=7')).items)).toEqual(['Cbc.ca', 'Zed.fr', 'Alpha.fr', 'Usa.us', 'Alpha.ca', 'Beta.fr', 'Aaa.de'])
    expect(ids((await list('country=FR')).items)).toEqual(['Zed.fr', 'Alpha.fr', 'Beta.fr'])          // the selection in its own order
    expect(ids((await list('country=FR&sort=name')).items)).toEqual(['Alpha.fr', 'Beta.fr', 'Zed.fr'])
    expect(ids((await list('sort=name&limit=3')).items)).toEqual(['Aaa.de', 'Alpha.ca', 'Alpha.fr'])
    const all = await list('')
    expect(all.total).toBe(15)
    expect(all.items.find((c: { id: string }) => c.id === 'Zed.fr')).toMatchObject({ curated: true, bestStream: null })
    expect(all.items.find((c: { id: string }) => c.id === 'Beta.fr').curated).toBe(false)
    // The owner chooses the countries
    await request(app).put('/api/iptv/settings').set(admin).send({ priorityCountries: 'de, fr' })
    expect(ids((await list('limit=7')).items)).toEqual(['Aaa.de', 'Zed.fr', 'Alpha.fr', 'Bbb.de', 'Beta.fr', 'Cbc.ca', 'Usa.us'])
    await request(app).put('/api/iptv/settings').set(admin).send({ priorityCountries: ['CA', 'FR', 'MG', 'US'] })
  })

  it('home: one shelf per priority country, a country without any channel said as such', async () => {
    const sum = (await request(app).get('/api/iptv/summary').set(alice)).body.data
    expect(sum.priority.map((p: { code: string; count: number }) => [p.code, p.count])).toEqual([['CA', 2], ['FR', 3], ['MG', 0], ['US', 1]])
    expect(sum.priority[0]).toMatchObject({ name: 'Canada', flag: '🇨🇦' })
    expect(ids(sum.priority[0].items)).toEqual(['Cbc.ca', 'Alpha.ca'])
    expect(ids(sum.priority[1].items)).toEqual(['Zed.fr', 'Alpha.fr', 'Beta.fr'])
    expect(sum.priority[2]).toEqual({ code: 'MG', name: null, flag: null, count: 0, items: [] })    // nothing made up
    expect(sum.countries.map((c: { code: string }) => c.code)).toEqual(['CA', 'FR', 'US', 'DE'])
    expect(sum.refresh.sources).toBeDefined()
  })

  it('keeps ten streams per channel, web pages included; only a page address is shown', async () => {
    const many = (await request(app).get('/api/iptv/channels/Many.tv').set(alice)).body.data
    expect(many.streams.map((x: { kind: string }) => x.kind)).toEqual([...Array(8).fill('hls'), 'page', 'page'])
    expect(many.streams[9].page).toBe('https://www.youtube.com/c/Two/live')
    const yt = (await request(app).get('/api/iptv/channels/Yt.tv').set(alice)).body.data
    expect(yt.streams).toEqual([
      { quality: null, labels: [], title: null, kind: 'hls', source: 'iptv-org', page: null },
      { quality: null, labels: [], title: 'YT Live', kind: 'page', source: 'free-tv', page: YT },
    ])
    expect(JSON.stringify(yt)).not.toContain('/geo.m3u8')
  })

  it('refuses a channel address answering a web page or a DASH manifest, with the reason', async () => {
    const portal = await request(app).get(`/api/iptv/play/Portal.tv/0/index.m3u8?token=${token()}`)
    expect(portal.status).toBe(502)
    expect(portal.body.error).toMatch(/page web/)
    const dash = await request(app).get(`/api/iptv/play/Dash.tv/0/index.m3u8?token=${token()}`)
    expect(dash.status).toBe(502)
    expect(dash.body.error).toMatch(/DASH/)
  })

  it('a check remembers the stream that works: the player starts there', async () => {
    const ch = await checkChannel(aliceId, 'Fallback.tv')
    expect(ch).toMatchObject({ status: 'online', statusReason: null, bestStream: 1 })
    const dead = await checkChannel(aliceId, 'Portal.tv')
    expect(dead).toMatchObject({ status: 'offline', bestStream: null })
    expect(dead.statusReason).toMatch(/page web/)
    expect((await checkChannel(aliceId, 'Dash.tv')).statusReason).toMatch(/DASH/)
  }, 60_000)

  it('plays a live given as a web page: looked up by yt-dlp once, relayed with its headers', async () => {
    hits.length = 0
    const first = await request(app).get(`/api/iptv/play/Yt.tv/1/index.m3u8?token=${token()}`)
    expect(first.status).toBe(200)
    expect(first.text).toContain('/api/iptv/play/Yt.tv/1/seg?u=')
    expect(first.text).not.toContain('youtube.com')
    expect(hits[0]).toMatchObject({ path: '/live/master.m3u8', ua: 'YT/1', referer: 'https://www.youtube.com/' })
    // Variants and segments go out with the headers yt-dlp gave, without another look-up
    hits.length = 0
    const variant = await request(app).get(first.text.split('\n')[2])
    expect(variant.status).toBe(200)
    expect(hits[0]).toMatchObject({ path: '/live/low/index.m3u8', ua: 'YT/1' })
    expect((await request(app).get(`/api/iptv/play/Yt.tv/1/index.m3u8?token=${token()}`)).status).toBe(200)
    expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toEqual([YT])
    // Checked the same way: the page's stream is the one that works on this channel
    expect(await checkChannel(aliceId, 'Yt.tv')).toMatchObject({ status: 'online', bestStream: 1 })
  }, 60_000)

  it('says why a web page cannot be played: no live at the moment, yt-dlp not installed', async () => {
    const off = await request(app).get(`/api/iptv/play/Twitch.tv/0/index.m3u8?token=${token()}`)
    expect(off.status).toBe(502)
    expect(off.body.error).toBe('Direct indisponible (pas de direct en cours)')
    const before = fs.readFileSync(calls, 'utf8')
    expect((await request(app).get(`/api/iptv/play/Twitch.tv/0/index.m3u8?token=${token()}`)).body.error).toMatch(/pas de direct en cours/)
    expect(fs.readFileSync(calls, 'utf8')).toBe(before)             // a failure is not looked up again at once
    expect(await checkChannel(aliceId, 'Twitch.tv')).toMatchObject({ status: 'offline', statusReason: 'pas de direct en cours' })

    process.env.IPTV_YTDLP = path.join(tmp, 'no-such-yt-dlp')
    const missing = await request(app).get(`/api/iptv/play/NoTool.tv/0/index.m3u8?token=${token()}`)
    expect(missing.status).toBe(502)
    expect(missing.body.error).toMatch(/yt-dlp n’est pas installé/)
    // Nothing is known about such a channel: « unknown », not « offline »
    const unknown = await checkChannel(aliceId, 'NoTool.tv')
    expect(unknown.status).toBe('unknown')
    expect(unknown.statusReason).toMatch(/yt-dlp/)
    expect(unknown.checkedAt).toBeTruthy()
  }, 60_000)

  it('background checks start with the selection of the priority countries', async () => {
    await query(`UPDATE iptv_channels SET checked_at = NULL, status = 'unknown', status_reason = NULL, best_stream = NULL`)
    expect(await checkDueChannels(3)).toBe(3)
    const { rows } = await query<{ id: string }>(`SELECT id FROM iptv_channels WHERE checked_at IS NOT NULL ORDER BY id`)
    expect(rows.map((r) => r.id)).toEqual(['Alpha.fr', 'Cbc.ca', 'Zed.fr'])
    // Verified channels come first in their country
    await query(`UPDATE iptv_channels SET status = 'online', checked_at = NOW() WHERE id = 'Beta.fr'`)
    await query(`UPDATE iptv_channels SET status = 'offline' WHERE id = 'Zed.fr'`)
    expect(ids((await list('country=FR')).items)).toEqual(['Alpha.fr', 'Beta.fr', 'Zed.fr'])
  }, 120_000)
})

// Real ffmpeg is required: skipped (with a notice) on machines without it
let hasFfmpeg = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { hasFfmpeg = false }
if (!hasFfmpeg) console.warn('ffmpeg not installed: IPTV conversion tests skipped')

;(hasFfmpeg ? describe : describe.skip)('IPTV stream with sound only: its picture converted by the server', () => {
  const token = () => makeToken('user', 'stream')
  let listener: http.Server

  beforeAll(async () => {
    const hls = (name: string, args: string[]) => {
      fs.mkdirSync(path.join(genDir, name), { recursive: true })
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod', path.join(genDir, name, 'index.m3u8')])
    }
    const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440']
    // What an old broadcast encoder sends (a browser plays its sound, not its picture), and a radio
    hls('old', ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', ...tone, '-t', '12', '-c:v', 'mpeg2video', '-b:v', '600k', '-g', '12', '-c:a', 'mp2', '-b:a', '96k'])
    hls('radio', [...tone, '-t', '8', '-c:a', 'aac', '-b:a', '64k'])
    // ffmpeg reads the stream through the relay: the server must be listening
    listener = app.listen(0, '127.0.0.1')
    await new Promise<void>((r) => listener.once('listening', () => r()))
    process.env.NEXUS_INTERNAL_URL = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
    await importCatalogue({
      generated_at: new Date().toISOString(), source: 'api',
      channels: [
        channel('Old.fr', 'Vieux Format', { streams: [{ url: `${base}/gen/old/index.m3u8` }] }),
        channel('Radio.fr', 'Radio Test', { streams: [{ url: `${base}/gen/radio/index.m3u8` }] }),
        channel('Gone.fr', 'Parti', { streams: [{ url: `${base}/gen/missing/index.m3u8` }] }),
      ],
      countries: [], categories: [], languages: [],
    })
  }, 120_000)
  afterAll(() => {
    stopConversions()
    listener?.close()
    delete process.env.NEXUS_INTERNAL_URL
    fs.rmSync(genDir, { recursive: true, force: true })
  })

  it('MPEG-2 video is converted to H.264: a playlist and segments the browser reads', async () => {
    const res = await request(app).post('/api/iptv/play/Old.fr/0/convert').set(alice)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ video: 'mpeg2video', audio: 'mp2', convert: true, reason: null })
    const list = await request(app).get(`/api/iptv/play/Old.fr/0/converted/index.m3u8?token=${token()}`)
    expect(list.status).toBe(200)
    expect(list.headers['content-type']).toMatch(/mpegurl/)
    const line = list.text.split('\n').find((l) => /^seg\d+\.ts\?token=/.test(l))!
    expect(line).toBeTruthy()
    const seg = await request(app).get(`/api/iptv/play/Old.fr/0/converted/${line}`).buffer(true)
    expect(seg.status).toBe(200)
    expect(seg.headers['content-type']).toBe('video/mp2t')
    const file = path.join(genDir, 'converted.ts')
    fs.writeFileSync(file, seg.body)
    const codecs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]).toString().trim().split(/\s+/)
    expect([...new Set(codecs)].sort()).toEqual(['aac', 'h264'])
    // One conversion per stream, shared by its viewers
    expect((await request(app).post('/api/iptv/play/Old.fr/0/convert').set(bob)).body.data.convert).toBe(true)
    expect(convertJobs()).toEqual(['Old.fr|0'])
  }, 120_000)

  it('?probe=1 only says what the stream holds: nothing is started', async () => {
    stopConversions()
    const res = await request(app).post('/api/iptv/play/Old.fr/0/convert?probe=1').set(alice)
    expect(res.body.data).toEqual({ video: 'mpeg2video', audio: 'mp2', convert: false, reason: null })
    expect(convertJobs()).toEqual([])
    expect((await request(app).post('/api/iptv/play/Old.fr/0/convert').set(alice)).body.data.convert).toBe(true)
  }, 120_000)

  it('a stream without any picture is a radio: nothing to convert', async () => {
    const res = await request(app).post('/api/iptv/play/Radio.fr/0/convert').set(alice)
    expect(res.body.data).toEqual({ video: null, audio: 'aac', convert: false, reason: 'audio' })
    expect(convertJobs()).toEqual(['Old.fr|0'])
  }, 60_000)

  it('says when the stream cannot be read; needs a session; a stopped conversion says so', async () => {
    expect((await request(app).post('/api/iptv/play/Gone.fr/0/convert').set(alice)).body.data).toMatchObject({ convert: false, reason: 'unreadable' })
    expect((await request(app).post('/api/iptv/play/Old.fr/0/convert')).status).toBe(401)
    expect((await request(app).post('/api/iptv/play/Old.fr/7/convert').set(alice)).status).toBe(404)
    expect((await request(app).get('/api/iptv/play/Old.fr/0/converted/index.m3u8')).status).toBe(401)
    expect((await request(app).get(`/api/iptv/play/Old.fr/0/converted/..%2Findex.m3u8?token=${token()}`)).status).toBe(404)
    stopConversions()
    expect((await request(app).get(`/api/iptv/play/Old.fr/0/converted/index.m3u8?token=${token()}`)).status).toBe(410)
    expect((await request(app).get(`/api/iptv/play/Old.fr/0/converted/seg000000.ts?token=${token()}`)).status).toBe(410)
  }, 60_000)
})
