import { describe, expect, it } from 'vitest'
import { mangaPills } from './mangaKind'

describe('mangaPills', () => {
  it('names where a title comes from and how it reads', () => {
    expect(mangaPills({ type: 'manga', origin: 'manhwa', webtoon: true })).toEqual(['Manhwa', 'Webtoon'])
    expect(mangaPills({ type: 'manga', origin: 'manhua', webtoon: false })).toEqual(['Manhua'])
    expect(mangaPills({ type: 'manga', origin: 'manga', webtoon: true })).toEqual(['Webtoon'])
  })

  it('nothing for a Japanese manga, an unknown origin, or another kind of title', () => {
    expect(mangaPills({ type: 'manga', origin: 'manga', webtoon: false })).toEqual([])
    expect(mangaPills({ type: 'manga', origin: null })).toEqual([])
    expect(mangaPills({ type: 'film', origin: 'manhwa', webtoon: true })).toEqual([])
  })
})
