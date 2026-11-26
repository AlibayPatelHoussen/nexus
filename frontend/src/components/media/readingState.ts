import type { Chapter } from '@/types'
import type { ChapterReading } from '@/services/readingService'

export interface ReadingState {
  /** Chapter numbers read (in any version: colour and black & white are the same chapter) */
  readNumbers: Set<number>
  /** Page reached (0-based) in the chapters started and not finished */
  pageOf: Map<string, number>
  /** Where « Continuer » goes: the chapter being read (at its page), else the one after the last read */
  next: { chapter: Chapter; page: number } | null
  /** Something was read in this title */
  started: boolean
  /** Every chapter of the version is read */
  finished: boolean
  readCount: number
}

const byNumber = (a: Chapter, b: Chapter) => a.chapterNumber - b.chapterNumber || a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true })

/**
 * The reading state of a title from its progress (most recent first): what is read, what is
 * started, and where to continue. `version`: the version shown when nothing is read yet.
 */
export function readingState(chapters: Chapter[], rows: ChapterReading[], version: string | null): ReadingState {
  const byId = new Map(chapters.map((c) => [c.id, c]))
  const readNumbers = new Set<number>()
  const pageOf = new Map<string, number>()
  for (const r of rows) {
    const c = byId.get(r.chapterId)
    if (!c) continue
    if (r.completed) readNumbers.add(c.chapterNumber)
    else if (r.currentPage > 0) pageOf.set(c.id, r.currentPage)
  }
  const latest = rows.map((r) => ({ r, c: byId.get(r.chapterId) })).find((x) => x.c)
  // The version being read (the last chapter opened), else the one shown
  const v = latest?.c?.language ?? version
  const list = chapters.filter((c) => !v || c.language === v).sort(byNumber)
  let next: ReadingState['next'] = null
  if (latest?.c && !latest.r.completed) {
    next = { chapter: latest.c, page: latest.r.currentPage }
  } else {
    const last = Math.max(-Infinity, ...readNumbers)
    const c = list.find((x) => x.chapterNumber > last && !readNumbers.has(x.chapterNumber))
    next = c ? { chapter: c, page: 0 } : null
  }
  const readCount = list.filter((c) => readNumbers.has(c.chapterNumber)).length
  return {
    readNumbers, pageOf, next,
    started: rows.length > 0,
    finished: list.length > 0 && !next,
    readCount,
  }
}
