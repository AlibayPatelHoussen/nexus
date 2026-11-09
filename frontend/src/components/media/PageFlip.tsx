import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { spring } from '@/design/motion'

/*
 * Book page turn (manga reader, page modes), like a paper book: the page folds along a
 * line that follows the finger (its corner stays under the finger), shows its back
 * (paper) and uncovers the next page, with shadows along the crease.
 *
 * - drag the page anywhere: towards the spine turns to the next page, away from it
 *   brings the previous one back; let go past the spine (or with a flick) to turn,
 *   otherwise it falls back;
 * - one tap on the outer edge: next page, on the spine side: previous page (animated
 *   the same way), in the middle: onCenterTap (show / hide the reader bars);
 * - right to left (manga): the spine is on the right; only the geometry is mirrored,
 *   never the pictures.
 *
 * The geometry is computed in « page space » (left to right, spine at x = 0, page
 * width w, height h) and written straight to the elements' styles on each frame
 * (no React render while the page moves).
 */

type Pt = { x: number; y: number }
export interface PageFlipHandle { turn: (dir: 1 | -1) => void }

interface Props {
  page:     number                      // 0-based current page
  count:    number
  rtl:      boolean
  /** Width of the page as a fraction of the area (desktop zoom), 1 = as wide as it fits */
  widthFraction?: number
  ratioOf:  (n: number) => number       // width / height of page n (0-based)
  render:   (n: number) => React.ReactNode
  onChange: (n: number) => void
  onCenterTap?: () => void
  /** Reduced motion: pages change at once */
  instant?: boolean
}

const EDGE = 0.3            // outer / inner tap zones: 30 % of the area each
const DRAG_START = 8        // px before a touch becomes a drag
const reflect = (p: Pt, m: Pt, n: Pt): Pt => {
  const d = (p.x - m.x) * n.x + (p.y - m.y) * n.y
  return { x: p.x - 2 * d * n.x, y: p.y - 2 * d * n.y }
}
/** The part of a convex polygon on one side of the line (m, normal n): sign -1 → (X−m)·n ≤ 0 */
function clip(poly: Pt[], m: Pt, n: Pt, sign: 1 | -1): Pt[] {
  const side = (p: Pt) => sign * ((p.x - m.x) * n.x + (p.y - m.y) * n.y)
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const sa = side(a), sb = side(b)
    if (sa >= 0) out.push(a)
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

const PageFlip = forwardRef<PageFlipHandle, Props>(function PageFlip(
  { page, count, rtl, widthFraction = 1, ratioOf, render, onChange, onCenterTap, instant }, ref,
) {
  const area = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // The turn in progress: dir 1 = to the next page, -1 = back to the previous one
  const [turning, setTurning] = useState<{ dir: 1 | -1 } | null>(null)
  const topEl = useRef<HTMLDivElement>(null)
  const flapEl = useRef<HTMLDivElement>(null)
  const flapShade = useRef<HTMLDivElement>(null)
  const underShade = useRef<HTMLDivElement>(null)
  const anim = useRef<{ stop: () => void } | null>(null)
  // First fold of a turn: drawn before the browser paints the new pages (no flash of a flat page)
  const pending = useRef<{ p: Pt; ay: number } | null>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Page rectangle: centred, as wide as allowed, at most as tall as the area
  const rect = (n: number) => {
    const ratio = ratioOf(n) || 0.68
    const w = Math.min(size.w * widthFraction, size.h * ratio)
    const h = w / ratio
    return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h }
  }
  const r = rect(page)

  /** Draws the fold for the corner point p (page space) of a turn anchored at height ay. */
  const draw = useCallback((p: Pt, ay: number) => {
    const { x: rx, y: ry, w, h } = r
    const toArea = (q: Pt) => ({ x: rx + (rtl ? w - q.x : q.x), y: ry + q.y })
    const poly = (pts: Pt[], ox = 0, oy = 0) =>
      pts.length ? `polygon(${pts.map((q) => { const a = toArea(q); return `${a.x - ox}px ${a.y - oy}px` }).join(',')})` : 'polygon(0 0, 0 0, 0 0)'
    const a: Pt = { x: w, y: ay }
    // keep the page attached to its spine (it cannot be pulled further than its width)
    const s: Pt = { x: 0, y: ay }
    const dx = p.x - s.x, dy = p.y - s.y
    const len = Math.hypot(dx, dy)
    if (len > w) p = { x: s.x + dx / len * w, y: s.y + dy / len * w }
    const d = Math.hypot(a.x - p.x, a.y - p.y)
    const page4: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
    const top = topEl.current, flap = flapEl.current, fs = flapShade.current, us = underShade.current
    if (!top || !flap || !fs || !us) return
    if (d < 0.5) {   // flat
      top.style.clipPath = 'none'; flap.style.clipPath = 'polygon(0 0, 0 0, 0 0)'; us.style.clipPath = 'polygon(0 0, 0 0, 0 0)'
      return
    }
    const n: Pt = { x: (a.x - p.x) / d, y: (a.y - p.y) / d }     // from the corner's new place to its old one
    const m: Pt = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 }     // the crease goes through m, across n
    const keep = clip(page4, m, n, -1)                              // the page still lying flat
    const folded = clip(page4, m, n, 1)                             // the part lifted (its place shows the page below)
    const back = folded.map((q) => reflect(q, m, n))               // that part, folded over: its back
    top.style.clipPath = poly(keep, rx, ry)
    flap.style.clipPath = poly(back)
    us.style.clipPath = poly(folded)
    // Shadows across the crease: CSS gradient positions measured along the gradient line
    const grad = (dir: Pt) => {
      const dirA = { x: rtl ? -dir.x : dir.x, y: dir.y }
      const deg = Math.atan2(dirA.x, -dirA.y) * 180 / Math.PI
      const L = Math.abs(size.w * dirA.x) + Math.abs(size.h * dirA.y)
      const mA = toArea(m)
      const at = (mA.x - size.w / 2) * dirA.x + (mA.y - size.h / 2) * dirA.y + L / 2
      return { deg, at }
    }
    const span = Math.min(d / 2, w)                                 // width of the lifted part
    const g1 = grad({ x: -n.x, y: -n.y })                           // on the back, from the crease outwards
    fs.style.background = `linear-gradient(${g1.deg}deg, var(--page-crease) ${g1.at}px, transparent ${g1.at + span * 0.35}px, rgba(255,255,255,0.18) ${g1.at + span * 0.7}px, var(--page-crease) ${g1.at + span}px)`
    const g2 = grad(n)                                              // on the page below, cast by the lifted page
    us.style.background = `linear-gradient(${g2.deg}deg, var(--page-shadow) ${g2.at}px, transparent ${g2.at + Math.max(24, span * 0.5)}px)`
  }, [r, rtl, size.w, size.h])

  useLayoutEffect(() => {
    if (turning && pending.current) { draw(pending.current.p, pending.current.ay); pending.current = null }
  }, [turning, draw])

  // ── Turning: by the finger, or animated (tap, buttons, keys) ──────────────
  const drag = useRef<{ id: number; start: Pt; startT: number; dir: 0 | 1 | -1; ay: number; last: Pt; lastT: number; vx: number } | null>(null)
  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const b = area.current!.getBoundingClientRect()
    const x = e.clientX - b.left - r.x, y = e.clientY - b.top - r.y
    return { x: rtl ? r.w - x : x, y }
  }
  const finish = useCallback((dir: 1 | -1, from: Pt, ay: number, complete: boolean) => {
    const w = r.w
    const startP = dir === 1 ? { x: w, y: ay } : { x: -w, y: ay }   // flat page / fully turned page
    const endP = complete ? (dir === 1 ? { x: -w, y: ay } : { x: w, y: ay }) : startP
    anim.current?.stop()
    anim.current = animate(0, 1, {
      ...spring.sheet,
      onUpdate: (t) => draw({ x: from.x + (endP.x - from.x) * t, y: from.y + (endP.y - from.y) * t }, ay),
      onComplete: () => {
        anim.current = null
        if (complete) onChange(page + dir)
        setTurning(null)
      },
    })
  }, [draw, onChange, page, r.w])

  const turn = useCallback((dir: 1 | -1) => {
    const target = page + dir
    if (target < 0 || target >= count || anim.current) return
    if (instant || !size.w) { onChange(target); return }
    // a programmatic turn lifts the lower corner a little, like a hand turning the page
    const ay = r.h * 0.9
    const w = r.w
    const from = dir === 1 ? { x: w, y: ay } : { x: -w, y: ay }
    const to = dir === 1 ? { x: -w, y: ay } : { x: w, y: ay }
    pending.current = { p: from, ay }
    setTurning({ dir })
    requestAnimationFrame(() => {
      anim.current = animate(0, 1, {
        ...spring.sheet,
        onUpdate: (t) => draw({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * r.h * 0.12 }, ay),
        onComplete: () => { anim.current = null; onChange(target); setTurning(null) },
      })
    })
  }, [count, draw, instant, onChange, page, r.h, r.w, size.w])

  useImperativeHandle(ref, () => ({ turn }), [turn])
  useEffect(() => () => anim.current?.stop(), [])

  function onPointerDown(e: React.PointerEvent) {
    if (anim.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    const p = toPage(e)
    drag.current = { id: e.pointerId, start: p, startT: performance.now(), dir: 0, ay: Math.min(Math.max(p.y, 0), r.h), last: p, lastT: performance.now(), vx: 0 }
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    const p = toPage(e)
    const now = performance.now()
    g.vx = (p.x - g.last.x) / Math.max(1, now - g.lastT)
    g.last = p; g.lastT = now
    const dx = p.x - g.start.x, dy = p.y - g.start.y
    if (!g.dir) {
      if (Math.hypot(dx, dy) < DRAG_START || Math.abs(dx) < Math.abs(dy)) return
      const dir: 1 | -1 = dx < 0 ? 1 : -1                   // towards the spine: next page
      if (page + dir < 0 || page + dir >= count) { drag.current = null; return }
      g.dir = dir
      area.current?.setPointerCapture(e.pointerId)
      pending.current = { p: { x: (dir === 1 ? r.w : -r.w) + dx, y: g.ay + dy }, ay: g.ay }
      setTurning({ dir })
      return
    }
    // the corner follows the finger
    const base = g.dir === 1 ? r.w : -r.w
    draw({ x: base + dx, y: g.ay + dy }, g.ay)
  }
  function onPointerUp(e: React.PointerEvent) {
    const g = drag.current
    drag.current = null
    if (!g || g.id !== e.pointerId) return
    const p = toPage(e)
    if (!g.dir) {
      // a tap: outer edge → next, spine side → previous, middle → the reader's own action
      if (performance.now() - g.startT > 500) return
      const x = p.x / r.w
      if (x > 1 - EDGE) turn(1)
      else if (x < EDGE) turn(-1)
      else onCenterTap?.()
      return
    }
    const dx = p.x - g.start.x, dy = p.y - g.start.y
    const base = g.dir === 1 ? r.w : -r.w
    const now: Pt = { x: base + dx, y: g.ay + dy }
    // past the spine, or a flick in the turning direction
    const complete = g.dir === 1 ? (now.x < 0 || g.vx < -0.6) : (now.x > 0 || g.vx > 0.6)
    if (instant) { if (complete) onChange(page + g.dir); setTurning(null); return }
    finish(g.dir, now, g.ay, complete)
  }

  // Pages on screen: the one being read, and the one under / over it during a turn
  const topN = turning?.dir === -1 ? page - 1 : page
  const underN = turning ? (turning.dir === 1 ? page + 1 : page) : null
  const box = (n: number, z: number, hidden = false): React.CSSProperties => {
    const b = rect(n)
    return { position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: z, visibility: hidden ? 'hidden' : 'visible' }
  }
  // the neighbours are kept mounted (hidden) so they are already loaded when the page turns
  const mounted = [page - 1, page, page + 1].filter((n) => n >= 0 && n < count)

  return (
    <div
      ref={area}
      className="absolute inset-0 select-none"
      style={{ touchAction: 'pinch-zoom' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { const g = drag.current; drag.current = null; if (g?.dir) finish(g.dir, { x: g.dir === 1 ? r.w : -r.w, y: g.ay }, g.ay, false) }}
      onClick={(e) => e.stopPropagation()}   // taps are handled here (the reader would toggle its bars)
    >
      {size.w > 0 && mounted.map((n) => {
        const isTop = n === topN, isUnder = n === underN
        return (
          <div key={n} ref={isTop ? topEl : undefined} style={{ ...box(n, isTop ? 2 : 1, !isTop && !isUnder), clipPath: isTop ? undefined : 'none' }}>
            {render(n)}
          </div>
        )
      })}
      {turning && (
        <>
          {/* shadow cast on the page below, along the crease */}
          <div ref={underShade} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1, clipPath: 'polygon(0 0, 0 0, 0 0)' }} aria-hidden="true" />
          {/* the back of the lifted page */}
          <div ref={flapEl} className="absolute inset-0 pointer-events-none" style={{ zIndex: 3, clipPath: 'polygon(0 0, 0 0, 0 0)', background: 'var(--page-paper)' }} aria-hidden="true">
            <div ref={flapShade} className="absolute inset-0" />
          </div>
        </>
      )}
    </div>
  )
})

export default PageFlip
