import fs from 'fs/promises'
import path from 'path'
import { query } from '../config/database'
import { AppError, NotFoundError } from '../utils/errors'
import { libraryRoots, strictlyInside } from '../utils/fsErrors'
import { logger } from '../utils/logger'
import { FilesService, assertNotProtected } from './files'
import { forgetIndex } from './keyframes'
import { listJobs, stopJob } from './transcode'
import { deleteDownload } from './downloads'

/*
 * « Supprimer de la bibliothèque » removes the title everywhere: its files on the disk
 * (so a scan never brings it back), its row (episodes, chapters, progress, « Reprendre »,
 * favourites and ratings go with it), the downloads that made it (stopped if running),
 * its follow (so new episodes are not downloaded again), the conversions being played
 * and the keyframe indexes. Deleting library files in the file manager also removes
 * what pointed to them (forgetPaths).
 */

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv', '.ts', '.wmv'])
const LANG_FOLDER = /^(vf|vff|vfq|vostfr|vost|vo|multi|fr|en|truefrench)$/i

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)

/** Category folders (films, series…) and library roots: never deleted themselves. */
function categoryFolders(): string[] {
  const env = ['FILMS_PATH', 'SERIES_PATH', 'ANIMES_PATH', 'MANGA_PATH', 'YOUTUBE_PATH']
    .map((k) => process.env[k]).filter((v): v is string => !!v).map((v) => path.resolve(v))
  return [...new Set([...libraryRoots(), ...env])]
}

const isVideo = (n: string) => !n.startsWith('.') && VIDEO_EXTS.has(path.extname(n).toLowerCase())

/** True when `dir` holds this video and no other one (not even in a sub-folder): a collection is never deleted whole. */
async function onlyVideoOf(dir: string, video: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return false
  const videos = entries.filter((e) => e.isFile() && isVideo(e.name)).map((e) => e.name)
  if (videos.length !== 1 || videos[0] !== video) return false
  for (const sub of entries.filter((e) => e.isDirectory())) {
    const inner = await fs.readdir(path.join(dir, sub.name), { recursive: true }).catch(() => [] as string[])
    if (inner.some((n) => isVideo(path.basename(String(n))))) return false
  }
  return true
}

/** The files / folders that hold a title, all inside the library. */
export async function mediaPaths(row: { type: string; file_path: string }): Promise<string[]> {
  const target = path.resolve(row.file_path)
  if (!['film', 'youtube'].includes(row.type)) return [target]       // series, animes, mangas: their folder

  // A film alone in its own folder (« Film (2024)/film.mkv »): the whole folder
  const dir = path.dirname(target)
  const categories = categoryFolders()
  if (!categories.includes(dir) && !LANG_FOLDER.test(path.basename(dir)) && strictlyInside(libraryRoots(), dir)) {
    if (await onlyVideoOf(dir, path.basename(target))) return [dir]
  }
  // Else the file and what goes with it: same name (« Film.srt », « Film.fr.srt », « Film.info.json »,
  // « Film.jpg »…) and the hint left by the download (« .Film.mkv.nexus.json »)
  const base = path.basename(target)
  const stem = base.slice(0, base.length - path.extname(base).length)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const extra = names.filter((n) => n !== base && (n.startsWith(`${stem}.`) || n === `.${base}.nexus.json`))
    // never another video (« Film.part2.mkv » is another file)
    .filter((n) => !isVideo(n))
  return [target, ...extra.map((n) => path.join(dir, n))]
}

function checkPath(p: string) {
  assertNotProtected(p)
  if (categoryFolders().includes(p) || !strictlyInside(libraryRoots(), p)) {
    throw new AppError(`« ${p} » n'est pas dans la bibliothèque : rien n'a été supprimé`, 403)
  }
}

/**
 * Everything that pointed to these deleted paths: library rows (titles, episodes,
 * chapters), downloads and their follows, conversions being played.
 * Returns what was removed.
 */
export async function forgetPaths(paths: string[]): Promise<{ media: number; downloads: number; follows: number }> {
  const list = [...new Set(paths.map((p) => path.resolve(p)))]
  if (!list.length) return { media: 0, downloads: 0, follows: 0 }
  const under = (col: string) => `EXISTS (SELECT 1 FROM unnest($1::text[]) d WHERE ${col} = d OR ${col} LIKE d || '/%')`

  for (const job of listJobs()) if (list.some((p) => inside(path.resolve(job.filePath), p))) stopJob(job.id, 'file deleted')

  const dl = await query<{ id: string; source_id: string }>(
    `SELECT id, source_id FROM downloads WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(progress->'files', '[]'::jsonb)) f WHERE ${under('f')})`, [list])
  for (const d of dl.rows) await deleteDownload(d.id).catch(() => {})
  // Follow of that title: else its next episodes would be downloaded again
  const sources = [...new Set(dl.rows.map((d) => d.source_id))]
  const fol = sources.length
    ? await query('DELETE FROM follows WHERE source_id = ANY($1::text[]) RETURNING id', [sources])
    : { rows: [] }

  await query(`DELETE FROM episodes WHERE ${under('file_path')}`, [list])
  await query(`DELETE FROM chapters WHERE ${under('folder_path')}`, [list])
  const media = await query(`DELETE FROM media_items WHERE ${under('file_path')} RETURNING id`, [list])
  return { media: media.rows.length, downloads: dl.rows.length, follows: fol.rows.length }
}

export interface DeleteResult {
  files: string[]
  media: number
  downloads: number
  follows: number
}

/**
 * Deletes a title of the library everywhere. Files first: when one cannot be deleted
 * (owned by root…) nothing else is touched and the error says so (code NEEDS_PASSWORD
 * with `paths`: the UI forces it with the sudo password, then asks again).
 */
export async function deleteMediaEverywhere(id: string): Promise<DeleteResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('Titre')
  const { rows } = await query<{ id: string; type: string; file_path: string }>(
    'SELECT id, type, file_path FROM media_items WHERE id = $1', [id])
  const row = rows[0]
  if (!row) throw new NotFoundError('Titre')

  const paths = await mediaPaths(row)
  for (const p of paths) checkPath(p)

  // Keyframe indexes are named after each file's size and date: read them before deleting
  const eps = await query<{ file_path: string }>('SELECT file_path FROM episodes WHERE media_item_id = $1', [id])
  await Promise.all([row.file_path, ...eps.rows.map((e) => e.file_path)].map((f) => forgetIndex(f)))

  const present: string[] = []
  for (const p of paths) if (await fs.lstat(p).then(() => true, () => false)) present.push(p)
  const { failed } = await FilesService.deleteMany(present)
  if (failed.length) {
    const e = new AppError(failed[0].error, 403, true, failed.every((f) => f.code === 'NEEDS_PASSWORD') ? 'NEEDS_PASSWORD' : undefined)
    ;(e as AppError & { details?: unknown }).details = { paths: failed.map((f) => f.path) }
    throw e
  }

  // The row itself even if its path was elsewhere, plus everything under the deleted paths
  const forgotten = await forgetPaths([...paths, row.file_path])
  await query('DELETE FROM media_items WHERE id = $1', [id])
  logger.info(`Library: « ${row.file_path} » deleted everywhere (${present.length} path(s), ` +
    `${forgotten.downloads} download(s), ${forgotten.follows} follow(s))`)
  return { files: present, media: Math.max(1, forgotten.media), downloads: forgotten.downloads, follows: forgotten.follows }
}
