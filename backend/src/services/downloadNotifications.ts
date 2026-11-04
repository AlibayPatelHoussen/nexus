import { query } from '../config/database'
import { logger } from '../utils/logger'
import { onDownloadFinished, type DownloadRow } from './downloads'
import { sendPush } from './push'

/** Push notification when a download finishes or fails (to the admins). */
function summary(row: DownloadRow) {
  const list = row.selection.episodes ?? row.selection.chapters
  const noun = row.selection.chapters ? 'chapitre' : 'épisode'
  if (!list?.length) return row.title
  return `${row.title} · ${list.length === 1 ? `${noun} ${list[0]}` : `${list.length} ${noun}s`}`
}

onDownloadFinished((row) => {
  void (async () => {
    const { rows } = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`)
    const ok = row.status === 'done'
    await sendPush(rows.map((r) => r.id), {
      title: ok ? 'Téléchargement terminé' : 'Échec du téléchargement',
      body: ok ? summary(row) : `${summary(row)}${row.error ? ` — ${row.error.slice(0, 120)}` : ''}`,
      url: '/downloads?tab=queue',
      tag: `download-${row.id}`,
    })
  })().catch((err: Error) => logger.warn(`Download notification: ${err.message}`))
})
