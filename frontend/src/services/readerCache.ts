/**
 * Pages already read stay on the device (Cache Storage): coming back to a
 * chapter shows them without downloading anything again.
 *
 * Keys are stable (chapter id + page number), not the media URLs, which
 * carry a stream token that changes. Only the last MAX_CHAPTERS chapters
 * are kept. Cache Storage needs a secure context (HTTPS or localhost):
 * elsewhere everything still works, without the cache.
 */
const CACHE = 'nexus-reader-v1'
const INDEX_KEY = 'nexus-reader-cache-index'
const MAX_CHAPTERS = 40
const PREFIX = '/__reader-cache/'

export interface ChapterMeta { kind: 'pdf' | 'images'; numPages: number; ratios?: Record<number, number> }

const available = () => typeof window !== 'undefined' && 'caches' in window && window.isSecureContext

const pageKey = (chapterId: string, n: number) => `${PREFIX}${chapterId}/page/${n}`
const metaKey = (chapterId: string) => `${PREFIX}${chapterId}/meta`

async function open(): Promise<Cache | null> {
  if (!available()) return null
  try { return await caches.open(CACHE) } catch { return null }
}

/** Remember that a chapter was opened; forget the oldest ones beyond the limit. */
async function touch(chapterId: string) {
  let index: Record<string, number> = {}
  try { index = JSON.parse(localStorage.getItem(INDEX_KEY) || '{}') } catch { /* corrupted */ }
  index[chapterId] = Date.now()
  const old = Object.entries(index).sort((a, b) => b[1] - a[1]).slice(MAX_CHAPTERS).map(([id]) => id)
  for (const id of old) delete index[id]
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)) } catch { /* private mode */ }
  if (!old.length) return
  const cache = await open()
  if (!cache) return
  for (const req of await cache.keys()) {
    if (old.some((id) => new URL(req.url).pathname.startsWith(`${PREFIX}${id}/`))) await cache.delete(req)
  }
}

export async function getPage(chapterId: string, n: number): Promise<Blob | null> {
  const cache = await open()
  const res = await cache?.match(pageKey(chapterId, n)).catch(() => undefined)
  return res ? res.blob() : null
}

export async function putPage(chapterId: string, n: number, blob: Blob): Promise<void> {
  const cache = await open()
  if (!cache) return
  await cache.put(pageKey(chapterId, n), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } })).catch(() => {})
  void touch(chapterId)
}

export async function getMeta(chapterId: string): Promise<ChapterMeta | null> {
  const cache = await open()
  const res = await cache?.match(metaKey(chapterId)).catch(() => undefined)
  if (!res) return null
  void touch(chapterId)
  try { return (await res.json()) as ChapterMeta } catch { return null }
}

export async function putMeta(chapterId: string, meta: ChapterMeta): Promise<void> {
  const cache = await open()
  if (!cache) return
  await cache.put(metaKey(chapterId), new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })).catch(() => {})
  void touch(chapterId)
}

/** Image page: from the cache, or downloaded once then cached. */
export async function loadImagePage(chapterId: string, n: number, url: string): Promise<Blob> {
  const hit = await getPage(chapterId, n)
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok) throw new Error(`page ${n} : erreur ${res.status}`)
  const blob = await res.blob()
  void putPage(chapterId, n, blob)
  return blob
}
