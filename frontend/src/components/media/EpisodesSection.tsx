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
    <section className="mb-10" aria-labelledby="episodes-title">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 id="episodes-title" className="text-title text-label">Épisodes</h2>
          <p className="text-subhead text-label2 mt-0.5 tabular">
            {list.length} épisode{list.length > 1 ? 's' : ''}{watched > 0 && ` · ${watched} vu${watched > 1 ? 's' : ''}`}
          </p>
        </div>
        {seasons.length > 5 ? (
          <label className="relative inline-flex items-center">
            <span className="sr-only">Saison</span>
            <select
              className="appearance-none h-7 max-md:h-9 pl-2.5 pr-7 rounded-[7px] bg-fill text-body text-label outline-none"
              value={activeSeason}
              onChange={(e) => onSeasonChange(Number(e.target.value))}
              aria-label="Saison"
            >
              {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
            </select>
            <span className="absolute right-2 pointer-events-none text-label2 text-[10px]" aria-hidden="true">▾</span>
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
      </div>

      <ol className="bg-surface rounded-card overflow-hidden">
        {list.map((ep, i) => {
          const p      = progress.get(ep.id)
          const total  = p?.duration || ep.duration || 0
          const pct    = p && total ? Math.min(100, Math.round((p.progress / total) * 100)) : 0
          const done   = !!p?.completed
          const isNext = ep.id === nextEpisodeId
          const title  = ep.title || `Épisode ${ep.episodeNumber}`
          return (
            <li key={ep.id} className={cn(i > 0 && 'hairline-t')}>
              <button
                type="button"
                className="group w-full flex gap-3 md:gap-4 p-3 md:px-4 text-left pressable hoverable"
                onClick={() => onPlay(ep.id)}
                aria-label={`Lire ${seasonLabel(ep.season ?? 1)} épisode ${ep.episodeNumber} : ${title}`}
              >
                <span className="relative flex-shrink-0 w-[128px] md:w-[176px] aspect-video rounded-[6px] overflow-hidden bg-fill">
                  {ep.thumbnailPath && !broken.has(ep.id) ? (
                    <img src={ep.thumbnailPath} alt="" loading="lazy" className="w-full h-full object-contain"
                      onError={() => setBroken((b) => new Set(b).add(ep.id))} />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center gap-1.5 text-label3">
                      <Tv size={16} strokeWidth={1.5} aria-hidden="true" />
                      <span className="text-subhead font-medium tabular">{ep.episodeNumber}</span>
                    </span>
                  )}
                  <span className="hidden lg:grid absolute inset-0 place-items-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-fast" aria-hidden="true">
                    <span className="w-9 h-9 rounded-full grid place-items-center material-bar"><Play size={14} fill="currentColor" strokeWidth={0} className="text-label ml-0.5" /></span>
                  </span>
                  {pct > 0 && !done && (
                    <span className="absolute inset-x-2 bottom-2 h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.45)' }}>
                      <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                <span className="flex-1 min-w-0 py-0.5">
                  {isNext && <span className="block text-caption font-semibold text-accent-text mb-0.5">{pct > 0 && !done ? 'En cours' : 'À suivre'}</span>}
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-body font-medium text-label leading-snug line-clamp-2">{ep.episodeNumber}. {title}</span>
                    {done && <Check size={16} strokeWidth={2} className="text-label2 flex-shrink-0 mt-px" aria-label="Vu" />}
                  </span>
                  {ep.overview && <span className="block text-subhead text-label2 mt-1 line-clamp-2 md:line-clamp-3">{ep.overview}</span>}
                  <span className="block text-caption text-label2 mt-1 tabular">
                    {[ep.duration ? formatDuration(ep.duration) : null,
                      ep.airDate ? new Date(ep.airDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
