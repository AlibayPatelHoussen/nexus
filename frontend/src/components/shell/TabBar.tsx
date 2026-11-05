import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import type { LucideIcon } from 'lucide-react'
import { TABS, tabFor } from './nav'

const PAD = 4           // the bar's inner inset (62 pt bar, 54 pt tabs)
const LENS = 1.45       // lens width, in tabs (Apple Music: ~1.4–1.5)
const OVERFLOW = 5      // the lens spills over the bar, top and bottom (pt)
// Apple Music: the lens tracks the finger (≈ response .35, damping .7) and
// settles back into the pill a bit slower (≈ .5 / .8)
const FOLLOW = { stiffness: 700, damping: 42, mass: 0.6 }
const SETTLE = { type: 'spring', stiffness: 300, damping: 28 } as const

/**
 * iOS 26 tab bar (Apple's iOS 26 kit, "Tab Bar – iPhone"; motion from a screen
 * recording of Apple Music): a Liquid Glass capsule floating above the content.
 * At rest the selected tab sits in a soft pill. Touching the bar turns the pill
 * into a clear glass lens, larger than a tab and spilling over the bar, that
 * follows the finger; the tabs under it are tinted and magnified. Letting go
 * selects the tab under the finger and the lens settles back into the pill.
 *
 * 60 fps: while the finger moves nothing re-renders. The finger position is a
 * motion value; the lens and every icon read it through springs / transforms
 * (compositor-only: transform and opacity).
 */
export default function TabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // Title pages (/media/…) stay under the tab they were opened from
  const last = useRef(tabFor(pathname))
  const found = tabFor(pathname)
  if (found) last.current = found
  const current = found ?? last.current
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly)
  const active = tabs.findIndex((t) => t.to === current?.to)

  const bar = useRef<HTMLUListElement>(null)
  const rect = useRef<DOMRect | null>(null)
  const [width, setWidth] = useState(0)
  const [pressing, setPressing] = useState(false)
  const handled = useRef(false)

  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const n = tabs.length
  const tabW = width ? (width - PAD * 2) / n : 0
  const lensW = tabW * LENS

  // Finger x inside the bar → lens centre (spring) → lens left edge, elastic past the ends
  const finger = useMotionValue(0)
  const center = useSpring(finger, FOLLOW)
  const lensX = useTransform(center, (c) => {
    const want = c - lensW / 2
    const min = PAD - tabW * 0.12
    const max = width - PAD - lensW + tabW * 0.12
    return want < min ? min - (min - want) * 0.3 : want > max ? max + (want - max) * 0.3 : want
  })
  // 0 at rest, 1 while touching: drives the tint / magnification of the tabs
  const touch = useSpring(0, { stiffness: 500, damping: 40 })

  const indexAt = (x: number) => Math.max(0, Math.min(n - 1, Math.floor((x - PAD) / tabW)))
  const relX = (clientX: number) => clientX - (rect.current?.left ?? 0)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !tabW || !bar.current) return
    bar.current.setPointerCapture(e.pointerId)
    rect.current = bar.current.getBoundingClientRect()
    handled.current = true
    const x = relX(e.clientX)
    // The lens grows out of the selected pill, then runs to the finger
    const from = active >= 0 ? PAD + (active + 0.5) * tabW : x
    center.jump(from); finger.jump(from)
    finger.set(x)
    touch.set(1)
    setPressing(true)
  }
  const onPointerMove = (e: React.PointerEvent) => { if (pressing) finger.set(relX(e.clientX)) }
  const end = (select: boolean, clientX?: number) => {
    if (!pressing) return
    setPressing(false)
    touch.set(0)
    if (select && clientX != null) {
      const i = indexAt(relX(clientX))
      navigator.vibrate?.(8)
      if (tabs[i]) navigate(tabs[i].to)   // the same tab again goes back to its root
    }
  }

  return (
    <nav
      aria-label="Onglets"
      className="fixed z-40 left-0 right-0 flex justify-center pointer-events-none"
      style={{
        bottom: 'var(--tabbar-bottom)',
        paddingLeft: 'max(21px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(21px, env(safe-area-inset-right, 0px))',
      }}
    >
      <ul
        ref={bar}
        className="glass relative pointer-events-auto flex w-full max-w-[460px] h-[var(--tabbar-h)] p-1 rounded-pill touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(true, e.clientX)}
        onPointerCancel={() => end(false)}
        // The pointer already chose the tab; the links' own clicks are for the keyboard
        onClickCapture={(e) => { if (handled.current) { e.preventDefault(); handled.current = false } }}
      >
        {tabW > 0 && (
          <>
            {/* Resting pill under the selected tab (slides on a spring when the tab changes) */}
            {active >= 0 && (
              <motion.span
                aria-hidden="true"
                className="absolute z-0 left-0 rounded-pill pointer-events-none bg-[color:var(--glass-select)]"
                style={{ top: PAD, bottom: PAD, width: tabW }}
                initial={false}
                animate={{ x: PAD + active * tabW, opacity: pressing ? 0 : 1, scale: pressing ? 1.15 : 1 }}
                transition={SETTLE}
              />
            )}
            {/* The glass lens: only while touching; grows in, follows the finger, shrinks back */}
            <motion.span
              aria-hidden="true"
              className="tab-lens absolute z-20 left-0 rounded-pill pointer-events-none"
              style={{ x: lensX, width: lensW, top: -OVERFLOW, bottom: -OVERFLOW }}
              initial={false}
              animate={{ opacity: pressing ? 1 : 0, scale: pressing ? 1 : 0.72 }}
              transition={pressing ? { type: 'spring', stiffness: 520, damping: 30 } : SETTLE}
            />
          </>
        )}
        {tabs.map((t, i) => (
          <Tab
            key={t.to}
            to={t.to}
            label={t.label}
            Icon={t.icon}
            on={i === active}
            centre={PAD + (i + 0.5) * tabW}
            reach={lensW * 0.6}
            lensCenter={center}
            touch={touch}
          />
        ))}
      </ul>
    </nav>
  )
}

/** One tab. Under the lens it is tinted and magnified (strongest at the lens centre). */
function Tab({ to, label, Icon, on, centre, reach, lensCenter, touch }: {
  to: string; label: string; Icon: LucideIcon; on: boolean
  centre: number; reach: number; lensCenter: MotionValue<number>; touch: MotionValue<number>
}) {
  // Props as motion values, so the transforms below never read stale numbers
  const cx = useMotionValue(centre)
  const rx = useMotionValue(reach)
  const sel = useMotionValue(on ? 1 : 0)
  useEffect(() => { cx.set(centre); rx.set(reach) }, [cx, rx, centre, reach])
  useEffect(() => { sel.set(on ? 1 : 0) }, [sel, on])
  // How much this tab is under the lens: 0…1
  const under = useTransform<number, number>([lensCenter, touch, cx, rx], ([c, t, x, r]) => t * Math.max(0, 1 - Math.abs(x - c) / (r || 1)))
  const scale = useTransform(under, (u) => 1 + u * 0.14)
  // Accent copy of the icon + label cross-fading over the plain one (opacity only, no repaint of colours)
  const accent = useTransform<number, number>([under, touch, sel], ([u, t, o]) => o * (1 - t) + Math.min(1, u * 2.2) * t)
  const plain = useTransform(accent, (a) => 1 - a)

  const body = (
    <>
      <Icon size={23} strokeWidth={2} />
      <span className="truncate max-w-full px-0.5">{label}</span>
    </>
  )
  return (
    <li className="relative z-30 flex-1 flex min-w-0">
      <Link
        to={to}
        aria-current={on ? 'page' : undefined}
        draggable={false}
        className="no-press relative flex-1 grid place-items-center rounded-pill text-[10px] leading-3 font-[590]"
      >
        <motion.span className="relative grid place-items-center max-w-full" style={{ scale }}>
          <motion.span aria-hidden="true" className="col-start-1 row-start-1 flex flex-col items-center gap-px max-w-full text-[color:var(--glass-label)]" style={{ opacity: plain }}>{body}</motion.span>
          <motion.span className="col-start-1 row-start-1 flex flex-col items-center gap-px max-w-full text-accent" style={{ opacity: accent }}>{body}</motion.span>
        </motion.span>
      </Link>
    </li>
  )
}
