// Shared responsive layouts for media posters.

/** Full grid (search results, library): 3 columns on phones, 4 on large phones, auto-fill from sm. */
export const MEDIA_GRID =
  'grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-3 gap-y-4 sm:gap-4'

/**
 * Shelf ("Récemment ajoutés", "Continuer la lecture"): a wrapping grid on phones
 * and tablets so every poster is visible, a horizontal scroll row from lg up.
 */
export const MEDIA_SHELF =
  'grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-x-3 gap-y-4 ' +
  'lg:flex lg:gap-3 lg:overflow-x-auto lg:pb-2 scrollbar-none'
