import { useState } from 'react'
import { Check, Play, Tv } from 'lucide-react'
import type { Episode } from '@/types'
import type { EpisodeProgress } from '@/services/mediaService'
import { formatDuration } from '@/utils'

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

/** Streaming-style season picker + episode list (thumbnail, title, synopsis, progress). */
export default function EpisodesSection({
  episodes, seasons, activeSeason, onSeasonChange, progress, nextEpisodeId, onPlay,
}: Props) {
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set())
  const list = episodes.filter((e) => (e.season ?? 1) === activeSeason)
  const watched = list.filter((e) => progress.get(e.id)?.completed).length

  return (
    <section className="card overflow-hidden mb-5 animate-fade-up" style={{ animationDelay: '60ms' }}>
      {/* Header: title + season selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Épisodes</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text3)' }}>
            {list.length} épisode{list.length > 1 ? 's' : ''}
            {watched > 0 && ` · ${watched} vu${watched > 1 ? 's' : ''}`}
          </p>
        </div>

        {seasons.length > 6 ? (
          <select
            className="input py-2 text-[13px] w-auto"
            value={activeSeason}
            onChange={(e) => onSeasonChange(Number(e.target.value))}
            aria-label="Saison"
          >
            {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
          </select>
        ) : seasons.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto scrollbar-none max-w-full" role="tablist" aria-label="Saisons">
            {seasons.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={activeSeason === s}
                className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-all flex-shrink-0 whitespace-nowrap"
                style={{
                  background: activeSeason === s ? 'var(--blue)' : 'var(--surface2)',
                  color:      activeSeason === s ? 'white'       : 'var(--text2)',
                  border:     `1px solid ${activeSeason === s ? 'var(--blue)' : 'var(--border)'}`,
                }}
                onClick={() => onSeasonChange(s)}
              >
                {seasonLabel(s)}
              </button>
            ))}
          </div>
        ) : (
          <span className="badge text-[11px]" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
            {seasonLabel(seasons[0] ?? 1)}
          </span>
        )}
      </div>

      {/* Episode list */}
      <ol className="flex flex-col pb-2">
        {list.map((ep) => {
          const p        = progress.get(ep.id)
          const total    = p?.duration || ep.duration || 0
          const pct      = p && total ? Math.min(100, Math.round((p.progress / total) * 100)) : 0
          const done     = !!p?.completed
          const isNext   = ep.id === nextEpisodeId
          const title    = ep.title || `Épisode ${ep.episodeNumber}`

          return (
            <li key={ep.id}>
              <button
                className="group w-full flex gap-3 sm:gap-4 px-3 sm:px-5 py-3 text-left transition-colors border-t hover:bg-[var(--surface2)]"
                style={{
                  borderColor: 'var(--border)',
                  background:  isNext ? 'var(--blue-dim)' : undefined,
                }}
                onClick={() => onPlay(ep.id)}
                aria-label={`Lire ${seasonLabel(ep.season ?? 1)} épisode ${ep.episodeNumber} : ${title}`}
              >
                {/* Thumbnail */}
                <div
                  className="relative flex-shrink-0 w-[124px] sm:w-[176px] aspect-video rounded-lg overflow-hidden"
                  style={{ background: 'var(--surface3)' }}
                >
                  {ep.thumbnailPath && !brokenThumbs.has(ep.id) ? (
                    // Stills are 16:9 like the frame: contain keeps them whole
                    <img src={ep.thumbnailPath} alt="" loading="lazy" className="w-full h-full object-contain"
                      onError={() => setBrokenThumbs((b) => new Set(b).add(ep.id))} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center gap-1.5"
                      style={{ background: 'linear-gradient(135deg, var(--surface2), var(--surface3))', color: 'var(--text3)' }}>
                      <Tv size={16} strokeWidth={1.8} />
                      <span className="text-[13px] font-bold font-mono">É{ep.episodeNumber}</span>
                    </div>
                  )}

                  {/* Play overlay */}
                  <div className="hover-reveal absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                      <Play size={15} fill="white" color="white" style={{ marginLeft: 2 }} />
                    </div>
                  </div>

                  {done && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--green)' }} title="Vu">
                      <Check size={12} strokeWidth={3} color="white" />
                    </div>
                  )}

                  {/* Progress bar */}
                  {pct > 0 && !done && (
                    <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: 'rgba(255,255,255,0.25)' }}>
                      <div className="h-full" style={{ width: `${pct}%`, background: 'var(--red)' }} />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] sm:text-[14px] font-semibold leading-snug line-clamp-2"
                      style={{ color: isNext ? 'var(--blue)' : 'var(--text)' }}>
                      {ep.episodeNumber}. {title}
                    </div>
                    {ep.duration ? (
                      <span className="text-[11px] font-mono flex-shrink-0 mt-0.5" style={{ color: 'var(--text3)' }}>
                        {formatDuration(ep.duration)}
                      </span>
                    ) : null}
                  </div>
                  {ep.overview && (
                    <p className="text-[12px] sm:text-[12.5px] mt-1 leading-relaxed line-clamp-2 sm:line-clamp-3"
                      style={{ color: 'var(--text3)' }}>
                      {ep.overview}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {isNext && (
                      <span className="badge text-[10px]" style={{ background: 'var(--blue)', color: 'white' }}>
                        {pct > 0 && !done ? 'En cours' : 'À suivre'}
                      </span>
                    )}
                    {done && (
                      <span className="badge text-[10px]" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>Vu</span>
                    )}
                    {ep.airDate && (
                      <span className="text-[10.5px]" style={{ color: 'var(--text3)' }}>
                        {new Date(ep.airDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
