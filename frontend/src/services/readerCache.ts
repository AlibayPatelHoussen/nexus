/**
 * Pages already read stay on the device (Cache Storage): coming back to a
 * chapter shows them without downloading anything again.
 *
 * Keys are stable (chapter id + page number), not the media URLs, which
 * carry a stream token that changes. Only the last MAX_CHAPTERS chapters
 * are kept. Cache Storage needs a secure context (HTTPS or localhost):
 * elsewhere everything still works, without the cache.
 */
import { pinnedChapterIds } from './offlineIndex'

const CACHE = 'nexus-reader-v1'
const INDEX_KEY = 'nexus-reader-cache-index'
const MAX_CHAPTERS = 40
const PREFIX = '/__reader-cache/'

/** Page width asked to the server: the screen's, in 160 px steps (shared cache) */
export const PAGE_WIDTH = typeof window === 'undefined' ? 960
  : Math.min(1600, Math.max(480, Math.round(Math.min(window.innerWidth, 900) * Math.min(window.devicePixelRatio || 1, 3) / 160) * 160))

export interface ChapterMeta { kind: 'pdf' | 'images'; numPages: number; ratios?: Record<number, number> }

export const available = () => typeof window !== 'undefined' && 'caches' in window && window.isSecureContext

const pageKey = (chapterId: string, n: number) => `${PREFIX}${chapterId}/page/${n}`
const metaKey = (chapterId: string) => `${PREFIX}${chapterId}/meta`

async function open(): Promise<Cache | null> {
  if (!available()) return null
  try { return await caches.open(CACHE) } catch { return null }
}

/** Remember that a chapter was opened; forget the oldest ones beyond the limit (never the ones kept offline). */
async function touch(chapterId: string) {
  let index: Record<string, number> = {}
  try { index = JSON.parse(localStorage.getItem(INDEX_KEY) || '{}') } catch { /* corrupted */ }
  index[chapterId] = Date.now()
  const kept = pinnedChapterIds()
  const old = Object.entries(index).filter(([id]) => !kept.has(id))
    .sort((a, b) => b[1] - a[1]).slice(MAX_CHAPTERS).map(([id]) => id)
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
  // A copy the device cannot read back any more: downloaded again
  return res ? res.blob().catch(() => null) : null
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

// ─── Offline reading: what the reader needs without the server ───────────────
const key = (name: string) => `${PREFIX}${name}`

export async function putJson(name: string, data: unknown): Promise<void> {
  const cache = await open()
  await cache?.put(key(name), new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })).catch(() => {})
}

export async function getJson<T>(name: string): Promise<T | null> {
  const cache = await open()
  const res = await cache?.match(key(name)).catch(() => undefined)
  if (!res) return null
  try { return (await res.json()) as T } catch { return null }
}

export async function deleteKey(name: string): Promise<void> {
  const cache = await open()
  await cache?.delete(key(name)).catch(() => false)
}

/** A PDF chapter, whole (PDF.js opens it from here without the server) */
export async function putPdf(chapterId: string, blob: Blob): Promise<void> {
  const cache = await open()
  await cache?.put(key(`${chapterId}/pdf`), new Response(blob, { headers: { 'Content-Type': 'application/pdf' } })).catch(() => {})
}

export async function getPdf(chapterId: string): Promise<Blob | null> {
  const cache = await open()
  const res = await cache?.match(key(`${chapterId}/pdf`)).catch(() => undefined)
  return res ? res.blob() : null
}

/** Everything kept of a chapter (pages, PDF, page list) */
export async function deleteChapter(chapterId: string): Promise<void> {
  const cache = await open()
  if (!cache) return
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.startsWith(`${PREFIX}${chapterId}/`)) await cache.delete(req)
  }
}

const inflight = new Map<string, Promise<Blob>>()

/** Image page: from the cache, or downloaded once then cached (a page is never fetched twice at once). */
export function loadImagePage(chapterId: string, n: number, url: string): Promise<Blob> {
  const key = `${chapterId}/${n}`
  const running = inflight.get(key)
  if (running) return running
  const job = (async () => {
    const hit = await getPage(chapterId, n)
    if (hit) return hit
    const res = await fetch(url)
    if (!res.ok) throw Object.assign(new Error(`page ${n} : erreur ${res.status}`), { status: res.status })
    const blob = await res.blob()
    await putPage(chapterId, n, blob)
    return blob
  })()
  inflight.set(key, job)
  job.finally(() => inflight.delete(key)).catch(() => {})
  return job
}

/** Downloads the next pages in the background (one after the other). */
export async function prefetchPages(chapterId: string, pages: { n: number; url: string }[]): Promise<void> {
  for (const p of pages) {
    try { await loadImagePage(chapterId, p.n, p.url) } catch { /* shown later with its own error */ }
  }
}
