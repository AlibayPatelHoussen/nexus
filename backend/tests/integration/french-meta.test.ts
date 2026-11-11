import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { query } from '../../src/config/database'

// Animes: TMDB's French synopsis first, else anime-sama's, else AniList's English one; genres in French
const ROOT = path.join(process.env.MEDIA_ROOT!, 'french-meta')
const ANIMES = path.join(ROOT, 'animes')
let tmdbFr = ''

beforeAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(ANIMES, 'Shingeki no Kyojin', 'Saison 1'), { recursive: true })
  fs.writeFileSync(path.join(ANIMES, 'Shingeki no Kyojin', 'Saison 1', 'Episode 1.mp4'), 'x')
  fs.mkdirSync(path.join(ROOT, 'scripts', 'data'), { recursive: true })
  process.env.ANIMES_PATH = ANIMES
  process.env.DOWNLOADERS_DIR = path.join(ROOT, 'scripts')
  process.env.TMDB_API_KEY = 'test-key-123'
  jest.spyOn(axios, 'post').mockImplementation(async (_url: string, body?: unknown) => {
    const search = (body as { variables?: { search?: string } })?.variables?.search
    const media = search === 'Your Name'
      // AniList's first result for « Your Name » is a 2016 advert with the film's characters
      ? [{ id: 99, title: { romaji: 'Suntory Minami Alps no Tennen Mizu' }, popularity: 900, format: 'SPECIAL', startDate: { year: 2016 } },
        { id: 21519, title: { romaji: 'Kimi no Na wa.', english: 'Your Name.', native: '君の名は。' }, popularity: 600000, format: 'MOVIE', startDate: { year: 2016 } }]
      : [{ id: 16498, title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' },
        description: '<b>Humans</b> fight the titans.', genres: ['Action', 'Drama', 'Mahou Shoujo'], startDate: { year: 2013 } }]
    return { data: { data: { Page: { media } } } }
  })
  jest.spyOn(axios, 'get').mockImplementation(async (url: string, opts?: { params?: { query?: string } }) => {
    const q = opts?.params?.query ?? ''
    if (url.includes('/search/tv') && /your name/i.test(q)) return { data: { results: [{ id: 90000, name: 'In Your Name, Allah', first_air_date: '2019-05-06', genre_ids: [16] }] } }
    if (url.includes('/search/movie') && /your name/i.test(q)) return { data: { results: [{ id: 372058, title: 'Your Name.', release_date: '2016-08-26', genre_ids: [16, 18], overview: 'Mitsuha et Taki…', poster_path: '/yn.jpg' }] } }
    if (url.includes('/search/tv')) return { data: { results: [{ id: 1429, name: 'L’Attaque des Titans', first_air_date: '2013-04-07', genre_ids: [16], overview: tmdbFr }] } }
    if (url.includes('/tv/1429')) return { data: { id: 1429, overview: tmdbFr } }
    if (url.includes('/movie/372058')) return { data: { id: 372058, overview: 'Mitsuha et Taki…' } }
    throw new Error(`unexpected ${url}`)
  })
})
afterAll(async () => {
  jest.restoreAllMocks()
  delete process.env.TMDB_API_KEY
  await query(`DELETE FROM media_items WHERE file_path LIKE $1 || '%'`, [ROOT])
  fs.rmSync(ROOT, { recursive: true, force: true })
})

const row = async () => (await query<{ overview: string; genres: string[]; tmdb_id: number }>(
  'SELECT overview, genres, tmdb_id FROM media_items WHERE file_path = $1', [path.join(ANIMES, 'Shingeki no Kyojin')])).rows[0]

it('anime: English only as a last resort, then replaced by a French synopsis', async () => {
  // loaded here: the scanner reads TMDB_API_KEY when it loads
  const { MediaScanner } = await import('../../src/services/scanner')

  await MediaScanner.scanAnimes()
  expect(await row()).toMatchObject({ overview: 'Humans fight the titans.', genres: ['Action', 'Drame', 'Magical girls'], tmdb_id: 1429 })

  // anime-sama knows a French synopsis
  fs.writeFileSync(path.join(ROOT, 'scripts', 'data', 'catalogue.json'), JSON.stringify([
    { title: 'Shingeki no Kyojin', slug: 'shingeki-no-kyojin', description: 'Depuis plus d’un siècle, l’humanité vit derrière des murs.' }]))
  await MediaScanner.scanAnimes()
  expect((await row()).overview).toMatch(/^Depuis plus/)

  // TMDB's French synopsis comes first
  tmdbFr = 'Synopsis français de TMDB pour la série.'
  await MediaScanner.scanAnimes()
  expect((await row()).overview).toBe(tmdbFr)
})

it('anime film (anisama.py « Your Name »): the film on AniList and TMDB, an old wrong match replaced', async () => {
  const { MediaScanner } = await import('../../src/services/scanner')
  const dir = path.join(ANIMES, 'Your Name')
  fs.mkdirSync(path.join(dir, 'Film — VOSTFR'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Film — VOSTFR', 'ep001.mp4'), 'x')
  // Matched by the old look-up (before migration 016): the advert, and an unrelated TMDB series
  await query(`INSERT INTO media_items (type, title, file_path, anilist_id, tmdb_id, year, poster_path)
               VALUES ('anime', 'Suntory Minami Alps no Tennen Mizu', $1, 99, NULL, 2016, 'https://image.tmdb.org/t/p/w500/allah.jpg')`, [dir])

  // Opening the Animes page (quick scan) is enough: it is looked up again, once
  await MediaScanner.quickly('anime', () => MediaScanner.scanAnimes())
  const yn = (await query<{ title: string; anilist_id: number; tmdb_id: number; tmdb_kind: string; poster_path: string; meta_checked_at: Date | null }>(
    'SELECT title, anilist_id, tmdb_id, tmdb_kind, poster_path, meta_checked_at FROM media_items WHERE file_path = $1', [dir])).rows[0]
  expect(yn).toMatchObject({ title: 'Your Name.', anilist_id: 21519, tmdb_id: 372058, tmdb_kind: 'movie', poster_path: 'https://image.tmdb.org/t/p/w500/yn.jpg' })
  expect(yn.meta_checked_at).not.toBeNull()

  // Known now: a quick scan does not ask AniList again
  const asked = (axios.post as jest.Mock).mock.calls.length
  await MediaScanner.quickly('anime', () => MediaScanner.scanAnimes())
  expect((axios.post as jest.Mock).mock.calls.length).toBe(asked)
})
