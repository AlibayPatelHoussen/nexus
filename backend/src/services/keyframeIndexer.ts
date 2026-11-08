import { query } from '../config/database'
import { logger } from '../utils/logger'
import { buildIndex, readIndex } from './keyframes'
import { decide, hasFfmpeg, probe } from './transcode'

/*
 * « Netflix-like » start for MKV films / episodes (picture copied, container changed):
 * their keyframe index is built ahead of time, in the background, so playing them starts
 * in 2-3 s with the whole film in the player. After each library scan / download, and
 * once a day; one file at a time, low CPU priority.
 */

let running: Promise<number> | null = null

export function indexLibrary(): Promise<number> {
  if (running) return running
  running = (async () => {
    if (!(await hasFfmpeg())) return 0
    const { rows } = await query<{ file_path: string }>(
      `SELECT file_path FROM media_items WHERE type = 'film' AND file_path IS NOT NULL
       UNION SELECT file_path FROM episodes WHERE file_path IS NOT NULL`)
    let built = 0
    for (const { file_path: file } of rows) {
      try {
        if (await readIndex(file)) continue
        const decision = decide(await probe(file))
        if (decision.mode !== 'remux' || !decision.duration) continue
        await buildIndex(file, decision.duration)
        built++
      } catch (err) {
        logger.debug(`Keyframe index skipped for ${file}: ${(err as Error).message}`)
      }
    }
    if (built) logger.info(`Keyframe index: ${built} films / episodes ready to start at once`)
    return built
  })().finally(() => { running = null })
  return running
}

/** Kicks the indexing off without waiting (after a scan, a download). */
export function indexLibrarySoon() {
  if (process.env.KEYFRAME_INDEX === 'off' || process.env.NODE_ENV === 'test') return
  void indexLibrary().catch((err: Error) => logger.warn(`Keyframe index failed: ${err.message}`))
}

let timer: NodeJS.Timeout | null = null
/** Daily, plus a first run a few minutes after start. */
export function startKeyframeIndexer() {
  if (timer || process.env.KEYFRAME_INDEX === 'off' || process.env.NODE_ENV === 'test') return
  timer = setInterval(indexLibrarySoon, 24 * 60 * 60_000)
  timer.unref()
  setTimeout(indexLibrarySoon, 2 * 60_000).unref()
}
