import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'

interface ToggleProps {
  checked:   boolean
  onChange:  (checked: boolean) => void
  label:     string            // accessible name
  disabled?: boolean
  id?:       string
}

/** Switch: iOS size on phones, AppKit "mini switch" on desktop. */
export default function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  const phone = useDevice() === 'phone'
  const w = phone ? 51 : 38
  const h = phone ? 31 : 22
  const knob = h - 4
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('group relative flex-shrink-0 rounded-full transition-colors duration ease-out disabled:opacity-40 no-press')}
      style={{ width: w, height: h, background: checked ? (phone ? 'var(--green)' : 'var(--accent)') : 'var(--fill)' }}
    >
      <span
        // The knob slides with a spring and stretches while pressed (iOS)
        className="absolute top-[2px] left-[2px] rounded-full bg-white w-[var(--knob)] transition-[transform,width] duration-slow ease-sheet [transform:translateX(var(--x))] group-active:w-[var(--knob-press)] group-active:[transform:translateX(var(--x-press))] group-disabled:!w-[var(--knob)]"
        style={{
          height: knob, boxShadow: 'var(--shadow-thumb)',
          ['--knob' as string]: `${knob}px`, ['--knob-press' as string]: `${knob + 6}px`,
          ['--x' as string]: `${checked ? w - h : 0}px`, ['--x-press' as string]: `${checked ? w - h - 6 : 0}px`,
        }}
      />
    </button>
  )
}
