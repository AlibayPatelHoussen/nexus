/* Nexus service worker: push notifications, and the app offline when mangas are kept for
 * reading without a connection (« Hors ligne » on a manga, off by default).
 *
 * Offline (only while at least one manga is kept, the page tells us: message « offline »):
 * - the app itself (index.html + the build's files listed in /app-files.json) is kept in
 *   « nexus-app-<version> » and opens without the server; online, the server's version always wins;
 * - the pictures of the kept mangas (poster, backdrop) are kept in « nexus-offline-images ».
 * The pages of the chapters are kept by the page itself (Cache Storage « nexus-reader-v1 »).
 * Switched off everywhere: those caches are deleted, nothing else stays.
 */
const APP_PREFIX = 'nexus-app-'
const IMAGES = 'nexus-offline-images'
const STATE = 'nexus-offline-state'
const STATE_KEY = '/__offline/state'
const EXTRA = ['/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png']

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// ─── Offline state (kept across restarts of the worker) ─────────────────────
let state = null
async function loadState() {
  if (state) return state
  try {
    const res = await (await caches.open(STATE)).match(STATE_KEY)
    state = res ? await res.json() : { on: false, media: [], app: null }
  } catch { state = { on: false, media: [], app: null } }
  return state
}
async function saveState(next) {
  state = next
  await (await caches.open(STATE)).put(STATE_KEY, new Response(JSON.stringify(next)))
}

async function deleteApps(except) {
  for (const name of await caches.keys()) if (name.startsWith(APP_PREFIX) && name !== except) await caches.delete(name)
}

/** The current build, whole (index.html and every file of /app-files.json), in its own cache;
 *  the previous builds' caches go once it is complete */
async function cacheApp(s) {
  try {
    const res = await fetch('/app-files.json', { cache: 'no-store' })
    if (!res.ok) return
    const { version, files } = await res.json()
    const name = APP_PREFIX + version
    if (s.app === name && (await caches.has(name))) return
    const cache = await caches.open(name)
    for (const url of ['/index.html', ...EXTRA, ...files.map((f) => `/${f}`)]) {
      if (await cache.match(url, { ignoreVary: true })) continue
      const r = await fetch(url, { cache: 'no-cache' })
      if (r.ok) await cache.put(url, r)
      else if (!EXTRA.includes(url)) throw new Error(`${url}: ${r.status}`)
    }
    await saveState({ ...s, app: name })
    await deleteApps(name)
  } catch { /* next time (no connection, deploy in progress) */ }
}

// One message after the other (switched off then on again quickly: never mixed)
let queue = Promise.resolve()
self.addEventListener('message', (event) => {
  const msg = event.data || {}
  if (msg.type !== 'offline') return
  const media = Array.isArray(msg.media) ? msg.media.filter((m) => typeof m === 'string') : []
  queue = queue.then(async () => {
    const s = await loadState()
    if (msg.on) {
      await saveState({ ...s, on: true, media })
      await cacheApp(state)
      // Pictures of titles no longer kept
      const cache = await caches.open(IMAGES)
      for (const req of await cache.keys()) {
        const m = new URL(req.url).pathname.match(/^\/api\/images\/media\/([^/]+)\//)
        if (!m || !media.includes(m[1])) await cache.delete(req)
      }
    } else {
      await saveState({ on: false, media: [], app: null })
      await deleteApps(null)
      await caches.delete(IMAGES)
    }
  }).catch(() => {})
  event.waitUntil(queue)
})

// ─── Requests ────────────────────────────────────────────────────────────────
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))

/** Pages of the app: the server's (always, when it answers), else the kept one */
async function page(request) {
  const s = await loadState()
  if (!s.on) return fetch(request)
  try {
    return await Promise.race([fetch(request), timeout(6000)])
  } catch {
    const kept = s.app ? await caches.match('/index.html', { cacheName: s.app, ignoreVary: true }) : null
    return kept || Response.error()
  }
}

/** Files of the build (never change): the kept copy, else the server. (ignoreVary: the server
 *  answers « Vary: Origin », and the app's scripts are asked with an Origin the kept copy has not) */
async function asset(request) {
  const s = await loadState()
  const kept = s.on && s.app ? await caches.match(request, { cacheName: s.app, ignoreVary: true }) : null
  return kept || fetch(request)
}

/** Pictures of a kept manga: the server's, kept for later; without it, the kept copy */
async function picture(request, mediaId) {
  const s = await loadState()
  if (!s.on || !s.media.includes(mediaId)) return fetch(request)
  try {
    const res = await fetch(request)
    if (res.ok) await (await caches.open(IMAGES)).put(request, res.clone())
    return res
  } catch (err) {
    const kept = await caches.match(request, { cacheName: IMAGES, ignoreSearch: true, ignoreVary: true })
    if (kept) return kept
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate' && !url.pathname.startsWith('/api/')) { event.respondWith(page(req)); return }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(asset(req)); return }
  const m = url.pathname.match(/^\/api\/images\/media\/([^/]+)\//)
  if (m) event.respondWith(picture(req, m[1]))
})

// ─── Push notifications ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let msg = { title: 'Nexus', body: '' }
  try { msg = event.data ? event.data.json() : msg } catch { msg.body = event.data ? event.data.text() : '' }
  event.waitUntil(self.registration.showNotification(msg.title || 'Nexus', {
    body: msg.body || '',
    tag: msg.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: msg.url || '/' },
  }))
})

// Tapping the notification opens (or focuses) Nexus on the right page
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin)) {
        await w.focus()
        if ('navigate' in w) await w.navigate(url).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
