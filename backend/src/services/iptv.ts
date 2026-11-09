import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { query, db as pool } from '../config/database'
import { logger } from '../utils/logger'
import { AppError, NotFoundError, ValidationError } from '../utils/errors'
import { collect, scriptsDir, type ScriptEvent } from './downloadScripts'
import { signedImage } from './images'

/*
 * IPTV: the iptv-org catalogue (https://github.com/iptv-org/iptv) and the Free-TV playlist
 * (https://github.com/Free-TV/IPTV, hand-picked free channels) merged into it.
 * The Python module downloaders/iptv builds the catalogue, checks streams and reads the guide;
 * this service stores it in PostgreSQL and serves it (per-user favourites and history).
 * Nothing is made up: countries, categories, languages come from iptv-org's database; a
 * channel is « online » / « offline » only after a real check; the guide only when an XMLTV
 * file was set; « popular » only from what was really watched on this server.
 * What comes first (lists, checks): the countries chosen in the settings, then the channels of
 * the Free-TV playlist in its order, channels verified as working before the others.
 */

export const CHANNEL_ID = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,119}$/
export function assertChannelId(id: unknown): string {
  if (typeof id !== 'string' || !CHANNEL_ID.test(id)) throw new ValidationError('Chaîne inconnue')
  return id
}

export interface IptvStream {
  url: string
  title?: string
  feed?: string | null
  quality?: string | null
  referrer?: string | null
  user_agent?: string | null
  labels?: string[]
  /** 'page': the address of a web page with a live player (YouTube, Twitch, Dailymotion); its
   * stream is looked up with yt-dlp when it is played. Absent: a direct stream. */
  kind?: 'page' | 'hls'
  /** 'free-tv' when the stream comes from the Free-TV playlist (absent: iptv-org) */
  source?: string
}
interface CatalogueChannel {
  id: string; name: string; alt_names?: string[]; country?: string | null; categories?: string[]; languages?: string[]
  logo?: string | null; website?: string | null; network?: string | null; streams: IptvStream[]
  /** Place in the Free-TV playlist */
  curated?: number | null
}
interface CatalogueFile {
  generated_at: string; source: string; sources?: string[]; channels: CatalogueChannel[]
  countries: { code: string; name: string; flag?: string | null; count: number }[]
  categories: { id: string; name: string; count: number }[]
  languages: { code: string; name: string; count: number }[]
}

export interface IptvSettings {
  /** Download the catalogue again once a day */
  autoRefresh: boolean
  /** Hide the channels whose last check failed */
  hideOffline: boolean
  /** Address of an XMLTV guide (iptv-org publishes none ready to use) */
  epgUrl: string | null
  /** Countries shown and checked first (ISO codes, in this order) */
  priorityCountries: string[]
}
const DEFAULT_SETTINGS: IptvSettings = { autoRefresh: true, hideOffline: false, epgUrl: null, priorityCountries: ['CA', 'FR', 'MG', 'US'] }

/** 'ca, fr mg' or ['ca', 'FR'] -> ['CA', 'FR', 'MG'] (two-letter codes, no duplicate, at most 12) */
function countryCodes(input: unknown): string[] {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,;]+/) : null
  if (!parts) throw new ValidationError('Pays prioritaires invalides')
  const out: string[] = []
  for (const p of parts) {
    const code = typeof p === 'string' ? p.trim().toUpperCase() : ''
    if (!code) continue
    if (!/^[A-Z]{2}$/.test(code)) throw new ValidationError(`Code pays invalide : « ${String(p).slice(0, 20)} » (deux lettres, ex. FR)`)
    if (!out.includes(code)) out.push(code)
  }
  if (out.length > 12) throw new ValidationError('Douze pays prioritaires au plus')
  return out
}

// ─── Meta (settings, facets, refresh state) ──────────────────────────────────
async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const { rows } = await query<{ value: T }>('SELECT value FROM iptv_meta WHERE key = $1', [key])
  return rows[0]?.value ?? fallback
}
async function setMeta(key: string, value: unknown): Promise<void> {
  await query(`INSERT INTO iptv_meta (key, value, updated_at) VALUES ($1, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)])
}

export async function getSettings(): Promise<IptvSettings> {
  const s = { ...DEFAULT_SETTINGS, ...(await getMeta<Partial<IptvSettings>>('settings', {})) }
  if (!Array.isArray(s.priorityCountries)) s.priorityCountries = DEFAULT_SETTINGS.priorityCountries
  return s
}
export async function saveSettings(input: Partial<IptvSettings>): Promise<IptvSettings> {
  const cur = await getSettings()
  const next: IptvSettings = { ...cur }
  if (typeof input.autoRefresh === 'boolean') next.autoRefresh = input.autoRefresh
  if (typeof input.hideOffline === 'boolean') next.hideOffline = input.hideOffline
  if (input.epgUrl !== undefined) {
    const url = typeof input.epgUrl === 'string' ? input.epgUrl.trim() : ''
    if (url && !/^https?:\/\/[^\s]{3,2000}$/i.test(url)) throw new ValidationError('Adresse du guide TV invalide (http ou https)')
    next.epgUrl = url || null
  }
  if (input.priorityCountries !== undefined) next.priorityCountries = countryCodes(input.priorityCountries)
  await setMeta('settings', next)
  if (next.epgUrl && next.epgUrl !== cur.epgUrl) void refreshEpg().catch((err) => logger.warn(`IPTV guide: ${err.message}`))
  if (!next.epgUrl) await query('DELETE FROM iptv_epg')
  return next
}

// ─── Catalogue import ─────────────────────────────────────────────────────────
const isPage = (s: IptvStream) => s.kind === 'page'
/** At most ten streams per channel: the direct ones in the catalogue's order, then web pages
 * (kept even on a channel with many streams: they are often the one that works everywhere). */
function keptStreams(streams: IptvStream[]): IptvStream[] {
  const pages = streams.filter(isPage).slice(0, 2)
  return [...streams.filter((s) => !isPage(s)).slice(0, 10 - pages.length), ...pages]
}

/** Writes the catalogue built by the Python module into the database (one transaction). */
export async function importCatalogue(data: CatalogueFile): Promise<number> {
  const rows = data.channels.filter((c) => typeof c.id === 'string' && CHANNEL_ID.test(c.id) && c.streams?.length)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE iptv_import (LIKE iptv_channels INCLUDING DEFAULTS) ON COMMIT DROP')
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000)
      await client.query(
        `INSERT INTO iptv_import (id, name, alt_names, country, categories, languages, logo, website, network, streams, labels, curated)
         SELECT x.id, x.name, ARRAY(SELECT jsonb_array_elements_text(x.alt_names)), x.country,
                ARRAY(SELECT jsonb_array_elements_text(x.categories)), ARRAY(SELECT jsonb_array_elements_text(x.languages)),
                x.logo, x.website, x.network, x.streams, ARRAY(SELECT jsonb_array_elements_text(x.labels)), x.curated
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, alt_names jsonb, country text, categories jsonb,
              languages jsonb, logo text, website text, network text, streams jsonb, labels jsonb, curated int)`,
        [JSON.stringify(part.map((c) => {
          const streams = keptStreams(c.streams)
          return {
            id: c.id, name: (c.name || c.id).slice(0, 300), alt_names: (c.alt_names ?? []).slice(0, 20),
            country: c.country || null, categories: c.categories ?? [], languages: c.languages ?? [],
            logo: c.logo || null, website: c.website || null, network: c.network || null,
            streams,
            // « Geo-blocked » only when every stream is; « Not 24/7 » when the first one is
            labels: [...new Set([
              ...(streams.every((s) => s.labels?.includes('Geo-blocked')) ? ['Geo-blocked'] : []),
              ...(streams[0].labels?.includes('Not 24/7') ? ['Not 24/7'] : []),
            ])],
            curated: Number.isInteger(c.curated) && (c.curated as number) > 0 ? c.curated : null,
          }
        }))],
      )
    }
    // A stream that changed address must be checked again
    await client.query(
      `INSERT INTO iptv_channels (id, name, alt_names, country, categories, languages, logo, website, network, streams, labels, curated, updated_at)
       SELECT id, name, alt_names, country, categories, languages, logo, website, network, streams, labels, curated, NOW() FROM iptv_import
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, alt_names = EXCLUDED.alt_names, country = EXCLUDED.country,
         categories = EXCLUDED.categories, languages = EXCLUDED.languages, logo = EXCLUDED.logo, website = EXCLUDED.website,
         network = EXCLUDED.network, labels = EXCLUDED.labels, curated = EXCLUDED.curated, updated_at = NOW(),
         status = CASE WHEN iptv_channels.streams = EXCLUDED.streams THEN iptv_channels.status ELSE 'unknown' END,
         status_reason = CASE WHEN iptv_channels.streams = EXCLUDED.streams THEN iptv_channels.status_reason ELSE NULL END,
         checked_at = CASE WHEN iptv_channels.streams = EXCLUDED.streams THEN iptv_channels.checked_at ELSE NULL END,
         best_stream = CASE WHEN iptv_channels.streams = EXCLUDED.streams THEN iptv_channels.best_stream ELSE NULL END,
         streams = EXCLUDED.streams`,
    )
    // Channels no longer in the sources (withdrawn, blocked) leave the catalogue
    await client.query('DELETE FROM iptv_channels c WHERE NOT EXISTS (SELECT 1 FROM iptv_import i WHERE i.id = c.id)')
    await client.query(`INSERT INTO iptv_meta (key, value, updated_at) VALUES ('facets', $1, NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ countries: data.countries ?? [], categories: data.categories ?? [], languages: data.languages ?? [] })])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return rows.length
}

// ─── Refresh (Python module) ──────────────────────────────────────────────────
export interface RefreshState {
  running: boolean
  at: string | null
  ok: boolean | null
  message: string | null
  stats: Record<string, number> | null
  notes: string[]
  source: string | null
  /** The sources the catalogue was built from: 'iptv-org', 'free-tv' */
  sources: string[]
}
type SavedRefresh = Omit<RefreshState, 'running'>
const NO_REFRESH: SavedRefresh = { at: null, ok: null, message: null, stats: null, notes: [], source: null, sources: [] }
let refreshing: Promise<RefreshState> | null = null

export async function refreshState(): Promise<RefreshState> {
  const saved = await getMeta<SavedRefresh>('refresh', NO_REFRESH)
  return { ...NO_REFRESH, ...saved, running: !!refreshing }
}

/** Downloads the catalogue again (one at a time; a second call waits for the first). */
export function refreshCatalogue(): Promise<RefreshState> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const out = path.join(os.tmpdir(), `nexus-iptv-${process.pid}-${Date.now()}.json`)
    const started = Date.now()
    try {
      const { events, code, log } = await collect('iptv', ['refresh', '--out', out], 10 * 60_000)
      const done = events.find((e) => e.type === 'done') as (ScriptEvent & { stats: Record<string, number>; notes: string[]; source: string; sources?: string[] }) | undefined
      if (!done || code !== 0) {
        const err = events.find((e) => e.type === 'error') as { message?: string } | undefined
        throw new AppError(err?.message || log.slice(-3).join(' | ') || 'Actualisation du catalogue IPTV impossible', 502)
      }
      const imported = await importCatalogue(JSON.parse(await fs.readFile(out, 'utf8')) as CatalogueFile)
      const state: SavedRefresh = {
        at: new Date().toISOString(), ok: true, message: null, stats: { ...done.stats, imported }, notes: done.notes ?? [],
        source: done.source, sources: Array.isArray(done.sources) ? done.sources.map(String) : [],
      }
      await setMeta('refresh', state)
      logger.info(`IPTV catalogue: ${imported} channels in ${Math.round((Date.now() - started) / 1000)} s (${state.sources.join(' + ') || done.source})`)
      return { ...state, running: false }
    } catch (err) {
      const prev = await getMeta<SavedRefresh>('refresh', NO_REFRESH)
      const state = { ...NO_REFRESH, ...prev, at: new Date().toISOString(), ok: false, message: (err as Error).message }
      await setMeta('refresh', state)
      logger.warn(`IPTV catalogue refresh failed: ${(err as Error).message}`)
      throw err
    } finally {
      await fs.unlink(out).catch(() => {})
      refreshing = null
    }
  })()
  return refreshing
}

// ─── Queries ──────────────────────────────────────────────────────────────────
interface ChannelRow {
  id: string; name: string; country: string | null; categories: string[]; languages: string[]; logo: string | null
  website: string | null; network: string | null; streams: IptvStream[]; labels: string[]; status: string
  status_reason: string | null; checked_at: Date | null; curated: number | null; best_stream: number | null; favorite?: boolean
}
export function mapChannel(r: ChannelRow) {
  const streams = r.streams ?? []
  return {
    id: r.id, name: r.name, country: r.country, categories: r.categories, languages: r.languages,
    logo: signedImage(r.logo), website: r.website, network: r.network, labels: r.labels,
    status: r.status as 'unknown' | 'online' | 'offline', statusReason: r.status_reason,
    checkedAt: r.checked_at ? r.checked_at.toISOString() : null,
    // Stream addresses stay on the server (played through it). The one exception is a « page »
    // stream: the public page of a live (YouTube…), given so it can be opened there when it
    // cannot be read here.
    streams: streams.map((s) => ({
      quality: s.quality ?? null, labels: s.labels ?? [], title: s.title ?? null,
      kind: isPage(s) ? 'page' as const : 'hls' as const, source: s.source || 'iptv-org', page: isPage(s) ? s.url : null,
    })),
    /** In the Free-TV selection */
    curated: r.curated != null,
    /** The stream the last check found working (the player starts there) */
    bestStream: r.best_stream != null && r.best_stream < streams.length ? r.best_stream : null,
    favorite: !!r.favorite,
  }
}
export type IptvChannel = ReturnType<typeof mapChannel>
const COLS = 'c.id, c.name, c.country, c.categories, c.languages, c.logo, c.website, c.network, c.streams, c.labels, c.status, c.status_reason, c.checked_at, c.curated, c.best_stream'
/** Names are ordered without their accents, whatever the collation of the database: « Équidia »
 * sits with the E, not after Z (a database created with the C locale orders by bytes).
 * translate() works on characters only in a UTF-8 database; any other keeps its own order. */
const ACCENTS: [string, string][] = [
  ['ÀÁÂÃÄÅàáâãäå', 'a'], ['Çç', 'c'], ['ÈÉÊËèéêë', 'e'], ['ÌÍÎÏìíîï', 'i'], ['Ññ', 'n'], ['ÒÓÔÕÖòóôõö', 'o'], ['ÙÚÛÜùúûü', 'u'], ['ÝýŸÿ', 'y'],
]
const BY_NAME = `(CASE WHEN getdatabaseencoding() = 'UTF8'
  THEN translate(lower(c.name), '${ACCENTS.map(([from]) => from).join('')}', '${ACCENTS.map(([from, to]) => to.repeat(from.length)).join('')}')
  ELSE lower(c.name) END)`
/** Inside one country: what was verified as working first, what failed last, the Free-TV
 * selection in its order (the usual channel numbers) before the rest by name. */
const TOP_IN_COUNTRY = `(c.status = 'offline'), (c.status <> 'online'), (c.curated IS NULL), c.curated, ${BY_NAME}, c.id`

export interface ChannelFilters {
  q?: string; country?: string; category?: string; language?: string
  /** 'top' (default): priority countries, working channels and the Free-TV selection first */
  status?: 'online' | 'all'; sort?: 'top' | 'name' | '-name'; page?: number; limit?: number
}
export async function listChannels(userId: string, f: ChannelFilters) {
  const where: string[] = []
  const params: unknown[] = [userId]
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)) }
  if (f.q?.trim()) {
    // LIKE wildcards typed by the user are taken literally
    params.push(`%${f.q.trim().slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
    const n = params.length
    where.push(`(c.name ILIKE $${n} OR c.network ILIKE $${n} OR EXISTS (SELECT 1 FROM unnest(c.alt_names) a WHERE a ILIKE $${n}))`)
  }
  if (f.country) add('c.country = $?', f.country.toUpperCase().slice(0, 2))
  if (f.category) add('$? = ANY(c.categories)', f.category.slice(0, 40))
  if (f.language) add('$? = ANY(c.languages)', f.language.slice(0, 10))
  const settings = await getSettings()
  if (f.status === 'online') where.push(`c.status = 'online'`)
  else if (settings.hideOffline) where.push(`c.status <> 'offline'`)
  const limit = Math.min(Math.max(Number(f.limit) || 60, 1), 200)
  const page = Math.max(Number(f.page) || 1, 1)
  const listParams = [...params]
  let order = f.sort === '-name' ? `${BY_NAME} DESC, c.id` : `${BY_NAME}, c.id`
  if (f.sort !== 'name' && f.sort !== '-name') {
    listParams.push(settings.priorityCountries)
    const n = `$${listParams.length}::text[]`
    order = `(c.status = 'offline'), (CASE WHEN c.country = ANY(${n}) THEN 0 ELSE 1 END), (c.status <> 'online'),
             (c.curated IS NULL), array_position(${n}, c.country), c.curated, ${BY_NAME}, c.id`
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [{ rows }, count] = await Promise.all([
    query<ChannelRow>(
      `SELECT ${COLS}, (fav.channel_id IS NOT NULL) AS favorite FROM iptv_channels c
       LEFT JOIN iptv_favorites fav ON fav.channel_id = c.id AND fav.user_id = $1
       ${sqlWhere} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, listParams),
    // Same parameters ($1 = the user, unused by the count itself)
    query<{ n: string }>(`SELECT COUNT(*) AS n FROM iptv_channels c WHERE $1::uuid IS NOT NULL ${where.length ? `AND ${where.join(' AND ')}` : ''}`, params),
  ])
  return { items: rows.map(mapChannel), total: Number(count.rows[0]?.n ?? 0), page, limit }
}

export async function getChannel(userId: string, id: string) {
  const { rows } = await query<ChannelRow>(
    `SELECT ${COLS}, (fav.channel_id IS NOT NULL) AS favorite FROM iptv_channels c
     LEFT JOIN iptv_favorites fav ON fav.channel_id = c.id AND fav.user_id = $1 WHERE c.id = $2`, [userId, id])
  if (!rows[0]) throw new NotFoundError('Chaîne')
  return { ...mapChannel(rows[0]), guide: await guideFor(id) }
}

/** The stream to play (server side only). */
export async function streamOf(id: string, index: number): Promise<IptvStream | null> {
  const { rows } = await query<{ streams: IptvStream[] }>('SELECT streams FROM iptv_channels WHERE id = $1', [id])
  return rows[0]?.streams?.[index] ?? null
}

interface Facets {
  countries: { code: string; name: string; flag?: string | null; count: number }[]
  categories: { id: string; name: string; count: number }[]
  languages: { code: string; name: string; count: number }[]
}
export async function facets(): Promise<Facets> {
  return { countries: [], categories: [], languages: [], ...(await getMeta<Partial<Facets>>('facets', {})) }
}

/** The first channels of each priority country, in the order of the settings. A country no
 * source has a channel for is still returned (count 0): the page says so instead of hiding it. */
async function priorityShelves(userId: string, settings: IptvSettings, f: Facets) {
  const codes = settings.priorityCountries
  if (!codes.length) return []
  const { rows } = await query<ChannelRow & { total: string }>(
    `SELECT * FROM (
       SELECT ${COLS}, (fav.channel_id IS NOT NULL) AS favorite, COUNT(*) OVER (PARTITION BY c.country) AS total,
              ROW_NUMBER() OVER (PARTITION BY c.country ORDER BY ${TOP_IN_COUNTRY}) AS rn
       FROM iptv_channels c LEFT JOIN iptv_favorites fav ON fav.channel_id = c.id AND fav.user_id = $1
       WHERE c.country = ANY($2::text[]) ${settings.hideOffline ? `AND c.status <> 'offline'` : ''}
     ) t WHERE rn <= 14 ORDER BY rn`, [userId, codes])
  return codes.map((code) => {
    const mine = rows.filter((r) => r.country === code)
    const known = f.countries.find((c) => c.code === code)
    return { code, name: known?.name ?? null, flag: known?.flag ?? null, count: Number(mine[0]?.total ?? 0), items: mine.map(mapChannel) }
  })
}

async function channelsByIds(userId: string, sql: string, params: unknown[]) {
  const { rows } = await query<ChannelRow & { position?: number }>(sql, params)
  return rows.map(mapChannel)
}

export async function summary(userId: string) {
  const settings = await getSettings()
  const [counts, fav, recent, popular, f, refresh] = await Promise.all([
    query<{ total: string; online: string; offline: string; checked: string }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'online') AS online,
              COUNT(*) FILTER (WHERE status = 'offline') AS offline, COUNT(*) FILTER (WHERE checked_at IS NOT NULL) AS checked
       FROM iptv_channels`),
    favorites(userId),
    recentChannels(userId, 12),
    // Most watched on this server (real plays, last 30 days): no made-up popularity
    channelsByIds(userId,
      `SELECT ${COLS}, (fav.channel_id IS NOT NULL) AS favorite FROM iptv_channels c
       JOIN (SELECT channel_id, SUM(plays) AS plays FROM iptv_history WHERE watched_at > NOW() - INTERVAL '30 days'
             GROUP BY channel_id) h ON h.channel_id = c.id
       LEFT JOIN iptv_favorites fav ON fav.channel_id = c.id AND fav.user_id = $1
       ORDER BY h.plays DESC, ${BY_NAME} LIMIT 12`, [userId]),
    facets(),
    refreshState(),
  ])
  const c = counts.rows[0]
  // Priority countries first, the others by number of channels (the order of the catalogue)
  const place = (code: string) => { const i = settings.priorityCountries.indexOf(code); return i < 0 ? settings.priorityCountries.length : i }
  const countries = [...f.countries].sort((a, b) => place(a.code) - place(b.code))
  return {
    total: Number(c.total), online: Number(c.online), offline: Number(c.offline), checked: Number(c.checked),
    favorites: fav, recent, popular, refresh, priority: await priorityShelves(userId, settings, f),
    countries: countries.slice(0, 12), categories: f.categories, languages: f.languages.slice(0, 12),
  }
}

// ─── Favourites / history (per user) ─────────────────────────────────────────
export async function favorites(userId: string) {
  return channelsByIds(userId,
    `SELECT ${COLS}, TRUE AS favorite FROM iptv_favorites fav JOIN iptv_channels c ON c.id = fav.channel_id
     WHERE fav.user_id = $1 ORDER BY fav.position, fav.created_at`, [userId])
}
export async function addFavorite(userId: string, id: string) {
  const { rows } = await query('SELECT 1 FROM iptv_channels WHERE id = $1', [id])
  if (!rows[0]) throw new NotFoundError('Chaîne')
  await query(
    `INSERT INTO iptv_favorites (user_id, channel_id, position)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM iptv_favorites WHERE user_id = $1), 0))
     ON CONFLICT DO NOTHING`, [userId, id])
}
export async function removeFavorite(userId: string, id: string) {
  await query('DELETE FROM iptv_favorites WHERE user_id = $1 AND channel_id = $2', [userId, id])
}
/** New order of the favourites (ids not given keep their place after them). */
export async function reorderFavorites(userId: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 1000) throw new ValidationError('Ordre invalide')
  const list = ids.map(assertChannelId)
  await query(
    `UPDATE iptv_favorites f SET position = o.ord FROM unnest($2::text[]) WITH ORDINALITY AS o(id, ord)
     WHERE f.user_id = $1 AND f.channel_id = o.id`, [userId, list])
  await query(
    `UPDATE iptv_favorites SET position = $3 + position WHERE user_id = $1 AND NOT (channel_id = ANY($2::text[]))`,
    [userId, list, list.length + 1])
}

export async function recordWatch(userId: string, id: string) {
  await query(
    `INSERT INTO iptv_history (user_id, channel_id) SELECT $1, id FROM iptv_channels WHERE id = $2
     ON CONFLICT (user_id, channel_id) DO UPDATE SET watched_at = NOW(), plays = iptv_history.plays + 1`, [userId, id])
}
export async function recentChannels(userId: string, limit = 30) {
  return channelsByIds(userId,
    `SELECT ${COLS}, (fav.channel_id IS NOT NULL) AS favorite FROM iptv_history h JOIN iptv_channels c ON c.id = h.channel_id
     LEFT JOIN iptv_favorites fav ON fav.channel_id = c.id AND fav.user_id = $1
     WHERE h.user_id = $1 ORDER BY h.watched_at DESC LIMIT ${Math.min(limit, 100)}`, [userId])
}

// ─── Availability checks (Python module, few at a time) ─────────────────────
interface CheckItem { id: string; url: string; index: number; kind?: 'page'; user_agent?: string | null; referrer?: string | null }
interface CheckResult { status: 'online' | 'offline' | 'unknown'; reason: string | null; best: number | null }

/** The streams of a channel worth a check: its first direct ones and its first web page. */
function checkItems(id: string, streams: IptvStream[], direct: number): CheckItem[] {
  const out: CheckItem[] = []
  let d = 0, p = 0
  streams.forEach((s, index) => {
    if (isPage(s) ? p++ >= 1 : d++ >= direct) return
    out.push({ id, url: s.url, index, ...(isPage(s) ? { kind: 'page' as const } : {}), user_agent: s.user_agent, referrer: s.referrer })
  })
  return out
}

async function runChecks(items: CheckItem[], workers = 4, timeoutMs = 5 * 60_000): Promise<Map<string, CheckResult>> {
  const out = new Map<string, CheckResult>()
  if (!items.length) return out
  const file = path.join(os.tmpdir(), `nexus-iptv-check-${process.pid}-${Date.now()}.json`)
  await fs.writeFile(file, JSON.stringify(items))
  try {
    const { events } = await collect('iptv', ['check', '--in', file, '--workers', String(workers)], timeoutMs)
    // The module answers per stream (id + address): back to the place of the stream in its channel
    const place = new Map(items.map((it) => [`${it.id}\n${it.url}`, it.index]))
    const perChannel = new Map<string, { index: number; status: string; reason: string }[]>()
    for (const e of events) {
      if (e.type !== 'check' || typeof e.id !== 'string') continue
      const index = place.get(`${e.id}\n${String(e.url)}`)
      if (index === undefined) continue
      const list = perChannel.get(e.id) ?? []
      list.push({ index, status: String(e.status), reason: String(e.reason ?? '') })
      perChannel.set(e.id, list)
    }
    for (const [id, list] of perChannel) {
      list.sort((x, y) => x.index - y.index)
      // A channel is online when one of its streams is: the first one that works is where the player starts
      const online = list.find((r) => r.status === 'online')
      // « unknown »: no stream could be judged (a web page without yt-dlp on the server) — not « offline »
      const failed = list.find((r) => r.status !== 'unknown')
      if (online) out.set(id, { status: 'online', reason: null, best: online.index })
      else if (failed) out.set(id, { status: 'offline', reason: failed.reason || null, best: null })
      else out.set(id, { status: 'unknown', reason: list[0].reason || null, best: null })
    }
    return out
  } finally {
    await fs.unlink(file).catch(() => {})
  }
}

async function saveChecks(results: Map<string, CheckResult>) {
  for (const [id, r] of results) {
    await query(`UPDATE iptv_channels SET status = $2, status_reason = $3, best_stream = $4, checked_at = NOW() WHERE id = $1`,
      [id, r.status, r.reason, r.best])
  }
}

/** Checks one channel now (its first three streams and its web page), unless it was checked a few minutes ago. */
export async function checkChannel(userId: string, id: string) {
  const { rows } = await query<{ streams: IptvStream[]; checked_at: Date | null }>('SELECT streams, checked_at FROM iptv_channels WHERE id = $1', [id])
  if (!rows[0]) throw new NotFoundError('Chaîne')
  if (!rows[0].checked_at || Date.now() - rows[0].checked_at.getTime() > 5 * 60_000) {
    await saveChecks(await runChecks(checkItems(id, rows[0].streams, 3)))
  }
  return getChannel(userId, id)
}

/**
 * Background pass. Whose turn: favourites and recently watched channels (every 6 hours), then
 * the priority countries and the Free-TV selection (every day), then the rest (every 3 days);
 * in each group, never checked first.
 */
export async function checkDueChannels(limit = 60) {
  const { priorityCountries } = await getSettings()
  const { rows } = await query<{ id: string; streams: IptvStream[] }>(
    `SELECT c.id, c.streams FROM iptv_channels c
     LEFT JOIN (SELECT channel_id FROM iptv_favorites UNION SELECT channel_id FROM iptv_history
                WHERE watched_at > NOW() - INTERVAL '30 days') mine ON mine.channel_id = c.id
     WHERE c.checked_at IS NULL OR c.checked_at < NOW() - (CASE
             WHEN mine.channel_id IS NOT NULL THEN INTERVAL '6 hours'
             WHEN c.curated IS NOT NULL OR c.country = ANY($2::text[]) THEN INTERVAL '1 day'
             ELSE INTERVAL '3 days' END)
     ORDER BY (CASE WHEN mine.channel_id IS NOT NULL THEN 0
                    WHEN c.curated IS NOT NULL AND c.country = ANY($2::text[]) THEN 1
                    WHEN c.country = ANY($2::text[]) THEN 2
                    WHEN c.curated IS NOT NULL THEN 3 ELSE 4 END),
              c.checked_at NULLS FIRST, c.curated NULLS LAST, c.id LIMIT $1`, [limit, priorityCountries])
  if (!rows.length) return 0
  await saveChecks(await runChecks(rows.flatMap((r) => checkItems(r.id, r.streams, 2)), 6, 9 * 60_000))
  return rows.length
}

// ─── Web pages: the live stream behind a YouTube / Twitch / Dailymotion page ────────────────
// yt-dlp (through the Python module) finds it when the channel is played. The address it gives
// lasts a few hours: it is kept in memory until then, never stored, never sent to the browser.
interface PageStream { url: string; user_agent: string | null; referrer: string | null }
const PAGE_KEPT = 200
const pageStreams = new Map<string, { until: number; found?: PageStream; error?: string }>()
const pageLookups = new Map<string, Promise<PageStream>>()
let lookups = 0
const lookupQueue: (() => void)[] = []

async function lookUpPage(pageUrl: string): Promise<PageStream> {
  // yt-dlp is heavy: three at a time, the others wait their turn
  if (lookups < 3) lookups++
  else await new Promise<void>((resolve) => lookupQueue.push(resolve))
  try {
    const { events, log } = await collect('iptv', ['resolve', '--url', pageUrl], 60_000)
    const hit = events.find((e) => e.type === 'resolved') as (ScriptEvent & { url?: unknown; user_agent?: unknown; referrer?: unknown; expires?: unknown }) | undefined
    if (!hit || typeof hit.url !== 'string' || !/^https?:\/\//i.test(hit.url)) {
      const err = events.find((e) => e.type === 'error') as { message?: string } | undefined
      if (!err?.message) logger.warn(`IPTV page ${pageUrl}: ${log.slice(-2).join(' | ') || 'no answer'}`)
      throw new AppError(`Direct indisponible (${err?.message || 'recherche impossible'})`, 502)
    }
    const now = Date.now()
    const expires = typeof hit.expires === 'number' ? hit.expires * 1000 - 5 * 60_000 : now + 20 * 60_000
    const found = {
      url: hit.url, user_agent: typeof hit.user_agent === 'string' ? hit.user_agent : null,
      referrer: typeof hit.referrer === 'string' ? hit.referrer : null,
    }
    pageStreams.set(pageUrl, { until: Math.max(now + 60_000, Math.min(expires, now + 3 * 3600_000)), found })
    return found
  } catch (err) {
    // A page that just failed is not looked up again at once (the player retries, several viewers)
    pageStreams.set(pageUrl, { until: Date.now() + 60_000, error: (err as Error).message })
    throw err instanceof AppError ? err : new AppError('Direct indisponible (recherche impossible)', 502)
  } finally {
    const next = lookupQueue.shift()
    if (next) next()
    else lookups--
    if (pageStreams.size > PAGE_KEPT) {
      const now = Date.now()
      for (const [k, v] of pageStreams) if (v.until < now || pageStreams.size > PAGE_KEPT) pageStreams.delete(k)
    }
  }
}

/** The stream already found for a page, while it lasts. */
function knownPage(pageUrl: string) {
  const hit = pageStreams.get(pageUrl)
  if (hit && hit.until < Date.now()) { pageStreams.delete(pageUrl); return undefined }
  return hit
}

/** Forgets what was found for a page (its stream stopped answering: look it up again next time). */
export function forgetPage(stream: IptvStream) {
  if (isPage(stream)) pageStreams.delete(stream.url)
}

/**
 * What the relay must fetch for a catalogue stream: itself, or for a web page the live stream
 * behind it. `lookUp` false (segments): only what is already known, the page is never looked up.
 */
export async function playable(stream: IptvStream, lookUp: boolean): Promise<IptvStream> {
  if (!isPage(stream)) return stream
  if (!/^https?:\/\//i.test(stream.url)) throw new AppError('Flux non pris en charge', 502)
  const hit = knownPage(stream.url)
  if (hit?.error && lookUp) throw new AppError(hit.error, 502)
  let found = hit?.found
  if (!found && lookUp) {
    let pending = pageLookups.get(stream.url)
    if (!pending) {
      pending = lookUpPage(stream.url).finally(() => pageLookups.delete(stream.url))
      pageLookups.set(stream.url, pending)
    }
    found = await pending
  }
  return found ? { ...stream, kind: 'hls', url: found.url, user_agent: found.user_agent, referrer: found.referrer } : { ...stream, kind: 'hls' }
}

// ─── Guide (XMLTV, only when configured) ─────────────────────────────────────
export async function refreshEpg(): Promise<number> {
  const { epgUrl } = await getSettings()
  if (!epgUrl) return 0
  const ids = (await query<{ id: string }>(`SELECT id FROM iptv_channels WHERE id NOT LIKE 'stream-%'`)).rows.map((r) => r.id)
  const idsFile = path.join(os.tmpdir(), `nexus-iptv-ids-${process.pid}.json`)
  const out = path.join(os.tmpdir(), `nexus-iptv-epg-${process.pid}.json`)
  await fs.writeFile(idsFile, JSON.stringify(ids))
  try {
    const { events } = await collect('iptv', ['epg', '--url', epgUrl, '--ids', idsFile, '--out', out], 10 * 60_000)
    const done = events.find((e) => e.type === 'done')
    if (!done) {
      const err = events.find((e) => e.type === 'error') as { message?: string } | undefined
      throw new Error(err?.message || 'Guide TV illisible')
    }
    const progs = JSON.parse(await fs.readFile(out, 'utf8')) as Record<string, { start: string; stop: string; title: string; description: string | null }[]>
    const flat = Object.entries(progs).flatMap(([cid, list]) => list.map((p) => ({ cid, ...p })))
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM iptv_epg')
      for (let i = 0; i < flat.length; i += 2000) {
        await client.query(
          `INSERT INTO iptv_epg (channel_id, starts_at, ends_at, title, description)
           SELECT x.cid, x.start::timestamptz, x.stop::timestamptz, x.title, x.description
           FROM jsonb_to_recordset($1::jsonb) AS x(cid text, start text, stop text, title text, description text)
           ON CONFLICT DO NOTHING`, [JSON.stringify(flat.slice(i, i + 2000))])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    await setMeta('epg', { at: new Date().toISOString(), channels: Object.keys(progs).length, programmes: flat.length })
    return flat.length
  } finally {
    await fs.unlink(idsFile).catch(() => {})
    await fs.unlink(out).catch(() => {})
  }
}

/** Now / next of a channel (empty when there is no guide for it). */
export async function guideFor(id: string) {
  const { rows } = await query<{ starts_at: Date; ends_at: Date; title: string; description: string | null }>(
    `SELECT starts_at, ends_at, title, description FROM iptv_epg WHERE channel_id = $1 AND ends_at > NOW()
     ORDER BY starts_at LIMIT 6`, [id])
  return rows.map((r) => ({ start: r.starts_at.toISOString(), end: r.ends_at.toISOString(), title: r.title, description: r.description }))
}

// ─── Background work ─────────────────────────────────────────────────────────
let timers: NodeJS.Timeout[] = []
let checking = false

export function startIptvWorker() {
  if (timers.length || process.env.NODE_ENV === 'test' || process.env.IPTV_DISABLED === '1') return
  const tick = async () => {
    const settings = await getSettings()
    const state = await refreshState()
    const age = state.at ? Date.now() - new Date(state.at).getTime() : Infinity
    // Daily catalogue refresh (and at once on the first start: the catalogue is empty)
    const empty = Number((await query<{ n: string }>('SELECT COUNT(*) AS n FROM iptv_channels')).rows[0].n) === 0
    if ((settings.autoRefresh && age > 24 * 3600_000) || (empty && age > 3600_000)) await refreshCatalogue().catch(() => {})
    if (settings.epgUrl) {
      const epg = await getMeta<{ at?: string }>('epg', {})
      if (!epg.at || Date.now() - new Date(epg.at).getTime() > 6 * 3600_000) await refreshEpg().catch((err) => logger.warn(`IPTV guide: ${err.message}`))
    }
  }
  const check = async () => {
    if (checking || refreshing) return
    checking = true
    try { await checkDueChannels(60) } catch (err) { logger.warn(`IPTV checks: ${(err as Error).message}`) } finally { checking = false }
  }
  timers = [
    setTimeout(() => { void tick().catch(() => {}) }, 60_000),
    setInterval(() => { void tick().catch(() => {}) }, 3600_000),
    setInterval(() => { void check() }, 10 * 60_000),
  ]
  for (const t of timers) t.unref()
}

/** Where the catalogue cache of the Python module lives (shown in Réglages). */
export const iptvDataDir = () => process.env.IPTV_DATA_DIR || path.join(scriptsDir(), 'data', 'iptv')
