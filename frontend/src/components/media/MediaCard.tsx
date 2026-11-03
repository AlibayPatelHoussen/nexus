import { useNavigate } from 'react-router-dom'
import { Star } from 'lucide-react'
import type { MediaItem } from '@/types'
import { useContextMenu } from '@/components/ui/useContextMenu'
import { rating, useMediaActions } from './mediaActions'
import { cn } from '@/utils'
import { ROW_CARD_WIDTH } from './layout'
import Artwork from './Artwork'

interface MediaCardProps {
  item:       MediaItem
  progress?:  number
  duration?:  number
  /** Small label under the title (e.g. "S1 · É3") */
  subtitle?:  string
  /** row: fixed responsive width for horizontal shelves · grid: fills its grid cell */
  variant?:   'row' | 'grid'
}

/** Poster like the TV app: the whole artwork, title and year underneath. */
export default function MediaCard({ item, progress, duration, subtitle, variant = 'row' }: MediaCardProps) {
  const navigate = useNavigate()
  const menu = useContextMenu()
  const actions = useMediaActions()
  const pct = progress && duration ? Math.round((progress / duration) * 100) : 0
  const r = rating(item.rating)

  return (
    <div className={cn(variant === 'grid' ? 'w-full min-w-0' : `${ROW_CARD_WIDTH} flex-shrink-0 snap-start`)}>
      <button
        type="button"
        className="group block w-full text-left rounded-[10px] focus-visible:outline-offset-4"
        onClick={() => navigate(`/media/${item.id}`)}
        aria-label={item.title}
        {...menu.bind(actions(item), item.title)}
      >
        <Artwork
          src={item.posterPath}
          alt=""
          type={item.type}
          title={item.title}
          subtitle={item.year}
          className="w-full rounded-[8px] transition-transform duration ease-out lg:group-hover:scale-[1.03] lg:group-active:scale-[0.99]"
        >
          <span className="absolute inset-0 rounded-[8px] pointer-events-none" style={{ boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.12)' }} />
          {pct > 0 && pct < 100 && (
            <span className="absolute inset-x-2 bottom-2 h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.45)' }}>
              <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </span>
          )}
        </Artwork>
        <span className="block mt-2 text-subhead font-medium text-label truncate">{item.title}</span>
        <span className="flex items-center gap-1 text-caption text-label2 truncate tabular">
          {subtitle ?? item.year ?? ' '}
          {r && !subtitle && <><span aria-hidden="true">·</span><Star size={10} strokeWidth={1.75} aria-hidden="true" />{r}</>}
        </span>
      </button>
      {menu.element}
    </div>
  )
}
