import { describe, expect, it } from 'vitest'
import { clampView, clampZoom, IDENTITY, keepPoint, zoomAt } from './readerZoom'

describe('vertical reading: the zoom is the width', () => {
  it('a pinch ends in range, and back to 100 % when barely enlarged', () => {
    expect(clampZoom(250.4)).toBe(250)
    expect(clampZoom(900)).toBe(400)
    expect(clampZoom(60)).toBe(100)
    expect(clampZoom(105)).toBe(100)
  })

  it('the point under the fingers stays under them', () => {
    // column top at 0 on screen with a 56 px padding; a point 300 px into the content, 100 px from the left
    const r = keepPoint(2, 0, { x: 100, y: 356 }, { x: 100, y: 356 }, 0, 56)
    expect(r.left).toBe(100)          // (0 + 100) × 2 − 100
    expect(r.dy).toBe(300)            // 300 × 2 − 300
    // zooming out from 250 %: back near the left, the scroll goes up
    const o = keepPoint(100 / 250, 400, { x: 50, y: 500 }, { x: 50, y: 500 }, -2000, 56)
    expect(o.left).toBeCloseTo(130)   // (400 + 50) × 0.4 − 50
    expect(o.dy).toBeCloseTo((500 + 2000 - 56) * 0.4 - (500 + 2000 - 56))
    // never a negative horizontal scroll
    expect(keepPoint(0.5, 0, { x: 10, y: 0 }, { x: 300, y: 0 }, 0, 0).left).toBe(0)
  })
})

describe('page by page: enlarged and moved', () => {
  it('zooms where tapped, the page always covering its area', () => {
    const v = zoomAt(IDENTITY, 2, { x: 100, y: 200 }, 400, 800)
    expect(v).toEqual({ s: 2, x: -100, y: -200 })   // the tapped point stays at (100, 200)
    const corner = zoomAt(IDENTITY, 2, { x: 0, y: 0 }, 400, 800)
    expect(corner).toEqual({ s: 2, x: 0, y: 0 })
    expect(zoomAt(IDENTITY, 9, { x: 0, y: 0 }, 400, 800).s).toBe(4)
  })

  it('cannot be moved past its edges, and back to its size below 1', () => {
    expect(clampView({ s: 2, x: 50, y: -2000 }, 400, 800)).toEqual({ s: 2, x: 0, y: -800 })
    expect(clampView({ s: 0.8, x: -10, y: -10 }, 400, 800)).toEqual(IDENTITY)
  })
})
