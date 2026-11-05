import type { InputHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import { useShell } from '@/components/shell/shellContext'
import { cn } from '@/utils'

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value:     string
  onChange:  (value: string) => void
  /** Accessible name when no visible label (also the placeholder's meaning) */
  label:     string
  className?: string
}

/**
 * The iOS 26 / macOS 26 search field: a capsule filled with the system fill,
 * magnifying glass on the left, round « clear » button on the right.
 * 36 pt with 17 pt text on iPhone, 28 pt with 13 pt text on the Mac.
 */
export default function SearchField({ value, onChange, label, className, placeholder = 'Rechercher', ...rest }: SearchFieldProps) {
  const { device } = useShell()
  const phone = device === 'phone'
  return (
    <label className={cn('relative flex items-center', className)}>
      <span className="sr-only">{label}</span>
      <Search size={phone ? 16 : 13} strokeWidth={1.75} className={cn('absolute text-label2 pointer-events-none', phone ? 'left-3' : 'left-2.5')} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-pill bg-fill text-label placeholder:text-label2 outline-none',
          'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_35%,transparent)] [&::-webkit-search-cancel-button]:appearance-none',
          phone ? 'h-9 pl-9 pr-9 text-[17px]' : 'h-[28px] pl-[28px] pr-[26px] text-body',
        )}
        {...rest}
      />
      {value && (
        <button
          type="button"
          className={cn('absolute w-5 h-5 grid place-items-center rounded-full bg-label3 text-surface', phone ? 'right-2.5' : 'right-1.5')}
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </label>
  )
}
