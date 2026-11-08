import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Namespace } from 'socket.io'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors'
import { signedImage } from './images'
import { MediaScanner, hintFor } from './scanner'
import { indexLibrarySoon } from './keyframeIndexer'
import {
  LANG_RE, SEASON_RE, SOURCES, collect, destFor, parseSourceId, runScript, selectionArg,
  type Kind, type RunHandle, type ScriptEvent, type Source,
} from './downloadScripts'

/**
 * « Téléchargements »: unified search over the four scripts, and the queue
 * of download jobs (table `downloads`) run by a small worker.
 */

export type Status = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

const MAX_PARALLEL = () => Math.max(1, Math.min(8, Number(process.env.DOWNLOADS_PARALLEL) || 2))
const SEARCH_TIMEOUT = () => Number(process.env.DOWNLOADS_SEARCH_TIMEOUT_MS) || 90_000
const DETAILS_TIMEOUT = () => Number(process.env.DOWNLOADS_DETAILS_TIMEOUT_MS) || 180_000

// ─── Live updates (Socket.io namespace /downloads, admins only) ─────────────

let ns: Namespace | null = null
export function setDownloadsNamespace(n: Namespace) { ns = n }
const emit = (event: string, payload: unknown, room?: string) => {
  if (!ns) return
  if (room) ns.to(room).emit(event, payload)
  else ns.emit(event, payload)
}

/** Listeners for finished jobs (push notifications, step 5). */
type FinishListener = (job: DownloadRow, libraryUpdated: Promise<void>) => void
const finishListeners: FinishListener[] = []
export function onDownloadFinished(fn: FinishListener) { finishListeners.push(fn) }

// ─── Search & details ──────────────────────────────────────────────────────

/** Remote artwork goes through the signed image proxy (no CORS, no hotlink). */
function withImages<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj }
  for (const key of ['poster_url', 'thumbnail_url']) {
    if (typeof out[key] === 'string') out[key] = signedImage(out[key] as string)
  }
  return out as T
}

/**
 * Starts the four scripts in parallel. Results are sent to the user's room
 * as they arrive (download:search_result), then one download:search_done
 * per script. A script that fails or times out does not block the others.
 */
export function startSearch(rawQuery: unknown, userId: string): { searchId: string; sources: Source[] } {
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  if (q.length < 2 || q.length > 200 || /[\0\r\n]/.test(q)) throw new ValidationError('Recherche invalide')
  const searchId = crypto.randomUUID()
  const room = `user:${userId}`
  for (const source of SOURCES) {
    const t0 = Date.now()
    let count = 0
    let error: string | null = null
    collect(source, ['--search', q], SEARCH_TIMEOUT(), (e) => {
      if (e.type === 'result') {
        count++
        emit('download:search_result', { searchId, source, result: withImages(e) }, room)
      } else if (e.type === 'error') {
        error = String(e.message || 'Erreur')
      }
    }).then(({ code, log }) => {
      if (code !== 0 && !error) error = code === null ? 'Délai dépassé' : 'Le script a échoué'
      if (error) logger.warn(`Download search ${source} "${q}": ${error} — ${log.slice(-3).join(' | ')}`)
      emit('download:search_done', { searchId, source, count, error, ms: Date.now() - t0 }, room)
    }).catch((err: Error) => {
      emit('download:search_done', { searchId, source, count, error: err.message, ms: Date.now() - t0 }, room)
    })
  }
  return { searchId, sources: SOURCES }
}

const detailsCache = new Map<string, { at: number; data: unknown }>()

/** Seasons / episodes / chapters of a title, with what is already downloaded. */
export async function getDetails(id: unknown, fresh = false): Promise<Record<string, unknown>> {
  const { source } = parseSourceId(id)
  const key = String(id)
  const hit = detailsCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.data as Record<string, unknown>
  const { events, code, log } = await collect(source, ['--details', key], DETAILS_TIMEOUT())
  const details = events.find((e) => e.type === 'details')
  if (!details) {
    const err = events.find((e) => e.type === 'error')
    logger.warn(`Download details ${key}: code ${code} — ${log.slice(-3).join(' | ')}`)
    throw new ConflictError(err ? String(err.message) : 'Détails indisponibles pour le moment')
  }
  const data = withImages(details as Record<string, unknown>)
  detailsCache.set(key, { at: Date.now(), data })
  return data
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

export interface DownloadRow {
  id: string
  kind: Kind
  source_script: Source
  source_id: string
  title: string
  poster_url: string | null
  options: {
    lang?: string; season?: string
    /** oxtorrent: the version chosen, what it is (« S01E03 »), the film / episode it stands for, jobs it replaces */
    version?: { label: string; resolution?: string | null; language?: string | null }
    part?: string; item?: string; replaces?: string[]
  }
  selection: { episodes?: number[]; chapters?: number[] }
  status: Status
  progress: Record<string, unknown>
  dest_path: string | null
  error: string | null
  created_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export function present(row: DownloadRow) {
  return { ...row, poster_url: signedImage(row.poster_url) }
}

export interface CreateInput {
  id: unknown          // script id, e.g. anisama:anime:one-piece
  title: unknown
  poster_url?: unknown
  lang?: unknown
  season?: unknown
  episodes?: unknown
  chapters?: unknown
  force?: unknown
  /** oxtorrent */
  version?: unknown
  part?: unknown
  item?: unknown
  replace?: unknown
}

const shortText = (v: unknown, max: number, re = /^[\p{L}\p{N} .,:'’&()·+\-–/]+$/u) => {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t && re.test(t) ? t : undefined
}

function cleanInput(input: CreateInput) {
  const { source, kind } = parseSourceId(input.id)
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : ''
  if (!title) throw new ValidationError('Titre manquant')
  const poster = typeof input.poster_url === 'string' && /^https?:\/\/\S+$/.test(input.poster_url) ? input.poster_url.slice(0, 2000) : null
  const options: DownloadRow['options'] = {}
  if (input.lang != null) {
    const lang = String(input.lang).toUpperCase()
    if (!LANG_RE.test(lang)) throw new ValidationError('Langue invalide')
    options.lang = lang
  }
  if (input.season != null) {
    const season = String(input.season).toLowerCase()
    if (!SEASON_RE.test(season)) throw new ValidationError('Saison invalide')
    options.season = season
  }
  const selection: { episodes?: number[]; chapters?: number[] } = {}
  if (source === 'oxtorrent') {
    // A torrent is downloaded whole: no season / episode choice, its language is in its name
    delete options.season
    delete options.lang
    const v = (input.version ?? {}) as { resolution?: unknown; language?: unknown }
    const resolution = shortText(v.resolution, 10, /^\d{3,4}p$/)
    const language = shortText(v.language, 12, /^[A-Z]{2,12}$/)
    const label = [resolution, language].filter(Boolean).join(' ')
    if (label) options.version = { label, resolution: resolution ?? null, language: language ?? null }
    const part = shortText(input.part, 40)
    if (part) options.part = part
    // The film / episode this version stands for: another version of it is a duplicate
    const item = shortText(input.item, 300, /^[a-z0-9 :|-]+$/)
    if (item) options.item = item
  } else if (kind === 'anime' || kind === 'serie') {
    if (!options.season) throw new ValidationError('Saison manquante')
    selectionArg(input.episodes)   // validates
    selection.episodes = (input.episodes as unknown[]).map(Number)
  } else if (kind === 'manga') {
    selectionArg(input.chapters)
    selection.chapters = (input.chapters as unknown[]).map(Number)
  }
  return { source, kind, title, poster, options, selection }
}

/** Same title + same episodes / chapters already queued, running or done. */
async function findDuplicates(sourceId: string, options: object, selection: { episodes?: number[]; chapters?: number[] }) {
  const { rows } = await query<DownloadRow>(
    `SELECT * FROM downloads WHERE source_id = $1 AND options = $2::jsonb
       AND status IN ('queued', 'running', 'paused', 'done') ORDER BY created_at DESC`,
    [sourceId, JSON.stringify(options)],
  )
  const wanted = selection.episodes ?? selection.chapters
  const overlap: number[] = []
  for (const row of rows) {
    const had = row.selection.episodes ?? row.selection.chapters
    if (!wanted || !had) return { rows: [row], items: [] as number[] }   // film / video already there
    for (const n of wanted) if (had.includes(n) && !overlap.includes(n)) overlap.push(n)
  }
  return { rows: overlap.length ? rows : [], items: overlap.sort((a, b) => a - b) }
}

/** Another version of the same film / episode (oxtorrent), queued or downloaded. */
async function otherVersions(item: string) {
  const { rows } = await query<DownloadRow>(
    `SELECT * FROM downloads WHERE source_script = 'oxtorrent' AND options->>'item' = $1
       AND status IN ('queued', 'running', 'paused', 'done') ORDER BY created_at DESC`, [item])
  return rows
}

export async function createDownload(input: CreateInput, userId: string) {
  const c = cleanInput(input)
  if (c.source === 'oxtorrent' && c.options.item) {
    const others = await otherVersions(c.options.item)
    const same = others.filter((r) => r.source_id === String(input.id))
    const different = others.filter((r) => r.source_id !== String(input.id))
    if (same.length && input.force !== true) {
      const err = new ConflictError('Cette version est déjà téléchargée ou dans la file')
      Object.assign(err, { details: { duplicate: true, items: [], downloads: same.map((r) => r.id) } })
      throw err
    }
    if (different.length && input.force !== true && input.replace !== true) {
      const had = [...new Set(different.map((r) => r.options.version?.label || 'une autre version'))].join(', ')
      const err = new ConflictError(`Déjà téléchargé en ${had}`)
      Object.assign(err, { details: { duplicate: true, replaceable: true, items: [], versions: had, downloads: different.map((r) => r.id) } })
      throw err
    }
    // « Remplacer »: the other versions' files are deleted once this one is complete
    if (input.replace === true && different.length) c.options.replaces = different.map((r) => r.id)
  } else if (input.force !== true) {
    const dup = await findDuplicates(String(input.id), c.options, c.selection)
    if (dup.rows.length) {
      const err = new ConflictError(dup.items.length
        ? `Déjà téléchargé ou en file : ${dup.items.length > 10 ? `${dup.items.length} éléments` : dup.items.join(', ')}`
        : 'Ce titre est déjà téléchargé ou dans la file')
      Object.assign(err, { details: { duplicate: true, items: dup.items, downloads: dup.rows.map((r) => r.id) } })
      throw err
    }
  }
  const { rows } = await query<DownloadRow>(
    `INSERT INTO downloads (kind, source_script, source_id, title, poster_url, options, selection, dest_path, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [c.kind, c.source, String(input.id), c.title, c.poster, JSON.stringify(c.options), JSON.stringify(c.selection),
      destFor(c.kind), userId],
  )
  broadcastStatus(rows[0])
  void tick()
  return present(rows[0])
}

export async function listDownloads() {
  const { rows } = await query<DownloadRow>(
    `SELECT * FROM downloads ORDER BY
       CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
       COALESCE(finished_at, created_at) DESC
     LIMIT 500`,
  )
  return rows.map(present)
}

async function getRow(id: string): Promise<DownloadRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('Téléchargement')
  const { rows } = await query<DownloadRow>('SELECT * FROM downloads WHERE id = $1', [id])
  if (!rows[0]) throw new NotFoundError('Téléchargement')
  return rows[0]
}

async function setStatus(id: string, status: Status, extra: Record<string, unknown> = {}) {
  const sets = ['status = $2', 'updated_at = NOW()']
  const values: unknown[] = [id, status]
  for (const [k, v] of Object.entries(extra)) {
    values.push(k === 'progress' ? JSON.stringify(v) : v)
    sets.push(`${k} = $${values.length}${k === 'progress' ? '::jsonb' : ''}`)
  }
  if (['done', 'failed', 'cancelled'].includes(status)) sets.push('finished_at = NOW()')
  const { rows } = await query<DownloadRow>(`UPDATE downloads SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values)
  if (rows[0]) broadcastStatus(rows[0])
  return rows[0]
}

function broadcastStatus(row: DownloadRow) {
  emit('download:status', present(row))
}

// ─── Worker ────────────────────────────────────────────────────────────────

interface Running { handle: RunHandle; stopAs: Status | null; progress: Record<string, unknown> }
const running = new Map<string, Running>()
let started = false
let ticking = false

function argsFor(row: DownloadRow): string[] {
  const args = ['--download', row.source_id, '--dest', row.dest_path || destFor(row.kind)]
  if (row.options.lang) args.push('--lang', row.options.lang)
  if (row.options.season) args.push('--season', row.options.season)
  const eps = selectionArg(row.selection.episodes)
  if (eps) args.push('--episodes', eps)
  const chs = selectionArg(row.selection.chapters)
  if (chs) args.push('--chapters', chs)
  return args
}

function applyEvent(p: Record<string, unknown>, e: ScriptEvent) {
  const files = (p.files as string[]) ?? []
  const errors = (p.errors as string[]) ?? []
  switch (e.type) {
    case 'item_start':
      Object.assign(p, { item: e.name, index: e.index, total: e.total, percent: 0, speed: '', eta: '' })
      delete p.page; delete p.pages_total
      break
    case 'progress':
      for (const k of ['item', 'percent', 'downloaded_mb', 'total_mb', 'speed', 'eta', 'chapter', 'chapters_total', 'page', 'pages_total']) {
        if (e[k] !== undefined) p[k] = e[k]
      }
      break
    case 'item_done':
      p.items_done = Number(p.items_done || 0) + 1
      if (p.item === e.name || !p.item) p.percent = 100     // the last progress line is often 99 %
      p.files = [...files, String(e.path)].slice(-200)
      break
    case 'item_skipped':
      p.items_skipped = Number(p.items_skipped || 0) + 1
      p.files = [...files, String(e.path)].slice(-200)
      break
    case 'error':
      p.errors = [...errors, `${e.item ? `${e.item} : ` : ''}${e.message}`].slice(-50)
      break
    case 'done':
      p.result = { ok: e.ok, failed: e.failed, skipped: e.skipped }
      break
  }
}

async function launch(row: DownloadRow) {
  const progress: Record<string, unknown> = {}
  let lastSave = 0
  const state: Running = { handle: null as unknown as RunHandle, stopAs: null, progress }
  const handle = runScript(row.source_script, argsFor(row), (e) => {
    applyEvent(progress, e)
    emit('download:progress', { id: row.id, progress })
    if (Date.now() - lastSave > 2000 || e.type !== 'progress') {
      lastSave = Date.now()
      query('UPDATE downloads SET progress = $2::jsonb, updated_at = NOW() WHERE id = $1', [row.id, JSON.stringify(progress)])
        .catch(() => {})
    }
  })
  state.handle = handle
  running.set(row.id, state)

  const { code, log } = await handle.done
  running.delete(row.id)
  let status: Status
  let error: string | null = null
  const result = progress.result as { ok?: number; failed?: number; skipped?: number } | undefined
  if (state.stopAs) {
    status = state.stopAs
  } else if (code === 0 && result) {
    status = 'done'
  } else if (result && ((result.ok ?? 0) > 0 || (result.skipped ?? 0) > 0)) {
    status = 'done'
    error = `${result.failed} élément(s) en échec`
  } else {
    status = 'failed'
    const errs = progress.errors as string[] | undefined
    error = errs?.at(-1) || log.filter((l) => /error|erreur|traceback/i.test(l)).at(-1) || `Le script s'est arrêté (code ${code})`
  }
  if (status === 'failed' || error) logger.warn(`Download ${row.id} (${row.title}) ${status}: ${error} — ${log.slice(-5).join(' | ')}`)
  const finished = await setStatus(row.id, status, { progress, error: error?.slice(0, 1000) ?? null })
  if (finished && (status === 'done' || status === 'failed')) {
    let libraryUpdated = Promise.resolve()
    if (status === 'done') {
      await writeHints(finished).catch((err: Error) => logger.warn(`Download hint: ${err.message}`))
      await removeReplaced(finished).catch((err: Error) => logger.warn(`Download replace: ${err.message}`))
      libraryUpdated = rescanLibrary(row.kind)
    }
    for (const fn of finishListeners) {
      try { fn(finished, libraryUpdated) } catch (err) { logger.warn(`download listener: ${(err as Error).message}`) }
    }
  }
  void tick()
}

/**
 * « Remplacer » (oxtorrent): the new version is complete, the files of the
 * versions it replaces are deleted (only inside the library folder of this
 * kind) and their jobs leave the queue.
 */
export async function removeReplaced(row: DownloadRow) {
  const ids = (row.options.replaces ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id) && id !== row.id)
  if (!ids.length) return
  const root = path.resolve(destFor(row.kind))
  const mine = new Set(((row.progress as { files?: string[] }).files ?? []).map((f) => path.resolve(f)))
  const { rows } = await query<DownloadRow>('SELECT * FROM downloads WHERE id = ANY($1::uuid[])', [ids])
  for (const old of rows) {
    for (const f of ((old.progress as { files?: string[] }).files ?? [])) {
      const file = path.resolve(String(f))
      if (!file.startsWith(root + path.sep) || mine.has(file)) continue
      await fs.unlink(file).catch(() => {})
      await fs.unlink(path.join(path.dirname(file), `.${path.basename(file)}.nexus.json`)).catch(() => {})
      // Empty folders left behind (« Film (2024) »), never the library folder itself
      for (let dir = path.dirname(file); dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
        const left = await fs.readdir(dir).catch(() => ['?'])
        if (left.some((n) => n !== '.nexus.json')) break
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }
    await query('DELETE FROM downloads WHERE id = $1', [old.id])
    emit('download:removed', { id: old.id })
    logger.info(`Download ${row.id}: replaces ${old.id} (${old.options.version?.label ?? 'autre version'})`)
  }
}

/** Starts queued jobs while there is room. */
export async function tick() {
  if (!started || ticking) return
  ticking = true
  try {
    while (running.size < MAX_PARALLEL()) {
      const { rows } = await query<DownloadRow>(
        `UPDATE downloads SET status = 'running', started_at = NOW(), updated_at = NOW(), error = NULL
         WHERE id = (SELECT id FROM downloads WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING *`,
      )
      if (!rows[0]) break
      broadcastStatus(rows[0])
      void launch(rows[0]).catch((err: Error) => logger.error(`Download ${rows[0].id}: ${err.message}`))
    }
  } catch (err) {
    logger.error(`Download worker: ${(err as Error).message}`)
  } finally {
    ticking = false
  }
}

/**
 * movix knows the exact TMDB title: leave it next to the files (.nexus.json)
 * so the library scan does not look the title up by name and pick another one
 * (« One Piece » 1999 anime vs the 2023 series).
 */
export async function writeHints(row: DownloadRow) {
  const m = row.source_id.match(/^movix:(tv|movie):(\d+)$/)
  const files = (row.progress.files as string[] | undefined) ?? []
  if (!m || !files.length || !row.dest_path) return
  const hint = JSON.stringify({ source: 'movix', media_type: m[1], tmdb_id: Number(m[2]), title: row.title }) + '\n'
  const targets = new Set<string>()
  for (const file of files) {
    const rel = path.relative(row.dest_path, file)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    targets.add(m[1] === 'tv' ? hintFor.serie(path.join(row.dest_path, rel.split(path.sep)[0])) : hintFor.film(file))
  }
  for (const t of targets) {
    try { await fs.access(path.dirname(t)); await fs.writeFile(t, hint) } catch { /* folder gone */ }
  }
}

/** Hints for downloads finished before they existed (e.g. after an update). */
async function backfillHints() {
  const { rows } = await query<DownloadRow>(`SELECT * FROM downloads WHERE status = 'done' AND source_script = 'movix'`)
  for (const row of rows) await writeHints(row).catch(() => {})
}

/** On startup, jobs left "running" (PM2 restart) go back to the queue. */
export async function requeueInterrupted(): Promise<number> {
  const { rowCount } = await query(`UPDATE downloads SET status = 'queued', updated_at = NOW() WHERE status = 'running'`)
  return rowCount ?? 0
}

export async function startDownloadWorker() {
  if (started) return
  started = true
  await requeueInterrupted()
  void backfillHints()
  setInterval(() => { void tick() }, 10_000).unref()
  await tick()
}

export async function stopDownloadWorker() {
  started = false
  for (const r of running.values()) { r.stopAs = 'queued'; r.handle.kill() }
}

// ─── Actions ───────────────────────────────────────────────────────────────

export async function actOn(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') {
  const row = await getRow(id)
  const live = running.get(id)
  switch (action) {
    case 'pause':
      if (live) { live.stopAs = 'paused'; live.handle.kill(); return present(row) }
      if (row.status !== 'queued') throw new ConflictError('Seul un téléchargement en cours ou en attente peut être mis en pause')
      return present(await setStatus(id, 'paused'))
    case 'resume':
      if (row.status !== 'paused') throw new ConflictError('Ce téléchargement n’est pas en pause')
      { const r = await setStatus(id, 'queued'); void tick(); return present(r) }
    case 'cancel':
      if (live) { live.stopAs = 'cancelled'; live.handle.kill(); return present(row) }
      if (!['queued', 'paused'].includes(row.status)) throw new ConflictError('Ce téléchargement est déjà terminé')
      return present(await setStatus(id, 'cancelled'))
    case 'retry':
      if (!['failed', 'cancelled', 'done'].includes(row.status)) throw new ConflictError('Ce téléchargement est encore actif')
      { const r = await setStatus(id, 'queued', { progress: {}, error: null }); void tick(); return present(r) }
  }
}

export async function deleteDownload(id: string) {
  await getRow(id)
  const live = running.get(id)
  if (live) { live.stopAs = 'cancelled'; live.handle.kill() }
  await query('DELETE FROM downloads WHERE id = $1', [id])
  emit('download:removed', { id })
}

/** Where to open a finished download: player (video) or reader (manga). */
export async function openTarget(id: string): Promise<{ mediaId: string; episodeId?: string; chapterId?: string; reader: 'player' | 'reader' }> {
  const row = await getRow(id)
  const files = [...((row.progress.files as string[] | undefined) ?? [])].reverse()
  for (const file of files) {
    const ep = await query<{ id: string; media_item_id: string }>('SELECT id, media_item_id FROM episodes WHERE file_path = $1 LIMIT 1', [file])
    if (ep.rows[0]) return { mediaId: ep.rows[0].media_item_id, episodeId: ep.rows[0].id, reader: 'player' }
    const ch = await query<{ id: string; media_item_id: string }>('SELECT id, media_item_id FROM chapters WHERE folder_path = $1 LIMIT 1', [file])
    if (ch.rows[0]) return { mediaId: ch.rows[0].media_item_id, chapterId: ch.rows[0].id, reader: 'reader' }
    const media = await query<{ id: string; type: string }>(
      `SELECT id, type FROM media_items WHERE file_path = $1 OR $1 LIKE file_path || '/%' ORDER BY length(file_path) DESC LIMIT 1`, [file])
    if (media.rows[0]) {
      return { mediaId: media.rows[0].id, reader: ['manga', 'webtoon'].includes(media.rows[0].type) ? 'reader' : 'player' }
    }
  }
  throw new AppError('Ce téléchargement n’est pas encore dans la bibliothèque', 404)
}

// ─── Library ───────────────────────────────────────────────────────────────

const SCANS: Partial<Record<Kind, [string, () => Promise<number>]>> = {
  anime: ['animes', () => MediaScanner.scanAnimes()],
  manga: ['manga', () => MediaScanner.scanManga()],
  film: ['films', () => MediaScanner.scanFilms()],
  serie: ['series', () => MediaScanner.scanSeries()],
  youtube: ['youtube', () => MediaScanner.scanYoutube()],
}

/** The finished file appears in the library at once (retries while another scan runs). */
/** Rescans the library of this kind; resolves when done (or given up), never rejects. */
function rescanLibrary(kind: Kind, attempt = 0): Promise<void> {
  const scan = SCANS[kind]
  if (!scan) return Promise.resolve()
  if (MediaScanner.isRunning()) {
    if (attempt >= 30) return Promise.resolve()
    return new Promise((resolve) => { setTimeout(() => { void rescanLibrary(kind, attempt + 1).then(resolve) }, 60_000).unref() })
  }
  return MediaScanner.exclusive(scan[0], scan[1])
    .then((n) => { logger.info(`Library rescan after download (${kind}): ${n}`); indexLibrarySoon() })
    .catch((err: Error) => { logger.warn(`Library rescan after download: ${err.message}`) })
}

/** Live event to every open Nexus of the admins (the /downloads namespace is admin only). */
export function broadcast(event: string, payload: unknown) { emit(event, payload) }

export const _test = { applyEvent, findDuplicates, running }
