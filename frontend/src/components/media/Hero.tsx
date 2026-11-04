import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Info, Play, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import type { MediaItem } from '@/types'
import { mediaService } from '@/services/mediaService'
import { useShell } from '@/components/shell/shellContext'
import { spring } from '@/design/motion'
import { cn } from '@/utils'
import { isReading } from './mediaActions'

const TYPE_LABEL: Record<string, string> = {
  film: 'Film', serie: 'Série', anime: 'Anime', manga: 'Manga', webtoon: 'Webtoon',
}
const ROTATE_MS = 8000

/*
 * The Apple TV billboard (measured on tv.apple.com): full-bleed artwork,
 * 16:9 up to 90 % of the window (portrait key art ~0.7 on iPhone), three
 * gradient layers for legible white text, title + one line of facts +
 * synopsis bottom-left, a white "Lecture" capsule (40 px) and a round glass
 * "+" (clear Liquid Glass over media). Carousel with cross-fade, pagination
 * dots on a 20 px pitch; the artwork moves slower than the page (parallax).
 */
const SCRIM = [
  'linear-gradient(80deg, rgba(0,0,0,.5), transparent 52%)',
  'linear-gradient(0deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.5) 12%, rgba(0,0,0,.27) 24%, rgba(0,0,0,.09) 36%, transparent 46%)',
  'linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,.18) 18%, transparent 34%)',
].join(', ')

export default function Hero({ items }: { items: MediaItem[] }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { device } = useShell()
  const phone = device === 'phone'
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [favs, setFavs] = useState<Record<string, boolean>>({})
  const art = useRef<HTMLDivElement>(null)
  const count = items.length
  const item = items[Math.min(index, count - 1)]

  // Auto-advance (paused while hovered / focused, and when reduced motion is on)
  useEffect(() => {
    if (count < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), ROTATE_MS)
    return () => clearTimeout(t)
  }, [index, count, paused])

  // Parallax: the artwork scrolls at 60 % of the page speed (transform only)
  useEffect(() => {
    const scroller: HTMLElement | Window = document.getElementById('main') ?? window
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop
        if (art.current) art.current.style.transform = `translate3d(0, ${Math.min(y, 1200) * 0.4}px, 0)`
      })
    }
    const target = phone ? window : scroller
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [phone])

  const toggleFav = useCallback(async (it: MediaItem) => {
    try {
      const on = await mediaService.toggleFavorite(it.id)
      setFavs((f) => ({ ...f, [it.id]: on }))
      toast.success(on ? 'Ajouté aux favoris' : 'Retiré des favoris')
      void qc.invalidateQueries({ queryKey: ['media'] })
    } catch { toast.error('Impossible de modifier les favoris.') }
  }, [qc])

  if (!item) return null
  const reading = isReading(item.type)
  const image = phone ? (item.posterPath || item.backdropPath) : (item.backdropPath || item.posterPath)
  const facts = [TYPE_LABEL[item.type] ?? item.type, item.year, ...(item.genres?.slice(0, 2) ?? [])].filter(Boolean).join(' · ')
  const fav = favs[item.id] ?? !!(item as MediaItem & { isFavorite?: boolean }).isFavorite

  return (
    <section
      aria-roledescription="carrousel"
      aria-label="À la une"
      className="relative overflow-hidden bg-black text-white select-none"
      style={{ height: phone ? 'min(calc(100vw / 0.704), 86svh)' : 'min(calc(100vw * 9 / 16), 90vh)', minHeight: phone ? 480 : 440 }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    >
      <div ref={art} className="absolute inset-0 will-change-transform">
        <AnimatePresence initial={false}>
          <motion.div
            key={item.id}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.9, ease: [0, 0, 0.2, 1] }, scale: { duration: 8, ease: 'linear' } }}
          >
            {image
              ? <img src={image} alt="" className="w-full h-full object-cover" style={{ objectPosition: phone ? 'center top' : 'center 25%' }} />
              : <div className="w-full h-full bg-gradient-to-br from-[#2c2c2e] to-black" />}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="absolute inset-0 pointer-events-none" style={{ background: SCRIM }} aria-hidden="true" />

      {/* Lockup: title, facts, synopsis, actions */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={item.id}
          className={cn(
            'absolute flex flex-col gap-2.5',
            phone ? 'inset-x-0 bottom-12 px-[25px] items-center text-center' : 'bottom-[72px] max-w-[min(520px,40vw)]',
          )}
          style={phone ? undefined : { left: 'calc(var(--content-left) + var(--shelf-x))' }}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={spring.soft}
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-white/70">À la une</p>
          <h2 className={cn('font-bold leading-[1.05] tracking-[-0.025em] text-white line-clamp-2 [text-wrap:balance]', phone ? 'text-[34px]' : 'text-[52px]')}>
            {item.title}
          </h2>
          <p className="text-[15px] text-white/70">{facts}</p>
          {item.overview && !phone && (
            <p className="text-[15px] leading-[20.8px] text-white/70 line-clamp-3 max-w-[410px]">{item.overview}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => navigate(reading ? `/media/${item.id}` : `/player/${item.id}`)}
              className="inline-flex items-center gap-[7px] h-10 px-[30px] min-w-[100px] rounded-pill bg-white/[0.92] text-black/[0.88] text-[15px] font-semibold"
            >
              <Play size={15} strokeWidth={0} fill="currentColor" aria-hidden="true" />
              {reading ? 'Lire' : 'Lecture'}
            </button>
            <button
              type="button"
              onClick={() => void toggleFav(item)}
              className="w-10 h-10 grid place-items-center rounded-full glass-clear"
              aria-label={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
              {fav ? <Check size={18} strokeWidth={2.25} /> : <Plus size={19} strokeWidth={2.25} />}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/media/${item.id}`)}
              className="w-10 h-10 grid place-items-center rounded-full glass-clear"
              aria-label="Plus d’infos" title="Plus d’infos"
            >
              <Info size={18} strokeWidth={2} />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Pagination: 20 px pitch, 8 px dots (active 9 px, white) */}
      {count > 1 && (
        <div className={cn('absolute flex justify-center bottom-5', phone ? 'inset-x-0 bottom-4' : 'right-0')} style={phone ? undefined : { left: 'var(--content-left)' }} role="tablist" aria-label="Titres à la une">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={it.title}
              onClick={() => setIndex(i)}
              className="no-press w-5 h-5 grid place-items-center group"
            >
              <span className={cn(
                'block rounded-full transition-[transform,background-color] duration-300',
                i === index ? 'w-[9px] h-[9px] bg-white' : 'w-2 h-2 bg-white/30 group-hover:bg-white/40',
              )} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
