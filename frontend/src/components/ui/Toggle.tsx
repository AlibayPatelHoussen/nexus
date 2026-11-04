import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'

interface ToggleProps {
  checked:   boolean
  onChange:  (checked: boolean) => void
  label:     string            // accessible name
  disabled?: boolean
  id?:       string
}

/**
 * iOS 26 switch (Apple's kit "Toggle – Switch"): a 64 × 28 capsule with a
 * 38 × 24 capsule knob. While pressed the knob turns into clear Liquid Glass,
 * grows (58 × 38 in the kit) and overflows the track; it slides on a spring.
 * Desktop: the same shape at macOS size.
 */
export default function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  const phone = useDevice() === 'phone'
  const w = phone ? 64 : 42
  const h = phone ? 28 : 22
  const kw = phone ? 38 : 26          // knob width
  const kh = h - 4                    // knob height
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('group relative flex-shrink-0 rounded-pill transition-colors duration ease-out disabled:opacity-40 no-press')}
      style={{ width: w, height: h, background: checked ? 'var(--green)' : 'var(--fill)' }}
    >
      <span
        className={cn(
          'absolute top-[2px] left-[2px] rounded-pill bg-white',
          'transition-[transform,background-color,box-shadow,scale] duration-slow',
          '[transform:translateX(var(--x))] [transition-timing-function:var(--ease-spring)]',
          // Pressed: clear glass, larger, overflowing the track
          'group-enabled:group-active:scale-x-[1.5] group-enabled:group-active:scale-y-[1.58] group-enabled:group-active:bg-white/10',
          'group-enabled:group-active:shadow-[0_0_0_0.5px_#ccc,inset_0_1px_0_rgba(255,255,255,0.7),0_4px_10px_rgba(0,0,0,0.18)]',
        )}
        style={{
          width: kw, height: kh, boxShadow: 'var(--shadow-thumb)',
          ['--x' as string]: `${checked ? w - kw - 4 : 0}px`,
        }}
      />
    </button>
  )
}
