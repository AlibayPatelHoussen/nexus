import { cn } from '@/utils'

/** Placeholder while loading: a soft block that breathes slowly. */
export default function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-[6px] bg-fill', className)}
      style={{ animation: 'nx-pulse 1.6s ease-in-out infinite', ...style }}
    />
  )
}

/** Rows of a grouped list while loading. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-surface rounded-group px-4" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 min-h-row py-2" style={{ boxShadow: i ? 'inset 0 .5px 0 var(--separator)' : undefined }}>
          <Skeleton className="h-3" style={{ width: `${45 + ((i * 17) % 35)}%` }} />
          <span className="flex-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}
