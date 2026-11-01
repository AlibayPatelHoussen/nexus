// Shared responsive layouts for media posters.

/** Poster width in a horizontal row: ~3 visible on phones (+ a peek of the next one). */
export const ROW_CARD_WIDTH = 'w-[29vw] max-w-[150px] sm:w-[150px] lg:w-[168px]'

/** Full grid (search results, "Tout voir"): 3 columns on phones, 4 on large phones, auto-fill from sm. */
export const MEDIA_GRID =
  'grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3 gap-y-5 sm:gap-x-4'
