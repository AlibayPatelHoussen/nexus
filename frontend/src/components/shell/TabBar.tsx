import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils'
import { TABS, tabFor } from './nav'

const PAD = 4           // the bar's inner inset (62 pt bar, 54 pt tabs)
const LENS = 1.45       // lens width, in tabs (Apple Music: ~1.4–1.5)
const OVERFLOW = 5      // the lens spills over the bar, top and bottom (pt)
// Apple Music: the lens tracks the finger (≈ response .35, damping .7) and
// settles back into the pill a bit slower (≈ .5 / .8)
const FOLLOW = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const
const SETTLE = { type: 'spring', stiffness: 260, damping: 26 } as const

/**
 * iOS 26 tab bar (Apple's iOS 26 kit, "Tab Bar – iPhone"; motion from a screen
 * recording of Apple Music): a Liquid Glass capsule floating above the content.
 * At rest the selected tab sits in a soft pill. Touching the bar turns the pill
 * into a clear glass lens, larger than a tab and spilling over the bar, that
 * follows the finger; the tabs under it are tinted and magnified. Letting go
 * selects the tab under the finger and the lens settles back into the pill.
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
  const [width, setWidth] = useState(0)
  const [lens, setLens] = useState<number | null>(null)   // finger x inside the bar, while touching
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
  const indexAt = (x: number) => Math.max(0, Math.min(n - 1, Math.floor((x - PAD) / tabW)))
  const relX = (clientX: number) => clientX - (bar.current?.getBoundingClientRect().left ?? 0)

  // Lens geometry: centred on the finger; past the ends it stretches out elastically
  const lensW = tabW * LENS
  let lensX = 0
  if (lens != null) {
    const want = lens - lensW / 2
    const min = PAD - tabW * 0.12
    const max = width - PAD - lensW + tabW * 0.12
    lensX = want < min ? min - (min - want) * 0.3 : want > max ? max + (want - max) * 0.3 : want
  }
  const pressing = lens != null && tabW > 0
  const lensCenter = lensX + lensW / 2

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !tabW) return
    bar.current?.setPointerCapture(e.pointerId)
    handled.current = true
    setLens(relX(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent) => { if (lens != null) setLens(relX(e.clientX)) }
  const onPointerUp = (e: React.PointerEvent) => {
    if (lens == null) return
    const i = indexAt(relX(e.clientX))
    setLens(null)
    navigator.vibrate?.(8)
    if (tabs[i]) navigate(tabs[i].to)   // the same tab again goes back to its root
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
        onPointerUp={onPointerUp}
        onPointerCancel={() => setLens(null)}
        // The pointer already chose the tab; the links' own clicks are for the keyboard
        onClickCapture={(e) => { if (handled.current) { e.preventDefault(); handled.current = false } }}
      >
        {/* Resting pill ⟷ glass lens: one element, so it morphs instead of swapping */}
        {tabW > 0 && (active >= 0 || pressing) && (
          <motion.span
            aria-hidden="true"
            className={cn('absolute z-0 rounded-pill pointer-events-none', pressing ? 'tab-lens' : 'bg-[color:var(--glass-select)]')}
            initial={false}
            animate={pressing
              ? { x: lensX, width: lensW, top: -OVERFLOW, bottom: -OVERFLOW }
              : { x: PAD + Math.max(active, 0) * tabW, width: tabW, top: PAD, bottom: PAD }}
            transition={pressing ? FOLLOW : SETTLE}
            style={{ left: 0 }}
          />
        )}
        {tabs.map((t, i) => {
          const on = i === active
          // Under the lens: tinted and magnified (strongest at its centre)
          const under = pressing ? Math.max(0, 1 - Math.abs(PAD + (i + 0.5) * tabW - lensCenter) / (lensW * 0.6)) : 0
          const tinted = pressing ? under > 0.25 : on
          return (
            <li key={t.to} className="relative z-10 flex-1 flex min-w-0">
              <Link
                to={t.to}
                aria-current={on ? 'page' : undefined}
                draggable={false}
                className={cn(
                  'no-press relative flex-1 flex flex-col items-center justify-center gap-px pt-1.5 pb-[7px] rounded-pill',
                  'text-[10px] leading-3 font-[590] transition-colors duration-200',
                  tinted ? 'text-accent' : 'text-[color:var(--glass-label)]',
                )}
              >
                <motion.span
                  className="flex flex-col items-center gap-px max-w-full"
                  animate={{ scale: 1 + under * 0.14 }}
                  transition={FOLLOW}
                >
                  <t.icon size={23} strokeWidth={on || tinted ? 2.1 : 1.75} aria-hidden="true" />
                  <span className="truncate max-w-full px-0.5">{t.label}</span>
                </motion.span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
