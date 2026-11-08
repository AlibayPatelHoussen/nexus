import { useCallback, useRef, useState } from 'react'
import ContextMenu, { type MenuItem } from './ContextMenu'

/**
 * Right click (desktop) or long press (touch) on an element opens its menu.
 * `openFrom(button)` opens it from a "…" button.
 *
 *   const menu = useContextMenu()
 *   <div {...menu.bind(items)}>…</div>   {menu.element}
 */
export function useContextMenu() {
  const [state, setState] = useState<{ open: boolean; x: number; y: number; items: MenuItem[]; title?: string; above?: number; alignEnd?: boolean }>({ open: false, x: 0, y: 0, items: [] })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressed = useRef(false)

  const show = useCallback((x: number, y: number, items: MenuItem[], title?: string) => setState({ open: true, x, y, items, title }), [])
  const closedAt = useRef(0)
  const close = useCallback(() => { closedAt.current = Date.now(); setState((s) => ({ ...s, open: false })) }, [])

  const bind = (items: MenuItem[], title?: string) => ({
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); show(e.clientX, e.clientY, items, title) },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      pressed.current = false
      timer.current = setTimeout(() => { pressed.current = true; navigator.vibrate?.(10); show(t.clientX, t.clientY, items, title) }, 500)
    },
    onTouchMove: () => { if (timer.current) clearTimeout(timer.current) },
    onTouchEnd: (e: React.TouchEvent) => {
      if (timer.current) clearTimeout(timer.current)
      // A long press must not also "click" the item
      if (pressed.current) { e.preventDefault(); pressed.current = false }
    },
  })

  /** From a "…" button: the menu grows out of it (aligned on its right edge when it sits on the right) */
  const openFrom = (el: HTMLElement, items: MenuItem[], title?: string) => {
    // A tap on the button while its menu is open closes it (the outside press already did)
    if (Date.now() - closedAt.current < 300) return
    const r = el.getBoundingClientRect()
    const alignEnd = r.left + r.width / 2 > window.innerWidth / 2
    setState({ open: true, x: alignEnd ? r.right : r.left, y: r.bottom + 6, items, title, above: r.top, alignEnd })
  }

  const element = (
    <ContextMenu open={state.open} x={state.x} y={state.y} items={state.items} title={state.title}
      above={state.above} alignEnd={state.alignEnd} onClose={close} />
  )

  return { bind, openFrom, element, close }
}
