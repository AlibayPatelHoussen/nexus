import type { MediaItem } from '@/types'

/**
 * The pills of a manga title: « Manhwa » (Korea) or « Manhua » (China), and « Webtoon » when it
 * reads as a long vertical strip. A Japanese manga gets none: it is what the section is named after.
 * Told by MangaDex / AniList when the library is scanned, never guessed here.
 */
export function mangaPills(item: Pick<MediaItem, 'type' | 'origin' | 'webtoon'>): string[] {
  if (item.type !== 'manga') return []
  return [
    item.origin === 'manhwa' ? 'Manhwa' : item.origin === 'manhua' ? 'Manhua' : null,
    item.webtoon ? 'Webtoon' : null,
  ].filter((p): p is string => !!p)
}
