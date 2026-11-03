import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/utils'

/* ── Group ──────────────────────────────────────────────── */

interface GroupProps {
  header?:   React.ReactNode
  footer?:   React.ReactNode
  /** Right side of the header (e.g. a "Tout voir" button) */
  action?:   React.ReactNode
  children:  React.ReactNode
  className?: string
  id?:       string
}

/** Inset grouped list (Réglages iOS / macOS): rounded block, hairline separators. */
export function Group({ header, footer, action, children, className, id }: GroupProps) {
  return (
    <section className={cn('min-w-0', className)} aria-labelledby={header && id ? `${id}-h` : undefined}>
      {(header || action) && (
        <div className="flex items-end justify-between gap-3 px-4 max-md:px-4 pb-1.5 min-h-[20px]">
          {header && <h2 id={id ? `${id}-h` : undefined} className="text-subhead text-label2 font-normal">{header}</h2>}
          {action}
        </div>
      )}
      <div className="bg-surface rounded-group overflow-hidden" role="list">
        {children}
      </div>
      {footer && <p className="text-caption text-label2 px-4 pt-1.5">{footer}</p>}
    </section>
  )
}

/* ── ListRow ────────────────────────────────────────────── */

interface ListRowProps {
  title:       React.ReactNode
  subtitle?:   React.ReactNode
  /** Grey value on the right */
  detail?:     React.ReactNode
  /** Leading icon; `iconTone` draws it in a filled square (iOS settings) */
  icon?:       React.ReactNode
  iconTone?:   'accent' | 'gray' | 'green' | 'orange' | 'red' | 'none'
  /** Status dot before the title */
  status?:     'ok' | 'warn' | 'error' | 'off'
  accessory?:  'chevron' | React.ReactNode
  to?:         string
  onClick?:    () => void
  onContextMenu?: (e: React.MouseEvent) => void
  destructive?: boolean
  selected?:   boolean
  disabled?:   boolean
  className?:  string
  /** Text actions / buttons inside the row (not a single click target) */
  children?:   React.ReactNode
  /** Let the subtitle wrap instead of truncating (explanations) */
  wrap?:       boolean
  'aria-label'?: string
}

const TONE: Record<string, string> = {
  accent: 'var(--accent)', gray: 'var(--gray)', green: 'var(--green)', orange: 'var(--orange)', red: 'var(--red)',
}
const DOT: Record<string, string> = { ok: 'var(--green)', warn: 'var(--orange)', error: 'var(--red)', off: 'var(--label-3)' }

/** One line of a grouped list: icon, title, subtitle, value, chevron / control. */
export function ListRow({
  title, subtitle, detail, icon, iconTone = 'none', status, accessory, to, onClick, onContextMenu,
  destructive, selected, disabled, className, children, wrap, ...aria
}: ListRowProps) {
  const interactive = !!(to || onClick)
  const content = (
    <>
      {status && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: DOT[status] }} aria-hidden="true" />}
      {icon && (
        iconTone === 'none'
          ? <span className="flex-shrink-0 text-accent flex [&_svg]:w-[18px] [&_svg]:h-[18px]" aria-hidden="true">{icon}</span>
          : (
            <span
              className="flex-shrink-0 w-[26px] h-[26px] max-md:w-[29px] max-md:h-[29px] rounded-[6px] max-md:rounded-[7px] grid place-items-center text-white [&_svg]:w-[15px] [&_svg]:h-[15px] max-md:[&_svg]:w-[17px] max-md:[&_svg]:h-[17px]"
              style={{ background: TONE[iconTone] }}
              aria-hidden="true"
            >
              {icon}
            </span>
          )
      )}
      <span className="flex-1 min-w-0 py-[7px] max-md:py-[11px]">
        <span className={cn('block truncate', destructive ? 'text-danger-text' : 'text-label')}>{title}</span>
        {subtitle && <span className={cn('block text-subhead text-label2 mt-px', wrap ? 'text-balance' : 'truncate')}>{subtitle}</span>}
      </span>
      {detail != null && detail !== '' && <span className="text-label2 tabular truncate max-w-[45%] text-right">{detail}</span>}
      {children}
      {accessory === 'chevron'
        ? <ChevronRight className="flex-shrink-0 text-label3 -mr-1" size={16} strokeWidth={2} aria-hidden="true" />
        : accessory}
    </>
  )

  const cls = cn(
    'nx-row relative flex items-center gap-3 px-4 min-h-row w-full text-left',
    interactive && !disabled && 'pressable hoverable',
    selected && 'bg-fill',
    disabled && 'opacity-40',
    className,
  )
  // Separator inset like iOS: starts after the icon
  const sep = icon && iconTone !== 'none' ? 'nx-row-inset' : ''

  if (to && !disabled) {
    return <Link to={to} role="listitem" className={cn(cls, sep)} onContextMenu={onContextMenu} {...aria}>{content}</Link>
  }
  if (onClick && !disabled) {
    return (
      <div role="listitem" className="contents">
        <button type="button" className={cn(cls, sep)} onClick={onClick} onContextMenu={onContextMenu} {...aria}>{content}</button>
      </div>
    )
  }
  return <div role="listitem" className={cn(cls, sep)} onContextMenu={onContextMenu} {...aria}>{content}</div>
}
