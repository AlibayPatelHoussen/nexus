import { pickManga, scoreMangaTitle, type MangaDexResult, mangaKind } from '../../src/services/scanner'

const manga = (id: string, title: Record<string, string>, altTitles: Record<string, string>[] = []): MangaDexResult =>
  ({ id, attributes: { title, altTitles } })

// Order of a MangaDex answer where the spin-offs come first
const onePiece = [
  manga('ace',   { en: 'One Piece: Ace’s Story—The Manga' }),
  manga('party', { en: 'One Piece Party' }),
  manga('main',  { en: 'One Piece' }, [{ ja: 'ワンピース' }, { fr: 'One Piece' }]),
  manga('color', { en: 'One Piece (Official Colored)' }),
]

describe('MangaDex matching', () => {
  it('picks the series itself, not a spin-off that starts the same way', () => {
    expect(pickManga('One Piece', onePiece)?.id).toBe('main')
  })

  it('finds the series through its alternative titles', () => {
    const res = [manga('ace', { en: 'One Piece: Ace’s Story—The Manga' }), manga('main', { 'ja-ro': 'Wan Pīsu' }, [{ en: 'One Piece' }])]
    expect(pickManga('One Piece', res)?.id).toBe('main')
  })

  it('ignores punctuation, accents and case', () => {
    expect(scoreMangaTitle('one piece aces story the manga', onePiece[0])).toBe(100)
    expect(scoreMangaTitle('Pokémon', manga('p', { en: 'pokemon' }))).toBe(100)
  })

  it('still picks the spin-off when that is the folder', () => {
    expect(pickManga('One Piece - Ace’s Story', onePiece)?.id).toBe('ace')
  })

  it('picks other entries of the franchise when they are the folder', () => {
    expect(pickManga('One Piece Party', onePiece)?.id).toBe('party')
    expect(pickManga('One Piece (Official Colored)', onePiece)?.id).toBe('color')
  })

  it('manga, manhwa or manhua from what the catalogues say; a webtoon is a long strip', () => {
    const md = (originalLanguage?: string, ...tags: string[]) => ({ attributes: { originalLanguage, tags: tags.map((en) => ({ attributes: { name: { en } } })) } })
    expect(mangaKind(md('ko', 'Action', 'Long Strip'))).toEqual({ origin: 'manhwa', webtoon: true })      // Solo Leveling, Tower of God
    expect(mangaKind(md('ja', 'Action'))).toEqual({ origin: 'manga', webtoon: false })
    expect(mangaKind(md('zh-hk', 'Web Comic'))).toEqual({ origin: 'manhua', webtoon: true })
    expect(mangaKind(md('fr'))).toEqual({ origin: 'manga', webtoon: false })
    // MangaDex does not say (or does not answer): AniList's country of origin
    expect(mangaKind(md(), { countryOfOrigin: 'KR' })).toEqual({ origin: 'manhwa', webtoon: false })
    expect(mangaKind(null, { countryOfOrigin: 'CN' })).toEqual({ origin: 'manhua', webtoon: false })
    expect(mangaKind(null, null)).toEqual({ origin: null, webtoon: false })
    // MangaDex wins when both speak
    expect(mangaKind(md('ko'), { countryOfOrigin: 'JP' }).origin).toBe('manhwa')
  })

  it('falls back to the first result when nothing matches', () => {
    expect(pickManga('Berserk', onePiece)?.id).toBe('ace')
    expect(pickManga('Berserk', [])).toBeNull()
  })
})
