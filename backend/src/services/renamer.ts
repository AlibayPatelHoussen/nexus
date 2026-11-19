import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'
import { query, withTransaction } from '../config/database'
import { logger } from '../utils/logger'
import { AppError, ConflictError } from '../utils/errors'
import { canSudo, isPermissionError, owner, sudoRun } from '../utils/sudo'
import { MediaScanner, hintFor } from './scanner'
import { listJobs } from './transcode'
import { onDownloadFinished } from './downloads'

/**
 * The library under the names Jellyfin recognises (its « Movies » / « Shows » naming):
 *
 *   films    Titre (Année) [tmdbid-N]/Titre (Année).mkv        (+ « .fr.srt »… subtitles)
 *   séries   Titre (Année) [tmdbid-N]/Season 01/Titre S01E01.mkv
 *   animes   the same (an anime film: like a film, in the animes folder)
 *
 * The files are moved, then Nexus' rows follow them (same ids: progress, favourites, « Reprendre »
 * stay). Every move is written down by batch, so a batch can be put back (« Annuler »). New
 * downloads are renamed as they finish (setting « auto », on by default); the library already
 * there, after a preview, with one button. A folder a script made again for a title already
 * renamed (anime-sama names its own folders) joins it: its episodes move in, its row goes.
 *
 * Never touched: files being played or still written, hidden files, other libraries (manga, YouTube).
 */

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv']
const SIDE_EXTS = ['.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', '.sup']
const LANG_FOLDER = /^(vf|vff|vfq|vostfr|vost|vo|multi|fr|en|truefrench)$/i
const LANG_IN_NAME = /(?:^|[^a-z])(vff|vfq|vf|vostfr|vost|vo|multi)(?:$|[^a-z])/i
/** A file changed less than this ago may still be written (a download) */
const QUIET_MS = 2 * 60_000

const roots = () => ({
  film: path.resolve(process.env.FILMS_PATH || '/media/films'),
  serie: path.resolve(process.env.SERIES_PATH || '/media/series'),
  anime: path.resolve(process.env.ANIMES_PATH || '/media/animes'),
})

// ─── Names ───────────────────────────────────────────────────────────────────

/** A name every system takes (Jellyfin, Windows through SMB): no / \ : * ? " < > |, no final dot */
export function safeName(text: string): string {
  const s = (text || '').normalize('NFC')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex -- control characters are what is removed
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
    .replace(/[. ]+$/, '')
    .trim()
  return s && s !== '.' && s !== '..' ? s : 'Sans titre'
}

export interface Naming { title: string; year: number | null; tmdbId: number | null }

/** « Inception (2010) » */
export const baseName = (m: Naming) => `${safeName(m.title)}${m.year ? ` (${m.year})` : ''}`
/** « Inception (2010) [tmdbid-27205] »: Jellyfin then takes the exact title, whatever its name */
export const titleFolder = (m: Naming) => `${baseName(m)}${m.tmdbId ? ` [tmdbid-${m.tmdbId}]` : ''}`
const pad = (n: number, width = 2) => String(n).padStart(width, '0')
/** « Season 01 » (« Season 00 »: specials) */
export const seasonFolder = (season: number) => `Season ${pad(season)}`
/** « One Piece S01E05 » */
export const episodeName = (title: string, season: number, episode: number) =>
  `${safeName(title)} S${pad(season)}E${pad(episode, episode >= 100 ? 3 : 2)}`

/** « VF » / « VOSTFR » from the folders a file is in (or its name), for two versions side by side */
export function versionOf(rel: string): string | null {
  const parts = rel.split(path.sep)
  for (const p of [...parts.slice(0, -1)].reverse()) {
    if (LANG_FOLDER.test(p.trim())) return p.trim().toUpperCase()
    const m = p.match(LANG_IN_NAME)
    if (m) return m[1].toUpperCase()
  }
  return null
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export interface Move { from: string; to: string }
export interface TitlePlan {
  mediaId: string
  type: 'film' | 'serie' | 'anime'
  title: string
  tmdbId: number | null
  /** The item's path now / once renamed (a film: its video; a series: its folder) */
  from: string
  to: string
  /** In order: a folder first, then the files inside it */
  moves: Move[]
  episodes: { id: string; from: string; to: string }[]
  /** Another title already has this folder: these episodes join it */
  mergeInto?: string
  skipped: { path: string; reason: string }[]
}

interface ItemRow { id: string; type: 'film' | 'serie' | 'anime'; title: string; year: number | null; tmdb_id: number | null; tmdb_kind: string | null; file_path: string }

const exists = (p: string) => fs.promises.lstat(p).then(() => true, () => false)
const isHidden = (p: string) => path.basename(p).startsWith('.')

/** Being played, or written less than two minutes ago (a download): left for later */
async function busy(file: string): Promise<string | null> {
  if (listJobs().some((j) => j.filePath === file)) return 'en cours de lecture'
  try {
    const st = await fs.promises.stat(file)
    if (Date.now() - st.mtimeMs < QUIET_MS) return 'encore en cours d’écriture'
  } catch { return 'introuvable' }
  return null
}

/** A folder where something is still being downloaded (a part file, a file just written) */
async function folderBusy(dir: string, depth = 0): Promise<boolean> {
  if (depth > 4) return false
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (/^\.part|\.part$|\.ytdl$|\.temp\.[a-z0-9]+$/i.test(e.name)) return true
    if (e.isDirectory()) { if (await folderBusy(full, depth + 1)) return true; continue }
    try { if (Date.now() - (await fs.promises.stat(full)).mtimeMs < QUIET_MS) return true } catch { /* gone */ }
  }
  return false
}

/** Subtitles next to a video, with what follows its name (« .fr.srt ») */
async function sidecars(video: string): Promise<{ file: string; rest: string }[]> {
  const dir = path.dirname(video)
  const stem = path.basename(video, path.extname(video))
  const out: { file: string; rest: string }[] = []
  for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
    if (!name.startsWith(`${stem}.`) || name === path.basename(video)) continue
    if (SIDE_EXTS.includes(path.extname(name).toLowerCase())) out.push({ file: path.join(dir, name), rest: name.slice(stem.length) })
  }
  return out
}

const naming = (r: ItemRow): Naming => ({ title: r.title, year: r.year, tmdbId: r.tmdb_id })

async function planFilm(r: ItemRow): Promise<TitlePlan | null> {
  const root = roots().film
  const video = r.file_path
  const dir = path.dirname(video)
  const plan: TitlePlan = { mediaId: r.id, type: 'film', title: r.title, tmdbId: r.tmdb_id, from: video, to: video, moves: [], episodes: [], skipped: [] }
  const inLang = path.dirname(dir) === root && LANG_FOLDER.test(path.basename(dir))
  const own = dir !== root && !inLang
  const version = inLang ? path.basename(dir).toUpperCase() : null
  const targetDir = path.join(root, titleFolder(naming(r)))
  const base = `${baseName(naming(r))}${version ? ` - ${version}` : ''}`
  if (path.join(targetDir, `${base}${path.extname(video).toLowerCase()}`) === video) return null
  const why = await busy(video)
  if (why) { plan.skipped.push({ path: video, reason: why }); return plan }

  // Its own folder with no other film in it: the folder itself becomes « Titre (Année) … »
  let current = video
  if (own && dir !== targetDir && !(await exists(targetDir))) {
    const others = (await fs.promises.readdir(dir).catch(() => [] as string[]))
      .filter((n) => VIDEO_EXTS.includes(path.extname(n).toLowerCase()) && n !== path.basename(video))
    if (!others.length && path.dirname(dir) === root) {
      plan.moves.push({ from: dir, to: targetDir })
      current = path.join(targetDir, path.basename(video))
    }
  }
  // Another version already has the name: « Titre (Année) - 1080p » (Jellyfin's versions)
  let name = base
  let target = path.join(targetDir, `${base}${path.extname(video).toLowerCase()}`)
  if (await exists(target) && target.toLowerCase() !== current.toLowerCase()) {
    const label = path.basename(video).match(/\b(2160p|1080p|720p|576p|480p|4k)\b/i)?.[1] ?? '2'
    name = `${base} - ${label}`
    target = path.join(targetDir, `${name}${path.extname(video).toLowerCase()}`)
    if (target.toLowerCase() !== current.toLowerCase() && await exists(target)) {
      plan.skipped.push({ path: video, reason: `« ${path.relative(root, target)} » existe déjà` })
      plan.moves = []
      return plan
    }
  }
  const subs = await sidecars(video)
  const fromDir = path.dirname(current)
  if (current !== target) plan.moves.push({ from: current, to: target })
  for (const s of subs) {
    const to = path.join(targetDir, `${name}${s.rest}`)
    if (!(await exists(to))) plan.moves.push({ from: path.join(fromDir, path.basename(s.file)), to })
  }
  const hint = hintFor.film(video)
  if (await exists(hint)) plan.moves.push({ from: path.join(fromDir, path.basename(hint)), to: hintFor.film(target) })
  plan.moves = plan.moves.filter((m) => m.from !== m.to)
  plan.to = target
  return plan.moves.length ? plan : null
}

async function planShow(r: ItemRow, folderOwners: Map<string, string>): Promise<TitlePlan | null> {
  const root = path.dirname(r.file_path)
  const folder = r.file_path
  const filmLike = r.type === 'anime' && r.tmdb_kind === 'movie'
  const targetFolder = path.join(root, titleFolder(naming(r)))
  const plan: TitlePlan = { mediaId: r.id, type: r.type, title: r.title, tmdbId: r.tmdb_id, from: folder, to: targetFolder, moves: [], episodes: [], skipped: [] }
  if (await folderBusy(folder)) { plan.skipped.push({ path: folder, reason: 'téléchargement en cours' }); return plan }

  // The folder: renamed, or (another title already there) its episodes join that one
  const owner = folderOwners.get(targetFolder)
  let base = folder
  if (folder !== targetFolder) {
    if (owner && owner !== r.id) plan.mergeInto = owner
    else if (await exists(targetFolder)) {
      plan.skipped.push({ path: folder, reason: `le dossier « ${path.basename(targetFolder)} » existe déjà` })
      return plan
    } else {
      plan.moves.push({ from: folder, to: targetFolder })
      base = targetFolder
    }
  }

  const { rows: eps } = await query<{ id: string; season: number | null; episode_number: number; file_path: string }>(
    'SELECT id, season, episode_number, file_path FROM episodes WHERE media_item_id = $1 ORDER BY season NULLS FIRST, episode_number, file_path', [r.id])
  // What the target folder already holds (a merge): never over it
  const taken = new Set<string>()
  if (plan.mergeInto) {
    const { rows } = await query<{ file_path: string }>('SELECT file_path FROM episodes WHERE media_item_id = $1', [plan.mergeInto])
    for (const e of rows) taken.add(e.file_path.toLowerCase())
  }
  const used = new Map<string, number>()
  for (const ep of eps) {
    const rel = path.relative(folder, ep.file_path)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    const now = path.join(base, rel)
    const ext = path.extname(ep.file_path).toLowerCase()
    const season = ep.season ?? 1
    let name = filmLike ? baseName(naming(r)) : episodeName(r.title, season, ep.episode_number)
    const key = filmLike ? 'film' : `${season}:${ep.episode_number}`
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    if (n > 1) name += ` - ${versionOf(rel) ?? n}`
    const dir = filmLike ? targetFolder : path.join(targetFolder, seasonFolder(season))
    let to = path.join(dir, `${name}${ext}`)
    if (taken.has(to.toLowerCase()) && now.toLowerCase() !== to.toLowerCase()) to = path.join(dir, `${name} - ${versionOf(rel) ?? 'copie'}${ext}`)
    const why = await busy(ep.file_path)
    if (why) {
      plan.skipped.push({ path: ep.file_path, reason: why })
      if (plan.mergeInto) continue
      plan.episodes.push({ id: ep.id, from: ep.file_path, to: now })
      continue
    }
    if (now !== to) {
      // Where `to` is today (before the folder is renamed): something else there is never replaced
      const today = plan.mergeInto ? to : path.join(folder, path.relative(base, to))
      if (taken.has(to.toLowerCase()) || (today.toLowerCase() !== ep.file_path.toLowerCase() && await exists(today))) {
        plan.skipped.push({ path: ep.file_path, reason: `« ${path.basename(to)} » existe déjà` })
        if (!plan.mergeInto) { plan.episodes.push({ id: ep.id, from: ep.file_path, to: now }); taken.add(now.toLowerCase()) }
        continue
      }
      plan.episodes.push({ id: ep.id, from: ep.file_path, to })
      plan.moves.push({ from: now, to })
      taken.add(to.toLowerCase())
      for (const s of await sidecars(ep.file_path)) {
        plan.moves.push({ from: path.join(path.dirname(now), path.basename(s.file)), to: path.join(dir, `${name}${s.rest}`) })
      }
    } else {
      plan.episodes.push({ id: ep.id, from: ep.file_path, to })
      taken.add(to.toLowerCase())
    }
  }
  plan.moves = plan.moves.filter((m) => m.from !== m.to)
  if (plan.mergeInto) plan.to = targetFolder
  const changed = plan.moves.length > 0 || plan.mergeInto
  return changed || plan.skipped.length ? plan : null
}

/** What would change, title by title (films, séries, animes; or only these titles) */
export async function planRenames(opts: { type?: 'film' | 'serie' | 'anime'; mediaIds?: string[] } = {}): Promise<TitlePlan[]> {
  const { rows } = await query<ItemRow>(
    `SELECT id, type, title, year, tmdb_id, tmdb_kind, file_path FROM media_items
      WHERE type IN ('film', 'serie', 'anime') AND ($1::text IS NULL OR type = $1) AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY type, title`,
    [opts.type ?? null, opts.mediaIds?.length ? opts.mediaIds : null])
  // Which title each folder belongs to now, and where the ones already renamed are (a folder
  // made again by a script joins the title that has its name)
  const folderOwners = new Map<string, string>()
  const { rows: shows } = await query<{ id: string; file_path: string }>(`SELECT id, file_path FROM media_items WHERE type IN ('serie', 'anime')`)
  for (const s of shows) folderOwners.set(s.file_path, s.id)
  const plans: TitlePlan[] = []
  const r0 = roots()
  for (const r of rows) {
    const root = r.type === 'film' ? r0.film : r0[r.type]
    // Only what is in the library folders (never outside them)
    const rel = path.relative(root, r.file_path)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || isHidden(r.file_path)) continue
    if (r.type !== 'film' && path.dirname(r.file_path) !== root) continue
    const p = r.type === 'film' ? await planFilm(r) : await planShow(r, folderOwners)
    if (!p) continue
    plans.push(p)
    // Two titles of the same name in this pass: the second one joins the first
    if (p.type !== 'film' && !p.mergeInto && p.moves[0]?.from === r.file_path) folderOwners.set(p.to, r.id)
  }
  return plans
}

// ─── Moving ──────────────────────────────────────────────────────────────────

async function mkdirFor(file: string) {
  const dir = path.dirname(file)
  try { await fs.promises.mkdir(dir, { recursive: true }) } catch (err) {
    if (!isPermissionError(err) || !(await canSudo())) throw err
    const [uid, gid] = owner.split(':')
    await sudoRun(['install', '-d', '-o', uid, '-g', gid, '--', dir])
  }
}

/** One move, never over something (with sudo when Nexus may not write there) */
async function move(from: string, to: string) {
  if (await exists(to) && from.toLowerCase() !== to.toLowerCase()) throw new AppError(`« ${to} » existe déjà`, 409)
  await mkdirFor(to)
  try { await fs.promises.rename(from, to) } catch (err) {
    if (!isPermissionError(err) || !(await canSudo())) {
      if (isPermissionError(err)) {
        throw new AppError(`Nexus ne peut pas renommer « ${path.basename(from)} » (droits). Sur le serveur : sudo chown -R ${owner} "${path.dirname(from)}"`, 409, true, 'NEEDS_RIGHTS')
      }
      throw err
    }
    await sudoRun(['mv', '-T', '--', from, to])
  }
}

/** Empty folders left behind (old season folders, the old title folder), up to the library root */
async function removeEmpty(dir: string, stop: string) {
  let d = dir
  while (d.startsWith(stop + path.sep) && d !== stop) {
    const entries = await fs.promises.readdir(d).catch(() => null)
    if (!entries || entries.length) return
    await fs.promises.rmdir(d).catch(() => {})
    d = path.dirname(d)
  }
}

async function cleanFolders(dir: string, root: string, depth = 0): Promise<void> {
  if (depth > 4) return
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])) {
    if (e.isDirectory() && !e.name.startsWith('.')) await cleanFolders(path.join(dir, e.name), root, depth + 1)
  }
  if (depth > 0) await removeEmpty(dir, root)
}

/** The title's rows follow its files (one transaction) */
async function updateRows(c: PoolClient, p: TitlePlan) {
  if (p.type === 'film') {
    await c.query('UPDATE media_items SET file_path = $2 WHERE id = $1', [p.mediaId, p.to])
    return
  }
  for (const e of p.episodes) {
    if (e.from !== e.to) await c.query('UPDATE episodes SET file_path = $2 WHERE id = $1', [e.id, e.to])
  }
  if (!p.mergeInto) {
    await c.query('UPDATE media_items SET file_path = $2 WHERE id = $1', [p.mediaId, p.to])
    return
  }
  // Joins the title that has the folder: its episodes, history and favourites go there
  const ids = p.episodes.filter((e) => e.from !== e.to).map((e) => e.id)
  await c.query('UPDATE episodes SET media_item_id = $2 WHERE id = ANY($1::uuid[])', [ids, p.mergeInto])
  await c.query(`UPDATE watch_history SET media_item_id = $2 WHERE media_item_id = $1 AND episode_id = ANY($3::uuid[])`, [p.mediaId, p.mergeInto, ids])
  await c.query(`INSERT INTO favorites (user_id, media_item_id) SELECT user_id, $2 FROM favorites WHERE media_item_id = $1 ON CONFLICT DO NOTHING`, [p.mediaId, p.mergeInto])
  const { rows } = await c.query('SELECT 1 FROM episodes WHERE media_item_id = $1 LIMIT 1', [p.mediaId])
  if (!rows.length) await c.query('DELETE FROM media_items WHERE id = $1', [p.mediaId])
}

export interface RenameResult {
  batch: string
  renamed: { mediaId: string; title: string; from: string; to: string; files: number }[]
  skipped: { title: string; path: string; reason: string }[]
  errors: { title: string; error: string }[]
}

/** Renames these titles (all by default), each one whole or not at all. */
export async function applyRenames(opts: { mediaIds?: string[]; type?: 'film' | 'serie' | 'anime'; auto?: boolean } = {}): Promise<RenameResult> {
  return MediaScanner.exclusive('rename', async () => {
    const batch = randomUUID()
    const result: RenameResult = { batch, renamed: [], skipped: [], errors: [] }
    const plans = await planRenames(opts)
    let seq = 0
    const r0 = roots()
    for (const p of plans) {
      for (const s of p.skipped) result.skipped.push({ title: p.title, path: s.path, reason: s.reason })
      if (!p.moves.length && !p.mergeInto) continue
      const done: Move[] = []
      try {
        for (const m of p.moves) { await move(m.from, m.to); done.push(m) }
        await withTransaction((c) => updateRows(c, p))
      } catch (err) {
        // This title goes back as it was
        for (const m of [...done].reverse()) await move(m.to, m.from).catch(() => {})
        result.errors.push({ title: p.title, error: (err as Error).message })
        logger.warn(`Rename ${p.title}: ${(err as Error).message}`)
        continue
      }
      for (const m of done) {
        await query(
          'INSERT INTO media_renames (batch_id, media_item_id, title, from_path, to_path, seq, auto) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [batch, p.mergeInto ?? p.mediaId, p.title, m.from, m.to, seq++, !!opts.auto])
      }
      const root = p.type === 'film' ? r0.film : r0[p.type]
      if (p.type === 'film') await removeEmpty(path.dirname(p.from), root)
      else {
        await cleanFolders(p.to, root)
        if (p.mergeInto) { await cleanFolders(p.from, root); await removeEmpty(p.from, root) }
        // The TMDB id next to the episodes: the download scripts find this folder again
        // (nexus_cli.series_folder), and the scan keeps the exact title
        const hint = hintFor.serie(p.to)
        if (p.tmdbId && !(await exists(hint))) {
          await fs.promises.writeFile(hint, JSON.stringify({ source: 'nexus', tmdb_id: p.tmdbId, title: p.title }) + '\n').catch(() => {})
        }
      }
      result.renamed.push({ mediaId: p.mergeInto ?? p.mediaId, title: p.title, from: p.from, to: p.to, files: done.length })
    }
    if (result.renamed.length) logger.info(`Renamed ${result.renamed.length} title(s) for Jellyfin (batch ${batch})`)
    return result
  })
}

// ─── Undo ────────────────────────────────────────────────────────────────────

export interface RenameBatch { batch: string; at: string; titles: number; files: number; auto: boolean; undone: boolean }

export async function renameHistory(limit = 20): Promise<RenameBatch[]> {
  const { rows } = await query<{ batch_id: string; at: Date; titles: string; files: string; auto: boolean; undone: boolean }>(
    `SELECT batch_id, MIN(created_at) AS at, COUNT(DISTINCT media_item_id) AS titles, COUNT(*) AS files,
            BOOL_OR(auto) AS auto, BOOL_AND(undone_at IS NOT NULL) AS undone
       FROM media_renames GROUP BY batch_id ORDER BY MIN(created_at) DESC LIMIT $1`, [limit])
  return rows.map((r) => ({ batch: r.batch_id, at: r.at.toISOString(), titles: Number(r.titles), files: Number(r.files), auto: r.auto, undone: r.undone }))
}

/** Puts a batch back: the files where they were, the rows with them (then a scan of those libraries). */
export async function undoRenames(batch: string): Promise<{ restored: number; failed: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(batch)) throw new AppError('Renommage introuvable', 404)
  const { rows } = await query<{ id: string; from_path: string; to_path: string }>(
    'SELECT id, from_path, to_path FROM media_renames WHERE batch_id = $1 AND undone_at IS NULL ORDER BY seq DESC', [batch])
  if (!rows.length) throw new AppError('Rien à annuler pour ce renommage', 404)
  return MediaScanner.exclusive('rename', async () => {
    let restored = 0
    let failed = 0
    for (const r of rows) {
      try {
        await move(r.to_path, r.from_path)
        await query('UPDATE media_items SET file_path = $1 WHERE file_path = $2', [r.from_path, r.to_path])
        await query('UPDATE episodes SET file_path = $1 WHERE file_path = $2', [r.from_path, r.to_path])
        // Moved with a folder: the paths inside it too
        await query(`UPDATE episodes SET file_path = $1 || substr(file_path, length($2) + 1) WHERE file_path LIKE $3`,
          [r.from_path, r.to_path, `${r.to_path.replace(/[\\%_]/g, '\\$&')}${path.sep}%`])
        await query('UPDATE media_renames SET undone_at = NOW() WHERE id = $1', [r.id])
        restored++
      } catch (err) {
        failed++
        logger.warn(`Undo rename ${r.to_path}: ${(err as Error).message}`)
      }
    }
    for (const r of rows) await removeEmpty(path.dirname(r.to_path), path.dirname(path.dirname(r.to_path))).catch(() => {})
    return { restored, failed }
  })
}

// ─── Settings, and new downloads ─────────────────────────────────────────────

export async function renameSettings(): Promise<{ auto: boolean }> {
  const { rows } = await query<{ value: { auto?: boolean } }>(`SELECT value FROM app_settings WHERE key = 'rename'`)
  return { auto: rows[0]?.value.auto !== false }
}

export async function setRenameSettings(auto: unknown): Promise<{ auto: boolean }> {
  if (typeof auto !== 'boolean') throw new AppError('Réglage invalide', 422)
  await query(`INSERT INTO app_settings (key, value) VALUES ('rename', $1::jsonb)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify({ auto })])
  return { auto }
}

/** The titles a finished download's files belong to (renamed once the library has them). */
export async function titlesOfFiles(files: string[]): Promise<string[]> {
  if (!files.length) return []
  const { rows } = await query<{ id: string }>(
    `SELECT DISTINCT m.id FROM media_items m
       LEFT JOIN episodes e ON e.media_item_id = m.id
      WHERE m.type IN ('film', 'serie', 'anime') AND (m.file_path = ANY($1::text[]) OR e.file_path = ANY($1::text[]))`, [files])
  return rows.map((r) => r.id)
}

/** After a download: its titles under Jellyfin's names (waits for a scan running) */
export async function renameAfterDownload(files: string[], attempt = 0): Promise<void> {
  if (!(await renameSettings()).auto) return
  const ids = await titlesOfFiles(files)
  if (!ids.length) return
  try {
    const res = await applyRenames({ mediaIds: ids, auto: true })
    // Files still being written (the last episode): again in a few minutes
    if (res.skipped.some((s) => /écriture|lecture|téléchargement/.test(s.reason)) && attempt < 3) {
      setTimeout(() => { void renameAfterDownload(files, attempt + 1) }, QUIET_MS + 30_000).unref()
    }
  } catch (err) {
    if (err instanceof ConflictError && attempt < 10) {
      setTimeout(() => { void renameAfterDownload(files, attempt + 1) }, 60_000).unref()
      return
    }
    logger.warn(`Automatic rename: ${(err as Error).message}`)
  }
}

// A download finished (films, séries, animes): its titles once the library has them
onDownloadFinished((job, libraryUpdated) => {
  if (job.status !== 'done' || !['film', 'serie', 'anime'].includes(job.kind)) return
  const files = ((job.progress.files as string[] | undefined) ?? []).filter((f) => typeof f === 'string')
  void libraryUpdated.then(() => renameAfterDownload(files)).catch((err: Error) => logger.warn(`Automatic rename: ${err.message}`))
})

