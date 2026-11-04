import type { Transition } from 'framer-motion'

/**
 * Liquid Glass motion (iOS 26 / macOS 26): everything moves on springs.
 * Values from the HIG / the kit's interaction specs, tuned to read the same
 * in a browser at 60 fps. Reduced motion: framer-motion's MotionConfig
 * (reducedMotion="user") turns them into instant changes.
 */
export const spring = {
  /** Selection capsule moving between items (sidebar, tab bar, segmented): fast, no wobble */
  selection: { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 } satisfies Transition,
  /** Press / release of a glass control: gel-like give */
  press: { type: 'spring', stiffness: 380, damping: 22 } satisfies Transition,
  /** Sheets, popovers, pages */
  sheet: { type: 'spring', stiffness: 300, damping: 32 } satisfies Transition,
  /** Cards scaling on hover / focus (Apple TV) */
  lift: { type: 'spring', stiffness: 300, damping: 24 } satisfies Transition,
  /** Gentle: hero cross-fades, content appearing */
  soft: { type: 'spring', stiffness: 170, damping: 26 } satisfies Transition,
} as const

/** Items appearing one after another (rows, shelves). */
export const stagger = (i: number, step = 0.035, max = 0.3) => ({ delay: Math.min(i * step, max) })
