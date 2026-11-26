import { describe, expect, it } from 'vitest'
import type { Chapter } from '@/types'
import type { ChapterReading } from '@/services/readingService'
import { readingState } from './readingState'

const chap = (n: number, language: string | null = 'VF'): Chapter => ({
  id: `${language}-${n}`, mediaItemId: 'm', chapterNumber: n, title: null, folderPath: `/m/${language}/${n}`, pageCount: 20, language,
})
const chapters = [1, 2, 3, 4, 5].flatMap((n) => [chap(n), chap(n, 'VF Noir et blanc')])
const row = (chapterId: string, currentPage: number, completed: boolean): ChapterReading => ({ chapterId, currentPage, completed, updatedAt: '' })

describe('readingState', () => {
  it('nothing read: from the first chapter of the version shown', () => {
    const s = readingState(chapters, [], 'VF Noir et blanc')
    expect(s.next).toEqual({ chapter: chap(1, 'VF Noir et blanc'), page: 0 })
    expect(s.started).toBe(false)
    expect(s.finished).toBe(false)
  })

  it('a chapter being read: continue there, at its page', () => {
    const s = readingState(chapters, [row('VF-3', 7, false), row('VF-2', 19, true), row('VF-1', 19, true)], null)
    expect(s.next).toEqual({ chapter: chap(3), page: 7 })
    expect(s.pageOf.get('VF-3')).toBe(7)
    expect([...s.readNumbers]).toEqual([2, 1])
    expect(s.readCount).toBe(2)
  })

  it('the last one opened is read: the next chapter after the furthest read, in its version', () => {
    // chapters 1 → 4 marked read at once, then chapter 2 read again
    const s = readingState(chapters, [row('VF-2', 19, true), row('VF-1', 0, true), row('VF-3', 0, true), row('VF-4', 0, true)], null)
    expect(s.next).toEqual({ chapter: chap(5), page: 0 })
  })

  it('a chapter read in one version is read in the other one too', () => {
    const s = readingState(chapters, [row('VF Noir et blanc-1', 19, true)], 'VF')
    expect(s.readNumbers.has(1)).toBe(true)
    expect(s.next).toEqual({ chapter: chap(2, 'VF Noir et blanc'), page: 0 })
  })

  it('everything read: finished, nothing to continue', () => {
    const s = readingState(chapters, [1, 2, 3, 4, 5].map((n) => row(`VF-${n}`, 19, true)), null)
    expect(s.next).toBeNull()
    expect(s.finished).toBe(true)
    expect(s.readCount).toBe(5)
  })

  it('progress of chapters gone (deleted) is left aside', () => {
    const s = readingState(chapters, [row('gone', 3, false), row('VF-1', 19, true)], null)
    expect(s.next).toEqual({ chapter: chap(2), page: 0 })
  })
})
