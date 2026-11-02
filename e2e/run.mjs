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
  assert(!(await page.$('text=Le serveur n\'est pas à jour')), 'version banner should not show')
  await page.screenshot({ path: `${SHOTS}/dashboard.png` })
  await page.context().close()
})

test('UI: catalogue (hero, rows, cleaned series title)', async () => {
  const page = await newPage(admin)
  await page.goto(`${B}/cinema`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Plus d\'infos')
  assert(await page.$('text=Ajouts récents'), 'recent row')
  await page.screenshot({ path: `${SHOTS}/cinema.png` })
  await page.click('[role="tab"]:has-text("Séries")')
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
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play() })
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
  const pdf = page.waitForResponse((r) => r.url().includes('/api/files/stream') && r.url().includes('.pdf'), { timeout: 15000 })
  await page.goto(`${B}/reader/${ber}?ch=${pch}`)
  const res = await pdf
  eq(res.status(), 200, 'pdf status'); eq(res.headers()['content-type'], 'application/pdf', 'pdf type')
  await page.context().close()
})

test('UI: admin pages (files, services, scripts, network, settings)', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/files?path=${encodeURIComponent(cfg.media)}`, { waitUntil: 'networkidle' })
  await page.goto(`${B}/files`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=élément(s)')
  for (const p of ['services', 'network', 'settings']) {
    await page.goto(`${B}/${p}`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${SHOTS}/${p}.png` })
  }
  await page.goto(`${B}/scripts`, { waitUntil: 'networkidle' })
  await page.click('button:has-text("Exécuter")')
  await page.waitForSelector('text=hello from e2e', { timeout: 10000 })
  await page.context().close()
})

test('UI: terminal connects and runs a command', async () => {
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/terminal`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.xterm', { timeout: 10000 })
  await page.waitForTimeout(1500)
  await page.click('.xterm')
  await page.keyboard.type('echo nexus-$((40+2))\n')
  await page.waitForFunction(() => document.querySelector('.xterm')?.textContent?.includes('nexus-42'), null, { timeout: 10000 })
  await page.context().close()
})

test('UI: regular user — no admin pages, can still watch', async () => {
  const page = await newPage(alice)
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.click('button[aria-label="Ouvrir le menu"]')
  assert(!(await page.$('#nexus-sidebar >> text=Fichiers')), 'Fichiers hidden for user')
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Demo Webm%'`)
  await page.goto(`${B}/player/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('video')
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play() })
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
  await page.waitForSelector('text=Le serveur n\'est pas à jour', { timeout: 10000 })
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
  await page.waitForFunction(() => /\d+%/.test(document.body.textContent || ''), null, { timeout: 15000 })
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
  await page.waitForSelector('text=1 résultat(s)', { timeout: 10000 })
  await page.fill('input[placeholder^="Rechercher"]', '')
  await page.waitForSelector('text=Tout voir', { timeout: 10000 })
  await page.click('text=Tout voir')
  await page.waitForSelector('text=résultat(s)', { timeout: 10000 })
  await page.context().close()
})

test('UI: file manager keeps the folder in the URL and uploads', async () => {
  const dir = `${cfg.media}/films`
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/files?path=${encodeURIComponent(dir)}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Marty Supreme (2025)')
  await page.setInputFiles('input[type="file"]', { name: 'e2e-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await page.waitForSelector('text=Upload terminé', { timeout: 10000 })
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
  for (const p of ['/dashboard', '/cinema', '/animes', '/manga', '/files', '/services', '/scripts', '/network', '/settings', `/media/${show}`, `/player/${show}`]) {
    await page.goto(B + p, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    assert(w[0] <= w[1], `${p} overflows: ${w[0]} > ${w[1]}`)
  }
  await page.goto(`${B}/dashboard`, { waitUntil: 'networkidle' })
  await page.click('header button[aria-label="Mode clair"]')
  await page.waitForFunction(() => document.documentElement.className.includes('light'))
  await page.context().close()
})

test('UI: playback progress is saved while watching', async () => {
  admin = await login('admin', 'Admin1234')
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Long Webm%'`)
  sql(`DELETE FROM watch_history WHERE media_item_id='${id}'`)
  const page = await newPage(admin)
  await page.goto(`${B}/player/${id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('video')
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play() })
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
const ffmpegCount = () => Number(execFileSync('bash', ['-c', `pgrep -f "ffmpeg.*-f hls" | wc -l`]).toString().trim())

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
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play().catch(() => {}) })
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2, null, { timeout: 30000 })
  // Spinner hidden while playing, total duration shown (not the converted part only)
  await page.waitForFunction(() => !document.querySelector('[role="status"]'), null, { timeout: 10000 })
  assert(/\/ 1:30/.test(await page.textContent('body')), 'full duration 1:30 displayed')
  await page.screenshot({ path: `${SHOTS}/player-transcode.png` })
  await page.context().close()
})

test('conversion: MKV h264+AC3 (audio converted) plays', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Remux Test%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/player/${id}`)
  await page.waitForSelector('video')
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play().catch(() => {}) })
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2, null, { timeout: 30000 })
  await page.context().close()
})

test('conversion: seeking past the converted part restarts ffmpeg there', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Hevc Test%'`)
  const page = await newPage(admin, { width: 1280, height: 800 })
  await page.goto(`${B}/player/${id}`)
  await page.waitForSelector('video')
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play().catch(() => {}) })
  await page.waitForFunction(() => document.querySelector('video').currentTime > 1, null, { timeout: 30000 })
  // Click at 80 % of the scrubber (72 s of 90 s)
  const restart = page.waitForResponse((r) => r.url().includes('/api/files/transcode?') && r.url().includes('start=7'), { timeout: 15000 })
  const bar = await page.$('div[style*="touch-action: none"]')
  const box = await bar.boundingBox()
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)
  const res = await restart
  eq(res.status(), 201, 'new conversion')
  // Time displayed ≈ 72 s and keeps playing
  await page.waitForFunction(() => /1:1\d \/ 1:30/.test(document.body.textContent || ''), null, { timeout: 30000 })
  await page.context().close()
})

test('conversion: closing the player kills ffmpeg', async () => {
  const id = sql(`SELECT id FROM media_items WHERE file_path LIKE '%Hevc Test%'`)
  const page = await newPage(admin)
  await page.goto(`${B}/media/${id}`, { waitUntil: 'networkidle' })
  await page.click('button:has-text("Lecture"), button:has-text("Reprendre")')
  await page.waitForSelector('video')
  await page.waitForFunction(() => document.querySelector('video').readyState >= 1, null, { timeout: 30000 })
  const stopped = page.waitForRequest((r) => r.url().includes('/api/files/transcode/') && r.method() === 'DELETE', { timeout: 10000 })
  await page.click('text=Retour')
  await stopped
  await sleep(1500)
  eq(ffmpegCount(), 0, 'ffmpeg processes still running')
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
