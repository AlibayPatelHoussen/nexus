import { pickManga, scoreMangaTitle, type MangaDexResult } from '../../src/services/scanner'

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

  it('falls back to the first result when nothing matches', () => {
    expect(pickManga('Berserk', onePiece)?.id).toBe('ace')
    expect(pickManga('Berserk', [])).toBeNull()
  })
})
