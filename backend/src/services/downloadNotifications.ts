import { query } from '../config/database'
import { logger } from '../utils/logger'
import { broadcast, onDownloadFinished, type DownloadRow } from './downloads'
import { sendPush } from './push'

/**
 * End of every download, whatever the script: a push notification to the
 * admins' devices and a live toast in every open Nexus.
 *   « Film terminé » — « Deadpool & Wolverine · 1080p MULTI »
 * Touching it opens the title in the library (once the rescan found it).
 */

const DONE: Record<DownloadRow['kind'], [string, string]> = {
  film: ['Film terminé', 'Film terminé'],
  serie: ['Épisode terminé', 'Épisodes terminés'],
  anime: ['Épisode terminé', 'Épisodes terminés'],
  manga: ['Chapitre terminé', 'Chapitres terminés'],
  youtube: ['Vidéo terminée', 'Vidéo terminée'],
}

/** « 1080p MULTI » for a torrent, « VOSTFR » for the others. */
export function versionLabel(row: DownloadRow): string | null {
  const v = (row.options as { version?: { label?: string } }).version
  if (v?.label) return v.label
  if (row.source_script === 'oxtorrent') {
    // Jobs queued before versions were stored: read it from the release name
    const name = String((row.progress as { item?: string }).item ?? '')
    const res = name.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1]?.toLowerCase()
    const lang = /\bmulti\b/i.test(name) ? 'MULTI' : /\b(vostfr|subfrench)\b/i.test(name) ? 'VOSTFR'
      : /\b(truefrench|french|vff|vfq|vf2)\b/i.test(name) ? 'VF' : null
    return [res, lang].filter(Boolean).join(' ') || null
  }
  return row.options.lang ?? null
}

/** « S01E03 », « épisodes 1–4 », « chapitre 12 »… */
function partOf(row: DownloadRow): string | null {
  const part = (row.options as { part?: string }).part
  if (part) return part
  const list = row.selection.episodes ?? row.selection.chapters
  if (!list?.length) return null
  const noun = row.selection.chapters ? 'chapitre' : 'épisode'
  if (list.length === 1) return `${noun} ${list[0]}`
  const sorted = [...list].sort((a, b) => a - b)
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)
  return contiguous ? `${noun}s ${sorted[0]}–${sorted.at(-1)}` : `${list.length} ${noun}s`
}

export function message(row: DownloadRow) {
  const ok = row.status === 'done'
  const many = (row.selection.episodes?.length ?? row.selection.chapters?.length ?? 1) > 1
  const title = ok ? DONE[row.kind][many ? 1 : 0] : 'Échec du téléchargement'
  const body = [row.title, partOf(row), versionLabel(row)].filter(Boolean).join(' · ')
  return { ok, title, body: ok ? body : `${body}${row.error ? ` — ${row.error.slice(0, 120)}` : ''}` }
}

/** The library page of what was downloaded, else the queue. */
async function urlOf(row: DownloadRow): Promise<string> {
  if (row.status !== 'done') return '/downloads?tab=queue'
  if (row.kind === 'youtube') return '/youtube'
  const files = ((row.progress as { files?: string[] }).files ?? []).filter((f) => typeof f === 'string').slice(-200)
  if (files.length) {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM media_items WHERE file_path = ANY($1::text[])
       UNION ALL SELECT media_item_id FROM episodes WHERE file_path = ANY($1::text[])
       UNION ALL SELECT media_item_id FROM chapters WHERE file_path = ANY($1::text[])
       LIMIT 1`, [files])
    if (rows[0]) return `/media/${rows[0].id}`
  }
  return '/downloads?tab=queue'
}

const LIBRARY_WAIT_MS = () => Number(process.env.DOWNLOAD_NOTIFY_WAIT_MS) || 90_000

onDownloadFinished((row, libraryUpdated) => {
  void (async () => {
    // Wait for the library to know the new files, so the notification can open them (at most 90 s)
    await Promise.race([libraryUpdated, new Promise((r) => setTimeout(r, LIBRARY_WAIT_MS()).unref())])
    const url = await urlOf(row).catch(() => '/downloads?tab=queue')
    const { ok, title, body } = message(row)
    broadcast('download:finished', { id: row.id, ok, title, body, url })
    const { rows } = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`)
    await sendPush(rows.map((r) => r.id), { title, body, url, tag: `download-${row.id}` })
  })().catch((err: Error) => logger.warn(`Download notification: ${err.message}`))
})
