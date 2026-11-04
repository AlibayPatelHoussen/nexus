/* Nexus service worker: only for push notifications (no offline cache). */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
