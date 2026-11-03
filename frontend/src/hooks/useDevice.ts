import { useMediaQuery } from './useMediaQuery'

export type Device = 'desktop' | 'tablet' | 'phone'

/**
 * Which native experience to render:
 * - desktop ≥ 1024 px → macOS (sidebar, toolbar, sheets from the top, context menus)
 * - tablet 768–1023 px → iPadOS (collapsible sidebar)
 * - phone < 768 px → iOS (tab bar, large titles, bottom sheets, action sheets)
 */
export function useDevice(): Device {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const tablet  = useMediaQuery('(min-width: 768px)')
  return desktop ? 'desktop' : tablet ? 'tablet' : 'phone'
}

/** Finger instead of mouse: 44 px targets, long-press menus, no hover effects */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
