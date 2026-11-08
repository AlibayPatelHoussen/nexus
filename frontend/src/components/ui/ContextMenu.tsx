import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'

export type MenuItem =
  | { separator: true }
  | {
      label:        string
      onSelect:     () => void
      icon?:        React.ReactNode
      shortcut?:    string
      destructive?: boolean
      disabled?:    boolean
    }

interface ContextMenuProps {
  open:    boolean
  x:       number
  y:       number
  items:   MenuItem[]
  title?:  string
  /** Opened from a button: its top edge, so the menu can open above it when there is no room below */
  above?:  number
  /** x is the menu's right edge (a "…" button on the right of a bar) */
  alignEnd?: boolean
  onClose: () => void
}

/**
 * iOS 26 / macOS 26 menu: a Liquid Glass panel that grows out of the "…" button or the
 * pressed item (never the old iOS action sheet from the bottom). Keyboard navigable.
 * - desktop: macOS contextual menu (compact rows, accent highlight)
 * - phone: iOS 26 menu (44 px rows, 17 px text, very round)
 */
export default function ContextMenu({ open, ...props }: ContextMenuProps) {
  return open ? <Popover {...props} /> : null
}

function Popover({ x, y, items, title, above, alignEnd, onClose }: Omit<ContextMenuProps, 'open'>) {
  const phone = useDevice() === 'phone'
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [origin, setOrigin] = useState('top left')
  const [active, setActive] = useState(-1)
  const choices = items.map((it, i) => ({ it, i })).filter(({ it }) => !('separator' in it) && !it.disabled)

  // Keep inside the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // offset sizes: the opening animation scales the panel (a scaled rect would be too small)
    const r = { width: el.offsetWidth, height: el.offsetHeight }
    const margin = phone ? 12 : 6
    const start = alignEnd ? x - r.width : x
    const bottomLimit = window.innerHeight - (phone ? 90 : 6)   // above the tab bar
    const up = y + r.height > bottomLimit
    const top = up ? Math.max(margin, (above ?? y) - r.height - (above != null ? 8 : 0)) : y
    setPos({ left: Math.max(margin, Math.min(start, window.innerWidth - r.width - margin)), top })
    setOrigin(`${up ? 'bottom' : 'top'} ${alignEnd ? 'right' : 'left'}`)
    // preventScroll: on iPhone, focusing scrolled the page a little, and that scroll closed the menu
    el.focus({ preventScroll: true })
  }, [x, y, above, alignEnd, phone])

  useEffect(() => {
    const close = () => onClose()
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    // A real scroll closes the menu, not the small moves a tap causes on iPhone (a shelf
    // snapping back into place, the page settling): the menu vanished right after opening
    const openedAt = performance.now()
    const start = new Map<EventTarget, [number, number]>()
    const page = document.scrollingElement ?? document.documentElement
    start.set(page, [page.scrollLeft, page.scrollTop])
    const onScroll = (e: Event) => {
      const t = e.target === document ? document.scrollingElement ?? document.documentElement : e.target as Element
      if (!t || !('scrollTop' in t)) return
      const now: [number, number] = [t.scrollLeft, t.scrollTop]
      const from = start.get(t)
      if (!from) { start.set(t, now); return }
      if (performance.now() - openedAt > 400 && Math.hypot(now[0] - from[0], now[1] - from[1]) > 16) onClose()
    }
    // iOS resizes the viewport when its bars move: only a width change (rotation) closes it
    const width = window.innerWidth
    const onResize = () => { if (window.innerWidth !== width) onClose() }
    window.addEventListener('blur', close)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const onKey = (e: React.KeyboardEvent) => {
    const at = choices.findIndex((c) => c.i === active)
    if (e.key === 'ArrowDown') { setActive(choices[(at + 1) % choices.length]?.i ?? -1); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setActive(choices[(at - 1 + choices.length) % choices.length]?.i ?? -1); e.preventDefault() }
    else if (e.key === 'Enter' || e.key === ' ') {
      const c = choices[at]
      if (c && !('separator' in c.it)) { onClose(); c.it.onSelect() }
      e.preventDefault()
    } else if (e.key === 'Escape' || e.key === 'Tab') { onClose(); e.preventDefault() }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title ?? 'Menu'}
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'fixed z-[120] glass-strong outline-none overflow-y-auto overscroll-contain max-h-[70vh]',
        phone ? 'w-max min-w-[250px] max-w-[calc(100vw-24px)] p-2 rounded-[26px] text-[17px]' : 'min-w-[200px] max-w-[300px] p-[6px] rounded-[16px] text-body',
      )}
      style={{ ...pos, animation: 'nx-menu-in 260ms var(--ease-spring) both', transformOrigin: origin }}
    >
      {phone && title && <div className="px-4 pt-1.5 pb-2 text-footnote text-label2 truncate">{title}</div>}
      {items.map((it, i) =>
        'separator' in it ? (
          <div key={`s${i}`} role="separator" className={cn('h-px', phone ? 'my-1.5 mx-4' : 'my-[5px] mx-2')} style={{ background: 'var(--separator)' }} />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => { onClose(); it.onSelect() }}
            className={cn(
              'w-full flex items-center text-left disabled:opacity-40',
              phone
                ? cn('min-h-[44px] gap-3 px-4 rounded-[18px] active:bg-[var(--glass-hover)]', active === i && 'bg-[var(--glass-hover)]',
                    it.destructive ? 'text-danger-text' : 'text-label')
                : cn('gap-2 px-2.5 py-[5px] rounded-[10px]', active === i ? 'bg-accent text-white' : it.destructive ? 'text-danger-text' : 'text-label'),
            )}
          >
            {phone ? (
              <>
                <span className="flex-1 truncate">{it.label}</span>
                {it.icon && <span className="flex w-5 justify-center [&_svg]:w-[19px] [&_svg]:h-[19px]" aria-hidden="true">{it.icon}</span>}
              </>
            ) : (
              <>
                {it.icon && <span className="flex w-4 justify-center [&_svg]:w-[14px] [&_svg]:h-[14px]" aria-hidden="true">{it.icon}</span>}
                <span className="flex-1 truncate">{it.label}</span>
              </>
            )}
            {!phone && it.shortcut && <span className={cn('text-caption', active === i ? 'text-white/80' : 'text-label2')}>{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
