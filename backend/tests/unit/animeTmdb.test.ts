import { pickAnimeResult } from '../../src/services/scanner'

describe('anime → TMDB series (posters with the title, logo, key art)', () => {
  const live = { id: 111110, name: 'One Piece', first_air_date: '2023-08-31', genre_ids: [10759, 35, 18] }
  const anime = { id: 37854, name: 'One Piece', first_air_date: '1999-10-20', genre_ids: [10759, 35, 16] }

  it('takes the animated series, never the live-action one', () => {
    expect(pickAnimeResult([live, anime], 1999)?.id).toBe(37854)
    expect(pickAnimeResult([live])).toBeNull()
  })

  it('prefers the one from the AniList year', () => {
    const dbz = { id: 12971, name: 'Dragon Ball Z', first_air_date: '1989-04-26', genre_ids: [16] }
    const kai = { id: 61709, name: 'Dragon Ball Z Kai', first_air_date: '2009-04-05', genre_ids: [16] }
    expect(pickAnimeResult([kai, dbz], 1989)?.id).toBe(12971)
    expect(pickAnimeResult([kai, dbz])?.id).toBe(61709)          // no year: first animated result
  })
})
