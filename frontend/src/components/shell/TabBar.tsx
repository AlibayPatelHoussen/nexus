import { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import type { LucideIcon } from 'lucide-react'
import { TABS, tabFor, type Tab } from './nav'
import { useSectionStore } from './sectionStore'
import { selectionHaptic } from '@/utils/haptics'

const PAD = 4           // the bar's inner inset (62 pt bar, 54 pt tabs)
const LENS = 1.45       // lens width, in tabs (Apple Music: ~1.4–1.5)
const OVERFLOW = 5      // the lens spills over the bar, top and bottom (pt)
// Apple Music: the lens tracks the finger (≈ response .35, damping .7) and
// settles back into the pill a bit slower (≈ .5 / .8)
const FOLLOW = { stiffness: 700, damping: 42, mass: 0.6 }
const SETTLE = { type: 'spring', stiffness: 300, damping: 28 } as const
/** After the finger lifts, the lens glides onto the chosen tab (the page changes after) */
const GLIDE_MS = 170
/** …and shrinks back into the pill of that tab (CSS transition: run by the compositor,
 * so the page rendering meanwhile cannot make it stutter) */
const SHRINK_MS = 260
// iOS-like curves: a springy grow (slight overshoot), a soft settle back
const GROW = 'cubic-bezier(0.2, 0.9, 0.25, 1.18)'
const SHRINK = 'cubic-bezier(0.3, 0.7, 0.2, 1)'
/** Even a very quick tap shows the lens popping out before it shrinks back (Apple Music) */
const MIN_POP_MS = 170

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
// Tab the last section page was under. Kept outside the component: the bar is created
// again when coming back from the full-screen reader / player, and must not forget it
let lastTab: Tab | undefined
/** Each tab is its own stack (iOS): switching back to a tab finds the page left in it */
const lastPathByTab: Record<string, string> = {}

export default function TabBar() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // Title pages (/media/…) stay under the tab they were opened from; opened directly
  // (app reopened on it…), under the tab of their library (a manga → Manga)
  const section = useSectionStore((s) => s.section)
  const found = tabFor(pathname)
  if (found) lastTab = found
  const current = found ?? lastTab ?? (section ? tabFor(section) : undefined)
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly)
  const active = tabs.findIndex((t) => t.to === current?.to)
  useEffect(() => { if (found) lastPathByTab[found.to] = pathname + search }, [found, pathname, search])
  const reduced = useReducedMotion()

  // Scrolling down a page tucks the bar away into a small capsule with the current tab
  // (iOS 26 tab bar minimise); scrolling back up, reaching the top or tapping it brings it back
  const [compact, setCompact] = useState(false)
  /** The scroll position put back when switching tab is not the user scrolling */
  const quietUntil = useRef(0)
  useEffect(() => {
    let lastY = window.scrollY
    let run = 0
    const onScroll = () => {
      const y = window.scrollY
      const d = y - lastY
      lastY = y
      if (performance.now() < quietUntil.current) { run = 0; return }
      if (y < 48) { run = 0; setCompact(false); return }
      // Rubber band at the bottom of the page: not a scroll back up
      if (d < 0 && y >= document.documentElement.scrollHeight - window.innerHeight - 4) return
      run = (run >= 0) === (d >= 0) ? run + d : d
      if (run > 28) setCompact(true)
      else if (run < -18) setCompact(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => { quietUntil.current = performance.now() + 400; setCompact(false) }, [pathname])

  const bar = useRef<HTMLUListElement>(null)
  const rect = useRef<DOMRect | null>(null)
  const [width, setWidth] = useState(0)
  // press: finger down, the lens follows it; release: the lens glides to the chosen tab
  const [phase, setPhase] = useState<'idle' | 'press' | 'release'>('idle')
  const pressing = phase === 'press'
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressedAt = useRef(0)
  /** Finger on the bar (the lens may still be popping out after it lifted) */
  const down = useRef(false)
  useEffect(() => () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current)
    if (navTimer.current) clearTimeout(navTimer.current)
  }, [])
  // Tab under the finger while pressing, then the tab picked until the route catches up:
  // the (hidden) pill follows it at once, so it is already in place when the lens lets go
  const [under, setUnder] = useState<number | null>(null)
  const handled = useRef(false)
  useEffect(() => { if (phase === 'idle' && under != null && (under === active || active < 0)) setUnder(null) }, [phase, under, active])

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
  // At rest the lens is the size of the pill (it grows out of it and shrinks back into it)
  const restScaleX = lensW ? tabW / lensW : 1
  const restScaleY = (62 - PAD * 2) / (62 + OVERFLOW * 2)   // --tabbar-h: 62
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
    // A new touch while the lens shrinks back: it grows again from where it is (fast taps)
    if (releaseTimer.current) { clearTimeout(releaseTimer.current); releaseTimer.current = null }
    if (phase === 'idle') {
      // The lens grows out of the selected pill, then runs to the finger
      const from = active >= 0 ? PAD + (active + 0.5) * tabW : x
      center.jump(from); finger.jump(from)
    }
    finger.set(x)
    touch.set(reduced ? 0 : 1)
    setUnder(indexAt(x))
    setPhase('press')
    pressedAt.current = performance.now()
    down.current = true
  }
  /** The lens shrinks back once it had time to pop out, then the bar is at rest */
  const settle = () => {
    const wait = reduced ? 0 : Math.max(0, MIN_POP_MS - (performance.now() - pressedAt.current))
    const shrink = () => {
      setPhase('release')
      releaseTimer.current = setTimeout(() => { releaseTimer.current = null; setPhase('idle') }, reduced ? 0 : SHRINK_MS)
    }
    if (wait) releaseTimer.current = setTimeout(shrink, wait)
    else shrink()
  }
  // A touch whose end never reaches the bar (iOS took the gesture: edge swipe, app sent to the
  // background, page changed…) must not leave the lens stuck: it is ended as cancelled
  const endRef = useRef<(select: boolean) => void>(() => {})
  useEffect(() => {
    const cancel = () => { if (down.current) endRef.current(false) }
    const onVisibility = () => { if (document.hidden) cancel() }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  useEffect(() => { if (down.current) endRef.current(false) }, [pathname])
  const onPointerMove = (e: React.PointerEvent) => {
    if (!down.current) return
    const x = relX(e.clientX)
    finger.set(x)
    setUnder(indexAt(x))
  }
  const end = (select: boolean, clientX?: number) => {
    if (!down.current) return
    down.current = false
    if (!select || clientX == null) {
      touch.set(0); setUnder(null)
      settle()
      return
    }
    const i = indexAt(relX(clientX))
    setUnder(i)
    // Apple Music: the lens glides onto the chosen tab while it shrinks back into its pill
    // and the bar settles. The page changes once the glide is over: rendering it meanwhile
    // would steal the frames of the glide (the shrink itself is a CSS transition)
    finger.set(PAD + (i + 0.5) * tabW)
    touch.set(0)
    settle()
    selectionHaptic()
    // Another tab: the page left in it. The current tab again: back to its root, and when
    // already there, back to the top of the page (iOS)
    const tab = tabs[i]
    const again = i === active
    const to = !tab ? undefined : again ? (pathname === tab.to ? undefined : tab.to) : lastPathByTab[tab.to] ?? tab.to
    if (navTimer.current) clearTimeout(navTimer.current)
    navTimer.current = setTimeout(() => {
      navTimer.current = null
      if (to) startTransition(() => navigate(to))
      else if (again) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    }, reduced ? 0 : GLIDE_MS)
  }
  endRef.current = (select) => end(select)
  const pill = under ?? active
  // The pill moves instantly when the finger chose the tab (it is hidden under the lens);
  // it slides on a spring only when the tab changes some other way (back, keyboard…)
  const pillMove = under != null || reduced ? { duration: 0 } : SETTLE
  const ActiveIcon = active >= 0 ? tabs[active].icon : undefined
  const barEase = 'cubic-bezier(0.32, 0.72, 0, 1)'

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
        className="glass glass-float relative pointer-events-auto flex w-full max-w-[460px] h-[var(--tabbar-h)] p-1 rounded-pill touch-none select-none"
        style={{
          opacity: compact ? 0 : 1,
          // Touched, the whole bar swells a little (never past the lens) and turns clearer
          transform: compact ? 'translateY(12px)' : pressing && !reduced ? 'scale(1.035)' : 'none',
          pointerEvents: compact ? 'none' : undefined,
          transition: reduced ? 'opacity 150ms linear'
            : `opacity 220ms ease-out, transform ${pressing ? `420ms ${GROW}` : compact ? `420ms ${barEase}` : `${SHRINK_MS}ms ${SHRINK}`}`,
        }}
        aria-hidden={compact || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(true, e.clientX)}
        onPointerCancel={() => end(false)}
        onLostPointerCapture={() => { if (down.current) end(false) }}
        // The pointer already chose the tab; the links' own clicks are for the keyboard
        onClickCapture={(e) => { if (handled.current) { e.preventDefault(); handled.current = false } }}
      >
        {/* Liquid sheen over the bar while it is touched (opacity only) */}
        <span
          aria-hidden="true"
          className="tabbar-sheen absolute inset-0 rounded-pill pointer-events-none"
          style={{ opacity: pressing && !reduced ? 1 : 0, transition: `opacity ${pressing ? 160 : SHRINK_MS}ms ease-out` }}
        />
        {tabW > 0 && (
          <>
            {/* Resting pill under the selected tab (already under the finger's tab when the lens lets go) */}
            {pill >= 0 && (
              <motion.span
                aria-hidden="true"
                data-tab-pill={pill}
                className="absolute z-0 left-0 rounded-pill pointer-events-none bg-[color:var(--glass-select)]"
                style={{ top: PAD, bottom: PAD, width: tabW }}
                initial={false}
                // Hidden under the lens while touching; comes back as the lens shrinks into it
                animate={{ x: PAD + pill * tabW, opacity: pressing ? 0 : 1 }}
                transition={{ x: pillMove, opacity: pressing ? { duration: 0.08 } : { duration: 0.16, delay: reduced ? 0 : 0.06, ease: 'easeOut' } }}
              />
            )}
            {/* The glass lens: grows out of the pill when touched, follows the finger, glides to the
                chosen tab and shrinks back into its pill. Position: motion value (follows the finger);
                size and opacity: CSS transitions on an inner layer (compositor, never stutters) */}
            <motion.span
              aria-hidden="true"
              className="absolute z-20 left-0 pointer-events-none"
              style={{ x: lensX, width: lensW, top: -OVERFLOW, bottom: -OVERFLOW }}
            >
              <span
                className="tab-lens absolute inset-0 rounded-pill"
                style={{
                  transform: pressing ? 'none' : `scale(${restScaleX}, ${restScaleY})`,
                  opacity: pressing && !reduced ? 1 : 0,
                  transition: reduced ? 'none' : pressing
                    ? `transform 420ms ${GROW}, opacity 90ms ease-out`
                    : `transform ${SHRINK_MS}ms ${SHRINK}, opacity ${SHRINK_MS - 70}ms ease-in 70ms`,
                }}
              />
            </motion.span>
          </>
        )}
        {tabs.map((t, i) => (
          <Tab
            key={t.to}
            to={t.to}
            label={t.label}
            Icon={t.icon}
            on={i === (pressing ? active : pill)}
            centre={PAD + (i + 0.5) * tabW}
            reach={lensW * 0.6}
            lensCenter={center}
            touch={touch}
          />
        ))}
      </ul>
      {/* Tucked away while scrolling down: the current tab in a small capsule; a tap brings the bar back */}
      {ActiveIcon && (
        <button
          type="button"
          onClick={() => { selectionHaptic(); setCompact(false) }}
          tabIndex={compact ? 0 : -1}
          aria-hidden={!compact || undefined}
          aria-label={`Afficher les onglets (${tabs[active].label})`}
          className="glass glass-float absolute pointer-events-auto grid place-items-center rounded-pill w-[var(--tabbar-h)] h-[var(--tabbar-h)]"
          style={{
            left: 'max(21px, env(safe-area-inset-left, 0px))',
            top: 0,
            opacity: compact ? 1 : 0,
            transform: compact ? 'none' : 'scale(0.7)',
            transformOrigin: 'left center',
            pointerEvents: compact ? 'auto' : 'none',
            transition: reduced ? 'opacity 150ms linear' : `opacity 200ms ease-out, transform 420ms ${barEase}`,
          }}
        >
          <ActiveIcon size={24} strokeWidth={2.4} aria-hidden="true" className="text-accent" />
        </button>
      )}
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

  // The selected / magnified copy is drawn a bit heavier, like the filled SF Symbol of the active tab
  const body = (weight: number) => (
    <>
      <Icon size={23} strokeWidth={weight} />
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
          <motion.span aria-hidden="true" className="col-start-1 row-start-1 flex flex-col items-center gap-px max-w-full text-[color:var(--glass-label)]" style={{ opacity: plain }}>{body(2)}</motion.span>
          <motion.span className="col-start-1 row-start-1 flex flex-col items-center gap-px max-w-full text-accent" style={{ opacity: accent }}>{body(2.5)}</motion.span>
        </motion.span>
      </Link>
    </li>
  )
}
