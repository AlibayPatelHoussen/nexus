import { describe, expect, it } from 'vitest'
import { tapTracker } from './doubleTap'

const finger = (id: number, x: number, y: number, t: number, isPrimary = true) =>
  ({ pointerId: id, pointerType: 'touch', isPrimary, clientX: x, clientY: y, timeStamp: t })

/** A tap: down, then up after `press` ms, `move` px further */
function tap(tr: ReturnType<typeof tapTracker>, t: number, x = 100, y = 200, { id = 1, press = 80, move = 0 } = {}) {
  tr.down(finger(id, x, y, t))
  return tr.up(finger(id, x + move, y, t + press))
}

describe('tapTracker', () => {
  it('two quick taps at the same place: a double tap (a third one starts over)', () => {
    const tr = tapTracker()
    expect(tap(tr, 0)).toBe(false)
    expect(tap(tr, 200, 110, 205)).toBe(true)
    expect(tap(tr, 400)).toBe(false)
  })

  it('too slow, too far, a finger that moved or stayed down: no double tap', () => {
    const tr = tapTracker()
    tap(tr, 0); expect(tap(tr, 600)).toBe(false)
    tap(tr, 1000); expect(tap(tr, 1150, 300, 500)).toBe(false)
    tap(tr, 2000); expect(tap(tr, 2150, 100, 200, { move: 40 })).toBe(false)
    tap(tr, 3000); expect(tap(tr, 3150, 100, 200, { press: 600 })).toBe(false)
  })

  it('a pinch (two fingers) is never a tap; a mouse is left to the double click', () => {
    const tr = tapTracker()
    tap(tr, 0)
    tr.down(finger(1, 100, 200, 100)); tr.down(finger(2, 200, 300, 110, false))
    expect(tr.up(finger(1, 100, 200, 150))).toBe(false)
    expect(tr.up(finger(2, 200, 300, 160))).toBe(false)
    const mouse = { pointerId: 9, pointerType: 'mouse', isPrimary: true, clientX: 0, clientY: 0, timeStamp: 0 }
    tr.down(mouse); expect(tr.up({ ...mouse, timeStamp: 50 })).toBe(false)
    tr.down({ ...mouse, timeStamp: 100 }); expect(tr.up({ ...mouse, timeStamp: 150 })).toBe(false)
  })
})
