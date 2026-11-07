import { animeSearchNames, pickAnimeResult } from '../../src/services/scanner'

describe('anime → TMDB series (posters with the title, logo, key art)', () => {
  const live = { id: 111110, name: 'One Piece', first_air_date: '2023-08-31', genre_ids: [10759, 35, 18] }
  const anime = { id: 37854, name: 'One Piece', first_air_date: '1999-10-20', genre_ids: [10759, 35, 16] }

  it('takes the animated series, never the live-action one', () => {
    expect(pickAnimeResult([live, anime], 1999)?.id).toBe(37854)
    expect(pickAnimeResult([live])).toBeNull()
  })

  it('the series itself, not its chibi spin-off from the same year (the owner\'s Attack on Titan)', () => {
    const chibi = { id: 224499, name: 'Attack on Titan: Chibi Theater', first_air_date: '2013-12-23', genre_ids: [16, 35], vote_count: 9 }
    const main = { id: 1429, name: 'L’Attaque des Titans', first_air_date: '2013-04-07', genre_ids: [16, 10765, 10759], vote_count: 7200 }
    expect(pickAnimeResult([chibi, main], 2013)?.id).toBe(1429)
    expect(pickAnimeResult([chibi, main])?.id).toBe(1429)
  })

  it('prefers the one from the AniList year', () => {
    const dbz = { id: 12971, name: 'Dragon Ball Z', first_air_date: '1989-04-26', genre_ids: [16] }
    const kai = { id: 61709, name: 'Dragon Ball Z Kai', first_air_date: '2009-04-05', genre_ids: [16] }
    expect(pickAnimeResult([kai, dbz], 1989)?.id).toBe(12971)
    expect(pickAnimeResult([kai, dbz])?.id).toBe(61709)          // no year: first animated result
  })

  it('also searches without the season / subtitle (AniList has one entry per season, TMDB one series)', () => {
    expect(animeSearchNames(['Attack on Titan Final Season', 'Shingeki no Kyojin: The Final Season']))
      .toEqual(['Attack on Titan Final Season', 'Shingeki no Kyojin: The Final Season', 'Attack on Titan', 'Shingeki no Kyojin'])
    expect(animeSearchNames(['Attack on Titan Season 3 Part 2', null, 'Attack on Titan Season 3 Part 2'])).toEqual(['Attack on Titan Season 3 Part 2', 'Attack on Titan'])
    expect(animeSearchNames(['Shingeki no Kyojin 2nd Season'])).toEqual(['Shingeki no Kyojin 2nd Season', 'Shingeki no Kyojin'])
    expect(animeSearchNames(['One Piece'])).toEqual(['One Piece'])
  })
})
