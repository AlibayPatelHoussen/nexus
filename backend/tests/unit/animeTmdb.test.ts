import fs from 'fs'
import os from 'os'
import path from 'path'
import { animeSearchNames, isFilmFolder, pickAniListResult, pickAnimeResult } from '../../src/services/scanner'

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

describe('anime films (the owner\'s « Your Name » from anisama.py)', () => {
  it('AniList: the entry named like the folder, not the advert AniList lists first', () => {
    const advert = { id: 99, title: { romaji: 'Suntory Minami Alps no Tennen Mizu' }, synonyms: ['Your Name. x Suntory'], popularity: 900, format: 'SPECIAL' }
    const film = { id: 21519, title: { romaji: 'Kimi no Na wa.', english: 'Your Name.' }, popularity: 600000, format: 'MOVIE' }
    expect(pickAniListResult([advert, film], 'Your Name')?.id).toBe(21519)
    expect(pickAniListResult([advert, film], 'Kimi no Na wa')?.id).toBe(21519)
    // Two entries named the same: the best known one
    const remake = { id: 5, title: { romaji: 'Your Name' }, popularity: 10 }
    expect(pickAniListResult([remake, film], 'Your Name')?.id).toBe(21519)
    // No entry named like it: AniList's own first result
    expect(pickAniListResult([advert, film], 'Kimi no Na')?.id).toBe(99)
    expect(pickAniListResult([], 'Your Name')).toBeNull()
  })

  it('TMDB: an animated film, by its release year', () => {
    const film = { id: 372058, title: 'Your Name.', release_date: '2016-08-26', genre_ids: [16, 10749, 18], vote_count: 11000 }
    const live = { id: 1, title: 'Your Name', release_date: '2016-01-01', genre_ids: [18], vote_count: 50000 }
    const other = { id: 2, title: 'Your Name Engraved Herein', release_date: '2020-09-30', genre_ids: [16], vote_count: 20000 }
    expect(pickAnimeResult([live, other, film], 2016)?.id).toBe(372058)
  })

  it('a folder holding only « Film » folders is a film', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-film-'))
    try {
      const mk = (...p: string[]) => fs.mkdirSync(path.join(root, ...p), { recursive: true })
      mk('Your Name', 'Film — VOSTFR'); mk('Your Name', 'Film — VF')
      mk('Demon Slayer', 'Saison1 — VOSTFR'); mk('Demon Slayer', 'Film — VOSTFR')
      mk('Empty')
      expect(await isFilmFolder(path.join(root, 'Your Name'))).toBe(true)
      expect(await isFilmFolder(path.join(root, 'Demon Slayer'))).toBe(false)
      expect(await isFilmFolder(path.join(root, 'Empty'))).toBe(false)
      expect(await isFilmFolder(path.join(root, 'Missing'))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
