import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Play, Plus, Star } from 'lucide-react'
import type { MediaItem } from '@/types'
import { useShell } from '@/components/shell/shellContext'
import { spring } from '@/design/motion'
import { cn } from '@/utils'
import TitleLogo from './TitleLogo'

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
const TYPE_LABEL: Record<string, string> = { film: 'Film', serie: 'Série', anime: 'Anime', manga: 'Manga', webtoon: 'Webtoon' }

/** Two lines of synopsis; « PLUS » (a small glass capsule over the faded end of the text) shows the rest. */
function Synopsis({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])
  const fade = !open && clipped
    ? 'linear-gradient(#000,#000) top / 100% calc(100% - 1lh) no-repeat, linear-gradient(to left, transparent 64px, #000 104px) bottom / 100% 1lh no-repeat'
    : undefined
  return (
    <div className="relative">
      <p ref={ref} className={cn(!open && 'line-clamp-2')} style={fade ? { mask: fade, WebkitMask: fade } : undefined}>{text}</p>
      {clipped && !open && (
        <button type="button" onClick={() => setOpen(true)}
          className="absolute right-0 bottom-0 h-[22px] px-2.5 rounded-pill glass-clear text-[13px] font-bold tracking-[0.02em] text-white"
          aria-label="Afficher tout le synopsis">
          PLUS
        </button>
      )}
    </div>
  )
}

const SCRIM_PHONE = [
  'linear-gradient(0deg, rgba(0,0,0,.82) 0%, rgba(0,0,0,.62) 26%, rgba(0,0,0,.25) 46%, transparent 62%)',
  'linear-gradient(180deg, rgba(0,0,0,.35) 0%, transparent 18%)',
].join(', ')
const BLUR_MASK = 'linear-gradient(0deg, #000 0%, #000 30%, transparent 52%)'

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
  const image = phone ? (media.keyArtPath || media.posterPath || media.backdropPath) : (media.heroBackdropPath || media.backdropPath || media.posterPath)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [image])

  // iPhone lines (Apple TV): « Série · Action · Aventure », then « 1999 · 2 saisons ★ 8,5 » and badges
  const kinds = [TYPE_LABEL[media.type], ...(media.genres?.slice(0, 2) ?? [])].filter(Boolean) as string[]
  const meta = [...facts.filter((f) => f !== TYPE_LABEL[media.type]), ...(rating ? [`★ ${rating}`] : [])]
  const badges = [media.language ? media.language.toUpperCase() : null].filter(Boolean) as string[]

  const favButton = (size: string) => (
    <motion.button
      type="button"
      onClick={onFav}
      disabled={favBusy}
      aria-pressed={isFav === true}
      whileTap={{ scale: 0.9 }}
      transition={spring.press}
      className={cn(size, 'flex-shrink-0 grid place-items-center rounded-full glass-clear')}
      aria-label={isFav ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
      title={isFav ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
    >
      {isFav ? <Check size={phone ? 22 : 19} strokeWidth={2.25} /> : <Plus size={phone ? 24 : 20} strokeWidth={2.25} />}
    </motion.button>
  )

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
      style={{ height: phone ? 'max(560px, min(calc(100vw / 0.65), 80svh))' : 'min(calc(100vw * 9 / 16), 80vh)', minHeight: phone ? 560 : 460 }}
    >
      <div ref={art} className="absolute inset-0 will-change-transform">
        {image && !failed
          ? <img src={image} alt="" onError={() => setFailed(true)} className="w-full h-full object-cover" style={{ viewTransitionName: 'media-art', objectPosition: phone ? 'center top' : 'center 25%' }} />
          : <div role="img" aria-label={media.title} className="w-full h-full bg-gradient-to-br from-[#3a3a3c] via-[#1c1c1e] to-black" style={{ viewTransitionName: 'media-art' }} />}
      </div>
      {/* iPhone (Apple TV): under the text the artwork goes progressively blurred and dark */}
      {phone && <div className="absolute inset-0 pointer-events-none backdrop-blur-2xl" style={{ maskImage: BLUR_MASK, WebkitMaskImage: BLUR_MASK }} aria-hidden="true" />}
      <div className="absolute inset-0 pointer-events-none" style={{ background: phone ? SCRIM_PHONE : SCRIM }} aria-hidden="true" />

      {phone ? (
        <motion.div
          className="absolute inset-x-0 bottom-6 px-[var(--shelf-x)] flex flex-col"
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.08 }}
        >
          <h1 className="self-center text-center text-[36px] font-extrabold leading-[1.02] tracking-[-0.03em] [text-wrap:balance]">
            <TitleLogo title={media.title} logo={media.logoPath} className="line-clamp-3" logoClassName="block mx-auto max-h-[112px] max-w-[80vw]" />
          </h1>
          {kinds.length > 0 && <p className="self-center text-center text-[17px] text-white/85 mt-2">{kinds.join(' · ')}</p>}
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={onPlay}
              disabled={!canPlay}
              className="flex-1 inline-flex items-center justify-center gap-2 h-[50px] px-5 rounded-pill bg-white/[0.94] text-black/[0.9] text-[17px] font-semibold disabled:opacity-50 min-w-0"
            >
              <Play size={18} strokeWidth={0} fill="currentColor" aria-hidden="true" className="flex-shrink-0" />
              <span className="truncate">{playLabel}</span>
            </button>
            {favButton('w-[50px] h-[50px]')}
          </div>
          {(upNext || media.overview) && (
            <div className="mt-4 text-[15px] leading-[20px] text-white/80">
              {upNext && <p className="font-semibold text-white mb-0.5">{upNext}</p>}
              {media.overview && <Synopsis text={media.overview} />}
            </div>
          )}
          {(meta.length > 0 || badges.length > 0) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 text-[15px] text-white/70 tabular">
              {meta.length > 0 && <span>{meta.join(' · ')}</span>}
              {badges.map((b) => (
                <span key={b} className="inline-flex items-center gap-0.5 h-[18px] px-1 rounded-[4px] border-[1.5px] border-white/60 text-[11px] font-bold leading-none text-white/80">{b}</span>
              ))}
            </p>
          )}
        </motion.div>
      ) : (
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
            <h1 className={cn('font-bold leading-[1.04] tracking-[-0.025em] [text-wrap:balance]', phone ? 'text-[34px]' : 'text-[56px]')}>
              <TitleLogo title={media.title} logo={media.logoPath} logoClassName="block max-h-[160px] max-w-[min(480px,36vw)] object-left" />
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
              {favButton('w-11 h-11')}
            </div>
          </div>
          {!phone && (media.overview || upNext) && (
            <div className="flex-[0_1_420px] min-w-0 pb-1">
              {upNext && <p className="text-[15px] font-semibold text-white/90 mb-1.5">{upNext}</p>}
              {media.overview && <p className="text-[15px] leading-[21px] text-white/75 line-clamp-5">{media.overview}</p>}
            </div>
          )}
        </motion.div>
      )}
    </section>
  )
}
