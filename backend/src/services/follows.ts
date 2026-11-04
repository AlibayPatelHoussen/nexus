import { query } from '../config/database'
import { logger } from '../utils/logger'
import { AppError, NotFoundError, ValidationError } from '../utils/errors'
import { LANG_RE, SEASON_RE, parseSourceId } from './downloadScripts'
import { createDownload, getDetails } from './downloads'
import { collect, type ScriptEvent } from './downloadScripts'

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

// ─── From a title of the library ───────────────────────────────────────────

export interface FollowTarget {
  sourceId: string
  title: string
  poster_url: string | null
  lang: string
  season?: string
  follow: FollowRow | null
}

const norm = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const targets = new Map<string, { at: number; target: Omit<FollowTarget, 'follow'> }>()

/**
 * Which script title a library item corresponds to: first the downloads that
 * created its files, else a search by its title (same kind, same name).
 * Season to follow: the one downloaded last, else the latest one.
 */
export async function followTarget(mediaId: string): Promise<FollowTarget> {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new NotFoundError('Titre')
  const { rows } = await query<{ type: string; title: string; file_path: string }>(
    'SELECT type, title, file_path FROM media_items WHERE id = $1', [mediaId])
  const media = rows[0]
  if (!media) throw new NotFoundError('Titre')
  const kind = media.type === 'webtoon' ? 'manga' : media.type
  if (kind !== 'anime' && kind !== 'manga' && kind !== 'serie') throw new ValidationError('Seuls les animes, séries et mangas peuvent être suivis')

  const cached = targets.get(mediaId)
  if (cached && Date.now() - cached.at < 3600_000) return { ...cached.target, follow: await getFollow(cached.target.sourceId) }

  let sourceId: string | null = null
  let lang: string | undefined
  let season: string | undefined
  let poster: string | null = null
  let title = media.title
  const dl = await query<{ source_id: string; options: { lang?: string; season?: string }; title: string; poster_url: string | null }>(
    `SELECT source_id, options, title, poster_url FROM downloads
     WHERE kind = $1 AND source_script IN ('anisama', 'movix') AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(progress->'files', '[]'::jsonb)) f WHERE f LIKE $2 || '/%')
     ORDER BY created_at DESC LIMIT 1`, [kind, media.file_path])
  if (dl.rows[0]) {
    ({ source_id: sourceId, title, poster_url: poster } = dl.rows[0])
    lang = dl.rows[0].options.lang
    season = dl.rows[0].options.season
  } else {
    const source = kind === 'serie' ? 'movix' : 'anisama'
    const { events } = await collect(source, ['--search', media.title], 90_000)
    const results = events.filter((e: ScriptEvent) => e.type === 'result' && e.kind === kind)
    // Same name only (never another title that merely came first)
    const want = norm(media.title)
    const hit = results.find((e) => norm(String(e.title)) === want)
      ?? results.find((e) => { const t = norm(String(e.title)); return t.startsWith(`${want} `) || want.startsWith(`${t} `) })
    if (!hit) throw new AppError(`« ${media.title} » est introuvable sur ${source === 'movix' ? 'movix' : 'anime-sama'}`, 404)
    sourceId = String(hit.id)
    poster = typeof hit.poster_url === 'string' ? hit.poster_url : null
    title = String(hit.title)
  }

  // Default language / latest season when not known from a download
  if (!lang || (kind !== 'manga' && !season)) {
    const d = await getDetails(sourceId) as {
      seasons?: { id: string | number; lang?: string }[]
      langs?: ({ lang: string } | string)[]
    }
    if (kind === 'manga') {
      const langs = (d.langs ?? []).map((l) => (typeof l === 'string' ? l : l.lang))
      lang ??= langs.includes('VF') ? 'VF' : langs[0]
    } else if (kind === 'anime') {
      const all = d.seasons ?? []
      lang ??= all.some((x) => x.lang === 'VOSTFR') ? 'VOSTFR' : all[0]?.lang
      season ??= [...all].reverse().find((x) => x.lang === lang && /^saison/.test(String(x.id)))?.id as string | undefined
        ?? all.filter((x) => x.lang === lang).at(-1)?.id as string | undefined
    } else {
      lang ??= 'VF'
      season ??= String(d.seasons?.at(-1)?.id ?? 1)
    }
  }
  if (!lang) throw new AppError('Aucune langue disponible pour ce titre', 404)
  // The proxy URL of a poster keeps the original address in ?u=
  if (poster?.startsWith('/api/images/remote')) poster = new URL(poster, 'http://x').searchParams.get('u')
  const target = { sourceId: sourceId!, title, poster_url: poster, lang, ...(season != null ? { season: String(season) } : {}) }
  targets.set(mediaId, { at: Date.now(), target })
  return { ...target, follow: await getFollow(target.sourceId) }
}
