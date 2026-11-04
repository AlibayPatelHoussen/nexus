import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Play, Plus, Star } from 'lucide-react'
import type { MediaItem } from '@/types'
import { useShell } from '@/components/shell/shellContext'
import { spring } from '@/design/motion'
import { cn } from '@/utils'

interface DetailHeroProps {
  media:      MediaItem
  facts:      string[]
  rating?:    string | null
  playLabel:  string
  canPlay:    boolean
  onPlay:     () => void
  isFav:      boolean | null
  onFav:      () => void
  favBusy?:   boolean
  /** Line above the synopsis: the episode up next */
  upNext?:    string | null
}

const SCRIM = [
  'linear-gradient(80deg, rgba(0,0,0,.62), transparent 58%)',
  'linear-gradient(0deg, rgba(0,0,0,.85) 0%, rgba(0,0,0,.55) 18%, rgba(0,0,0,.2) 40%, transparent 58%)',
  'linear-gradient(180deg, rgba(0,0,0,.5) 0%, transparent 26%)',
].join(', ')

/**
 * Title page header like the Apple TV app: the artwork fills the top of the
 * window (16:9 up to 80 % of its height, portrait key art on iPhone), the
 * title, facts and the white « Lecture » capsule sit over it bottom-left with
 * the round glass « + », the synopsis beside them. The artwork keeps the
 * `media-art` view-transition name: the poster that was clicked grows into it.
 */
export default function DetailHero({ media, facts, rating, playLabel, canPlay, onPlay, isFav, onFav, favBusy, upNext }: DetailHeroProps) {
  const { device } = useShell()
  const phone = device === 'phone'
  const art = useRef<HTMLDivElement>(null)
  const image = phone ? (media.posterPath || media.backdropPath) : (media.backdropPath || media.posterPath)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [image])

  // Parallax (transform only)
  useEffect(() => {
    const target: HTMLElement | Window = phone ? window : (document.getElementById('main') ?? window)
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = target === window ? window.scrollY : (target as HTMLElement).scrollTop
        if (art.current) art.current.style.transform = `translate3d(0, ${Math.min(y, 1000) * 0.4}px, 0)`
      })
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [phone])

  return (
    <section
      aria-label={media.title}
      className="relative overflow-hidden bg-black text-white"
      style={{ height: phone ? 'min(calc(100vw / 0.704), 82svh)' : 'min(calc(100vw * 9 / 16), 80vh)', minHeight: phone ? 500 : 460 }}
    >
      <div ref={art} className="absolute inset-0 will-change-transform">
        {image && !failed
          ? <img src={image} alt="" onError={() => setFailed(true)} className="w-full h-full object-cover" style={{ viewTransitionName: 'media-art', objectPosition: phone ? 'center top' : 'center 25%' }} />
          : <div role="img" aria-label={media.title} className="w-full h-full bg-gradient-to-br from-[#3a3a3c] via-[#1c1c1e] to-black" style={{ viewTransitionName: 'media-art' }} />}
      </div>
      <div className="absolute inset-0 pointer-events-none" style={{ background: SCRIM }} aria-hidden="true" />

      <motion.div
        className={cn(
          'absolute flex',
          phone ? 'inset-x-0 bottom-7 px-[25px] flex-col items-center text-center gap-2.5'
            : 'right-[var(--shelf-x)] bottom-12 items-end gap-12',
        )}
        style={phone ? undefined : { left: 'calc(var(--content-left) + var(--shelf-x))' }}
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.08 }}
      >
        <div className={cn('flex flex-col gap-2.5 min-w-0', phone ? 'items-center' : 'flex-[0_1_560px]')}>
          <h1 className={cn('font-bold leading-[1.04] tracking-[-0.025em] [text-wrap:balance] line-clamp-3', phone ? 'text-[34px]' : 'text-[56px]')}>
            {media.title}
          </h1>
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-[15px] text-white/70 tabular" style={phone ? undefined : { justifyContent: 'flex-start' }}>
            {facts.join(' · ')}
            {rating && <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><Star size={12} strokeWidth={2} aria-hidden="true" />{rating}</span>}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={onPlay}
              disabled={!canPlay}
              className="inline-flex items-center gap-[7px] h-11 px-[30px] min-w-[120px] rounded-pill bg-white/[0.92] text-black/[0.88] text-[15px] font-semibold disabled:opacity-50"
            >
              <Play size={15} strokeWidth={0} fill="currentColor" aria-hidden="true" />
              {playLabel}
            </button>
            <button
              type="button"
              onClick={onFav}
              disabled={favBusy}
              aria-pressed={isFav === true}
              className="w-11 h-11 grid place-items-center rounded-full glass-clear"
              aria-label={isFav ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
              title={isFav ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
            >
              {isFav ? <Check size={19} strokeWidth={2.25} /> : <Plus size={20} strokeWidth={2.25} />}
            </button>
          </div>
        </div>
        {!phone && (media.overview || upNext) && (
          <div className="flex-[0_1_420px] min-w-0 pb-1">
            {upNext && <p className="text-[15px] font-semibold text-white/90 mb-1.5">{upNext}</p>}
            {media.overview && <p className="text-[15px] leading-[21px] text-white/75 line-clamp-5">{media.overview}</p>}
          </div>
        )}
      </motion.div>
    </section>
  )
}
