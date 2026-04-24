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
  let name = path.basename(filename, path.extname(filename))

  // Remove content in square brackets e.g. [FR-EN], [OxTorrent.com]
  name = name.replace(/\[.*?\]/g, '')

  // Extract year (handles year at end of string too)
  const yearMatch = name.match(/(?:[^0-9]|^)(\d{4})(?:[^0-9]|$)/)
  const year = yearMatch ? parseInt(yearMatch[1]) : undefined

  // Remove year and everything after (handles year at end of string too)
  name = name.replace(/[(_. ]\d{4}([)_. ].*|$)/, '')

  // Remove common quality/source tags
  name = name.replace(/\b(TRUEFRENCH|FRENCH|VOSTFR|MULTI|BluRay|BDRip|WEBRip|WEB[-.]DL|HDLight|HDLIGHT|720p|1080p|2160p|4K|x264|x265|HEVC|DTS|AC3|AAC|VFF|VFQ|VOA|HDR|SDR|EXTENDED|REPACK|PROPER|REMUX)\b.*/i, '')

  // Replace dots and underscores with spaces
  name = name.replace(/[._]/g, ' ')

  // Remove leading junk like "Dromoy - " or "SiteName - " or leading dashes/spaces
  name = name.replace(/^[A-Za-z0-9]+\s*-\s*/, '').replace(/^[\s-]+/, '').trim()

  // Collapse multiple spaces
  name = name.replace(/\s+/g, ' ').trim()

  return { title: name, year }
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
function scoreMangaTitle(query: string, titles: Record<string, string>): number {
  const q = query.toLowerCase().trim()
  const candidates = Object.values(titles).map((t) => t.toLowerCase().trim())
  let best = 0
  for (const t of candidates) {
    if (t === q)              { best = Math.max(best, 100); break }
    if (t.startsWith(q + ' ') || t.startsWith(q + ':')) best = Math.max(best, 80)
    else if (t.startsWith(q)) best = Math.max(best, 70)
    else if (t.includes(q))   best = Math.max(best, 40)
    // penalise titles that have extra words beyond the query
    else if (q.includes(t))   best = Math.max(best, 30)
  }
  return best
}

async function searchMangaDex(title: string): Promise<MangaDexResult | null> {
  try {
    const { data } = await axios.get(`${MANGADEX_URL}/manga`, {
      params: { title, limit: 10, 'includes[]': ['cover_art'] },
    })
    const results = (data.data ?? []) as MangaDexResult[]
    if (!results.length) return null

    // Pick the result whose titles best match the query
    let best: MangaDexResult = results[0]
    let bestScore = -1
    for (const manga of results) {
      const titles = manga.attributes?.title ?? {}
      const score  = scoreMangaTitle(title, titles)
      if (score > bestScore) { bestScore = score; best = manga }
    }

    const cover = best.relationships?.find((r) => r.type === 'cover_art')
    const coverUrl = cover
      ? `https://uploads.mangadex.org/covers/${best.id}/${cover.attributes?.fileName}`
      : undefined

    return { ...best, coverUrl }
  } catch { return null }
}

// ─── File size ───────────────────────────────────────
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    return stat.size
  } catch { return 0 }
}

async function getDirSize(dirPath: string): Promise<number> {
  try {
    let total = 0
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      total += entry.isDirectory() ? await getDirSize(fullPath) : await getFileSize(fullPath)
    }
    return total
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
           ON CONFLICT (file_path) DO UPDATE SET
             title = EXCLUDED.title, original_title = EXCLUDED.original_title,
             tmdb_id = EXCLUDED.tmdb_id, overview = EXCLUDED.overview,
             poster_path = EXCLUDED.poster_path, backdrop_path = EXCLUDED.backdrop_path,
             genres = EXCLUDED.genres, year = EXCLUDED.year, rating = EXCLUDED.rating,
             vote_count = EXCLUDED.vote_count, status = EXCLUDED.status,
             language = EXCLUDED.language, file_size = EXCLUDED.file_size,
             last_scanned = NOW()`,
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

        const anilist = await searchAniList(title, 'ANIME')

        const { rows } = await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, anilist_id, overview,
            poster_path, backdrop_path, genres, year, rating, status, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           ON CONFLICT (file_path) DO UPDATE SET last_scanned = NOW()
           RETURNING id`,
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

        const mediaId = rows[0]?.id as string | undefined
        if (mediaId) await MediaScanner.scanAnimeEpisodes(animePath, mediaId)
        count++
      }
    } catch (err) {
      logger.error(`Anime scan error: ${err}`)
    }

    return count
  }

  static async scanAnimeEpisodes(animePath: string, mediaItemId: string): Promise<void> {
    try {
      const entries = await fs.readdir(animePath, { withFileTypes: true })
      let autoNum = 1

      for (const entry of entries) {
        const fullPath = path.join(animePath, entry.name)

        if (entry.isFile() && VIDEO_EXTS.includes(path.extname(entry.name).toLowerCase())) {
          const epMatch = entry.name.match(/[Ee](\d+)/)
          const epNum   = epMatch ? parseInt(epMatch[1]) : autoNum++
          await query(
            `INSERT INTO episodes (media_item_id, season, episode_number, file_path, file_size)
             VALUES ($1, 1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [mediaItemId, epNum, fullPath, await getFileSize(fullPath)],
          )
        } else if (entry.isDirectory()) {
          const seasonNum  = parseInt(entry.name.match(/\d+/)?.[0] || '1')
          const seasonFiles = await fs.readdir(fullPath)
          for (const file of seasonFiles) {
            if (!VIDEO_EXTS.includes(path.extname(file).toLowerCase())) continue
            const epPath  = path.join(fullPath, file)
            const epMatch = file.match(/[Ee](\d+)/)
            const epNum   = epMatch ? parseInt(epMatch[1]) : autoNum++
            await query(
              `INSERT INTO episodes (media_item_id, season, episode_number, file_path, file_size)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
              [mediaItemId, seasonNum, epNum, epPath, await getFileSize(epPath)],
            )
          }
        }
      }
    } catch (err) {
      logger.error(`Anime episode scan error: ${err}`)
    }
  }

  static async scanManga(): Promise<number> {
    const dir = process.env.MANGA_PATH || '/media/scans'
    let count = 0

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries.filter((e) => e.isDirectory())) {
        const mangaPath = path.join(dir, entry.name)
        const { title } = parseFilename(entry.name)

        const mdx = await searchMangaDex(title)

        await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, mangadex_id,
            overview, poster_path, genres, status, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (file_path) DO UPDATE SET last_scanned = NOW()`,
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

        // Scan chapters then update total file_size from all images
        await MediaScanner.scanChapters(mangaPath, entry.name)
        const totalSize = await getDirSize(mangaPath)
        await query('UPDATE media_items SET file_size = $1 WHERE file_path = $2', [totalSize, mangaPath])

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

      // Collect actual chapter dirs, handling optional lang subdir (VF, VOSTFR, EN…)
      // Pattern A: mangaPath/Chapitre 1/*.jpg
      // Pattern B: mangaPath/VF/Chapitre 1/*.jpg
      const chapDirs: string[] = []

      const firstLevel = await fs.readdir(mangaPath, { withFileTypes: true })
      for (const entry of firstLevel.filter((e) => e.isDirectory())) {
        const entryPath = path.join(mangaPath, entry.name)
        const contents  = await fs.readdir(entryPath)
        const hasImages = contents.some((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))

        if (hasImages) {
          // Pattern A — this dir is a chapter
          chapDirs.push(entryPath)
        } else {
          // Pattern B — this dir is a lang/grouping folder, go one level deeper
          const inner = await fs.readdir(entryPath, { withFileTypes: true })
          for (const sub of inner.filter((e) => e.isDirectory())) {
            chapDirs.push(path.join(entryPath, sub.name))
          }
        }
      }

      for (const chapPath of chapDirs) {
        const name = path.basename(chapPath)

        const explicit = name.match(/(?:ch(?:apter|apit(?:re)?)?)[.\s_-]*(\d+(?:[._]\d+)?)/i)
        const fallback = name.match(/(?:^|[^a-z])(\d+(?:\.\d+)?)(?:[^a-z]|$)/i)
        const rawNum   = explicit?.[1] ?? fallback?.[1] ?? '0'
        const chapNum  = parseFloat(rawNum.replace('_', '.'))

        const chapTitle = name
          .replace(/(?:ch(?:apter|apit(?:re)?)?)[.\s_-]*\d+(?:[._]\d+)?/gi, '')
          .replace(/^\s*[-_.\s]+|[-_.\s]+$/g, '')
          .replace(/[-_]+/g, ' ')
          .trim() || null

        const files     = await fs.readdir(chapPath)
        const pageCount = files.filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase())).length

        await query(
          `INSERT INTO chapters (media_item_id, chapter_number, title, folder_path, page_count)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING`,
          [mediaId, chapNum, chapTitle, chapPath, pageCount],
        )
      }
    } catch (err) {
      logger.error(`Chapter scan error: ${err}`)
    }
  }

  static async pruneDeleted(type?: string): Promise<number> {
    const { rows } = type
      ? await query('SELECT id, file_path, type FROM media_items WHERE type = $1', [type])
      : await query('SELECT id, file_path, type FROM media_items')
    let removed = 0

    for (const row of rows as { id: string; file_path: string; type: string }[]) {
      try {
        await fs.access(row.file_path)
      } catch {
        await query('DELETE FROM media_items WHERE id = $1', [row.id])
        logger.info(`Pruned missing ${row.type}: ${row.file_path}`)
        removed++
      }
    }

    if (removed > 0) logger.info(`Pruned ${removed} missing media item(s) from DB`)
    return removed
  }

  static async scanAll(): Promise<Record<string, number>> {
    logger.info('Starting full media scan…')
    const pruned = await this.pruneDeleted()
    const [films, series, animes, manga] = await Promise.all([
      this.scanFilms(),
      this.scanSeries(),
      this.scanAnimes(),
      this.scanManga(),
    ])
    logger.info(`Scan complete: ${films} films, ${series} series, ${animes} animes, ${manga} manga, ${pruned} pruned`)
    return { films, series, animes, manga, pruned }
  }
}
