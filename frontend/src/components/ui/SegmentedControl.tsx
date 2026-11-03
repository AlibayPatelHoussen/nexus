import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/utils'

interface Option<T extends string> { value: T; label: React.ReactNode; title?: string }

interface SegmentedControlProps<T extends string> {
  options:   Option<T>[]
  value:     T
  onChange:  (value: T) => void
  label:     string          // accessible name of the group
  /** Stretch over the available width (iOS) */
  full?:     boolean
  className?: string
}

/** NSSegmentedControl / UISegmentedControl: the selected segment's thumb slides to the new choice. */
export default function SegmentedControl<T extends string>({ options, value, onChange, label, full, className }: SegmentedControlProps<T>) {
  const box = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number; animate: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const place = (animate: boolean) => {
      const on = el.querySelector<HTMLElement>('[aria-checked="true"]')
      setThumb((t) => on ? { x: on.offsetLeft, w: on.offsetWidth, animate: animate && !!t } : null)
    }
    place(true)
    if (typeof ResizeObserver === 'undefined') return
    let first = true   // observe() reports the current size at once: not a resize
    const ro = new ResizeObserver(() => { if (first) first = false; else place(false) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [value, options.length])
  return (
    <div
      ref={box}
      role="radiogroup"
      aria-label={label}
      className={cn('relative inline-flex p-[2px] gap-[2px] rounded-[8px] bg-fill', full && 'flex w-full', className)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const i = options.findIndex((o) => o.value === value)
        const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
        onChange(next.value)
        e.preventDefault()
      }}
    >
      {thumb && (
        <span
          aria-hidden="true"
          className="absolute top-[2px] bottom-[2px] left-0 rounded-[6px] pointer-events-none"
          style={{
            width: thumb.w, transform: `translateX(${thumb.x}px)`,
            transition: thumb.animate ? 'transform 320ms var(--ease-sheet), width 320ms var(--ease-sheet)' : 'none',
            background: 'var(--seg-on, var(--surface))', boxShadow: '0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04)',
          }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative min-h-[24px] px-3 rounded-[6px] text-body leading-none whitespace-nowrap transition-opacity duration-fast ease-out active:opacity-60',
              'max-md:min-h-[30px]',
              full && 'flex-1',
              on ? 'font-medium' : 'text-label',
            )}
            // Before the first measure (and in tests) the selected segment draws its own thumb
            style={on && !thumb ? { background: 'var(--seg-on, var(--surface))', boxShadow: '0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04)' } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
