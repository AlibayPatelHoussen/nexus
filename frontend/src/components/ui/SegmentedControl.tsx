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

/** NSSegmentedControl / UISegmentedControl. */
export default function SegmentedControl<T extends string>({ options, value, onChange, label, full, className }: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex p-[2px] gap-[2px] rounded-[8px] bg-fill', full && 'flex w-full', className)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const i = options.findIndex((o) => o.value === value)
        const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
        onChange(next.value)
        e.preventDefault()
      }}
    >
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
              'min-h-[24px] px-3 rounded-[6px] text-body leading-none whitespace-nowrap transition-[background-color,box-shadow] duration-fast ease-out',
              'max-md:min-h-[30px]',
              full && 'flex-1',
              on ? 'font-medium' : 'text-label',
            )}
            style={on ? { background: 'var(--seg-on, var(--surface))', boxShadow: '0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04)' } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
