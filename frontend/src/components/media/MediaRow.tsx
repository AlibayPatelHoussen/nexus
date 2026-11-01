import { ChevronRight } from 'lucide-react'
import MediaCard from './MediaCard'
import type { MediaItem } from '@/types'

interface MediaRowProps {
  title:      string
  items:      MediaItem[]
  onSeeAll?:  () => void
  isLoading?: boolean
}

export default function MediaRow({ title, items, onSeeAll, isLoading }: MediaRowProps) {
  if (!isLoading && items.length === 0) return null

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
        {onSeeAll && (
          <button
            className="flex items-center gap-1 text-[12px] font-medium"
            style={{ color: 'var(--blue)' }}
            onClick={onSeeAll}
          >
            Tout voir <ChevronRight size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Scroll row */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x" style={{ scrollbarWidth: 'none' }}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-[108px] sm:w-[120px] aspect-[12/17] rounded-xl animate-pulse"
                style={{ background: 'var(--surface2)' }}
              />
            ))
          : items.map((item) => <MediaCard key={item.id} item={item} />)
        }
      </div>
    </div>
  )
}
