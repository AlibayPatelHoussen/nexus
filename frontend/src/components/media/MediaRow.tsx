import { ChevronRight } from 'lucide-react'
import MediaCard from './MediaCard'
import { MEDIA_SHELF } from './layout'
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
      <div className={MEDIA_SHELF}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="w-full lg:w-[120px] lg:flex-shrink-0 aspect-[12/17] rounded-xl animate-pulse"
                style={{ background: 'var(--surface2)' }}
              />
            ))
          : items.map((item) => <MediaCard key={item.id} item={item} adaptive />)
        }
      </div>
    </div>
  )
}
