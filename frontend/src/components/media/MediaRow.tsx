import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MediaCard from './MediaCard'
import { ROW_CARD_WIDTH } from './layout'
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

/** Netflix-style row: title, horizontally scrolling posters (snap), arrows on desktop. */
export default function MediaRow({ title, items, onSeeAll, isLoading }: MediaRowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  if (!isLoading && items.length === 0) return null

  function scrollBy(dir: 1 | -1) {
    const el = scroller.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <section className="mb-6 sm:mb-8 group/row">
      <div className="flex items-baseline justify-between gap-3 mb-2 sm:mb-3">
        <h2 className="text-[15px] sm:text-[17px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>{title}</h2>
        {onSeeAll && (
          <button className="flex items-center gap-0.5 text-[12px] font-semibold flex-shrink-0" style={{ color: 'var(--blue)' }} onClick={onSeeAll}>
            Tout voir <ChevronRight size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="relative">
        <div
          ref={scroller}
          className="flex gap-2.5 sm:gap-3 overflow-x-auto scrollbar-none snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 lg:scroll-px-0 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 pb-1"
        >
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`${ROW_CARD_WIDTH} flex-shrink-0`}>
                  <div className="w-full aspect-[2/3] rounded-lg animate-pulse" style={{ background: 'var(--surface2)' }} />
                </div>
              ))
            : items.map((x) => isRowItem(x)
                ? <MediaCard key={x.item.id + (x.subtitle ?? '')} item={x.item} progress={x.progress} duration={x.duration} subtitle={x.subtitle} />
                : <MediaCard key={x.id} item={x} />)
          }
        </div>

        {/* Desktop arrows */}
        <button
          className="hidden lg:flex absolute left-0 top-0 bottom-8 w-10 -ml-3 items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity rounded-r-lg"
          style={{ background: 'linear-gradient(to right, var(--bg), transparent)' }}
          onClick={() => scrollBy(-1)}
          aria-label={`Défiler ${title} vers la gauche`}
        >
          <ChevronLeft size={26} style={{ color: 'var(--text)' }} />
        </button>
        <button
          className="hidden lg:flex absolute right-0 top-0 bottom-8 w-10 -mr-3 items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity rounded-l-lg"
          style={{ background: 'linear-gradient(to left, var(--bg), transparent)' }}
          onClick={() => scrollBy(1)}
          aria-label={`Défiler ${title} vers la droite`}
        >
          <ChevronRight size={26} style={{ color: 'var(--text)' }} />
        </button>
      </div>
    </section>
  )
}
