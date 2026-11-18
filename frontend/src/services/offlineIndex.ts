/**
 * What this device keeps for reading offline (manga), in localStorage: the titles switched
 * « Hors ligne », the chapters downloaded for them and the last chapter opened of each title.
 * The pages themselves are in Cache Storage (readerCache).
 */
export type OfflineCount = 5 | 10 | 25 | 'all'

export interface OfflineTitle {
  /** How many chapters are kept, from the one being read */
  count:   OfflineCount
  /** Version (folder) the chapters are taken from: « VF », « VF Noir et blanc »… */
  version: string | null
  title:   string
}

export interface OfflineChapter {
  mediaId: string
  bytes:   number
  pages:   number
  at:      number
}

export interface OfflineIndex {
  titles:   Record<string, OfflineTitle>
  chapters: Record<string, OfflineChapter>
  /** Last chapter opened of each title (the kept chapters start there) */
  lastRead: Record<string, string>
}

const KEY = 'nexus-offline-v1'
const empty = (): OfflineIndex => ({ titles: {}, chapters: {}, lastRead: {} })

export function readIndex(): OfflineIndex {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<OfflineIndex> | null
    return { ...empty(), ...(raw ?? {}) }
  } catch { return empty() }
}

export function writeIndex(change: (index: OfflineIndex) => void): OfflineIndex {
  const index = readIndex()
  change(index)
  try { localStorage.setItem(KEY, JSON.stringify(index)) } catch { /* private mode, full */ }
  return index
}

export function clearIndex() {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

/** Chapters kept for offline reading: never pushed out of the reader's cache */
export function pinnedChapterIds(): Set<string> {
  return new Set(Object.keys(readIndex().chapters))
}
