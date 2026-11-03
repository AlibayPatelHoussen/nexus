import { cn } from '@/utils'

interface EmptyStateProps {
  icon?:     React.ReactNode
  title:     string
  message?:  React.ReactNode
  action?:   React.ReactNode
  className?: string
  /** "error" draws the icon in red (failed load) */
  tone?:     'neutral' | 'error'
}

/** Empty list, failed load, nothing found: one clear sentence and what to do. */
export default function EmptyState({ icon, title, message, action, className, tone = 'neutral' }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center text-center gap-1.5 px-6 py-12', className)} role={tone === 'error' ? 'alert' : 'status'}>
      {icon && (
        <div className={cn('mb-2 [&_svg]:w-10 [&_svg]:h-10', tone === 'error' ? 'text-danger' : 'text-label3')} aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-headline text-label">{title}</p>
      {message && <div className="text-subhead text-label2 max-w-[36ch] text-balance">{message}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
