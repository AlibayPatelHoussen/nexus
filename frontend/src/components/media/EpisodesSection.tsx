import { useState } from 'react'
import { Check, Play, Tv } from 'lucide-react'
import type { Episode } from '@/types'
import type { EpisodeProgress } from '@/services/mediaService'
import SegmentedControl from '@/components/ui/SegmentedControl'
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
  const list = episodes.filter((e) => (e.season ?? 1) === activeSeason)
  const watched = list.filter((e) => progress.get(e.id)?.completed).length

  return (
    <section className="mb-4" aria-labelledby="episodes-title">
      <div className="flex flex-wrap items-center gap-3 mb-3.5">
        <h2 id="episodes-title" className="text-[19px] font-bold text-label">Épisodes</h2>
        {seasons.length > 5 ? (
          <label className="relative inline-flex items-center">
            <span className="sr-only">Saison</span>
            <select
              className="appearance-none h-8 max-md:h-9 pl-3.5 pr-8 rounded-pill bg-fill text-body font-medium text-label outline-none hoverable"
              value={activeSeason}
              onChange={(e) => onSeasonChange(Number(e.target.value))}
              aria-label="Saison"
            >
              {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
            </select>
            <span className="absolute right-3 pointer-events-none text-label2 text-[10px]" aria-hidden="true">▾</span>
          </label>
        ) : seasons.length > 1 ? (
          <SegmentedControl
            label="Saisons"
            value={String(activeSeason)}
            onChange={(v) => onSeasonChange(Number(v))}
            options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          />
        ) : (
          <span className="text-subhead text-label2">{seasonLabel(seasons[0] ?? 1)}</span>
        )}
        <span className="text-subhead text-label2 tabular ml-auto">
          {list.length} épisode{list.length > 1 ? 's' : ''}{watched > 0 && ` · ${watched} vu${watched > 1 ? 's' : ''}`}
        </span>
      </div>

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
              return (
                <button
                  key={ep.id}
                  type="button"
                  className="group snap-start min-w-0 text-left rounded-card press-soft"
                  onClick={() => onPlay(ep.id)}
                  aria-label={`Lire ${seasonLabel(ep.season ?? 1)} épisode ${ep.episodeNumber} : ${title}`}
                >
                  <span className="relative block aspect-video rounded-card overflow-hidden bg-fill shadow-[inset_0_0_0_1px_var(--poster-rim)] transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.5)]">
                    {ep.thumbnailPath && !broken.has(ep.id) ? (
                      <img src={ep.thumbnailPath} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
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
                  <span className="block mt-2.5 px-0.5">
                    <span className={cn('block text-caption font-semibold uppercase tracking-[0.04em] tabular', isNext ? 'text-accent-text' : 'text-label2')}>
                      {isNext ? (pct > 0 && !done ? 'En cours' : 'À suivre') + ' · ' : ''}Épisode {ep.episodeNumber}
                    </span>
                    <span className="block text-body font-semibold text-label leading-snug line-clamp-1 mt-0.5">{title}</span>
                    {ep.overview && <span className="block text-subhead text-label2 mt-1 line-clamp-3">{ep.overview}</span>}
                    <span className="block text-caption text-label2 mt-1 tabular">
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
