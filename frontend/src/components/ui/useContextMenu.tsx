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
  const [state, setState] = useState<{ open: boolean; x: number; y: number; items: MenuItem[]; title?: string }>({ open: false, x: 0, y: 0, items: [] })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressed = useRef(false)

  const show = useCallback((x: number, y: number, items: MenuItem[], title?: string) => setState({ open: true, x, y, items, title }), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])

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

  const openFrom = (el: HTMLElement, items: MenuItem[], title?: string) => {
    const r = el.getBoundingClientRect()
    show(r.left, r.bottom + 4, items, title)
  }

  const element = <ContextMenu open={state.open} x={state.x} y={state.y} items={state.items} title={state.title} onClose={close} />

  return { bind, openFrom, element, close }
}
