import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'
import ActionSheet from './ActionSheet'

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
  onClose: () => void
}

/**
 * Menu that takes the native shape:
 * - desktop: macOS contextual menu at the pointer, keyboard navigable
 * - phone: iOS action sheet with the same items
 */
export default function ContextMenu({ open, x, y, items, title, onClose }: ContextMenuProps) {
  const phone = useDevice() === 'phone'
  if (phone) {
    const actions = items.flatMap((i) => ('separator' in i ? [] : [{ label: i.label, onSelect: i.onSelect, destructive: i.destructive, disabled: i.disabled }]))
    return <ActionSheet open={open} onClose={onClose} title={title} actions={actions} />
  }
  return open ? <Popover x={x} y={y} items={items} onClose={onClose} title={title} /> : null
}

function Popover({ x, y, items, title, onClose }: Omit<ContextMenuProps, 'open'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [active, setActive] = useState(-1)
  const choices = items.map((it, i) => ({ it, i })).filter(({ it }) => !('separator' in it) && !it.disabled)

  // Keep inside the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(6, Math.min(x, window.innerWidth - r.width - 6)),
      top:  y + r.height > window.innerHeight - 6 ? Math.max(6, y - r.height) : y,
    })
    el.focus()
  }, [x, y])

  useEffect(() => {
    const close = () => onClose()
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('mousedown', onDown, true)
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
      className="fixed z-[120] min-w-[200px] max-w-[300px] p-[5px] rounded-[8px] material-bar text-body outline-none"
      style={{ ...pos, boxShadow: 'var(--shadow-popover)', animation: 'nx-menu-in 220ms var(--ease-spring) both', transformOrigin: 'top left' }}
    >
      {items.map((it, i) =>
        'separator' in it ? (
          <div key={`s${i}`} role="separator" className="my-[5px] mx-2 h-px" style={{ background: 'var(--separator)' }} />
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
              'w-full flex items-center gap-2 px-2.5 py-[3px] rounded-[4px] text-left disabled:opacity-40',
              active === i ? 'bg-accent text-white' : it.destructive ? 'text-danger-text' : 'text-label',
            )}
          >
            {it.icon && <span className="flex w-4 justify-center [&_svg]:w-[14px] [&_svg]:h-[14px]" aria-hidden="true">{it.icon}</span>}
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className={cn('text-caption', active === i ? 'text-white/80' : 'text-label2')}>{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
