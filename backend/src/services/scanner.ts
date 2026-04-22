import fs from 'fs/promises'
import path from 'path'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import axios from 'axios'

const TMDB_KEY      = process.env.TMDB_API_KEY
const TMDB_BASE     = process.env.TMDB_BASE_URL     || 'https://api.themoviedb.org/3'
const TMDB_IMG      = process.env.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p'
const ANILIST_URL   = process.env.ANILIST_API_URL   || 'https://graphql.anilist.co'
const MANGADEX_URL  = process.env.MANGADEX_API_URL  || 'https://api.mangadex.org'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif']

interface TmdbResult {
  id?: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string
  backdrop_path?: string
  genres?: { name: string }[]
  release_date?: string
  first_air_date?: string
  vote_average?: number
  vote_count?: number
  status?: string
  original_language?: string
}

interface MangaDexRelationship {
  type: string
  attributes?: { fileName?: string }
}

interface MangaDexResult {
  id?: string
  coverUrl?: string
  attributes?: {
    title?: Record<string, string>
    description?: Record<string, string>
    status?: string
    tags?: { attributes?: { name?: Record<string, string> } }[]
  }
  relationships?: MangaDexRelationship[]
}

interface AniListResult {
  id?: number
  title?: { romaji?: string; english?: string; native?: string; french?: string }
  description?: string
  coverImage?: { large?: string; extraLarge?: string }
  bannerImage?: string
  genres?: string[]
  averageScore?: number
  status?: string
  startDate?: { year?: number }
}

// ─── Parse filename ──────────────────────────────────
function parseFilename(filename: string): { title: string; year?: number } {
  const noExt  = path.basename(filename, path.extname(filename))
  const yearMatch = noExt.match(/[.(]?(\d{4})[.)]/)
  const year   = yearMatch ? parseInt(yearMatch[1]) : undefined
  const title  = noExt
    .replace(/[.(]\d{4}[.)].*/, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { title, year }
}

// ─── TMDB search ─────────────────────────────────────
async function searchTMDB(title: string, year?: number, type: 'movie' | 'tv' = 'movie'): Promise<TmdbResult | null> {
  if (!TMDB_KEY) return null
  try {
    const params: Record<string, string | number> = { api_key: TMDB_KEY, query: title, language: 'fr-FR' }
    if (year) params.year = year
    const { data } = await axios.get(`${TMDB_BASE}/search/${type}`, { params })
    return (data.results?.[0] as TmdbResult) || null
  } catch (err) {
    logger.warn(`TMDB search failed for "${title}": ${err}`)
    return null
  }
}

async function getTMDBDetails(id: number, type: 'movie' | 'tv'): Promise<TmdbResult | null> {
  if (!TMDB_KEY) return null
  try {
    const { data } = await axios.get(`${TMDB_BASE}/${type}/${id}`, {
      params: { api_key: TMDB_KEY, language: 'fr-FR' },
    })
    return data as TmdbResult
  } catch { return null }
}

// ─── AniList search ──────────────────────────────────
async function searchAniList(title: string, type: 'ANIME' | 'MANGA' = 'ANIME'): Promise<AniListResult | null> {
  const query_gql = `
    query ($search: String, $type: MediaType) {
      Media(search: $search, type: $type, sort: SEARCH_MATCH) {
        id title { romaji english native }
        description coverImage { large extraLarge }
        bannerImage genres averageScore episodes
        status startDate { year } format
      }
    }
  `
  try {
    const { data } = await axios.post(ANILIST_URL, {
      query: query_gql,
      variables: { search: title, type },
    })
    return (data.data?.Media as AniListResult) || null
  } catch {
    return null
  }
}

// ─── MangaDex search ─────────────────────────────────
async function searchMangaDex(title: string): Promise<MangaDexResult | null> {
  try {
    const { data } = await axios.get(`${MANGADEX_URL}/manga`, {
      params: { title, limit: 1, 'includes[]': ['cover_art'] },
    })
    const manga = data.data?.[0] as MangaDexResult | undefined
    if (!manga) return null

    const cover = manga.relationships?.find((r) => r.type === 'cover_art')
    const coverUrl = cover
      ? `https://uploads.mangadex.org/covers/${manga.id}/${cover.attributes?.fileName}`
      : undefined

    return { ...manga, coverUrl }
  } catch { return null }
}

// ─── File size ───────────────────────────────────────
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    return stat.size
  } catch { return 0 }
}

// ─── SCANNER ─────────────────────────────────────────
export class MediaScanner {

  static async scanFilms(): Promise<number> {
    const dir = process.env.FILMS_PATH || '/media/films'
    let count = 0

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        // Check if already scanned
        const existing = await query(
          'SELECT id FROM media_items WHERE file_path = $1',
          [fullPath],
        )
        if (existing.rows.length > 0) continue

        const isVideoFile = entry.isFile() && VIDEO_EXTS.includes(path.extname(entry.name).toLowerCase())
        const isDir       = entry.isDirectory()

        if (!isVideoFile && !isDir) continue

        // For directory, find main video file
        let videoPath = fullPath
        if (isDir) {
          const files = await fs.readdir(fullPath)
          const video = files.find((f) => VIDEO_EXTS.includes(path.extname(f).toLowerCase()))
          if (!video) continue
          videoPath = path.join(fullPath, video)
        }

        const { title, year } = parseFilename(isDir ? entry.name : path.basename(videoPath, path.extname(videoPath)))
        const tmdb = await searchTMDB(title, year, 'movie')

        let details: TmdbResult | null = null
        if (tmdb?.id) details = await getTMDBDetails(tmdb.id, 'movie')

        const item = details || tmdb

        await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, tmdb_id, overview,
            poster_path, backdrop_path, genres, year, rating, vote_count,
            status, language, file_size, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
           ON CONFLICT (file_path) DO NOTHING`,
          [
            'film',
            item?.title || item?.name || title,
            item?.original_title || null,
            videoPath,
            item?.id || null,
            item?.overview || null,
            item?.poster_path   ? `${TMDB_IMG}/w500${item.poster_path}`   : null,
            item?.backdrop_path ? `${TMDB_IMG}/w1280${item.backdrop_path}` : null,
            item?.genres?.map((g) => g.name) || [],
            item?.release_date ? parseInt(item.release_date.slice(0, 4)) : year || null,
            item?.vote_average || null,
            item?.vote_count || null,
            item?.status || null,
            item?.original_language || null,
            await getFileSize(videoPath),
          ],
        )
        count++
        logger.info(`Scanned film: ${title}`)
      }
    } catch (err) {
      logger.error(`Film scan error: ${err}`)
    }

    return count
  }

  static async scanSeries(): Promise<number> {
    const dir = process.env.SERIES_PATH || '/media/series'
    let count = 0

    try {
      const series = await fs.readdir(dir, { withFileTypes: true })

      for (const serieDir of series.filter((e) => e.isDirectory())) {
        const seriePath = path.join(dir, serieDir.name)
        const { title } = parseFilename(serieDir.name)

        const existing = await query('SELECT id FROM media_items WHERE file_path = $1', [seriePath])
        if (existing.rows.length > 0) continue

        const tmdb    = await searchTMDB(title, undefined, 'tv')
        const details = tmdb?.id ? await getTMDBDetails(tmdb.id, 'tv') : null
        const item    = details || tmdb

        const { rows } = await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, tmdb_id, overview,
            poster_path, backdrop_path, genres, year, rating, vote_count, status, language, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
           RETURNING id`,
          [
            'serie', item?.name || title, item?.original_name || null, seriePath,
            item?.id || null, item?.overview || null,
            item?.poster_path   ? `${TMDB_IMG}/w500${item.poster_path}`   : null,
            item?.backdrop_path ? `${TMDB_IMG}/w1280${item.backdrop_path}` : null,
            item?.genres?.map((g) => g.name) || [],
            item?.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : null,
            item?.vote_average || null, item?.vote_count || null,
            item?.status || null, item?.original_language || null,
          ],
        )

        const mediaId = rows[0]?.id as string | undefined
        if (!mediaId) continue

        // Scan episodes
        await MediaScanner.scanEpisodes(seriePath, mediaId)
        count++
      }
    } catch (err) {
      logger.error(`Series scan error: ${err}`)
    }

    return count
  }

  static async scanEpisodes(seriesPath: string, mediaItemId: string): Promise<void> {
    try {
      const seasons = await fs.readdir(seriesPath, { withFileTypes: true })

      for (const season of seasons) {
        const seasonPath = path.join(seriesPath, season.name)
        const seasonNum  = parseInt(season.name.match(/\d+/)?.[0] || '1')

        const files = season.isDirectory()
          ? await fs.readdir(seasonPath)
          : [season.name]

        const basePath = season.isDirectory() ? seasonPath : seriesPath

        for (const file of files) {
          if (!VIDEO_EXTS.includes(path.extname(file).toLowerCase())) continue
          const epMatch = file.match(/[Ee](\d+)/)
          const epNum   = epMatch ? parseInt(epMatch[1]) : 1
          const filePath = path.join(basePath, file)

          await query(
            `INSERT INTO episodes (media_item_id, season, episode_number, file_path, file_size)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [mediaItemId, seasonNum, epNum, filePath, await getFileSize(filePath)],
          )
        }
      }
    } catch (err) {
      logger.error(`Episode scan error: ${err}`)
    }
  }

  static async scanAnimes(): Promise<number> {
    const dir = process.env.ANIMES_PATH || '/media/animes'
    let count = 0

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries.filter((e) => e.isDirectory())) {
        const animePath = path.join(dir, entry.name)
        const { title } = parseFilename(entry.name)

        const existing = await query('SELECT id FROM media_items WHERE file_path = $1', [animePath])
        if (existing.rows.length > 0) continue

        const anilist = await searchAniList(title, 'ANIME')

        await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, anilist_id, overview,
            poster_path, backdrop_path, genres, year, rating, status, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           ON CONFLICT DO NOTHING`,
          [
            'anime',
            anilist?.title?.french || anilist?.title?.english || anilist?.title?.romaji || title,
            anilist?.title?.native || null,
            animePath,
            anilist?.id || null,
            anilist?.description?.replace(/<[^>]*>/g, '') || null,
            anilist?.coverImage?.extraLarge || anilist?.coverImage?.large || null,
            anilist?.bannerImage || null,
            anilist?.genres || [],
            anilist?.startDate?.year || null,
            anilist?.averageScore ? anilist.averageScore / 10 : null,
            anilist?.status || null,
          ],
        )
        count++
      }
    } catch (err) {
      logger.error(`Anime scan error: ${err}`)
    }

    return count
  }

  static async scanManga(): Promise<number> {
    const dir = process.env.MANGA_PATH || '/media/scans'
    let count = 0

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries.filter((e) => e.isDirectory())) {
        const mangaPath = path.join(dir, entry.name)
        const { title } = parseFilename(entry.name)

        const existing = await query('SELECT id FROM media_items WHERE file_path = $1', [mangaPath])
        if (existing.rows.length > 0) continue

        const mdx = await searchMangaDex(title)

        await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, mangadex_id,
            overview, poster_path, genres, status, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT DO NOTHING`,
          [
            'manga',
            mdx?.attributes?.title?.en || mdx?.attributes?.title?.['ja-ro'] || title,
            mdx?.attributes?.title?.ja || null,
            mangaPath,
            mdx?.id || null,
            mdx?.attributes?.description?.en || null,
            mdx?.coverUrl || null,
            mdx?.attributes?.tags?.map((t) => t.attributes?.name?.['en']).filter(Boolean) || [],
            mdx?.attributes?.status || null,
          ],
        )

        // Scan chapters
        await MediaScanner.scanChapters(mangaPath, entry.name)
        count++
      }
    } catch (err) {
      logger.error(`Manga scan error: ${err}`)
    }

    return count
  }

  static async scanChapters(mangaPath: string, _mangaName: string): Promise<void> {
    try {
      const { rows } = await query(
        'SELECT id FROM media_items WHERE file_path = $1',
        [mangaPath],
      )
      if (!rows[0]) return
      const mediaId = rows[0].id

      const chapters = await fs.readdir(mangaPath, { withFileTypes: true })

      for (const chap of chapters.filter((e) => e.isDirectory())) {
        const chapPath = path.join(mangaPath, chap.name)
        const chapNum  = parseFloat(chap.name.match(/[\d.]+/)?.[0] || '0')

        const files    = await fs.readdir(chapPath)
        const pageCount = files.filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase())).length

        await query(
          `INSERT INTO chapters (media_item_id, chapter_number, folder_path, page_count)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [mediaId, chapNum, chapPath, pageCount],
        )
      }
    } catch (err) {
      logger.error(`Chapter scan error: ${err}`)
    }
  }

  static async scanAll(): Promise<Record<string, number>> {
    logger.info('Starting full media scan…')
    const [films, series, animes, manga] = await Promise.all([
      this.scanFilms(),
      this.scanSeries(),
      this.scanAnimes(),
      this.scanManga(),
    ])
    logger.info(`Scan complete: ${films} films, ${series} series, ${animes} animes, ${manga} manga`)
    return { films, series, animes, manga }
  }
}
