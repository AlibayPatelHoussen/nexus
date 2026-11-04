import { query } from '../config/database'
import { logger } from '../utils/logger'
import { ValidationError } from '../utils/errors'
import { LANG_RE, SEASON_RE, parseSourceId } from './downloadScripts'
import { createDownload, getDetails } from './downloads'

/**
 * « Télécharger automatiquement les nouveautés »: off unless switched on in
 * the detail sheet of an anime, series or manga. Once a day the followed
 * titles are checked; episodes / chapters that did not exist when the switch
 * was turned on (or at the last check) are added to the queue.
 */

export interface FollowRow {
  id: string
  source_id: string
  source_script: 'anisama' | 'movix'
  kind: 'anime' | 'manga' | 'serie'
  title: string
  poster_url: string | null
  options: { lang?: string; season?: string }
  known: number[]
  enabled: boolean
  created_by: string | null
  last_checked_at: string | null
  last_error: string | null
  created_at: string
}

const CHECK_EVERY_MS = () => Number(process.env.FOLLOW_CHECK_INTERVAL_MS) || 24 * 3600_000

/** Numbers available right now for this title / season / language. */
async function available(sourceId: string, kind: FollowRow['kind'], options: FollowRow['options']): Promise<number[]> {
  const d = await getDetails(sourceId, true) as {
    seasons?: { id: string | number; lang?: string; episodes: { n: number }[] }[]
    langs?: ({ lang: string; chapters?: { n: number }[] } | string)[]
  }
  if (kind === 'manga') {
    const l = (d.langs ?? []).find((x) => typeof x !== 'string' && x.lang === options.lang) as { chapters?: { n: number }[] } | undefined
    return (l?.chapters ?? []).map((c) => c.n)
  }
  const s = (d.seasons ?? []).find((x) => String(x.id) === String(options.season) && (kind !== 'anime' || x.lang === options.lang))
  return (s?.episodes ?? []).map((e) => e.n)
}

export async function getFollow(sourceId: unknown): Promise<FollowRow | null> {
  parseSourceId(sourceId)
  const { rows } = await query<FollowRow>('SELECT * FROM follows WHERE source_id = $1', [String(sourceId)])
  return rows[0] ?? null
}

export async function listFollows(): Promise<FollowRow[]> {
  return (await query<FollowRow>('SELECT * FROM follows ORDER BY created_at DESC')).rows
}

export interface FollowInput { id: unknown; title: unknown; poster_url?: unknown; lang?: unknown; season?: unknown; enabled: unknown }

/** Turns following on (remembering what exists today) or off. */
export async function setFollow(input: FollowInput, userId: string): Promise<FollowRow | null> {
  const { source, kind } = parseSourceId(input.id)
  if (source !== 'anisama' && source !== 'movix') throw new ValidationError('Ce titre ne peut pas être suivi')
  if (kind !== 'anime' && kind !== 'manga' && kind !== 'serie') throw new ValidationError('Seuls les animes, séries et mangas peuvent être suivis')
  const id = String(input.id)
  if (input.enabled !== true) {
    await query('UPDATE follows SET enabled = FALSE WHERE source_id = $1', [id])
    return getFollow(id)
  }
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : ''
  if (!title) throw new ValidationError('Titre manquant')
  const lang = String(input.lang ?? '').toUpperCase()
  if (!LANG_RE.test(lang)) throw new ValidationError('Langue invalide')
  const options: FollowRow['options'] = { lang }
  if (kind !== 'manga') {
    const season = String(input.season ?? '').toLowerCase()
    if (!SEASON_RE.test(season)) throw new ValidationError('Saison invalide')
    options.season = season
  }
  const poster = typeof input.poster_url === 'string' && /^https?:\/\/\S+$/.test(input.poster_url) ? input.poster_url.slice(0, 2000) : null
  // What exists today is not downloaded automatically: only what comes next
  const known = await available(id, kind, options)
  const { rows } = await query<FollowRow>(
    `INSERT INTO follows (source_id, source_script, kind, title, poster_url, options, known, enabled, created_by, last_checked_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, NOW(), NULL)
     ON CONFLICT (source_id) DO UPDATE SET title = EXCLUDED.title, poster_url = COALESCE(EXCLUDED.poster_url, follows.poster_url),
       options = EXCLUDED.options, known = EXCLUDED.known, enabled = TRUE, last_checked_at = NOW(), last_error = NULL
     RETURNING *`,
    [id, source, kind, title, poster, JSON.stringify(options), JSON.stringify(known), userId],
  )
  return rows[0]
}

/** Checks one followed title and queues what is new. Returns the new numbers. */
export async function checkFollow(f: FollowRow): Promise<number[]> {
  try {
    const now = await available(f.source_id, f.kind, f.options)
    const known = new Set(f.known)
    const fresh = now.filter((n) => !known.has(n))
    if (fresh.length && f.created_by) {
      await createDownload({
        id: f.source_id, title: f.title, poster_url: f.poster_url, lang: f.options.lang, season: f.options.season,
        ...(f.kind === 'manga' ? { chapters: fresh } : { episodes: fresh }), force: true,
      }, f.created_by)
      logger.info(`Follow ${f.title}: ${fresh.length} new item(s) queued`)
    }
    await query('UPDATE follows SET known = $2, last_checked_at = NOW(), last_error = NULL WHERE id = $1',
      [f.id, JSON.stringify([...new Set([...f.known, ...now])].sort((a, b) => a - b))])
    return fresh
  } catch (err) {
    await query('UPDATE follows SET last_checked_at = NOW(), last_error = $2 WHERE id = $1', [f.id, (err as Error).message.slice(0, 500)])
    logger.warn(`Follow ${f.title}: ${(err as Error).message}`)
    return []
  }
}

/** Every enabled title whose last check is older than a day. */
export async function checkDueFollows(force = false): Promise<number> {
  const { rows } = await query<FollowRow>(
    `SELECT * FROM follows WHERE enabled AND ($1 OR last_checked_at IS NULL OR last_checked_at < NOW() - ($2 || ' milliseconds')::interval)
     ORDER BY last_checked_at NULLS FIRST`, [force, String(CHECK_EVERY_MS())])
  let queued = 0
  for (const f of rows) queued += (await checkFollow(f)).length    // one at a time: gentle with the sites
  return queued
}

let timer: NodeJS.Timeout | null = null
export function startFollowChecker() {
  if (timer) return
  // Checked every hour; each title at most once a day
  timer = setInterval(() => { void checkDueFollows().catch(() => {}) }, 3600_000)
  timer.unref()
  setTimeout(() => { void checkDueFollows().catch(() => {}) }, 5 * 60_000).unref()
}
