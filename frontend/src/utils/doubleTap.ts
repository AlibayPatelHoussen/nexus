/** Two taps of a finger in a row: close in time and place, each a short press that did not move */
export const DOUBLE_TAP_MS = 320
export const DOUBLE_TAP_SLOP = 32
const TAP_MOVE = 12
const TAP_PRESS_MS = 350

interface Down { pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number; timeStamp: number }
interface Up { pointerId: number; pointerType: string; clientX: number; clientY: number; timeStamp: number }

export interface TapTracker {
  down: (e: Down) => void
  /** true when this lift completes a double tap */
  up: (e: Up) => boolean
  cancel: () => void
}

/** Double taps of a finger (a mouse has its double click); a pinch is never one */
export function tapTracker(): TapTracker {
  let press: { id: number; x: number; y: number; t: number } | null = null
  let last: { x: number; y: number; t: number } | null = null
  let fingers = 0
  return {
    down(e) {
      if (e.pointerType === 'mouse') return
      fingers++
      // A second finger: a pinch, not a tap
      press = e.isPrimary && fingers === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null
      if (fingers > 1) last = null
    },
    up(e) {
      if (e.pointerType === 'mouse') return false
      fingers = Math.max(0, fingers - 1)
      const p = press
      press = null
      if (!p || p.id !== e.pointerId) return false
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MOVE || e.timeStamp - p.t > TAP_PRESS_MS) { last = null; return false }
      const tap = { x: e.clientX, y: e.clientY, t: e.timeStamp }
      if (last && tap.t - last.t <= DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) <= DOUBLE_TAP_SLOP) {
        last = null
        return true
      }
      last = tap
      return false
    },
    cancel() { press = null; last = null; fingers = 0 },
  }
}
