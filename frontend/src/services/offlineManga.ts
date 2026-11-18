import { api } from './api'
import { getStreamToken, withStreamToken } from './streamToken'
import {
  PAGE_WIDTH, available, deleteChapter, deleteKey, getJson, getPage, putJson, putPage, putPdf,
} from './readerCache'
import { clearIndex, readIndex, writeIndex, type OfflineCount, type OfflineIndex } from './offlineIndex'
import { chapterVersions } from '@/components/media/chapterVersions'
import type { Chapter, MediaItem } from '@/types'

/**
 * Mangas « Hors ligne » (switch in a title's chapters, off by default): this device keeps the
 * next chapters from the one being read, so they read without a connection (the app itself
 * then opens offline too: service worker). Chapters already read leave on their own.
 *
 * Pages are the reader's (readerCache, same keys): a kept chapter opens instantly online too.
 */

export type OfflineMedia = MediaItem & { chapters?: Chapter[] }

interface PagesResponse { type: 'pdf' | 'images'; pdfUrl?: string; data: { name: string; url: string }[] }
/** The page list of a kept chapter, for the reader without the server */
export interface ChapterManifest { type: 'pdf' | 'images'; pages: { name: string }[] }

export interface OfflineProgress { mediaId: string; chapterId: string; done: number; total: number }

interface State {
  index:   OfflineIndex
  /** Chapter being downloaded */
  active:  OfflineProgress | null
  /** Titles waiting for a download (or whose download stopped) */
  waiting: Record<string, string | null>   // mediaId → error, null = queued
}

export const offlineSupported = (): boolean => available() && 'serviceWorker' in navigator

// ─── Store (useSyncExternalStore) ───────────────────────────────────────────
let state: State = { index: readIndex(), active: null, waiting: {} }
const listeners = new Set<() => void>()
const without = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k))
const emit = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) }
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getState = () => state
const refreshIndex = (index = readIndex()) => emit({ index })

// ─── The service worker keeps the app itself (and these titles' pictures) ────
function tellServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const media = Object.keys(readIndex().titles)
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'offline', on: media.length > 0, media }))
    .catch(() => {})
}

/** The reader's « PDF address » of a kept PDF chapter: opened from the device */
export const OFFLINE_PDF = 'offline:pdf'

const mediaKey = (id: string) => `media/${id}`
const manifestKey = (chapterId: string) => `${chapterId}/manifest`

/** The title as last seen online (detail page and reader without the server) */
export const offlineMedia = (id: string) => getJson<OfflineMedia>(mediaKey(id))
export const offlineManifest = (chapterId: string) => getJson<ChapterManifest>(manifestKey(chapterId))
export const isKept = (chapterId: string) => !!readIndex().chapters[chapterId]
export const isOfflineTitle = (mediaId: string) => !!readIndex().titles[mediaId]

/** Titles kept on this device (the manga library without a connection) */
export async function offlineTitles(): Promise<OfflineMedia[]> {
  const ids = Object.keys(readIndex().titles)
  const all = await Promise.all(ids.map((id) => offlineMedia(id)))
  return all.filter((m): m is OfflineMedia => !!m)
}

const byNumber = (a: Chapter, b: Chapter) =>
  a.chapterNumber - b.chapterNumber || a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true })

/** The chapters to keep: `count` of the chosen version, from the one read last (else the first) */
export function wantedChapters(chapters: Chapter[], count: OfflineCount, version: string | null, lastRead?: string): Chapter[] {
  const versions = chapterVersions(chapters)
  const v = version && versions.includes(version) ? version : versions[0] ?? null
  const list = (v ? chapters.filter((c) => c.language === v) : [...chapters]).sort(byNumber)
  const at = lastRead ? list.findIndex((c) => c.id === lastRead) : -1
  const from = list.slice(Math.max(0, at))
  return count === 'all' ? from : from.slice(0, count)
}

// ─── Switch on / off ─────────────────────────────────────────────────────────
export async function enableOffline(media: OfflineMedia, count: OfflineCount, version: string | null) {
  writeIndex((i) => { i.titles[media.id] = { count, version, title: media.title } })
  refreshIndex()
  // Kept even when the phone needs room (installed app; asked once)
  void navigator.storage?.persist?.().catch(() => false)
  await putJson(mediaKey(media.id), media)
  tellServiceWorker()
  void syncOffline(media.id)
}

export async function setOfflineCount(mediaId: string, count: OfflineCount) {
  writeIndex((i) => { if (i.titles[mediaId]) i.titles[mediaId].count = count })
  refreshIndex()
  void syncOffline(mediaId)
}

export async function disableOffline(mediaId: string) {
  aborts.get(mediaId)?.abort()
  const index = writeIndex((i) => { delete i.titles[mediaId] })
  const ids = Object.entries(index.chapters).filter(([, c]) => c.mediaId === mediaId).map(([id]) => id)
  for (const id of ids) await removeChapter(id)
  await deleteKey(mediaKey(mediaId))
  emit({ waiting: without(state.waiting, mediaId) })
  refreshIndex()
  tellServiceWorker()
}

/** Signed out: nothing of this account stays on the device */
export async function clearOffline() {
  for (const a of aborts.values()) a.abort()
  const index = readIndex()
  for (const id of Object.keys(index.chapters)) await deleteChapter(id)
  for (const id of Object.keys(index.titles)) await deleteKey(mediaKey(id))
  clearIndex()
  emit({ index: readIndex(), active: null, waiting: {} })
  tellServiceWorker()
}

async function removeChapter(chapterId: string) {
  await deleteChapter(chapterId)
  writeIndex((i) => { delete i.chapters[chapterId] })
}

/** The reader opened a chapter: the kept ones now start there (the ones before leave) */
export function noteRead(mediaId: string, chapterId: string, version?: string | null) {
  const before = readIndex()
  if (before.lastRead[mediaId] === chapterId) return
  writeIndex((i) => {
    i.lastRead[mediaId] = chapterId
    if (version && i.titles[mediaId]) i.titles[mediaId].version = version
  })
  refreshIndex()
  if (before.titles[mediaId]) void syncOffline(mediaId)
}

// ─── Downloads: one title, one chapter at a time ─────────────────────────────
const aborts = new Map<string, AbortController>()
const queue = new Set<string>()
let running: Promise<void> | null = null

/** Brings the kept chapters of these titles (all of them by default) up to date. */
export function syncOffline(mediaId?: string): Promise<void> {
  if (!offlineSupported()) return Promise.resolve()
  const ids = mediaId ? [mediaId] : Object.keys(readIndex().titles)
  for (const id of ids) queue.add(id)
  emit({ waiting: { ...state.waiting, ...Object.fromEntries(ids.map((id) => [id, null])) } })
  running ??= (async () => {
    try {
      while (queue.size) {
        const id = queue.values().next().value as string
        queue.delete(id)
        await syncTitle(id)
      }
    } finally { running = null }
  })()
  return running
}

async function syncTitle(mediaId: string) {
  const title = readIndex().titles[mediaId]
  if (!title) return
  const ctrl = new AbortController()
  aborts.set(mediaId, ctrl)
  const done = (error: string | null) => {
    const rest = without(state.waiting, mediaId)
    emit({ active: null, waiting: error ? { ...rest, [mediaId]: error } : rest })
  }
  try {
    // The chapters as the server has them now (else as kept: the removals still happen)
    let media: OfflineMedia | null = null
    try {
      media = (await api.get<{ data: OfflineMedia }>(`/media/${mediaId}`, { signal: ctrl.signal, timeout: 15_000 })).data.data
      await putJson(mediaKey(mediaId), media)
    } catch { media = await offlineMedia(mediaId) }
    if (!media || ctrl.signal.aborted) { done(null); return }

    const index = readIndex()
    const wanted = wantedChapters(media.chapters ?? [], title.count, title.version, index.lastRead[mediaId])
    const keep = new Set(wanted.map((c) => c.id))
    for (const [id, c] of Object.entries(index.chapters)) {
      if (c.mediaId === mediaId && !keep.has(id)) await removeChapter(id)
    }
    refreshIndex()

    for (const ch of wanted) {
      if (ctrl.signal.aborted || !readIndex().titles[mediaId]) break
      if (readIndex().chapters[ch.id]) continue
      if (!navigator.onLine) { done('En attente de connexion'); return }
      const { bytes, pages } = await downloadChapter(mediaId, ch.id, ctrl.signal)
      if (ctrl.signal.aborted || !readIndex().titles[mediaId]) { await deleteChapter(ch.id); break }
      writeIndex((i) => { i.chapters[ch.id] = { mediaId, bytes, pages, at: Date.now() } })
      refreshIndex()
    }
    done(null)
  } catch (err) {
    if (ctrl.signal.aborted) { done(null); return }
    const e = err as { response?: unknown; message?: string }
    done(e.response ? (e.message || 'Erreur du serveur') : 'En attente de connexion')
  } finally {
    if (aborts.get(mediaId) === ctrl) aborts.delete(mediaId)
  }
}

/** Every page of a chapter into the device (three at a time), with its page list. */
async function downloadChapter(mediaId: string, chapterId: string, signal: AbortSignal): Promise<{ bytes: number; pages: number }> {
  const { data } = await api.get<PagesResponse>(`/media/chapters/${chapterId}/pages`, { signal, timeout: 30_000 })
  const token = await getStreamToken()
  const progress = (done: number, total: number) => emit({ active: { mediaId, chapterId, done, total } })

  if (data.type === 'pdf' && data.pdfUrl) {
    progress(0, 1)
    const res = await fetch(withStreamToken(data.pdfUrl, token), { signal })
    if (!res.ok) throw new Error(`PDF : erreur ${res.status}`)
    const blob = await res.blob()
    await putPdf(chapterId, blob)
    await putJson(manifestKey(chapterId), { type: 'pdf', pages: [] } satisfies ChapterManifest)
    progress(1, 1)
    return { bytes: blob.size, pages: 0 }
  }

  const pages = data.data
  let bytes = 0
  let done = 0
  progress(0, pages.length)
  let next = 0
  const worker = async () => {
    while (next < pages.length && !signal.aborted) {
      const n = ++next
      const p = pages[n - 1]
      const hit = await getPage(chapterId, n)
      let blob = hit
      if (!blob) {
        const res = await fetch(withStreamToken(`${p.url}${p.url.includes('?') ? '&' : '?'}w=${PAGE_WIDTH}`, token), { signal })
        if (!res.ok) throw new Error(`page ${n} : erreur ${res.status}`)
        blob = await res.blob()
        await putPage(chapterId, n, blob)
      }
      bytes += blob.size
      progress(++done, pages.length)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  await putJson(manifestKey(chapterId), { type: 'images', pages: pages.map((p) => ({ name: p.name })) } satisfies ChapterManifest)
  return { bytes, pages: pages.length }
}

/** On start and when the connection comes back: what was left to download */
let started = false
export function startOfflineSync() {
  if (started || !offlineSupported()) return
  started = true
  window.addEventListener('online', () => { void syncOffline() })
  tellServiceWorker()
  if (Object.keys(readIndex().titles).length) void syncOffline()
}
