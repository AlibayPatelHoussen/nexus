import axios from 'axios'
import zlib from 'zlib'
import readline from 'readline'
import type { Readable } from 'stream'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import { linkArtwork } from './artwork'

/*
 * IMDb ratings for the Top 10.
 *  1. Each film / series / anime with a TMDB id gets its IMDb id from TMDB
 *     (`/movie|tv/{id}/external_ids`), once (retried after 30 days when TMDB has none).
 *  2. Once a day the official IMDb dataset `title.ratings.tsv.gz` (non-commercial
 *     use, ~8 MB, refreshed daily by IMDb) is streamed and the ratings / vote
 *     counts of the library's titles are stored.
 * Nothing is scraped from imdb.com.
 */
const TMDB_KEY    = process.env.TMDB_API_KEY
const TMDB_BASE   = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3'
const RATINGS_URL = process.env.IMDB_RATINGS_URL || 'https://datasets.imdbws.com/title.ratings.tsv.gz'
const DAY = 86_400_000

const hasTmdbKey = () => !!TMDB_KEY && !/your_|_here|changeme|^x+$/i.test(TMDB_KEY)

/** Looks up missing IMDb ids on TMDB. Returns how many were found. */
export async function linkImdbIds(limit = 500): Promise<number> {
  if (!hasTmdbKey()) return 0
  const { rows } = await query<{ id: string; type: string; tmdb_id: number }>(
    `SELECT id, type, tmdb_id FROM media_items
      WHERE tmdb_id IS NOT NULL AND imdb_id IS NULL AND type IN ('film', 'serie', 'anime')
        AND (imdb_checked_at IS NULL OR imdb_checked_at < NOW() - INTERVAL '30 days')
      ORDER BY created_at DESC LIMIT $1`, [limit])
  let found = 0
  for (const r of rows) {
    const kind = r.type === 'film' ? 'movie' : 'tv'
    let imdb: string | null = null
    try {
      const { data } = await axios.get(`${TMDB_BASE}/${kind}/${r.tmdb_id}/external_ids`, { params: { api_key: TMDB_KEY }, timeout: 10_000 })
      imdb = typeof data?.imdb_id === 'string' && /^tt\d+$/.test(data.imdb_id) ? data.imdb_id : null
    } catch (err) {
      logger.warn(`IMDb id lookup failed for TMDB ${kind} ${r.tmdb_id}: ${err}`)
      continue   // network error: try again next time
    }
    await query('UPDATE media_items SET imdb_id = $2, imdb_checked_at = NOW() WHERE id = $1', [r.id, imdb])
    if (imdb) found++
  }
  return found
}

/** Streams the IMDb ratings dataset and stores the ratings of the library's titles. */
export async function refreshImdbRatings(): Promise<number> {
  const { rows } = await query<{ imdb_id: string }>('SELECT DISTINCT imdb_id FROM media_items WHERE imdb_id IS NOT NULL')
  if (!rows.length) return 0
  const wanted = new Set(rows.map((r) => r.imdb_id))
  const found = new Map<string, { rating: number; votes: number }>()

  const res = await axios.get<Readable>(RATINGS_URL, { responseType: 'stream', timeout: 60_000 })
  const lines = readline.createInterface({ input: res.data.pipe(zlib.createGunzip()), crlfDelay: Infinity })
  for await (const line of lines) {
    // tconst \t averageRating \t numVotes
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const id = line.slice(0, tab)
    if (!wanted.has(id)) continue
    const [, rating, votes] = line.split('\t')
    const r = Number(rating), v = Number(votes)
    if (Number.isFinite(r) && Number.isFinite(v)) found.set(id, { rating: r, votes: v })
    if (found.size === wanted.size) { lines.close(); res.data.destroy(); break }
  }

  if (found.size) {
    const ids = [...found.keys()]
    await query(
      `UPDATE media_items m SET imdb_rating = u.rating, imdb_votes = u.votes
         FROM unnest($1::text[], $2::numeric[], $3::int[]) AS u(imdb_id, rating, votes)
        WHERE m.imdb_id = u.imdb_id`,
      [ids, ids.map((k) => found.get(k)!.rating), ids.map((k) => found.get(k)!.votes)])
  }
  return found.size
}

let running: Promise<{ linked: number; rated: number; artwork: number }> | null = null
/** Enrichment after scans and once a day: IMDb ids + ratings, Apple TV-style artwork. One run at a time. */
export function syncImdb() {
  if (running) return running
  running = (async () => {
    const linked = await linkImdbIds()
    const rated = await refreshImdbRatings()
    const artwork = await linkArtwork()
    logger.info(`IMDb: ${linked} new ids, ${rated} ratings updated; artwork for ${artwork} titles`)
    return { linked, rated, artwork }
  })().finally(() => { running = null })
  return running
}

let timer: NodeJS.Timeout | null = null
/** Daily, plus a first run a few minutes after start. */
export function startImdbSync() {
  if (timer || process.env.IMDB_SYNC === 'off') return
  const run = () => { void syncImdb().catch((err) => logger.warn(`IMDb sync failed: ${err}`)) }
  timer = setInterval(run, DAY)
  timer.unref()
  setTimeout(run, 3 * 60_000).unref()
}
