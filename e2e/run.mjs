// Nexus end-to-end tests against the production build started by e2e/setup.sh.
// Usage: node e2e/run.mjs [filter]      (needs the `playwright` package)
import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const E2E = process.env.E2E_DIR || '/tmp/nexus-e2e'
const cfg = JSON.parse(fs.readFileSync(`${E2E}/config.json`, 'utf8'))
const B = cfg.base
const SHOTS = process.env.E2E_SHOTS || `${E2E}/shots`
fs.mkdirSync(SHOTS, { recursive: true })
const filter = process.argv[2]

// ── tiny harness ─────────────────────────────────────
const results = []
const tests = []
const test = (name, fn) => tests.push({ name, fn })
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const sql = (q) => execFileSync(cfg.psql[0], [...cfg.psql.slice(1), q]).toString().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, { token, method = 'GET', body, raw } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (raw) return res
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers }
}
async function login(username, password) {
  const r = await api('/api/auth/login', { method: 'POST', body: { username, password } })
  assert(r.status === 200, `login ${username} → ${r.status}`)
  return r.json.data
}

let admin, alice, browser
const errorsByPage = []

async function newPage(session, { width = 390, height = 844, theme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 1000 })
  await ctx.addInitScript(([rt, u, t]) => {
    if (!rt) return
    localStorage.setItem('nexus_refresh_token', rt)
    localStorage.setItem('nexus-auth', JSON.stringify({ state: { user: u, theme: t, isAuth: true }, version: 0 }))
  }, [session?.refreshToken ?? null, session?.user ?? null, theme])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errorsByPage.push(`${page.url()}: ${e.message}`))
  return page
}
/** Start playback once the player attached its source (like a user pressing play). */
async function playVideo(page) {
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1, null, { timeout: 30000 })
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play() })
}
const mediaId = (title) => sql(`SELECT id FROM media_items WHERE title = '${title.replace(/'/g, "''")}' LIMIT 1`)

// ═════════════════════════ API / backend ═════════════════════════

test('health reports the running build', async () => {
  const r = await api('/api/health')
  eq(r.status, 200, 'status')
  assert(r.json?.build?.commit && r.json.build.commit !== 'dev', `build commit missing: ${r.text}`)
})

test('unknown API routes are JSON 404 (not the SPA page)', async () => {
  const r = await api('/api/does-not-exist')
  eq(r.status, 404, 'status')
  assert(r.json && r.json.success === false, `body: ${r.text.slice(0, 80)}`)
})

test('SPA routes still serve index.html', async () => {
  const r = await api('/cinema')
  eq(r.status, 200, 'status')
  assert(r.text.includes('<div id="root">'), 'index.html expected')
})

test('login: good and bad credentials', async () => {
  admin = await login('admin', 'Admin1234')
  alice = await login('alice', 'User12345')
  const bad = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'nope' } })
  eq(bad.status, 401, 'bad password')
})

test('stream token is issued and only works for media', async () => {
  const r = await api('/api/auth/stream-token', { token: admin.accessToken })
  eq(r.status, 200, 'status')
  assert(typeof r.json?.data?.token === 'string', 'token')
  const me = await api('/api/auth/me', { token: r.json.data.token })
  eq(me.status, 401, 'stream token on /me')
})

test('scan films / series / animes / manga (fresh library)', async () => {
  sql('DELETE FROM media_items; DELETE FROM watch_history; DELETE FROM favorites')
  for (const t of ['films', 'series', 'animes', 'manga']) {
    const r = await api(`/api/media/scan/${t}`, { method: 'POST', token: admin.accessToken })
    eq(r.status, 200, `scan ${t}`)
  }
})

test('films: metadata fetched, unknown film keeps its file name', async () => {
  const rows = sql(`SELECT title || '|' || (poster_path IS NOT NULL) || '|' || coalesce(overview,'') FROM media_items WHERE type='film' ORDER BY title`)
  const lines = rows.split('\n')
  eq(lines.length, 7, `films: ${rows}`)
  assert(lines.filter((l) => l.includes('|true|Synopsis')).length === 6, `3 films with poster+synopsis: ${rows}`)
  assert(lines.some((l) => l.startsWith('Notfound Movie|false')), `unmatched film: ${rows}`)
})

test('series folder "… S02E12-22 FINAL" is searched by its show name', async () => {
  const reqs = await (await fetch(`${cfg.mock}/__requests`)).json()
  const q = reqs.filter((r) => r.path === '/3/search/tv').map((r) => r.query.query)
  assert(q.includes('Georgie and Mandys First Marriage'), `TMDB tv queries: ${JSON.stringify(q)}`)
  assert(!q.some((x) => /S02E12|FINAL/i.test(x)), `dirty query sent: ${JSON.stringify(q)}`)
})

test('series episodes: seasons, numbers, TMDB titles & thumbnails', async () => {
  const g = sql(`SELECT string_agg(season||'x'||episode_number||':'||coalesce(e.title,'-')||':'||(e.thumbnail_path IS NOT NULL), ',' ORDER BY season, episode_number) FROM episodes e JOIN media_items m ON m.id=e.media_item_id WHERE m.file_path LIKE '%Georgie%'`)
  eq(g, '2x12:Titre S2E12:true,2x13:Titre S2E13:true,2x14:Titre S2E14:true', 'Georgie episodes')
  const bb = sql(`SELECT string_agg(season||'x'||episode_number, ',' ORDER BY season, episode_number) FROM episodes e JOIN media_items m ON m.id=e.media_item_id WHERE m.file_path LIKE '%Breaking Bad%'`)
  eq(bb, '1x1,1x2,2x1', 'Breaking Bad episodes')
  const op = sql(`SELECT string_agg(season||'x'||episode_number, ',' ORDER BY season, episode_number) FROM episodes e JOIN media_items m ON m.id=e.media_item_id WHERE m.type='anime'`)
  eq(op, '1x1,1x2', 'One Piece episodes')
})

test('manga chapters (images and PDF)', async () => {
  const c = sql(`SELECT string_agg(m.title||':'||c.chapter_number, ',' ORDER BY m.title, c.chapter_number) FROM chapters c JOIN media_items m ON m.id=c.media_item_id`)
  assert(/Berserk:1(\.0)?/.test(c) && /Solo Leveling:1(\.0)?,Solo Leveling:2(\.0)?/.test(c), `chapters: ${c}`)
})

test('rescan never wipes metadata when the metadata API is down', async () => {
  const before = sql(`SELECT count(*) FROM media_items WHERE poster_path IS NOT NULL`)
  try { process.kill(Number(fs.readFileSync(`${E2E}/mock.pid`, 'utf8'))) } catch { /* already stopped */ }
  await sleep(300)
  try {
    for (const t of ['films', 'series', 'animes', 'manga']) await api(`/api/media/scan/${t}`, { method: 'POST', token: admin.accessToken })
    eq(sql(`SELECT count(*) FROM media_items WHERE poster_path IS NOT NULL`), before, 'posters after offline rescan')
    eq(sql(`SELECT count(*) FROM media_items WHERE overview IS NULL AND poster_path IS NOT NULL`), '0', 'synopsis kept')
  } finally {
    const out = fs.openSync(`${E2E}/mock.log`, 'a')
    const child = spawn(process.execPath, [new URL('./mock-metadata.mjs', import.meta.url).pathname], {
      env: { ...process.env, MOCK_PORT: new URL(cfg.mock).port }, detached: true, stdio: ['ignore', out, out],
    })
    child.unref()
    fs.writeFileSync(`${E2E}/mock.pid`, String(child.pid))
    await sleep(800)
  }
})

test('streaming: mp4 range requests, 416, access rules', async () => {
  const film = sql(`SELECT file_path FROM media_items WHERE title LIKE 'Film %' AND file_path LIKE '%.mp4' LIMIT 1`)
  const st = (await api('/api/auth/stream-token', { token: alice.accessToken })).json.data.token
  const url = `/api/files/stream?path=${encodeURIComponent(film)}&token=${st}`
  const full = await api(url, { raw: true })
  eq(full.status, 200, 'full'); eq(full.headers.get('content-type'), 'video/mp4', 'type')
  const part = await fetch(B + url, { headers: { Range: 'bytes=0-99' } })
  eq(part.status, 206, 'range'); eq(part.headers.get('content-range')?.startsWith('bytes 0-99/'), true, 'content-range')
  eq((await fetch(B + url, { headers: { Range: 'bytes=999999999-' } })).status, 416, 'bad range')
  eq((await api(`/api/files/stream?path=%2Fetc%2Fpasswd&token=${st}`)).status, 403, 'outside media root')
  eq((await api(`/api/files?path=/`, { token: alice.accessToken })).status, 403, 'file manager for user')
})

test('progress: one row per film, resume per episode', async () => {
  const film = mediaId(sql(`SELECT title FROM media_items WHERE file_path LIKE '%Demo Webm%'`))
  for (const p of [100, 250]) await api(`/api/media/${film}/progress`, { method: 'POST', token: admin.accessToken, body: { progress: p, duration: 1000 } })
  eq(sql(`SELECT count(*)||':'||max(progress) FROM watch_history w JOIN users u ON u.id=w.user_id WHERE u.username='admin' AND media_item_id='${film}'`), '1:250', 'film rows')
  const show = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Breaking Bad%'`)
  const ep = sql(`SELECT id FROM episodes WHERE media_item_id='${show}' AND season=1 AND episode_number=2`)
  await api(`/api/media/${show}/progress`, { method: 'POST', token: admin.accessToken, body: { progress: 60, duration: 240, episodeId: ep } })
  const list = (await api(`/api/media/${show}/episodes/progress`, { token: admin.accessToken })).json.data
  eq(list[0]?.episodeId, ep, 'episode progress')
})

// ═════════════════════════ UI (production build) ═════════════════════════

test('UI: login form → dashboard, no "outdated server" banner', async () => {
  const page = await newPage(null)
  await page.goto(`${B}/login`)
  await page.fill('input[autocomplete="username"], input[type="text"]', 'admin')
  await page.fill('input[type="password"]', 'Admin1234')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1500)
  assert(!(await page.$('text=Le serveur n’est pas à jour')), 'version banner should not show')
  await page.screenshot({ path: `${SHOTS}/dashboard.png` })
  await page.context().close()
})

test('UI: catalogue (hero, rows, cleaned series title)', async () => {
  const page = await newPage(admin)
  await page.goto(`${B}/cinema`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Plus d’infos')
  assert(await page.$('text=Ajouts récents'), 'recent row')
  await page.screenshot({ path: `${SHOTS}/cinema.png` })
  await page.click('[role="radio"]:has-text("Séries")')
  await page.waitForTimeout(800)
  const body = await page.textContent('body')
  assert(!/S02E12-22/.test(body), 'series title still contains the folder tags')
  await page.screenshot({ path: `${SHOTS}/series.png` })
  await page.context().close()
})

test('UI: film page → Lecture actually plays the video', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Demo Webm%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  assert(await page.$('text=Synopsis'), 'synopsis on title page')
  await page.click('button:has-text("Lecture"), button:has-text("Reprendre")')
  await page.waitForURL(`**/player/${id}**`)
  const video = await page.waitForSelector('video', { timeout: 10000 })
  await playVideo(page)
  await page.waitForFunction(() => document.querySelector('video').currentTime > 1, null, { timeout: 15000 })
  assert(video, 'video element')
  await page.screenshot({ path: `${SHOTS}/player-film.png` })
  await page.context().close()
})

test('UI: mp4 film page opens the player with a valid stream URL', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Marty%'`)
  const page = await newPage(admin)
  const streamed = page.waitForResponse((r) => r.url().includes('/api/files/stream'), { timeout: 15000 })
  await page.goto(`${B}/player/${id}`, { waitUntil: 'domcontentloaded' })
  const res = await streamed
  assert([200, 206].includes(res.status()), `stream status ${res.status()}`)
  eq(res.headers()['content-type'], 'video/mp4', 'stream content-type')
  assert(!(await page.$('text=Lecture impossible')), 'no playback error')
  await page.context().close()
})

test('UI: series page → episodes with titles → Lecture opens an episode', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Georgie%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Titre S2E12')
  await page.screenshot({ path: `${SHOTS}/series-page.png`, fullPage: true })
  await page.click('button:has-text("Lecture")')
  await page.waitForURL(/\/player\/.+\?ep=/)
  await page.waitForSelector('video', { timeout: 10000 })
  await page.context().close()
})

test('UI: "Reprendre" points to the episode in progress', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Breaking Bad%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Reprendre')
  assert(/S1 É2/.test(await page.textContent('body')), 'resume S1 É2')
  await page.context().close()
})

test('UI: manga reader loads image pages and PDF chapters', async () => {
  const solo = sql(`SELECT id FROM media_items WHERE title LIKE '%Solo%'`)
  const ch = sql(`SELECT c.id FROM chapters c WHERE media_item_id='${solo}' ORDER BY chapter_number LIMIT 1`)
  const page = await newPage(admin)
  await page.goto(`${B}/reader/${solo}?ch=${ch}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => [...document.images].filter((i) => i.naturalWidth > 0 && i.alt.startsWith('Page')).length >= 3, null, { timeout: 15000 })
  await page.screenshot({ path: `${SHOTS}/reader.png` })
  const ber = sql(`SELECT id FROM media_items WHERE title LIKE '%Berserk%'`)
  const pch = sql(`SELECT id FROM chapters WHERE media_item_id='${ber}' LIMIT 1`)
  // PDF pages are prepared by the server as light WebP images (poppler + sharp)
  const pdf = page.waitForResponse((r) => r.url().includes(`/api/media/chapters/${pch}/page/1`), { timeout: 15000 })
  await page.goto(`${B}/reader/${ber}?ch=${pch}`)
  const res = await pdf
  eq(res.status(), 200, 'pdf page status'); eq(res.headers()['content-type'], 'image/webp', 'pdf page type')
  await page.waitForFunction(() => [...document.images].some((i) => i.alt === 'Page 1' && i.naturalWidth > 0), null, { timeout: 30000 })
  assert(!(await page.$('iframe')), 'no PDF iframe (blank on iPhone)')
  // Coming back to chapters already read: pages come from the device, nothing is downloaded again
  const streams = []
  page.on('request', (r) => { if (/\/api\/files\/stream|\/chapters\/[^/]+\/page\//.test(r.url())) streams.push(r.url()) })
  const shown = () => page.waitForFunction(() => [...document.images].some((i) => i.alt === 'Page 1' && i.naturalWidth > 0), null, { timeout: 30000 })
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.goto(`${B}/reader/${ber}?ch=${pch}`, { waitUntil: 'networkidle' }); await shown()
  await page.goto(`${B}/reader/${solo}?ch=${ch}`, { waitUntil: 'networkidle' }); await shown()
  eq(streams, [], 'pages of chapters already read are not downloaded again')
  await page.context().close()
})

test('UI: admin pages (files, services, network, settings)', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/files?path=${encodeURIComponent(cfg.media)}`, { waitUntil: 'networkidle' })
  await page.goto(`${B}/files`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=/\\d+ éléments?/')
  for (const p of ['services', 'network', 'settings']) {
    await page.goto(`${B}/${p}`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${SHOTS}/${p}.png` })
  }
  await page.context().close()
})

test('UI: terminal — login shell, clean env, session survives leaving the page, reset', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  const screen = () => page.evaluate(() => document.querySelector('.xterm')?.textContent || '')
  const waitText = (t) => page.waitForFunction((t) => document.querySelector('.xterm')?.textContent?.includes(t), t, { timeout: 10000 })
  const run = async (cmd) => { await page.click('.xterm'); await page.keyboard.type(cmd + '\n') }
  await page.goto(`${B}/terminal`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="terminal-title"]:has-text("@")', { timeout: 10000 })
  await run('echo nexus-$((40+2))')
  await waitText('nexus-42')
  // Real terminal type, no Nexus secrets in the shell environment
  await run('echo "T=$TERM S=[${JWT_SECRET}${DB_PASSWORD}] N=[${NODE_ENV}]"')
  await waitText('T=xterm-256color S=[] N=[]')
  // State kept when leaving the page and coming back
  await run('export NEXUS_KEEP=persist-$((6*7))')
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.goto(`${B}/terminal`, { waitUntil: 'networkidle' })
  await waitText('export NEXUS_KEEP')               // previous output replayed
  await page.waitForSelector('[data-testid="terminal-title"]:has-text("@")')
  await run('echo got-$NEXUS_KEEP')
  await waitText('got-persist-42')
  // Font size
  await page.click('button[aria-label="Agrandir le texte"]')
  // Reset → a new shell (variable gone)
  await page.click('button[aria-label="Réinitialiser le terminal"]')
  await page.click('[role="alertdialog"] button:has-text("Réinitialiser")')
  await page.waitForFunction(() => !document.querySelector('.xterm')?.textContent?.includes('got-persist'), null, { timeout: 10000 })
  await page.waitForTimeout(800)
  await run('echo after-[$NEXUS_KEEP]')
  await waitText('after-[]')
  // exit → "Nouvelle session"
  await run('exit')
  await page.click('button:has-text("Nouvelle session")', { timeout: 10000 })
  await page.waitForTimeout(800)
  await run('echo again-$((1+1))')
  await waitText('again-2')
  assert(!(await screen()).includes('Impossible de démarrer'), 'shell started')
  await page.context().close()
})

test('UI: regular user — no admin pages, can still watch', async () => {
  const page = await newPage(alice)
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.waitForSelector('nav[aria-label="Onglets"]')
  assert(!(await page.$('nav[aria-label="Onglets"] >> text=Terminal')), 'Terminal tab hidden for user')
  assert(!(await page.$('a[href="/files"]')), 'Fichiers hidden for user')
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Demo Webm%'`)
  await page.goto(`${B}/player/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('video')
  await playVideo(page)
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5, null, { timeout: 15000 })
  await page.context().close()
})

test('UI: diagnostics — outdated backend is reported, never a blank player', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Demo Webm%'`)
  const page = await newPage(admin)
  // Old backend: unknown routes answered with the SPA page (HTTP 200) and /api/health without build info
  await page.route('**/api/auth/stream-token', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }))
  await page.route('**/api/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }))
  await page.goto(`${B}/player/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Lecture impossible', { timeout: 15000 })
  assert(/backend pas à jour/.test(await page.textContent('body')), 'explains the outdated backend')
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Le serveur n’est pas à jour', { timeout: 10000 })
  await page.context().close()
})

test('UI: session survives access-token expiry (refresh)', async () => {
  const page = await newPage(admin)
  await page.goto(`${B}/cinema`, { waitUntil: 'networkidle' })
  const wait = Number(process.env.E2E_EXPIRY_WAIT_MS || 45000)
  await page.waitForTimeout(wait)
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Demo Webm%'`)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Synopsis', { timeout: 10000 })
  assert(!page.url().includes('/login'), 'should still be logged in')
  await page.context().close()
})

test('UI: dashboard live stats over WebSocket', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=En ligne', { timeout: 15000 })
  await page.waitForFunction(() => /\d+\s%/.test(document.body.textContent || ''), null, { timeout: 15000 })
  await page.context().close()
})

test('UI: "Ma liste" toggles a favourite', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Marty%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.click('button:has-text("Ma liste")')
  await page.waitForSelector('text=Ajouté à ma liste', { timeout: 10000 })
  admin = await login('admin', 'Admin1234') // access tokens only live 40 s in this environment
  const favs = (await api('/api/media/favorites', { token: admin.accessToken })).json.data
  assert(favs.some((f) => f.id === id), 'added to favourites')
  await page.context().close()
})

test('UI: search and genre "Tout voir" show a results grid', async () => {
  const page = await newPage(admin)
  await page.goto(`${B}/cinema`, { waitUntil: 'networkidle' })
  const title = sql(`SELECT title FROM media_items WHERE file_path LIKE '%Marty%'`)
  await page.fill('input[placeholder^="Rechercher"]', title)
  await page.waitForSelector('text=/^1 résultat$/', { timeout: 10000 })
  await page.fill('input[placeholder^="Rechercher"]', '')
  await page.waitForSelector('text=Tout voir', { timeout: 10000 })
  await page.click('text=Tout voir')
  await page.waitForSelector('text=/\\d+ résultats?/', { timeout: 10000 })
  await page.context().close()
})

test('UI: file manager keeps the folder in the URL and uploads', async () => {
  const dir = `${cfg.media}/films`
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/files?path=${encodeURIComponent(dir)}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Marty Supreme (2025)')
  await page.setInputFiles('input[type="file"]', { name: 'e2e-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await page.waitForSelector('text=1 fichier envoyé', { timeout: 10000 })
  assert(fs.existsSync(`${dir}/e2e-upload.txt`), 'uploaded file on disk')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=e2e-upload.txt')
  fs.unlinkSync(`${dir}/e2e-upload.txt`)
  await page.context().close()
})

test('UI: settings shows matching interface/server versions', async () => {
  const commit = (await api('/api/health')).json.build.commit
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/settings`, { waitUntil: 'networkidle' })
  await page.waitForSelector(`text=${commit}`)
  const count = await page.locator(`text=${commit}`).count()
  assert(count >= 2, `interface and server should both show ${commit}`)
  await page.context().close()
})

test('UI: change password (and back)', async () => {
  const s = await login('alice', 'User12345')
  const page = await newPage(s, { width: 1280, height: 800 })
  await page.goto(`${B}/settings`, { waitUntil: 'networkidle' })
  const inputs = page.locator('form input[type="password"]')
  await inputs.nth(0).fill('User12345'); await inputs.nth(1).fill('NewPass123'); await inputs.nth(2).fill('NewPass123')
  await page.click('form button[type="submit"]')
  await page.waitForSelector('text=Mot de passe mis à jour', { timeout: 10000 })
  const s2 = await login('alice', 'NewPass123')
  await api('/api/auth/password', { method: 'PATCH', token: s2.accessToken, body: { currentPassword: 'NewPass123', newPassword: 'User12345' } })
  alice = await login('alice', 'User12345')
  await page.context().close()
})

test('UI: theme toggle and no horizontal overflow on phones', async () => {
  const page = await newPage(admin, { width: 375, height: 812 })
  const show = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Georgie%'`)
  for (const p of ['/dashboard', '/cinema', '/animes', '/manga', '/files', '/services', '/network', '/settings', `/media/${show}`, `/player/${show}`]) {
    await page.goto(B + p, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    assert(w[0] <= w[1], `${p} overflows: ${w[0]} > ${w[1]}`)
  }
  await page.goto(`${B}/settings`, { waitUntil: 'networkidle' })
  await page.click('[role="radiogroup"][aria-label="Apparence"] >> text=Sombre')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.click('[role="radiogroup"][aria-label="Apparence"] >> text=Clair')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.click('[role="radiogroup"][aria-label="Apparence"] >> text=Auto')
  await page.waitForFunction(() => !document.documentElement.dataset.theme)
  await page.context().close()
})

test('UI: playback progress is saved while watching', async () => {
  admin = await login('admin', 'Admin1234')
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Long Webm%'`)
  sql(`DELETE FROM watch_history WHERE media_item_id='${id}'`)
  const page = await newPage(admin)
  await page.goto(`${B}/player/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('video')
  await playVideo(page)
  await page.waitForFunction(() => document.querySelector('video').currentTime > 7, null, { timeout: 20000 })
  await page.waitForTimeout(5500) // one periodic save (every 5 s)
  const saved = Number(sql(`SELECT max(progress) FROM watch_history WHERE media_item_id='${id}'`))
  assert(saved >= 6, `saved progress should follow playback, got ${saved}`)
  await page.context().close()
})

test('UI: player resumes at the saved position, "Recommencer" goes back to 0', async () => {
  admin = await login('admin', 'Admin1234')
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Long Webm%'`)
  await api(`/api/media/${id}/progress`, { method: 'POST', token: admin.accessToken, body: { progress: 35, duration: 60 } })
  const page = await newPage(admin)
  await page.goto(`${B}/player/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Reprise à')
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 35) < 2, null, { timeout: 15000 })
  await page.screenshot({ path: `${SHOTS}/player-resume.png` })
  await page.click('button:has-text("Recommencer")')
  await page.waitForFunction(() => document.querySelector('video').currentTime < 2, null, { timeout: 10000 })
  await page.context().close()
})

// ═════════════════════════ On-the-fly conversion (ffmpeg → HLS) ═════════════════════════

test('conversion: play-info picks direct / remux / transcode', async () => {
  admin = await login('admin', 'Admin1234')
  const info = async (like) => {
    const p = sql(`SELECT file_path FROM media_items WHERE file_path LIKE '${like}'`)
    return (await api(`/api/files/play-info?path=${encodeURIComponent(p)}`, { token: admin.accessToken })).json.data
  }
  eq((await info('%Marty%')).mode, 'direct', 'mp4 h264/aac')
  eq((await info('%Remux Test%')).mode, 'remux', 'mkv h264/ac3')
  const hevc = await info('%Hevc Test%')
  eq(hevc.mode, 'transcode', 'hevc'); assert(hevc.duration > 89, `duration ${hevc.duration}`)
})

test('conversion: HEVC film shows a spinner + "Préparation de la vidéo…", then plays', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Hevc Test%'`)
  sql(`DELETE FROM watch_history WHERE media_item_id='${id}'`)
  const page = await newPage(admin)
  const started = page.waitForResponse((r) => r.url().includes('/api/files/transcode') && r.request().method() === 'POST', { timeout: 15000 })
  await page.goto(`${B}/player/${id}`)
  await page.waitForSelector('[role="status"] >> text=Préparation de la vidéo…', { timeout: 15000 })
  eq((await started).status(), 201, 'transcode started')
  await page.waitForSelector('video')
  await playVideo(page)
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2, null, { timeout: 30000 })
  // Spinner hidden while playing, total duration shown (not the converted part only)
  await page.waitForFunction(() => !document.querySelector('[role="status"]'), null, { timeout: 10000 })
  assert(/sur 1:30$/.test(await page.getAttribute('[role="slider"][aria-label="Position dans la vidéo"]', 'aria-valuetext')), 'full duration 1:30 displayed')
  await page.screenshot({ path: `${SHOTS}/player-transcode.png` })
  await page.context().close()
})

test('conversion: MKV h264+AC3 (audio converted) plays', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Remux Test%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/player/${id}`)
  await page.waitForSelector('video')
  await playVideo(page)
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2, null, { timeout: 30000 })
  await page.context().close()
})

test('conversion: seeking past the converted part restarts ffmpeg there', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Hevc Test%'`)
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/player/${id}`)
  await page.waitForSelector('video')
  await playVideo(page)
  await page.waitForFunction(() => document.querySelector('video').currentTime > 1, null, { timeout: 30000 })
  // Click at 80 % of the scrubber (72 s of 90 s)
  const restart = page.waitForResponse((r) => r.url().includes('/api/files/transcode?') && r.url().includes('start=7'), { timeout: 15000 })
  const bar = await page.$('[role="slider"][aria-label="Position dans la vidéo"]')
  const box = await bar.boundingBox()
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)
  const res = await restart
  eq(res.status(), 201, 'new conversion')
  // Time displayed ≈ 72 s and keeps playing
  await page.waitForFunction(() => /^1:1\d sur 1:30$/.test(document.querySelector('[role="slider"][aria-label="Position dans la vidéo"]')?.getAttribute('aria-valuetext') || ''), null, { timeout: 30000 })
  await page.context().close()
})

test('conversion: closing the player kills ffmpeg', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Hevc Test%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  const created = page.waitForResponse((r) => r.url().includes('/api/files/transcode?') && r.request().method() === 'POST', { timeout: 15000 })
  await page.click('button:has-text("Lecture"), button:has-text("Reprendre")')
  const jobId = (await (await created).json()).data.id
  await page.waitForSelector('video')
  await page.waitForFunction(() => document.querySelector('video').readyState >= 1, null, { timeout: 30000 })
  const stopped = page.waitForRequest((r) => r.url().includes('/api/files/transcode/') && r.method() === 'DELETE', { timeout: 10000 })
  await page.click('text=Retour')
  await stopped
  await sleep(1500)
  const left = Number(execFileSync('bash', ['-c', `pgrep -f "nexus-hl[s]/${jobId}" | wc -l`]).toString().trim())
  eq(left, 0, 'ffmpeg of this player still running')
  await page.context().close()
})

// ═════════════════════════ Artwork, manga chapters, file deletion ═════════════════════════

test('images: anime & manga covers are served by the proxy and actually load', async () => {
  admin = await login('admin', 'Admin1234')
  for (const type of ['anime', 'manga']) {
    const items = (await api(`/api/media?type=${type}&limit=50`, { token: admin.accessToken })).json.data.items
    const withPoster = items.filter((i) => i.posterPath)
    assert(withPoster.length > 0, `${type}: no poster at all`)
    assert(withPoster.every((i) => i.posterPath.startsWith('/api/images/media/')), `${type}: posters must be proxied: ${withPoster[0].posterPath}`)
    const res = await fetch(B + withPoster[0].posterPath)
    eq(res.status, 200, `${type} poster status`)
    assert(res.headers.get('content-type').startsWith('image/'), 'image content-type')
  }
  for (const [path, type] of [['/animes', 'anime'], ['/manga', 'manga']]) {
    const page = await newPage(admin)
    await page.goto(B + path, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => [...document.images].filter((i) => i.src.includes('/api/images/') && i.naturalWidth > 0).length >= 2, null, { timeout: 15000 })
    await page.screenshot({ path: `${SHOTS}/covers-${type}.png` })
    await page.context().close()
  }
})

test('images: the proxy caches (second request does not reach the source)', async () => {
  const items = (await api('/api/media?type=manga&limit=50', { token: admin.accessToken })).json.data.items
  const poster = items.find((i) => i.posterPath).posterPath
  const count = async () => (await (await fetch(`${cfg.mock}/__requests`)).json()).filter((r) => r.path.startsWith('/covers/')).length
  await fetch(B + poster)
  const before = await count()
  for (let i = 0; i < 3; i++) eq((await fetch(B + poster)).status, 200, 'cached poster')
  eq(await count(), before, 'requests to the image source')
})

test('images: a missing image shows a clean placeholder', async () => {
  const id = sql(`SELECT id FROM media_items WHERE type='anime' LIMIT 1`)
  const old = sql(`SELECT poster_path FROM media_items WHERE id='${id}'`)
  sql(`UPDATE media_items SET poster_path='http://localhost:4010/img/missing.png' WHERE id='${id}'`)
  try {
    const page = await newPage(admin)
    await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('section [role="img"]', { timeout: 10000 })
    await page.context().close()
  } finally { sql(`UPDATE media_items SET poster_path='${old}' WHERE id='${id}'`) }
})

test('detail page: artwork is whole (contain), 2:3, and never covered by the text', async () => {
  for (const width of [390, 1280]) {
    const id = sql(`SELECT id FROM media_items WHERE type='manga' AND poster_path IS NOT NULL LIMIT 1`)
    const page = await newPage(admin, { width, height: 900 })
    await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => [...document.querySelectorAll('section img[alt]')].some((i) => i.alt && i.naturalWidth > 0))
    const r = await page.evaluate(() => {
      const img = [...document.querySelectorAll('section img')].find((i) => i.alt && i.naturalWidth > 0)
      const frame = img.parentElement.getBoundingClientRect()
      const h1 = document.querySelector('section h2').getBoundingClientRect()
      const btn = [...document.querySelectorAll('button')].find((b) => /Lire|Lecture|Aucun chapitre/.test(b.textContent)).getBoundingClientRect()
      const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
      return {
        fit: getComputedStyle(img).objectFit,
        ratio: frame.width / frame.height,
        overTitle: overlap(frame, h1), overButton: overlap(frame, btn),
        inside: frame.left >= 0 && frame.right <= window.innerWidth,
      }
    })
    eq(r.fit, 'contain', `object-fit at ${width}px`)
    assert(Math.abs(r.ratio - 2 / 3) < 0.02, `ratio ${r.ratio} at ${width}px`)
    assert(!r.overTitle && !r.overButton, `text over the artwork at ${width}px`)
    assert(r.inside, `artwork out of the screen at ${width}px`)
    await page.screenshot({ path: `${SHOTS}/detail-manga-${width}.png` })
    await page.context().close()
  }
})

test('manga chapters: every folder layout is found and sorted', async () => {
  const chapters = (like) => sql(`SELECT string_agg(c.chapter_number::text || ':' || regexp_replace(c.folder_path, '^.*/', ''), ',' ORDER BY c.chapter_number) FROM chapters c JOIN media_items m ON m.id=c.media_item_id WHERE m.file_path LIKE '%/${like}'`)
  eq(chapters('Vinland Saga'), '1.0:Vinland Saga - Chapter 001.cbz,2.0:Vinland Saga - Chapter 002.cbz,10.0:Vinland Saga - Chapter 010.cbz', 'CBZ at the root')
  eq(chapters('Vagabond'), '1.0:Vagabond 01.pdf,2.0:Vagabond 02.pdf', 'PDF at the root')
  eq(chapters('Nested Manga'), '1.0:Chapitre 1,2.0:Chapitre 2,3.0:Chapitre 3', 'volume/chapter folders')
  eq(chapters('Oneshot Manga'), '1.0:Oneshot Manga', 'images at the root')
  eq(chapters('Empty Manga') || '', '', 'no chapter')
})

test('manga chapters: listed on the title page, a click opens the reader (CBZ pages load)', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%/Vinland Saga'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Chapitres')
  const rows = page.locator('[role="list"] button:has-text("Chapitre")')
  const order = (await rows.allTextContents()).map((t) => t.match(/Chapitre (\d+)/)?.[1])
  eq(order, ['1', '2', '10'], 'sorted by number')
  await rows.nth(2).click()
  await page.waitForURL('**/reader/**')
  await page.waitForFunction(() => [...document.images].filter((i) => i.alt.startsWith('Page') && i.naturalWidth > 0).length === 3, null, { timeout: 15000 })
  await page.screenshot({ path: `${SHOTS}/reader-cbz.png` })
  await page.context().close()
})

test('manga chapters: clear message when there is none', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%/Empty Manga'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Aucun chapitre trouvé')
  assert(await page.$('button:has-text("Analyser les chapitres")'), 'scan button')
  await page.context().close()
})

test('files: delete a non-empty folder with accents from the UI, list refreshed', async () => {
  const dir = `${cfg.media}/à supprimer`
  fs.mkdirSync(`${dir}/Saison 1 (2024)`, { recursive: true })
  fs.writeFileSync(`${dir}/Saison 1 (2024)/Épisode #1 & co.mkv`, 'x')
  const page = await newPage(admin, { width: 1280, height: 800 })
  let native = false
  page.on('dialog', (d) => { native = true; d.dismiss() })
  await page.goto(`${B}/files?path=${encodeURIComponent(cfg.media)}`, { waitUntil: 'networkidle' })
  const dlg = '[role="alertdialog"]'
  // In-app confirmation (not the browser's confirm()), "Annuler" keeps the folder
  await page.click('button[aria-label="Actions pour à supprimer"]')
  await page.click('button:has-text("Supprimer")')
  await page.waitForSelector(`${dlg} >> text=Supprimer « à supprimer » ?`)
  await page.click(`${dlg} button:has-text("Annuler")`)
  await page.waitForSelector(dlg, { state: 'detached' })
  assert(fs.existsSync(dir), 'cancel must keep the folder')
  // Escape cancels too
  await page.click('button[aria-label="Actions pour à supprimer"]')
  await page.click('button:has-text("Supprimer")')
  await page.waitForSelector(dlg)
  await page.keyboard.press('Escape')
  await page.waitForSelector(dlg, { state: 'detached' })
  assert(fs.existsSync(dir), 'Escape must keep the folder')
  // Confirm
  await page.click('button[aria-label="Actions pour à supprimer"]')
  await page.click('button:has-text("Supprimer")')
  await page.click(`${dlg} button:has-text("Supprimer")`)
  await page.waitForSelector('text=Supprimé', { timeout: 10000 })
  assert(!native, 'native confirm() used')
  await page.waitForFunction(() => !document.body.textContent.includes('à supprimer'), null, { timeout: 10000 })
  assert(!fs.existsSync(dir), 'folder still on disk')
  await page.context().close()
})

test('files: multiple delete reports the failure with its reason, deletes the rest', async () => {
  const a = `${cfg.media}/del-a`; const b = `${cfg.media}/del b é.txt`
  fs.mkdirSync(`${a}/x`, { recursive: true }); fs.writeFileSync(b, 'x')
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/files?path=${encodeURIComponent(cfg.media)}`, { waitUntil: 'networkidle' })
  // Remove one of them behind the UI's back → its deletion fails (already gone)
  for (const [i, name] of ['del-a', 'del b é.txt', 'films'].entries()) {
    await page.click(`tr:has(span:text-is("${name}"))`, i ? { modifiers: ['Control'] } : {})
  }
  await page.click('button[aria-label="Supprimer la sélection"]')
  await page.waitForSelector('[role="alertdialog"] >> text=Supprimer 3 élément(s) ?')
  await page.click('[role="alertdialog"] button:has-text("Supprimer")')
  await page.waitForSelector('text=2 élément(s) supprimé(s)', { timeout: 10000 })
  await page.waitForSelector('text=protégé', { timeout: 10000 })
  assert(!fs.existsSync(a) && !fs.existsSync(b), 'deletable entries removed')
  assert(fs.existsSync(`${cfg.media}/films`), 'protected library folder kept')
  await page.context().close()
})

test('files: permission refused → password asked, wrong then right password, cancel keeps the chown hint', async () => {
  const dir = `${cfg.media}/root-owned`
  fs.mkdirSync(dir, { recursive: true })
  const page = await newPage(admin, { width: 1280, height: 800 })
  const reason = `Impossible de supprimer « root-owned » : Nexus (utilisateur houssen) n'a pas le droit d'écrire dans « ${cfg.media} », qui appartient à root. Sur le serveur : sudo chown -R houssen: "${cfg.media}"`
  const sent = []
  // The E2E server runs as root (never refused): simulate a non-root server
  await page.route((u) => u.pathname === '/api/files' && u.searchParams.has('path'), (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: reason, code: 'NEEDS_PASSWORD' }) })
    : route.fallback())
  await page.route('**/api/files/delete-elevated', (route) => {
    const body = JSON.parse(route.request().postData())
    sent.push(body)
    if (body.password !== 'bon-mdp') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' }) })
    fs.rmSync(dir, { recursive: true, force: true })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { deleted: body.paths, failed: [] } }) })
  })
  await page.goto(`${B}/files?path=${encodeURIComponent(cfg.media)}`, { waitUntil: 'networkidle' })
  const dlg = '[role="alertdialog"]'
  const askDelete = async () => {
    await page.click('button[aria-label="Actions pour root-owned"]')
    await page.click('button:has-text("Supprimer")')
    await page.click(`${dlg} button:has-text("Supprimer")`)
    await page.waitForSelector(`${dlg} >> text=Forcer la suppression de « root-owned » ?`)
  }
  // Cancel → explanation + copyable command
  await askDelete()
  await page.click(`${dlg} button:has-text("Annuler")`)
  await page.waitForSelector('text=À lancer sur le serveur')
  assert(await page.isVisible(`code:has-text('sudo chown -R houssen: "${cfg.media}"')`), 'chown command shown')
  assert(sent.length === 0, 'nothing sent on cancel')
  // Wrong password → error in the dialog, stays open, field cleared
  await askDelete()
  const btn = `${dlg} button:has-text("Supprimer")`
  assert(await page.isDisabled(btn), 'button disabled without password')
  await page.fill('#confirm-password', 'faux')
  await page.click(btn)
  await page.waitForSelector(`${dlg} [role="alert"]:has-text("Mot de passe incorrect")`)
  assert((await page.inputValue('#confirm-password')) === '', 'field cleared after a wrong password')
  // Right password (Enter submits) → deleted, dialog closed, list refreshed
  await page.fill('#confirm-password', 'bon-mdp')
  await page.press('#confirm-password', 'Enter')
  await page.waitForSelector(dlg, { state: 'detached' })
  await page.waitForSelector('text=Supprimé')
  await page.waitForSelector('button[aria-label="Actions pour root-owned"]', { state: 'detached', timeout: 10000 })
  assert(sent.length === 2 && sent[1].paths[0] === dir, 'elevated request with the path')
  await page.context().close()
})

test('downloads: one search over the four scripts, choose chapters, queue runs with live progress', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/downloads`, { waitUntil: 'networkidle' })
  await page.fill('input[type=search]', 'one piece')
  await page.keyboard.press('Enter')
  // anime-sama answers first: its cards appear before the slower scripts have finished
  await page.waitForSelector('text=Recherche dans', { timeout: 5000 })
  await page.locator('button', { hasText: 'Animé' }).filter({ hasText: 'One Piece' }).first().waitFor({ timeout: 5000 })
  await page.locator('button', { hasText: 'Manga' }).filter({ hasText: 'One Piece' }).first().waitFor()
  await page.waitForSelector('text=One Piece Stampede', { timeout: 10000 })
  await page.waitForSelector('text=one piece — vidéo 1')
  // Filter by type
  await page.click('[role=radio]:has-text("YouTube")')
  eq(await page.locator('text=One Piece Stampede').count(), 0, 'films hidden by the YouTube filter')
  await page.click('[role=radio]:has-text("Tout")')
  // Manga: range of chapters
  await page.locator('button', { hasText: 'Manga' }).filter({ hasText: 'One Piece' }).first().click()
  await page.waitForSelector('text=Tout sélectionner')
  await page.fill('input[aria-label="Premier chapitre"]', '4')
  await page.fill('input[aria-label="Dernier chapitre"]', '5')
  await page.click('button:has-text("Choisir")')
  await page.click('button:has-text("Télécharger 2 chapitres")')
  await page.waitForSelector('text=ajouté à la file')
  await page.click('[role=radio]:has-text("File")')
  await page.waitForSelector('text=chapitres 4–5')
  await page.waitForSelector('[role=progressbar]', { timeout: 10000 })
  await page.waitForSelector('text=Terminés', { timeout: 20000 })
  await page.screenshot({ path: `${SHOTS}/downloads-queue.png` })
  // Same chapters again: warned instead of downloading twice
  await page.click('[role=radio]:has-text("Rechercher")')
  await page.locator('button', { hasText: 'Manga' }).filter({ hasText: 'One Piece' }).first().click()
  await page.waitForSelector('text=Tout sélectionner')
  await page.fill('input[aria-label="Premier chapitre"]', '5'); await page.fill('input[aria-label="Dernier chapitre"]', '6')
  await page.click('button:has-text("Choisir")')
  await page.click('button:has-text("Télécharger 2 chapitres")')
  await page.waitForSelector('text=Déjà téléchargé ou en file : 5')
  await page.context().close()
})

test('UI: logout', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.click('button[aria-label="Déconnexion"]')
  await page.waitForURL('**/login')
  await page.context().close()
})

// ── run ──────────────────────────────────────────────
browser = await chromium.launch()
for (const t of tests) {
  if (filter && !t.name.toLowerCase().includes(filter.toLowerCase()) && !t.name.startsWith('login')) continue
  const start = Date.now()
  const limit = t.name.includes('expiry') ? 120_000 : 60_000
  let timer
  try {
    await Promise.race([t.fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${limit / 1000}s`)), limit) })])
    results.push({ name: t.name, ok: true, ms: Date.now() - start })
  } catch (e) {
    results.push({ name: t.name, ok: false, ms: Date.now() - start, err: e.message.split('\n')[0] })
  } finally { clearTimeout(timer) }
  const r = results[results.length - 1]
  console.log(`${r.ok ? '✅' : '❌'} ${r.name} (${r.ms} ms)${r.ok ? '' : `\n     → ${r.err}`}`)
}
await browser.close()
if (errorsByPage.length) { console.log('\nBrowser errors:'); for (const e of errorsByPage) console.log('  ' + e) }
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed || errorsByPage.length ? 1 : 0)
