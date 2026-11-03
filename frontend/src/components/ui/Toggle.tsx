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
      className={cn('relative flex-shrink-0 rounded-full transition-colors duration ease-out disabled:opacity-40')}
      style={{ width: w, height: h, background: checked ? (phone ? 'var(--green)' : 'var(--accent)') : 'var(--fill)' }}
    >
      <span
        className="absolute top-[2px] left-[2px] rounded-full bg-white transition-transform duration ease-sheet"
        style={{ width: knob, height: knob, boxShadow: 'var(--shadow-thumb)', transform: checked ? `translateX(${w - h}px)` : 'none' }}
      />
    </button>
  )
}
