import { query } from '../config/database'
import { logger } from '../utils/logger'
import { buildIndex, readIndex } from './keyframes'
import { decide, hasFfmpeg, probe } from './transcode'
import { convertToMp4 } from './mp4Convert'

/*
 * Library preparation, in the background: H.264 MKV films / episodes are converted to MP4
 * (services/mp4Convert.ts); the ones that still need their container changed (conversion
 * not possible) get a keyframe index so playing them starts in 2-3 s with the whole film. After each library scan / download, and
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
    let converted = 0
    for (const { file_path: file } of rows) {
      try {
        // H.264 MKV → MP4 (read directly, like the MP4 films); the index is for the others
        if (process.env.MP4_CONVERT !== 'off' && await convertToMp4(file)) { converted++; continue }
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
    if (converted) logger.info(`MP4: ${converted} films / episodes converted`)
    return built + converted
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
