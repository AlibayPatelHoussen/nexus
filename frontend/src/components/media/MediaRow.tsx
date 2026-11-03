import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MediaCard from './MediaCard'
import { ROW_CARD_WIDTH } from './layout'
import Skeleton from '@/components/ui/Skeleton'
import type { MediaItem } from '@/types'

export interface RowItem {
  item:      MediaItem
  progress?: number
  duration?: number
  subtitle?: string
}

interface MediaRowProps {
  title:      string
  items:      (MediaItem | RowItem)[]
  onSeeAll?:  () => void
  isLoading?: boolean
}

const isRowItem = (x: MediaItem | RowItem): x is RowItem => 'item' in x

/** Shelf (TV app): title, "Tout voir", posters scrolling sideways; arrows on hover (desktop). */
export default function MediaRow({ title, items, onSeeAll, isLoading }: MediaRowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  if (!isLoading && items.length === 0) return null

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }
  const arrow = 'hidden lg:grid absolute top-[calc(50%-24px)] -translate-y-1/2 w-8 h-8 place-items-center rounded-full material-bar text-label opacity-0 group-hover/row:opacity-100 transition-opacity duration-fast'

  return (
    <section className="mb-8 group/row" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h2 className="text-headline text-label">{title}</h2>
        {onSeeAll && (
          <button type="button" className="text-subhead text-accent-text hover:underline flex-shrink-0" onClick={onSeeAll}>
            Tout voir
          </button>
        )}
      </div>
      <div className="relative">
        <div
          ref={scroller}
          className="flex gap-3 lg:gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory -mx-4 px-4 scroll-px-4 lg:-mx-6 lg:px-6 lg:scroll-px-6 pb-1"
        >
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`${ROW_CARD_WIDTH} flex-shrink-0`}>
                  <Skeleton className="w-full aspect-[2/3] rounded-[8px]" />
                  <Skeleton className="h-3 w-3/4 mt-2.5" />
                </div>
              ))
            : items.map((x) => isRowItem(x)
                ? <MediaCard key={x.item.id + (x.subtitle ?? '')} item={x.item} progress={x.progress} duration={x.duration} subtitle={x.subtitle} />
                : <MediaCard key={x.id} item={x} />)}
        </div>
        <button type="button" className={`${arrow} -left-2`} style={{ boxShadow: 'var(--shadow-popover)' }} onClick={() => scrollBy(-1)} aria-label={`${title} : précédents`}>
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className={`${arrow} -right-2`} style={{ boxShadow: 'var(--shadow-popover)' }} onClick={() => scrollBy(1)} aria-label={`${title} : suivants`}>
          <ChevronRight size={18} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  )
}
