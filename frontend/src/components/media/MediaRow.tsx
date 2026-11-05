import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MediaCard from './MediaCard'
import Skeleton from '@/components/ui/Skeleton'
import type { MediaItem } from '@/types'
import { cn } from '@/utils'

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
  /** poster shelf · wide 16:9 cards ("Reprendre") · top10 (big ranks + genre) */
  kind?:      'poster' | 'wide' | 'top10' | 'book'
}

const isRowItem = (x: MediaItem | RowItem): x is RowItem => 'item' in x

/**
 * Apple TV shelf (measured on tv.apple.com): 17 pt bold title with a chevron
 * when it opens a list, 14 px above the cards, cards in a horizontal grid that
 * snaps (8 posters across 1440 px, ~2.4 on iPhone at 144 px), 20 px gaps
 * (10 on iPhone), page gutter 40 / 25 px; chevron buttons appear on hover.
 */
export default function MediaRow({ title, items, onSeeAll, isLoading, kind = 'poster' }: MediaRowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  if (!isLoading && items.length === 0) return null

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: dir * (el.clientWidth - 80), behavior: 'smooth' })
  }
  const arrow = 'no-press hidden lg:grid absolute top-0 bottom-0 w-10 place-items-center text-label2 opacity-0 group-hover/row:opacity-100 hover:text-label transition-opacity duration-200 z-10'
  const Heading = onSeeAll ? 'button' : 'span'

  return (
    <section className={cn('shelf group/row', kind === 'wide' ? 'shelf--wide' : 'shelf--poster')} aria-label={title}>
      <h2 className="shelf__title">
        <Heading
          {...(onSeeAll ? { type: 'button' as const, onClick: onSeeAll, title: `Tout voir : ${title}` } : {})}
          className={cn('inline-flex items-center gap-0.5 text-[17px] md:text-[19px] font-bold leading-[22px] text-label', onSeeAll && 'no-press hover:opacity-70')}
        >
          {title}
          {onSeeAll && <ChevronRight size={20} strokeWidth={2.5} className="text-label2 translate-y-px" aria-hidden="true" />}
        </Heading>
      </h2>
      <div className="relative">
        <div ref={scroller} className="shelf__scroller scrollbar-none">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className={cn('w-full rounded-card', kind === 'wide' ? 'aspect-video' : 'aspect-[2/3]')} />
              ))
            : items.map((x, i) => {
                const r = isRowItem(x) ? x : { item: x }
                return (
                  <MediaCard
                    key={r.item.id + (r.subtitle ?? '')}
                    item={r.item} progress={r.progress} duration={r.duration} subtitle={r.subtitle}
                    shape={kind === 'wide' ? 'wide' : kind === 'book' ? 'book' : 'poster'}
                    rank={kind === 'top10' ? i + 1 : undefined}
                    caption={kind === 'top10'
                      ? (r.item.imdbRating != null ? `IMDb ${r.item.imdbRating.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : r.item.genres?.[0])
                      : undefined}
                  />
                )
              })}
        </div>
        <button type="button" className={`${arrow} left-0`} onClick={() => scrollBy(-1)} aria-label={`${title} : précédents`}>
          <ChevronLeft size={30} strokeWidth={1.5} />
        </button>
        <button type="button" className={`${arrow} right-0`} onClick={() => scrollBy(1)} aria-label={`${title} : suivants`}>
          <ChevronRight size={30} strokeWidth={1.5} />
        </button>
      </div>
    </section>
  )
}
