import { useState } from 'react'
import { Check, ChevronsUpDown, Play, Tv } from 'lucide-react'
import type { Episode } from '@/types'
import type { EpisodeProgress } from '@/services/mediaService'
import PullDownMenu from '@/components/ui/PullDownMenu'
import { useShell } from '@/components/shell/shellContext'
import { cn, formatDuration } from '@/utils'

interface Props {
  episodes:        Episode[]
  seasons:         number[]
  activeSeason:    number
  onSeasonChange:  (season: number) => void
  progress:        Map<string, EpisodeProgress>
  nextEpisodeId?:  string
  onPlay:          (episodeId: string) => void
}

const seasonLabel = (s: number) => (s === 0 ? 'Spéciaux' : `Saison ${s}`)

/** Season picker + episodes (whole still, number and title, synopsis, progress). */
export default function EpisodesSection({ episodes, seasons, activeSeason, onSeasonChange, progress, nextEpisodeId, onPlay }: Props) {
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const { device } = useShell()
  const phone = device === 'phone'
  const list = episodes.filter((e) => (e.season ?? 1) === activeSeason)
  const watched = list.filter((e) => progress.get(e.id)?.completed).length

  return (
    <section className="mb-4" aria-labelledby="episodes-title">
      {/* Apple TV: « Saison 1 ⇅ » is the section title and a pull-down menu */}
      <h2 id="episodes-title" className={cn('flex items-center font-bold text-label mb-3.5', phone ? 'text-[22px]' : 'text-[19px]')}>
        {seasons.length > 1 ? (
          <PullDownMenu
            label="Saison"
            value={activeSeason}
            onChange={onSeasonChange}
            options={seasons.map((s) => ({ value: s, label: seasonLabel(s) }))}
            className="-mx-1 px-1 hoverable"
          >
            {seasonLabel(activeSeason)}
            <ChevronsUpDown size={phone ? 20 : 16} strokeWidth={2.25} className="text-label2" aria-hidden="true" />
          </PullDownMenu>
        ) : seasonLabel(seasons[0] ?? 1)}
        <span className="sr-only">, {list.length} épisode{list.length > 1 ? 's' : ''}{watched > 0 && `, ${watched} vu${watched > 1 ? 's' : ''}`}</span>
      </h2>

      {/* Apple TV: episodes side by side, 16:9 still with its progress, text underneath */}
      <ol className="shelf shelf--wide !mb-0 list-none">
        <li className="contents">
          <div className="shelf__scroller scrollbar-none">
            {list.map((ep) => {
              const p      = progress.get(ep.id)
              const total  = p?.duration || ep.duration || 0
              const pct    = p && total ? Math.min(100, Math.round((p.progress / total) * 100)) : 0
              const done   = !!p?.completed
              const isNext = ep.id === nextEpisodeId
              const title  = ep.title || `Épisode ${ep.episodeNumber}`
              const still  = ep.thumbnailPath && !broken.has(ep.id) ? ep.thumbnailPath : null
              return (
                <button
                  key={ep.id}
                  type="button"
                  className={cn('group snap-start min-w-0 text-left rounded-card press-soft', phone && 'relative flex flex-col overflow-hidden bg-fill shadow-[inset_0_0_0_1px_var(--poster-rim)]', phone && still && 'scheme-dark')}
                  onClick={() => onPlay(ep.id)}
                  aria-label={`Lire ${seasonLabel(ep.season ?? 1)} épisode ${ep.episodeNumber} : ${title}`}
                >
                  <span className={cn('relative block aspect-video overflow-hidden bg-fill', !phone && 'rounded-card shadow-[inset_0_0_0_1px_var(--poster-rim)] transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.5)]')}>
                    {still ? (
                      <img src={still} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                        onError={() => setBroken((b) => new Set(b).add(ep.id))} />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center gap-1.5 text-label3">
                        <Tv size={18} strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-headline tabular">{ep.episodeNumber}</span>
                      </span>
                    )}
                    <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200" aria-hidden="true">
                      <span className="w-11 h-11 rounded-full grid place-items-center glass-clear"><Play size={16} fill="currentColor" strokeWidth={0} className="ml-0.5" /></span>
                    </span>
                    {pct > 0 && !done && (
                      <span className="absolute inset-x-2.5 bottom-2.5 h-[3px] rounded-full overflow-hidden bg-white/35">
                        <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                      </span>
                    )}
                    {done && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full grid place-items-center glass-clear" aria-label="Vu">
                        <Check size={13} strokeWidth={2.75} />
                      </span>
                    )}
                  </span>
                  <span className={cn('relative block', phone ? 'flex-1 px-3.5 pt-2.5 pb-3.5 overflow-hidden' : 'mt-2.5 px-0.5')}>
                    {/* iPhone: the text sits on the still, blurred and darkened (Apple TV card) */}
                    {phone && still && (
                      <span className="absolute inset-0 pointer-events-none" aria-hidden="true">
                        <img src={still} alt="" className="absolute inset-x-0 bottom-0 w-full h-[200%] object-cover object-bottom scale-110 blur-2xl" />
                        <span className="absolute inset-0 bg-black/50" />
                      </span>
                    )}
                    <span className={cn('relative block text-caption font-semibold uppercase tracking-[0.04em] tabular', isNext ? 'text-accent-text' : 'text-label2')}>
                      {isNext ? (pct > 0 && !done ? 'En cours' : 'À suivre') + ' · ' : ''}Épisode {ep.episodeNumber}
                    </span>
                    <span className="relative block text-body font-semibold text-label leading-snug line-clamp-1 mt-0.5">{title}</span>
                    {ep.overview && <span className="relative block text-subhead text-label2 mt-1 line-clamp-3">{ep.overview}</span>}
                    <span className="relative block text-caption text-label2 mt-1 tabular">
                      {[ep.duration ? formatDuration(ep.duration) : null,
                        ep.airDate ? new Date(ep.airDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </li>
      </ol>
    </section>
  )
}
