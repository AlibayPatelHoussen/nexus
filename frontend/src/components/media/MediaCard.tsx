import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CircleMinus, Ellipsis, Play } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { mediaService, type WatchHistoryItem } from '@/services/mediaService'
import type { MediaItem } from '@/types'
import { useContextMenu } from '@/components/ui/useContextMenu'
import { spring } from '@/design/motion'
import { useMediaActions } from './mediaActions'
import Artwork from './Artwork'

interface MediaCardProps {
  item:       MediaItem
  progress?:  number
  duration?:  number
  /** Episode / chapter label (e.g. "S1, É3") */
  subtitle?:  string
  /** poster (2:3, Apple TV shelves and grids) · wide (16:9 "Reprendre") · book (Apple Books cover) */
  shape?:     'poster' | 'wide' | 'book'
  /** Top 10 rank drawn over the artwork */
  rank?:      number
  /** Line over the bottom of the artwork (genre, like Apple TV's Top 10) */
  caption?:   string
  /** Grid cells show the title under the poster (search results) */
  showTitle?: boolean
  /** @deprecated kept for older callers */
  variant?:   'row' | 'grid'
}

/**
 * Apple TV card. Artwork only (14 px corners, a hairline rim); on hover / focus
 * it lifts on a spring with a stronger shadow and a light reflection that
 * follows the pointer (tvOS focus effect). "Reprendre" cards are 16:9 with
 * the progress bar and the episode written over the bottom of the image.
 */
export default function MediaCard({ item, progress, duration, subtitle, shape = 'poster', rank, caption, showTitle, variant }: MediaCardProps) {
  const navigate = useNavigate()
  const menu = useContextMenu()
  const actions = useMediaActions()
  const ref = useRef<HTMLButtonElement>(null)
  const pct = progress && duration ? Math.min(100, Math.round((progress / duration) * 100)) : 0
  const wide = shape === 'wide'
  const book = shape === 'book'
  const grid = showTitle ?? (variant === 'grid' || book)
  const remaining = duration && progress ? Math.max(0, Math.round((duration - progress) / 60)) : null
  const qc = useQueryClient()

  // « Reprendre » cards: « Retirer de Reprendre » (the progress is kept; watching again brings it back)
  const removeFromContinue = async () => {
    const key = ['media', 'continue']
    const before = qc.getQueryData<WatchHistoryItem[]>(key)
    qc.setQueryData<WatchHistoryItem[]>(key, (list) => list?.filter((w) => w.id !== item.id))
    try {
      await mediaService.removeFromContinue(item.id)
    } catch {
      qc.setQueryData(key, before)
      toast.error('Impossible de retirer ce titre de « Reprendre »')
    }
  }
  const menuItems = () => wide
    ? [{ label: 'Retirer de Reprendre', icon: <CircleMinus />, onSelect: () => { void removeFromContinue() } }, { separator: true } as const, ...actions(item)]
    : actions(item)

  // Poster → title page: the artwork grows into the page header (View Transitions API,
  // a plain navigation where the browser has none or reduced motion is on)
  const open = () => {
    const to = wide ? `/player/${item.id}` : `/media/${item.id}`
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
    const art = ref.current?.querySelector<HTMLElement>('[data-art]')
    if (wide || !doc.startViewTransition || !art || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { navigate(to); return }
    art.style.viewTransitionName = 'media-art'
    doc.startViewTransition(() => {
      art.style.viewTransitionName = ''
      flushSync(() => navigate(to))
    })
  }

  // Reflection position (CSS variables, no re-render)
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
  }

  return (
    <div className="relative min-w-0 snap-start group/card">
      <motion.button
        ref={ref}
        type="button"
        className="no-press group relative block w-full text-left rounded-card focus-visible:outline-offset-4"
        onClick={() => open()}
        onPointerMove={onMove}
        whileHover={{ scale: 1.045, y: -2 }}
        whileFocus={{ scale: 1.045 }}
        whileTap={{ scale: 0.97 }}
        transition={spring.lift}
        aria-label={[item.title, subtitle].filter(Boolean).join(', ')}
        {...menu.bind(menuItems(), item.title)}
      >
        <Artwork
          data-art
          src={wide ? (item.backdropPath || item.posterPath) : item.posterPath}
          alt=""
          ratio={wide ? '16 / 9' : '2 / 3'}
          type={item.type}
          title={item.title}
          subtitle={item.year}
          cover={wide}
          className={book
            // Apple Books: a printed cover, small corners, resting on the shelf with a soft shadow
            ? 'w-full rounded-[6px] shadow-[0_6px_16px_-4px_rgba(0,0,0,0.35)] transition-shadow duration-300 group-hover:shadow-[0_18px_36px_-10px_rgba(0,0,0,0.5)]'
            : 'w-full rounded-card transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)] group-focus-visible:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]'}
        >
          {/* Hairline rim (tv.apple.com: 1 px white @16 % + 0.5 px inner shadow); a book's spine light */}
          <span className={book ? 'absolute inset-0 rounded-[6px] pointer-events-none bg-[linear-gradient(90deg,rgba(255,255,255,0.18),transparent_5%,rgba(0,0,0,0.12)_7%,transparent_10%)]' : 'absolute inset-0 rounded-card pointer-events-none shadow-[inset_0_0_0_1px_var(--poster-rim)]'} aria-hidden="true" />
          {/* Specular reflection following the pointer */}
          <span
            className="absolute inset-0 rounded-card pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{ background: 'radial-gradient(circle at var(--mx, 50%) var(--my, 0%), rgba(255,255,255,0.28), rgba(255,255,255,0.06) 38%, transparent 62%)' }}
            aria-hidden="true"
          />
          {rank != null && (
            <span className="absolute left-2.5 top-1 text-[40px] font-bold leading-none text-white tabular [text-shadow:0_2px_12px_rgba(0,0,0,0.45)]" aria-hidden="true">{rank}</span>
          )}
          {(caption || wide) && (
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" aria-hidden="true" />
          )}
          {caption && !wide && (
            <span className="absolute inset-x-0 bottom-5 text-center text-[13px] text-white/70 truncate px-2">{caption}</span>
          )}
          {wide && (
            <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 pb-2.5 text-[13px] font-semibold text-white">
              <Play size={11} strokeWidth={0} fill="currentColor" aria-hidden="true" />
              {pct > 0 && pct < 100 && (
                <span className="w-8 h-[3px] rounded-full bg-white/35 overflow-hidden flex-shrink-0">
                  <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                </span>
              )}
              <span className="truncate">{[subtitle, remaining ? `${remaining} min` : null].filter(Boolean).join(' · ') || 'Reprendre'}</span>
            </span>
          )}
          {!wide && pct > 0 && pct < 100 && (
            <span className="absolute inset-x-2.5 bottom-2.5 h-[3px] rounded-full overflow-hidden bg-white/35">
              <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </span>
          )}
        </Artwork>
        {(wide || grid) && (
          <span className="block mt-2 px-0.5">
            <span className="block text-subhead font-semibold text-label truncate">{item.title}</span>
            {grid && !wide && item.year && <span className="block text-caption text-label2 tabular">{item.year}</span>}
          </span>
        )}
      </motion.button>
      {wide && (
        // Apple TV « … » on an Up Next card: always there on touch, on hover / focus with a mouse
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`Options de « ${item.title} »`}
          className="absolute top-0 right-0 w-11 h-11 grid place-items-center outline-none
            [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/card:opacity-100 focus-visible:opacity-100 transition-opacity duration-fast"
          onClick={(e) => menu.openFrom(e.currentTarget, menuItems(), item.title)}
        >
          <span className="w-7 h-7 grid place-items-center rounded-full glass-clear text-white" aria-hidden="true">
            <Ellipsis size={16} strokeWidth={2.25} />
          </span>
        </button>
      )}
      {menu.element}
    </div>
  )
}
