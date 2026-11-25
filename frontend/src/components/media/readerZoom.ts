import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/*
 * The manga reader's own zoom on touch screens, like Apple Books: two fingers zoom in and out,
 * a double tap zooms out (or in, where it was tapped). The browser's page zoom stays off in the
 * reader: it enlarged the bars too, and nothing brought it back.
 * - vertical reading: the zoom is the width of the pages column, so the page scrolls both ways
 *   natively; during the pinch the column is only scaled (no layout per frame);
 * - page by page: the page is enlarged (transform) and moved with one finger; the page turn
 *   waits until it is back to its size.
 */

export type Pt = { x: number; y: number }
export const ZOOM_MIN = 100
export const ZOOM_MAX = 400
/** Where a double tap zooms in */
export const ZOOM_TAP = 250
/** Zoom in %, from a pinch: kept in range, and back to 100 % when barely enlarged */
export function clampZoom(z: number): number {
  const c = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)))
  return c < 108 ? ZOOM_MIN : c
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * Vertical reading: after the column's width changed by k, the scroll that brings the point that
 * was under `from` under `to` (screen points, x relative to the horizontal scroller).
 * `top`: the column's top on screen before the change; `pad`: its top padding (not enlarged).
 * `left`: the horizontal scroll before; `dy`: how much to scroll down.
 */
export function keepPoint(k: number, scrollLeft: number, from: Pt, to: Pt, top: number, pad: number) {
  const cx = scrollLeft + from.x
  const cy = from.y - top - pad
  return { left: Math.max(0, cx * k - to.x), dy: cy * k - (to.y - top - pad) }
}

/** Page by page: the page's scale and offset in its area */
export interface View { s: number; x: number; y: number }
export const IDENTITY: View = { s: 1, x: 0, y: 0 }
/** The enlarged page always covers its area (no empty border around it) */
export function clampView(v: View, w: number, h: number): View {
  if (v.s <= 1.001) return IDENTITY
  return { s: v.s, x: clamp(v.x, w * (1 - v.s), 0), y: clamp(v.y, h * (1 - v.s), 0) }
}
/** Page by page: to scale s, the point p (in the area) staying where it is */
export function zoomAt(v: View, s: number, p: Pt, w: number, h: number): View {
  const s2 = clamp(s, 1, ZOOM_MAX / 100)
  const k = s2 / v.s
  return clampView({ s: s2, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }, w, h)
}

const two = (t: TouchList) => ({
  d: Math.max(1, Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)),
  m: { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 },
})
const ANIMATE = 'transform var(--dur-slow) var(--ease-out)'
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** iOS: the page's own zoom gesture, never in the reader */
function useNoPageZoom(active: boolean) {
  useEffect(() => {
    if (!active) return
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', block)
    document.addEventListener('gesturechange', block)
    return () => {
      document.removeEventListener('gesturestart', block)
      document.removeEventListener('gesturechange', block)
    }
  }, [active])
}

/** Vertical reading. `zoom` (%) is the column's width; `scrollY` scrolls the reader down by dy. */
export function useWidthZoom(o: {
  active: boolean
  root: RefObject<HTMLElement | null>
  scroller: RefObject<HTMLElement | null>
  column: RefObject<HTMLElement | null>
  zoom: number
  setZoom: (z: number) => void
  scrollY: (dy: number) => void
  pad: number
}) {
  const { active, root, scroller, column, pad } = o
  const fns = useRef(o)
  fns.current = o
  const pending = useRef<{ k: number; from: Pt; to: Pt; top: number; left: number } | null>(null)

  // The new width is laid out: the enlarged picture goes, the scroll keeps the same point in place
  const settle = useCallback(() => {
    const p = pending.current
    pending.current = null
    const col = column.current, sc = scroller.current
    if (col) { col.style.transition = ''; col.style.transform = ''; col.style.transformOrigin = '' }
    if (!p || !sc) return
    const r = keepPoint(p.k, p.left, p.from, p.to, p.top, pad)
    sc.scrollLeft = r.left
    if (Math.abs(r.dy) >= 1) fns.current.scrollY(r.dy)
  }, [column, scroller, pad])
  useLayoutEffect(() => { if (pending.current) settle() }, [o.zoom, settle])

  const commit = useCallback((z0: number, z1: number, from: Pt, to: Pt, top: number, left: number) => {
    const sc = scroller.current
    if (!sc) return
    const sl = sc.getBoundingClientRect().left
    pending.current = { k: z1 / z0, from: { x: from.x - sl, y: from.y }, to: { x: to.x - sl, y: to.y }, top, left }
    if (z1 === z0) settle()
    else fns.current.setZoom(z1)
  }, [scroller, settle])

  useNoPageZoom(active)
  useEffect(() => {
    const el = root.current
    if (!active || !el) return
    let g: { d0: number; m0: Pt; m: Pt; z0: number; k: number; top: number; left: number } | null = null
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      const col = column.current, sc = scroller.current
      if (!col || !sc) return
      const { d, m } = two(e.touches)
      const r = col.getBoundingClientRect()
      g = { d0: d, m0: m, m, z0: fns.current.zoom, k: 1, top: r.top, left: sc.scrollLeft }
      col.style.transition = ''
      col.style.transformOrigin = `${m.x - r.left}px ${m.y - r.top}px`
    }
    const move = (e: TouchEvent) => {
      if (!g || e.touches.length !== 2) return
      e.preventDefault()
      const { d, m } = two(e.touches)
      g.k = clamp(g.z0 * d / g.d0, ZOOM_MIN, ZOOM_MAX) / g.z0
      g.m = m
      const col = column.current
      if (col) col.style.transform = `translate(${m.x - g.m0.x}px, ${m.y - g.m0.y}px) scale(${g.k})`
    }
    const end = (e: TouchEvent) => {
      if (!g || e.touches.length >= 2) return
      const s = g
      g = null
      commit(s.z0, clampZoom(s.z0 * s.k), s.m0, s.m, s.top, s.left)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [active, root, column, scroller, commit])

  /** Zoomed in: back to the page's width; else zoomed in where tapped */
  const doubleTap = useCallback((p: Pt) => {
    const col = column.current, sc = scroller.current
    if (!col || !sc) return
    const z0 = fns.current.zoom
    const z1 = z0 > ZOOM_MIN ? ZOOM_MIN : ZOOM_TAP
    const r = col.getBoundingClientRect()
    const top = r.top, left = sc.scrollLeft
    if (reduced()) { commit(z0, z1, p, p, top, left); return }
    // the picture grows / shrinks around the finger first, then the width follows
    col.style.transformOrigin = `${p.x - r.left}px ${p.y - r.top}px`
    col.style.transition = ANIMATE
    col.style.transform = `scale(${z1 / z0})`
    let done = false
    const finish = () => { if (done) return; done = true; commit(z0, z1, p, p, top, left) }
    col.addEventListener('transitionend', finish, { once: true })
    setTimeout(finish, 400)   // (no transitionend when the tab is hidden)
  }, [column, scroller, commit])

  return { doubleTap }
}

/** Page by page. `content` is enlarged inside `area`; back to its size when `resetKey` changes. */
export function usePanZoom(o: {
  active: boolean
  area: RefObject<HTMLElement | null>
  content: RefObject<HTMLElement | null>
  resetKey: unknown
}) {
  const { active, area, content, resetKey } = o
  const view = useRef<View>(IDENTITY)
  const pinching = useRef(false)

  const apply = useCallback((v: View, animate = false) => {
    view.current = v
    const el = content.current
    if (!el) return
    el.style.transformOrigin = '0 0'
    el.style.transition = animate && !reduced() ? ANIMATE : ''
    el.style.transform = v.s > 1 ? `translate(${v.x}px, ${v.y}px) scale(${v.s})` : ''
  }, [content])
  useEffect(() => { apply(IDENTITY) }, [resetKey, apply])

  useNoPageZoom(active)
  useEffect(() => {
    const el = area.current
    if (!active || !el) return
    let g: { kind: 'pinch'; v0: View; d0: number; m0: Pt } | { kind: 'pan'; v0: View; p0: Pt } | null = null
    const local = (x: number, y: number) => { const r = el.getBoundingClientRect(); return { x: x - r.left, y: y - r.top } }
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const { d, m } = two(e.touches)
        g = { kind: 'pinch', v0: view.current, d0: d, m0: local(m.x, m.y) }
        pinching.current = true
      } else if (e.touches.length === 1 && view.current.s > 1.001) {
        g = { kind: 'pan', v0: view.current, p0: local(e.touches[0].clientX, e.touches[0].clientY) }
      }
    }
    const move = (e: TouchEvent) => {
      if (!g) return
      const w = el.clientWidth, h = el.clientHeight
      if (g.kind === 'pinch' && e.touches.length === 2) {
        e.preventDefault()
        const { d, m } = two(e.touches)
        const ml = local(m.x, m.y)
        const v = zoomAt(g.v0, g.v0.s * d / g.d0, g.m0, w, h)
        apply(clampView({ s: v.s, x: v.x + ml.x - g.m0.x, y: v.y + ml.y - g.m0.y }, w, h))
      } else if (g.kind === 'pan' && e.touches.length === 1) {
        e.preventDefault()
        const p = local(e.touches[0].clientX, e.touches[0].clientY)
        apply(clampView({ s: g.v0.s, x: g.v0.x + p.x - g.p0.x, y: g.v0.y + p.y - g.p0.y }, w, h))
      }
    }
    const end = (e: TouchEvent) => {
      if (g?.kind === 'pinch' && e.touches.length < 2) {
        g = null
        pinching.current = false
        if (view.current.s < 1.08) apply(IDENTITY, true)
      } else if (g?.kind === 'pan' && e.touches.length === 0) {
        g = null
      }
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      pinching.current = false
    }
  }, [active, area, apply])

  /** The page is enlarged or being pinched: no page turn, no tap */
  const locked = useCallback(() => pinching.current || view.current.s > 1.001, [])

  /** Enlarged: back to its size. Else, in the middle of the page (the edges turn pages): enlarged where tapped */
  const doubleTap = useCallback((p: Pt): boolean => {
    const el = area.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (view.current.s > 1.001) { apply(IDENTITY, true); return true }
    const x = p.x - r.left
    if (x < r.width * 0.3 || x > r.width * 0.7) return false
    apply(zoomAt(view.current, ZOOM_TAP / 100, { x, y: p.y - r.top }, r.width, r.height), true)
    return true
  }, [area, apply])

  return { locked, doubleTap }
}
