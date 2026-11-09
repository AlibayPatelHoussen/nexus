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
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { Media: {
    id: 16498, title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' },
    description: '<b>Humans</b> fight the titans.', genres: ['Action', 'Drama', 'Mahou Shoujo'], startDate: { year: 2013 },
  } } } })
  jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
    if (url.includes('/search/tv')) return { data: { results: [{ id: 1429, name: 'L’Attaque des Titans', first_air_date: '2013-04-07', genre_ids: [16], overview: tmdbFr }] } }
    if (url.includes('/tv/1429')) return { data: { id: 1429, overview: tmdbFr } }
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
