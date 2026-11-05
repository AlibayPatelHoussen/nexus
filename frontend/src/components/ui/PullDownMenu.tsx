import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { useShell } from '@/components/shell/shellContext'
import { spring } from '@/design/motion'
import { cn } from '@/utils'

export interface PullDownOption<T extends string | number> {
  value: T
  label: string
}

interface PullDownMenuProps<T extends string | number> {
  value:    T
  options:  PullDownOption<T>[]
  onChange: (value: T) => void
  /** Accessible name of the menu */
  label:    string
  /** The control that opens the menu (rendered inside the trigger button) */
  children: ReactNode
  className?: string
}

/**
 * iOS 26 / macOS 26 pull-down menu: the button opens a Liquid Glass panel
 * that grows out of it on a spring (above it when there is no room below),
 * the chosen item carries a checkmark. Keyboard: arrows, Enter, Escape.
 */
export default function PullDownMenu<T extends string | number>({ value, options, onChange, label, children, className }: PullDownMenuProps<T>) {
  const { device } = useShell()
  const phone = device === 'phone'
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; up: boolean }>({ left: 0, top: 0, up: false })
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const r = trigger.current.getBoundingClientRect()
    const h = Math.min(options.length * (phone ? 44 : 30) + 16, window.innerHeight * 0.6)
    const up = r.bottom + 8 + h > window.innerHeight - 90 && r.top - 8 - h > 0
    const left = Math.max(12, Math.min(r.left - (phone ? 6 : 4), window.innerWidth - (phone ? 262 : 222)))
    setPos(up ? { left, bottom: window.innerHeight - r.top + 8, up } : { left, top: r.bottom + 8, up })
    setActive(options.findIndex((o) => o.value === value))
  }, [open, options, value, phone])

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('resize', close) }
  }, [open])

  const choose = (v: T) => { setOpen(false); onChange(v); trigger.current?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { setActive((a) => (a + 1) % options.length); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setActive((a) => (a - 1 + options.length) % options.length); e.preventDefault() }
    else if (e.key === 'Enter' || e.key === ' ') { if (options[active]) choose(options[active].value); e.preventDefault() }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); trigger.current?.focus(); e.preventDefault() }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} : ${options.find((o) => o.value === value)?.label ?? ''}`}
        className={cn('inline-flex items-center gap-1.5 rounded-pill outline-none focus-visible:ring-2 focus-visible:ring-accent', className)}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panel}
              role="menu"
              aria-label={label}
              tabIndex={-1}
              onKeyDown={onKey}
              className={cn(
                'fixed z-[120] glass-strong outline-none overflow-y-auto overscroll-contain',
                phone ? 'w-[250px] p-2 rounded-[26px] max-h-[60vh]' : 'min-w-[200px] max-w-[260px] p-[6px] rounded-[16px] max-h-[60vh]',
              )}
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, transformOrigin: pos.up ? 'bottom left' : 'top left' }}
              initial={{ opacity: 0, scale: 0.6, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)', transition: { duration: 0.15 } }}
              transition={spring.sheet}
            >
              {options.map((o, i) => (
                <button
                  key={String(o.value)}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                  className={cn(
                    'w-full flex items-center gap-2 text-left text-label',
                    phone ? 'min-h-[44px] px-4 rounded-[18px] text-[17px] active:bg-[var(--glass-hover)]' : 'px-2.5 py-[5px] rounded-[10px] text-body',
                    !phone && active === i && 'bg-accent text-white',
                    phone && active === i && 'bg-[var(--glass-hover)]',
                  )}
                >
                  <span className="w-4 flex justify-center flex-shrink-0" aria-hidden="true">
                    {o.value === value && <Check size={phone ? 16 : 13} strokeWidth={2.5} />}
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
