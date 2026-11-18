import { beforeEach, describe, expect, it } from 'vitest'
import { noteRead, wantedChapters } from './offlineManga'
import { pinnedChapterIds, readIndex, writeIndex } from './offlineIndex'
import type { Chapter } from '@/types'

const ch = (n: number, language: string | null = 'VF'): Chapter => ({
  id: `${language}-${n}`, mediaItemId: 'm', chapterNumber: n, title: null, folderPath: `/m/${language}/${n}`, pageCount: 10, language,
})
const vf = [3, 1, 2, 5, 4, 6].map((n) => ch(n))
const vostfr = [1, 2, 3].map((n) => ch(n, 'VOSTFR'))

beforeEach(() => localStorage.clear())

describe('wantedChapters', () => {
  it('the next chapters of the version, in order, from the first when nothing was read', () => {
    expect(wantedChapters([...vf, ...vostfr], 5, 'VF').map((c) => c.id)).toEqual(['VF-1', 'VF-2', 'VF-3', 'VF-4', 'VF-5'])
    expect(wantedChapters([...vf, ...vostfr], 5, 'VOSTFR').map((c) => c.id)).toEqual(['VOSTFR-1', 'VOSTFR-2', 'VOSTFR-3'])
  })
  it('from the chapter read last (the ones before are not kept)', () => {
    expect(wantedChapters(vf, 5, 'VF', 'VF-4').map((c) => c.id)).toEqual(['VF-4', 'VF-5', 'VF-6'])
    expect(wantedChapters(vf, 'all', 'VF', 'VF-2').map((c) => c.id)).toEqual(['VF-2', 'VF-3', 'VF-4', 'VF-5', 'VF-6'])
  })
  it('a version gone or none: the first one; an unknown last chapter: from the start', () => {
    expect(wantedChapters(vf, 5, 'Gone').map((c) => c.id)[0]).toBe('VF-1')
    expect(wantedChapters(vf, 10, null, 'nope').map((c) => c.id)).toHaveLength(6)
    expect(wantedChapters([ch(2, null), ch(1, null)], 5, null).map((c) => c.chapterNumber)).toEqual([1, 2])
  })
})

describe('offline index', () => {
  it('the kept chapters are pinned (never pushed out of the reader cache)', () => {
    writeIndex((i) => { i.chapters['VF-1'] = { mediaId: 'm', bytes: 10, pages: 2, at: 1 } })
    expect([...pinnedChapterIds()]).toEqual(['VF-1'])
  })
  it('reading a chapter moves the start of the kept ones and follows its version', () => {
    writeIndex((i) => { i.titles.m = { count: 10, version: 'VF', title: 'Manga' } })
    noteRead('m', 'VOSTFR-2', 'VOSTFR')
    expect(readIndex().lastRead.m).toBe('VOSTFR-2')
    expect(readIndex().titles.m.version).toBe('VOSTFR')
    // A title not kept: only remembered
    noteRead('other', 'x-1', 'VF')
    expect(readIndex().titles.other).toBeUndefined()
    expect(readIndex().lastRead.other).toBe('x-1')
  })
})
