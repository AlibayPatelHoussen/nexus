import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import { signedImage } from '../../src/services/images'
import {
  requeueInterrupted, setDownloadsNamespace, startDownloadWorker, stopDownloadWorker,
} from '../../src/services/downloads'
import { checkDueFollows } from '../../src/services/follows'
import { makeToken } from '../helpers'

/**
 * The real scripts need the internet: these tests use fake scripts that speak
 * the same JSON Lines protocol (search, details, download, errors, slow jobs).
 */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-downloaders-'))
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-downloads-out-'))
const ARGS_LOG = path.join(DIR, 'args.log')

const FAKE = `
import json, sys, time, os
args = sys.argv[1:]
name = os.path.basename(sys.argv[0]).split('.')[0]
with open(${JSON.stringify(ARGS_LOG)}, 'a') as f:
    f.write(json.dumps([name] + args) + "\\n")
def out(**o):
    print(json.dumps(o), flush=True)
def arg(k):
    return args[args.index(k) + 1] if k in args else None
print("human message on stderr", file=sys.stderr)
if '--search' in args:
    q = arg('--search')
    if name == 'films':
        time.sleep(30)                      # never answers in time
    if name == 'movix':
        sys.exit(3)                         # crashes
    if name == 'anisama':
        out(type='result', id='anisama:anime:one-piece', kind='anime', title='One Piece', poster_url='https://cdn.example/op.jpg')
        out(type='result', id='anisama:manga:one-piece', kind='manga', title='One Piece', poster_url='https://cdn.example/op.jpg')
    if name == 'youtube':
        out(type='result', id='youtube:dQw4w9WgXcQ', kind='youtube', title=q, thumbnail_url='https://i.ytimg.com/vi/x/hq.jpg', duration=212)
    out(type='done')
elif '--details' in args:
    try:
        count = int(open(os.path.join(os.path.dirname(sys.argv[0]), 'count.txt')).read())
    except Exception:
        count = 2
    out(type='details', id=arg('--details'), kind='manga', title='One Piece', poster_url='https://cdn.example/op.jpg',
        langs=[{'lang': 'VF', 'chapters': [{'n': n, 'pages': 20, 'downloaded': n == 1} for n in range(1, count + 1)]}])
    out(type='done')
elif '--download' in args:
    ident = arg('--download')
    dest = arg('--dest')
    if 'slow' in ident:
        out(type='item_start', name='Lent', index=1, total=1)
        for i in range(600):
            out(type='progress', item='Lent', percent=i / 6)
            time.sleep(0.1)
    if 'fail' in ident:
        out(type='item_start', name='Episode 1', index=1, total=1)
        out(type='error', message='Aucune source', item='Episode 1', fatal=False)
        out(type='done', ok=0, failed=1, skipped=0)
        sys.exit(2)
    out(type='item_start', name='Chapitre 1', index=1, total=2)
    out(type='progress', item='Chapitre 1', chapter=1, chapters_total=2, page=10, pages_total=20)
    p = os.path.join(dest, 'Chapitre 1.pdf')
    os.makedirs(dest, exist_ok=True); open(p, 'w').write('x')
    out(type='item_done', name='Chapitre 1', path=p)
    out(type='item_skipped', name='Chapitre 2', reason='exists', path=os.path.join(dest, 'Chapitre 2.pdf'))
    out(type='done', ok=1, failed=0, skipped=1)
`

const emitted: { event: string; payload: Record<string, unknown>; room?: string }[] = []
const fakeNs = {
  emit: (event: string, payload: Record<string, unknown>) => { emitted.push({ event, payload }) },
  to: (room: string) => ({ emit: (event: string, payload: Record<string, unknown>) => { emitted.push({ event, payload, room }) } }),
}

let adminId = ''
let admin: Record<string, string> = {}
const user = { Authorization: `Bearer ${makeToken('user')}` }

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 15000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 150))
  }
}
const statusOf = async (id: string) =>
  (await query<{ status: string }>('SELECT status FROM downloads WHERE id = $1', [id])).rows[0]?.status

beforeAll(async () => {
  for (const f of ['anisama', 'films', 'movix', 'youtube']) fs.writeFileSync(path.join(DIR, `${f}.py`), FAKE)
  process.env.DOWNLOADERS_DIR = DIR
  process.env.MANGA_PATH = path.join(OUT, 'scans')
  process.env.DOWNLOADS_SEARCH_TIMEOUT_MS = '3000'
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (username, email, password, role) VALUES ('dl-admin', 'dl@test.io', 'x', 'admin')
     ON CONFLICT (username) DO UPDATE SET role = 'admin' RETURNING id`)
  adminId = rows[0].id
  admin = { Authorization: `Bearer ${makeToken('admin', 'access', adminId)}` }
  await query('DELETE FROM downloads')
  setDownloadsNamespace(fakeNs as never)
  await startDownloadWorker()
})

afterAll(async () => {
  await stopDownloadWorker()
  await new Promise((r) => setTimeout(r, 300))
})

describe('Downloads: access', () => {
  it('needs a token and an admin', async () => {
    expect((await request(app).get('/api/downloads')).status).toBe(401)
    expect((await request(app).get('/api/downloads').set(user)).status).toBe(403)
    expect((await request(app).post('/api/downloads/search').set(user).send({ query: 'x' })).status).toBe(403)
  })
})

describe('Downloads: unified search', () => {
  it('runs the four scripts in parallel and streams results; a slow or broken script does not block the others', async () => {
    emitted.length = 0
    const res = await request(app).post('/api/downloads/search').set(admin).send({ query: 'one piece' })
    expect(res.status).toBe(202)
    const { searchId } = res.body.data
    const done = await waitFor(async () => {
      const d = emitted.filter((e) => e.event === 'download:search_done' && e.payload.searchId === searchId)
      return d.length === 4 ? d : null
    }, 10000)
    const results = emitted.filter((e) => e.event === 'download:search_result' && e.payload.searchId === searchId)
    expect(results.map((r) => (r.payload.result as { kind: string }).kind).sort()).toEqual(['anime', 'manga', 'youtube'])
    // Only to the user who searched
    expect(results.every((r) => r.room === `user:${adminId}`)).toBe(true)
    // Artwork goes through the signed proxy (results arrive in any order)
    const anime = results.find((r) => (r.payload.result as { kind: string }).kind === 'anime')!.payload.result as { poster_url: string }
    expect(anime.poster_url).toMatch(/^\/api\/images\/remote\?u=.+&s=/)
    const video = results.find((r) => (r.payload.result as { kind: string }).kind === 'youtube')!.payload.result as { thumbnail_url: string }
    expect(video.thumbnail_url).toMatch(/^\/api\/images\/remote\?u=.+&s=/)
    const by = Object.fromEntries(done.map((d) => [d.payload.source, d.payload]))
    expect(by.anisama.error).toBeNull()
    expect(by.movix.error).toBeTruthy()           // crashed
    expect(by.films.error).toMatch(/Délai/)       // timed out
  })

  it('refuses empty or odd queries', async () => {
    expect((await request(app).post('/api/downloads/search').set(admin).send({ query: '' })).status).toBe(422)
    expect((await request(app).post('/api/downloads/search').set(admin).send({ query: 'a\nb' })).status).toBe(422)
  })

  it('returns details of a title', async () => {
    const res = await request(app).get('/api/downloads/details').set(admin).query({ id: 'anisama:manga:one-piece' })
    expect(res.status).toBe(200)
    expect(res.body.data.langs[0].chapters).toHaveLength(2)
    expect((await request(app).get('/api/downloads/details').set(admin).query({ id: '../../etc' })).status).toBe(422)
  })
})

describe('Downloads: queue', () => {
  it('validates every input before anything runs', async () => {
    const bad = [
      { id: 'anisama:manga:one-piece; rm -rf /', title: 'x', chapters: [1] },
      { id: 'anisama:manga:one-piece', title: 'x', chapters: ['1;id'] },
      { id: 'anisama:manga:one-piece', title: 'x', chapters: [1], lang: 'VF --dest /etc' },
      { id: 'anisama:anime:one-piece', title: 'x', season: '../x', episodes: [1] },
      { id: 'anisama:anime:one-piece', title: 'x', episodes: [1] },          // no season
      { id: 'youtube:short', title: 'x' },
    ]
    for (const body of bad) {
      expect((await request(app).post('/api/downloads').set(admin).send(body)).status).toBe(422)
    }
  })

  it('runs a job, saves progress, lists the files and reports it live', async () => {
    emitted.length = 0
    fs.writeFileSync(ARGS_LOG, '')
    const res = await request(app).post('/api/downloads').set(admin)
      .send({ id: 'anisama:manga:one-piece', title: 'One Piece', lang: 'vf', chapters: [2, 1], poster_url: 'https://cdn.example/op.jpg' })
    expect(res.status).toBe(201)
    const id = res.body.data.id
    await waitFor(async () => (await statusOf(id)) === 'done')
    const row = (await request(app).get('/api/downloads').set(admin)).body.data.find((d: { id: string }) => d.id === id)
    expect(row.progress.items_done).toBe(1)
    expect(row.progress.items_skipped).toBe(1)
    expect(row.progress.files).toHaveLength(2)
    expect(row.dest_path).toBe(path.join(OUT, 'scans'))
    expect(row.poster_url).toMatch(/^\/api\/images\/remote/)
    expect(row.finished_at).toBeTruthy()
    // Arguments passed as an array, selection compacted
    const call = JSON.parse(fs.readFileSync(ARGS_LOG, 'utf8').trim().split('\n').pop()!)
    expect(call).toEqual(['anisama', '--json', '--download', 'anisama:manga:one-piece', '--dest', path.join(OUT, 'scans'),
      '--lang', 'VF', '--chapters', '1-2'])
    expect(emitted.some((e) => e.event === 'download:progress' && e.payload.id === id)).toBe(true)
    expect(emitted.filter((e) => e.event === 'download:status' && e.payload.id === id).map((e) => e.payload.status))
      .toEqual(expect.arrayContaining(['queued', 'running', 'done']))
  })

  it('warns about duplicates instead of downloading again (unless forced)', async () => {
    const body = { id: 'anisama:manga:one-piece', title: 'One Piece', lang: 'VF', chapters: [2, 3] }
    const dup = await request(app).post('/api/downloads').set(admin).send(body)
    expect(dup.status).toBe(409)
    expect(dup.body.details).toEqual(expect.objectContaining({ duplicate: true, items: [2] }))
    const forced = await request(app).post('/api/downloads').set(admin).send({ ...body, force: true })
    expect(forced.status).toBe(201)
    await waitFor(async () => (await statusOf(forced.body.data.id)) === 'done')
  })

  it('marks failed jobs and lets them be retried', async () => {
    const res = await request(app).post('/api/downloads').set(admin)
      .send({ id: 'anisama:anime:fail-test', title: 'Fail', season: 'saison1', lang: 'VOSTFR', episodes: [1] })
    const id = res.body.data.id
    await waitFor(async () => (await statusOf(id)) === 'failed')
    const row = (await query<{ error: string }>('SELECT error FROM downloads WHERE id = $1', [id])).rows[0]
    expect(row.error).toMatch(/Aucune source/)
    const retry = await request(app).post(`/api/downloads/${id}/retry`).set(admin)
    expect(retry.status).toBe(200)
    await waitFor(async () => (await statusOf(id)) === 'failed')
  })

  it('pauses, resumes and cancels a running job (the script is stopped)', async () => {
    const res = await request(app).post('/api/downloads').set(admin)
      .send({ id: 'anisama:anime:slow-test', title: 'Lent', season: 'saison1', lang: 'VOSTFR', episodes: [1] })
    const id = res.body.data.id
    await waitFor(async () => (await statusOf(id)) === 'running')
    await waitFor(async () => emitted.some((e) => e.event === 'download:progress' && e.payload.id === id))
    expect((await request(app).post(`/api/downloads/${id}/pause`).set(admin)).status).toBe(200)
    await waitFor(async () => (await statusOf(id)) === 'paused')
    expect((await request(app).post(`/api/downloads/${id}/resume`).set(admin)).status).toBe(200)
    await waitFor(async () => (await statusOf(id)) === 'running')
    expect((await request(app).post(`/api/downloads/${id}/cancel`).set(admin)).status).toBe(200)
    await waitFor(async () => (await statusOf(id)) === 'cancelled')
    expect((await request(app).post(`/api/downloads/${id}/resume`).set(admin)).status).toBe(409)
    expect((await request(app).post(`/api/downloads/${id}/explode`).set(admin)).status).toBe(422)
    expect((await request(app).delete(`/api/downloads/${id}`).set(admin)).status).toBe(200)
    expect(await statusOf(id)).toBeUndefined()
  })

  it('puts jobs left "running" by a restart back in the queue', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO downloads (kind, source_script, source_id, title, status) VALUES ('film', 'movix', 'movix:movie:1', 'x', 'running') RETURNING id`)
    await stopDownloadWorker()
    expect(await requeueInterrupted()).toBeGreaterThanOrEqual(1)
    expect(await statusOf(rows[0].id)).toBe('queued')
    await query('DELETE FROM downloads WHERE id = $1', [rows[0].id])
  })
})

describe('Follow a title (automatic downloads, off by default)', () => {
  it('is off until switched on, then only queues what is new', async () => {
    fs.writeFileSync(path.join(DIR, 'count.txt'), '3')
    const id = 'anisama:manga:one-piece'
    expect((await request(app).get('/api/downloads/follows').set(admin).query({ id })).body.data).toBeNull()
    const on = await request(app).put('/api/downloads/follows').set(admin)
      .send({ id, title: 'One Piece', lang: 'VF', enabled: true })
    expect(on.status).toBe(200)
    expect(on.body.data).toEqual(expect.objectContaining({ enabled: true, known: [1, 2, 3], options: { lang: 'VF' } }))
    // Nothing new: nothing queued
    const before = (await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM downloads')).rows[0].n
    expect(await checkDueFollows(true)).toBe(0)
    // Two chapters come out on the site
    fs.writeFileSync(path.join(DIR, 'count.txt'), '5')
    expect(await checkDueFollows(true)).toBe(2)
    const { rows } = await query<{ selection: { chapters: number[] }; status: string }>(
      'SELECT selection, status FROM downloads ORDER BY created_at DESC LIMIT 1')
    expect(rows[0].selection.chapters).toEqual([4, 5])
    expect((await query('SELECT COUNT(*)::int AS n FROM downloads')).rows[0].n).toBe(before + 1)
    // Switched off: no more checks
    await request(app).put('/api/downloads/follows').set(admin).send({ id, enabled: false })
    fs.writeFileSync(path.join(DIR, 'count.txt'), '7')
    expect(await checkDueFollows(true)).toBe(0)
  })

  it('finds the source of a library title: from its downloads, else by its name', async () => {
    fs.writeFileSync(path.join(DIR, 'count.txt'), '3')
    const lib = path.join(OUT, 'scans', 'One Piece')
    const m = await query<{ id: string }>(
      `INSERT INTO media_items (type, title, file_path) VALUES ('manga', 'One Piece', $1)
       ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [lib])
    // The test job above wrote its files under OUT/scans, not inside this title's folder: found by name
    let res = await request(app).get(`/api/downloads/follows/media/${m.rows[0].id}`).set(admin)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({ sourceId: 'anisama:manga:one-piece', lang: 'VF' }))
    // A title the site does not have
    const other = await query<{ id: string }>(
      `INSERT INTO media_items (type, title, file_path) VALUES ('manga', 'Titre Inconnu', $1)
       ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [path.join(OUT, 'scans', 'Titre Inconnu')])
    res = await request(app).get(`/api/downloads/follows/media/${other.rows[0].id}`).set(admin)
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/introuvable/)
    // Films cannot be followed
    const film = await query<{ id: string }>(
      `INSERT INTO media_items (type, title, file_path) VALUES ('film', 'Un film', $1)
       ON CONFLICT (file_path) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [path.join(OUT, 'film.mp4')])
    expect((await request(app).get(`/api/downloads/follows/media/${film.rows[0].id}`).set(admin)).status).toBe(422)
  })

  it('refuses films, videos and bad options', async () => {
    expect((await request(app).put('/api/downloads/follows').set(admin).send({ id: 'youtube:dQw4w9WgXcQ', title: 'x', enabled: true })).status).toBe(422)
    expect((await request(app).put('/api/downloads/follows').set(admin).send({ id: 'movix:movie:603', title: 'x', enabled: true })).status).toBe(422)
    expect((await request(app).put('/api/downloads/follows').set(admin).send({ id: 'anisama:anime:x', title: 'x', lang: 'VF', season: '../', enabled: true })).status).toBe(422)
    expect((await request(app).put('/api/downloads/follows').set(user).send({ id: 'anisama:manga:x', enabled: true })).status).toBe(403)
  })
})

describe('Signed image proxy', () => {
  let server: http.Server
  let base = ''
  beforeAll(async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png) })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server.close())

  it('serves only URLs signed by the server', async () => {
    const url = `${base}/poster.png`
    const ok = await request(app).get(signedImage(url)!)
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('image/png')
    const forged = await request(app).get(`/api/images/remote?u=${encodeURIComponent(`${base}/other.png`)}&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
    expect(forged.status).toBe(404)
  })
})

describe('Exact title hint for the library (.nexus.json)', () => {
  it('writes the TMDB id of a movix download next to its files', async () => {
    const { writeHints } = await import('../../src/services/downloads')
    const dest = path.join(OUT, 'series-hint')
    const ep = path.join(dest, 'One_Piece', 'VF', 'Saison_1', 'E01_-_Luffy.mp4')
    fs.mkdirSync(path.dirname(ep), { recursive: true }); fs.writeFileSync(ep, 'x')
    const film = path.join(OUT, 'films-hint', 'VF', 'One_Piece_Film_Red_2022.mp4')
    fs.mkdirSync(path.dirname(film), { recursive: true }); fs.writeFileSync(film, 'x')
    const base = { status: 'done', options: {}, selection: {}, error: null } as const
    await writeHints({ ...base, source_id: 'movix:tv:37854', source_script: 'movix', kind: 'serie', title: 'One Piece',
      dest_path: dest, progress: { files: [ep, '/etc/passwd'] } } as never)
    await writeHints({ ...base, source_id: 'movix:movie:900667', source_script: 'movix', kind: 'film', title: 'Red',
      dest_path: path.join(OUT, 'films-hint'), progress: { files: [film] } } as never)
    expect(JSON.parse(fs.readFileSync(path.join(dest, 'One_Piece', '.nexus.json'), 'utf8'))).toEqual(
      expect.objectContaining({ tmdb_id: 37854, media_type: 'tv' }))
    expect(JSON.parse(fs.readFileSync(path.join(OUT, 'films-hint', 'VF', '.One_Piece_Film_Red_2022.mp4.nexus.json'), 'utf8')))
      .toEqual(expect.objectContaining({ tmdb_id: 900667, media_type: 'movie' }))
    expect(fs.existsSync('/etc/.nexus.json')).toBe(false)
  })
})
