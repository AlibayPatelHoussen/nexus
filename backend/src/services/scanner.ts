import fs from 'fs/promises'
import path from 'path'
import { query, withTransaction } from '../config/database'
import { ConflictError } from '../utils/errors'
import { findChapters } from './chapters'
import { logger } from '../utils/logger'
import axios from 'axios'

const TMDB_KEY      = process.env.TMDB_API_KEY
const TMDB_BASE     = process.env.TMDB_BASE_URL     || 'https://api.themoviedb.org/3'
const TMDB_IMG      = process.env.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p'
const ANILIST_URL   = process.env.ANILIST_API_URL   || 'https://graphql.anilist.co'
const MANGADEX_URL  = process.env.MANGADEX_API_URL  || 'https://api.mangadex.org'
const MANGADEX_COVERS = process.env.MANGADEX_COVERS_URL || 'https://uploads.mangadex.org/covers'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv']

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

// ─── Parse chapter number from a folder / PDF name ───
// "Chapter 12", "ch.12.5", "Chapitre_3", "Vol 2 - 045" → 12, 12.5, 3, 2 …
export function parseChapterNumber(name: string): number {
  const explicit = name.match(/(?:ch(?:apter|apit(?:re)?)?)[.\s_-]*(\d+(?:[._]\d+)?)/i)
  const fallback = name.match(/(?:^|[^a-z])(\d+(?:\.\d+)?)(?:[^a-z]|$)/i)
  const rawNum   = explicit?.[1] ?? fallback?.[1] ?? '0'
  const num      = parseFloat(rawNum.replace('_', '.'))
  return Number.isFinite(num) ? num : 0
}

// ─── Parse filename ──────────────────────────────────
export function parseFilename(filename: string): { title: string; year?: number } {
  let name = path.basename(filename, path.extname(filename))

  // Remove content in square brackets e.g. [FR-EN], [OxTorrent.com]
  name = name.replace(/\[.*?\]/g, '')

  // Series folders often carry season / episode info: "Show S02E12-22 FINAL",
  // "Show.S01.1080p", "Show - Saison 2", "Show Complete Series" → keep the show name only
  // (only after a separator, so titles like "Final Destination" are kept)
  name = name
    .replace(
      /[\s._-]+(?:S\d{1,2}(?:[\s._-]*E\d{1,3}(?:[-–]E?\d{1,3})?)?|(?:saison|season|staffel)[\s._-]*\d+|int[ée]grale|complete|compl[eè]te?|the[\s._-]+complete[\s._-]+series)(?=$|[\s._-]).*$/i,
      '',
    )
    .replace(/[\s._-]+final$/i, '')
    .replace(/[\s._-]+$/, '')

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
let warnedNoTmdbKey = false

/** True when a real TMDB API key is configured (not the .env.example placeholder). */
export function hasTmdbKey(): boolean {
  return !!TMDB_KEY && !/your_|_here|changeme|^x+$/i.test(TMDB_KEY)
}

async function searchTMDB(title: string, year?: number, type: 'movie' | 'tv' = 'movie'): Promise<TmdbResult | null> {
  if (!hasTmdbKey()) {
    if (!warnedNoTmdbKey) { logger.warn('TMDB_API_KEY missing: posters and synopsis cannot be fetched'); warnedNoTmdbKey = true }
    return null
  }
  try {
    const params: Record<string, string | number> = { api_key: TMDB_KEY!, query: title, language: 'fr-FR' }
    if (year) params.year = year
    const { data } = await axios.get(`${TMDB_BASE}/search/${type}`, { params })
    return (data.results?.[0] as TmdbResult) || null
  } catch (err) {
    logger.warn(`TMDB search failed for "${title}": ${err}`)
    return null
  }
}

async function getTMDBDetails(id: number, type: 'movie' | 'tv'): Promise<TmdbResult | null> {
  if (!hasTmdbKey()) return null
  try {
    const { data } = await axios.get(`${TMDB_BASE}/${type}/${id}`, {
      params: { api_key: TMDB_KEY, language: 'fr-FR' },
    })
    return data as TmdbResult
  } catch { return null }
}

// ─── Episodes ────────────────────────────────────────
export interface EpisodeInfo { season: number | null; episode: number | null }

/**
 * Extract season / episode numbers from a video file name and the folders
 * between the show root and the file (closest folder last).
 * Handles S01E02, s1.e2, 1x02, "Episode 5", "Épisode 05", "Ep 3", "E07",
 * and season folders like "Season 2", "Saison 02", "S03" or "Specials".
 */
export function parseEpisodeInfo(fileName: string, folders: string[] = []): EpisodeInfo {
  const name = path.basename(fileName, path.extname(fileName))

  const se = name.match(/(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)/i)
  if (se) return { season: parseInt(se[1]), episode: parseInt(se[2]) }

  const x = name.match(/(?:^|[^\d])(\d{1,2})x(\d{2,3})(?!\d)/i)
  if (x) return { season: parseInt(x[1]), episode: parseInt(x[2]) }

  let season: number | null = null
  for (const folder of [...folders].reverse()) {
    if (/^(specials?|sp[ée]ciaux|extras?)$/i.test(folder.trim())) { season = 0; break }
    const m = folder.match(/(?:^|[^a-z])(?:season|saison|s)[\s._-]*(\d{1,2})(?!\d)/i)
      ?? folder.match(/^\s*(\d{1,2})\s*$/)
    if (m) { season = parseInt(m[1]); break }
  }

  const ep = name.match(/(?:^|[^a-z])(?:[ée]pisode|ep|e)[\s._-]*(\d{1,3})(?!\d)/i)
  if (ep) return { season, episode: parseInt(ep[1]) }

  // Bare number, e.g. "05.mkv" or "Show - 12 [1080p].mkv": drop tags, codecs,
  // resolutions and audio specs first, then take the last remaining number
  const cleaned = name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(?:[hx][ .]?26[45]|hevc|avc|\d{3,4}p|\d+bits?|(?:aac|ac3|eac3|ddp?|dts|truehd)[\d.]*|\d\.\d)\b/gi, ' ')
  const bare = [...cleaned.matchAll(/(?:^|[^\da-z])(\d{1,3})(?![\dp])/gi)]
    .map((m) => parseInt(m[1]))
    .filter((n) => n > 0 && n < 1000)
  return { season, episode: bare.length ? bare[bare.length - 1] : null }
}

/** Recursively list video files under `root` (max depth 4, hidden folders / samples skipped). */
async function listVideoFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 4) return []
  const out: string[] = []
  let entries: import('fs').Dirent[]
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(root, e.name)
    if (e.isDirectory()) out.push(...await listVideoFiles(full, depth + 1))
    else if (e.isFile() && VIDEO_EXTS.includes(path.extname(e.name).toLowerCase())
      && !/(^|[^a-z])sample([^a-z]|$)/i.test(e.name)) out.push(full)
  }
  return out
}

interface TmdbEpisode {
  episode_number: number
  name?: string
  overview?: string
  still_path?: string | null
  air_date?: string | null
  runtime?: number | null
}

async function getTMDBSeason(tvId: number, season: number): Promise<TmdbEpisode[]> {
  if (!hasTmdbKey()) return []
  try {
    const { data } = await axios.get(`${TMDB_BASE}/tv/${tvId}/season/${season}`, {
      params: { api_key: TMDB_KEY, language: 'fr-FR' },
    })
    return (data.episodes as TmdbEpisode[]) || []
  } catch { return [] }
}

/**
 * Index every episode file of a show (series or anime). Existing episodes keep
 * their id (upsert on file_path) so watch progress survives rescans; episodes
 * whose file disappeared are removed. With a TMDB id, titles, synopsis,
 * thumbnails, air dates and runtimes are filled in per season.
 */
export async function scanShowEpisodes(showPath: string, mediaItemId: string, tmdbId?: number | null): Promise<number> {
  const files = (await listVideoFiles(showPath)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const parsed = files.map((file) => {
    const folders = path.relative(showPath, path.dirname(file)).split(path.sep).filter((f) => f && f !== '.')
    const info = parseEpisodeInfo(path.basename(file), folders)
    return { file, season: info.season ?? 1, episode: info.episode }
  })

  // Files without a number get the next free number in their season (natural sort order)
  const used = new Map<number, Set<number>>()
  for (const p of parsed) if (p.episode != null) {
    if (!used.has(p.season)) used.set(p.season, new Set())
    used.get(p.season)!.add(p.episode)
  }
  for (const p of parsed) if (p.episode == null) {
    const set = used.get(p.season) ?? new Set<number>()
    let n = 1
    while (set.has(n)) n++
    set.add(n); used.set(p.season, set)
    p.episode = n
  }

  const sizes = await Promise.all(parsed.map((p) => getFileSize(p.file)))

  await withTransaction(async (client) => {
    for (const [i, p] of parsed.entries()) {
      await client.query(
        `INSERT INTO episodes (media_item_id, season, episode_number, file_path, file_size)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (file_path) DO UPDATE SET
           media_item_id  = EXCLUDED.media_item_id,
           season         = EXCLUDED.season,
           episode_number = EXCLUDED.episode_number,
           file_size      = EXCLUDED.file_size`,
        [mediaItemId, p.season, p.episode, p.file, sizes[i]],
      )
    }
    await client.query(
      'DELETE FROM episodes WHERE media_item_id = $1 AND NOT (file_path = ANY($2::text[]))',
      [mediaItemId, parsed.map((p) => p.file)],
    )
  })

  if (tmdbId) {
    for (const season of [...new Set(parsed.map((p) => p.season))]) {
      for (const ep of await getTMDBSeason(tmdbId, season)) {
        await query(
          `UPDATE episodes SET
             title          = COALESCE(NULLIF($4, ''), title),
             overview       = COALESCE(NULLIF($5, ''), overview),
             thumbnail_path = COALESCE($6, thumbnail_path),
             air_date       = COALESCE($7::date, air_date),
             duration       = COALESCE(duration, $8)
           WHERE media_item_id = $1 AND season = $2 AND episode_number = $3`,
          [
            mediaItemId, season, ep.episode_number,
            ep.name ?? null, ep.overview ?? null,
            ep.still_path ? `${TMDB_IMG}/w300${ep.still_path}` : null,
            ep.air_date || null,
            ep.runtime ? ep.runtime * 60 : null,
          ],
        )
      }
    }
  }

  logger.info(`Episodes: ${parsed.length} file(s) for ${showPath}`)
  return parsed.length
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
      params: { title, limit: 25, 'includes[]': ['cover_art'] },
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
      ? `${MANGADEX_COVERS}/${best.id}/${cover.attributes?.fileName}`
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
  private static running: string | null = null

  static isRunning(): string | null {
    return this.running
  }

  /** Run a scan, refusing to start while another one is in progress. */
  static async exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new ConflictError(`A scan is already running (${this.running})`)
    this.running = label
    try {
      return await fn()
    } finally {
      this.running = null
    }
  }


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

        // Already indexed with metadata: only refresh size / scan date (no TMDB call)
        const existing = await query<{ id: string; poster_path: string | null }>(
          'SELECT id, poster_path FROM media_items WHERE file_path = $1', [videoPath],
        )
        if (existing.rows[0]?.poster_path) {
          await query('UPDATE media_items SET file_size = $1, last_scanned = NOW() WHERE id = $2',
            [await getFileSize(videoPath), existing.rows[0].id])
          count++
          continue
        }

        const tmdb = await searchTMDB(title, year, 'movie')

        let details: TmdbResult | null = null
        if (tmdb?.id) details = await getTMDBDetails(tmdb.id, 'movie')

        const item = details || tmdb

        // Lookup failed (no key, network, rate limit): never overwrite existing data
        if (existing.rows[0] && !item) {
          await query('UPDATE media_items SET last_scanned = NOW() WHERE id = $1', [existing.rows[0].id])
          count++
          continue
        }

        await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, tmdb_id, overview,
            poster_path, backdrop_path, genres, year, rating, vote_count,
            status, language, file_size, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
           ON CONFLICT (file_path) DO UPDATE SET
             title          = EXCLUDED.title,
             original_title = COALESCE(EXCLUDED.original_title, media_items.original_title),
             tmdb_id        = COALESCE(EXCLUDED.tmdb_id,        media_items.tmdb_id),
             overview       = COALESCE(EXCLUDED.overview,       media_items.overview),
             poster_path    = COALESCE(EXCLUDED.poster_path,    media_items.poster_path),
             backdrop_path  = COALESCE(EXCLUDED.backdrop_path,  media_items.backdrop_path),
             genres         = CASE WHEN cardinality(EXCLUDED.genres) > 0 THEN EXCLUDED.genres ELSE media_items.genres END,
             year           = COALESCE(EXCLUDED.year,           media_items.year),
             rating         = COALESCE(EXCLUDED.rating,         media_items.rating),
             vote_count     = COALESCE(EXCLUDED.vote_count,     media_items.vote_count),
             status         = COALESCE(EXCLUDED.status,         media_items.status),
             language       = COALESCE(EXCLUDED.language,       media_items.language),
             file_size      = EXCLUDED.file_size,
             last_scanned   = NOW()`,
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

        // Already indexed: keep metadata, but always refresh its episodes
        const existing = await query<{ id: string; tmdb_id: number | null; poster_path: string | null }>(
          'SELECT id, tmdb_id, poster_path FROM media_items WHERE file_path = $1', [seriePath],
        )
        if (existing.rows[0]) {
          const row = existing.rows[0]
          let tmdbId = row.tmdb_id
          // Metadata missing (e.g. an earlier lookup failed): try TMDB again, fill only what is empty
          if (!row.poster_path) {
            const found   = await searchTMDB(title, undefined, 'tv')
            const details = found?.id ? await getTMDBDetails(found.id, 'tv') : null
            const meta    = details || found
            if (meta) {
              tmdbId = meta.id ?? tmdbId
              await query(
                `UPDATE media_items SET
                   title          = COALESCE($2, title),
                   original_title = COALESCE(original_title, $3),
                   tmdb_id        = COALESCE(tmdb_id, $4),
                   overview       = COALESCE(overview, $5),
                   poster_path    = COALESCE(poster_path, $6),
                   backdrop_path  = COALESCE(backdrop_path, $7),
                   genres         = CASE WHEN cardinality(genres) > 0 THEN genres ELSE $8 END,
                   year           = COALESCE(year, $9),
                   rating         = COALESCE(rating, $10),
                   vote_count     = COALESCE(vote_count, $11),
                   status         = COALESCE(status, $12),
                   language       = COALESCE(language, $13)
                 WHERE id = $1`,
                [
                  row.id, meta.name || null, meta.original_name || null, meta.id || null, meta.overview || null,
                  meta.poster_path   ? `${TMDB_IMG}/w500${meta.poster_path}`   : null,
                  meta.backdrop_path ? `${TMDB_IMG}/w1280${meta.backdrop_path}` : null,
                  meta.genres?.map((g) => g.name) || [],
                  meta.first_air_date ? parseInt(meta.first_air_date.slice(0, 4)) : null,
                  meta.vote_average || null, meta.vote_count || null,
                  meta.status || null, meta.original_language || null,
                ],
              )
            }
          }
          await query('UPDATE media_items SET last_scanned = NOW() WHERE id = $1', [row.id])
          await scanShowEpisodes(seriePath, row.id, tmdbId)
          continue
        }

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

        await scanShowEpisodes(seriePath, mediaId, item?.id ?? null)
        count++
      }
    } catch (err) {
      logger.error(`Series scan error: ${err}`)
    }

    return count
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
           ON CONFLICT (file_path) DO UPDATE SET
             anilist_id    = COALESCE(media_items.anilist_id,    EXCLUDED.anilist_id),
             overview      = COALESCE(media_items.overview,      EXCLUDED.overview),
             poster_path   = COALESCE(media_items.poster_path,   EXCLUDED.poster_path),
             backdrop_path = COALESCE(media_items.backdrop_path, EXCLUDED.backdrop_path),
             genres        = CASE WHEN cardinality(media_items.genres) > 0 THEN media_items.genres ELSE EXCLUDED.genres END,
             year          = COALESCE(media_items.year,   EXCLUDED.year),
             rating        = COALESCE(media_items.rating, EXCLUDED.rating),
             status        = COALESCE(media_items.status, EXCLUDED.status),
             last_scanned  = NOW()
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
        if (mediaId) await scanShowEpisodes(animePath, mediaId)
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

      for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))) {
        const mangaPath = path.join(dir, entry.name)
        const { title } = parseFilename(entry.name)
        // One unreadable manga must not stop the scan of the others
        try {

        const mdx = await searchMangaDex(title)

        await query(
          `INSERT INTO media_items
           (type, title, original_title, file_path, mangadex_id,
            overview, poster_path, genres, status, last_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (file_path) DO UPDATE SET
             mangadex_id  = COALESCE(media_items.mangadex_id, EXCLUDED.mangadex_id),
             overview     = COALESCE(media_items.overview,    EXCLUDED.overview),
             poster_path  = COALESCE(media_items.poster_path, EXCLUDED.poster_path),
             genres       = CASE WHEN cardinality(media_items.genres) > 0 THEN media_items.genres ELSE EXCLUDED.genres END,
             status       = COALESCE(media_items.status, EXCLUDED.status),
             last_scanned = NOW()`,
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
        } catch (err) {
          logger.error(`Manga scan error for ${mangaPath}: ${err}`)
        }
      }
    } catch (err) {
      logger.error(`Manga scan error: ${err}`)
    }

    return count
  }

  static async scanChapters(mangaPath: string, _mangaName: string): Promise<void> {
    const { rows } = await query(
      'SELECT id FROM media_items WHERE file_path = $1',
      [mangaPath],
    )
    if (!rows[0]) {
      logger.warn(`scanChapters: no media_item found for path ${mangaPath}`)
      return
    }
    const mediaId = rows[0].id

    const found = await findChapters(mangaPath)
    const chapterRows = found.map((c, i) => {
      const n = parseChapterNumber(c.name)
      // No number in the name ("Prologue", "Oneshot"…): keep the folder order
      return { chapPath: c.path, chapNum: n > 0 || /\b0+\b/.test(c.name) ? n : i + 1, pageCount: c.pageCount }
    })

    // Upsert on folder_path so existing chapters keep their id (and therefore
    // users' read_history), then drop chapters whose folder disappeared.
    // Done atomically so a failing scan never leaves a manga without chapters.
    await withTransaction(async (client) => {
      for (const { chapPath, chapNum, pageCount } of chapterRows) {
        await client.query(
          `INSERT INTO chapters (media_item_id, chapter_number, title, folder_path, page_count, language)
           VALUES ($1, $2, NULL, $3, $4, NULL)
           ON CONFLICT (folder_path) DO UPDATE SET
             media_item_id  = EXCLUDED.media_item_id,
             chapter_number = EXCLUDED.chapter_number,
             page_count     = EXCLUDED.page_count`,
          [mediaId, chapNum, chapPath, pageCount],
        )
      }
      await client.query(
        'DELETE FROM chapters WHERE media_item_id = $1 AND NOT (folder_path = ANY($2::text[]))',
        [mediaId, chapterRows.map((r) => r.chapPath)],
      )
    })

    logger.info(`scanChapters: ${chapterRows.length} chapters for ${mangaPath}`)
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
