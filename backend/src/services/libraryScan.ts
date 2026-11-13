import { syncImdb } from './imdb'
import { indexLibrarySoon } from './keyframeIndexer'
import { MediaScanner } from './scanner'
import { logger } from '../utils/logger'

/** Library names used by the API and the UI → media_items.type */
export const LIBRARY_TYPES = {
  films: 'film', series: 'serie', animes: 'anime', manga: 'manga', youtube: 'youtube',
} as const
export type LibraryType = keyof typeof LIBRARY_TYPES

const SCANS: Record<LibraryType, () => Promise<number>> = {
  films:   () => MediaScanner.scanFilms(),
  series:  () => MediaScanner.scanSeries(),
  animes:  () => MediaScanner.scanAnimes(),
  manga:   () => MediaScanner.scanManga(),
  youtube: () => MediaScanner.scanYoutube(),
}

export function isLibraryType(type: unknown): type is LibraryType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(LIBRARY_TYPES, type)
}

/**
 * Full scan of one library (the « Analyser » button, Jarvis): forgets titles whose files
 * are gone, scans the folder, then enriches new titles in the background.
 * Throws ConflictError while another scan runs.
 */
export async function scanLibrary(type: LibraryType): Promise<number> {
  const count = await MediaScanner.exclusive(type, async () => {
    await MediaScanner.pruneDeleted(LIBRARY_TYPES[type])
    return SCANS[type]()
  })
  const video = type === 'films' || type === 'series' || type === 'animes'
  // New titles get their IMDb rating and artwork in the background
  if (video && process.env.IMDB_SYNC !== 'off') {
    void syncImdb().catch((err) => logger.warn(`Enrichment after scan failed: ${err}`))
  }
  // MKV films / episodes get their keyframe index (start at once, whole film) in the background
  if (video) indexLibrarySoon()
  return count
}
