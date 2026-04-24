import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Heart, Star, BookOpen,
  Calendar, Globe, Clock, Layers, ChevronRight,
} from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { formatDuration, formatBytes } from '@/utils'
import type { Episode, Chapter } from '@/types'
import toast from 'react-hot-toast'

export default function MediaDetailPage() {
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const [isFav, setIsFav] = useState(false)
  const [imgErr, setImgErr] = useState(false)
  const [activeSeason, setActiveSeason] = useState(1)

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn:  () => mediaService.getById(id!),
    enabled:  !!id,
  })

  const { data: progress } = useQuery({
    queryKey: ['progress', id],
    queryFn:  () => mediaService.getProgress(id!),
    enabled:  !!id,
  })

  const favMut = useMutation({
    mutationFn: () => mediaService.toggleFavorite(id!),
    onSuccess:  (result) => {
      setIsFav(result)
      toast.success(result ? 'Ajouté aux favoris' : 'Retiré des favoris')
      qc.invalidateQueries({ queryKey: ['media', 'favorites'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
        <div className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--border2)', borderTopColor: 'var(--blue)' }} />
      </div>
    )
  }

  if (!media) return null

  const episodes: Episode[] = media.episodes || []
  const chapters: Chapter[] = media.chapters  || []
  const seasons  = [...new Set(episodes.map((e) => e.season || 1))].sort((a, b) => a - b)
  const isReading = ['manga', 'webtoon'].includes(media.type)

  const resumeEpisode = progress?.episodeId
    ? episodes.find((e) => e.id === progress.episodeId)
    : null

  const progressPct = progress && progress.duration
    ? Math.round((progress.progress / progress.duration) * 100)
    : 0

  function play(episodeId?: string, chapterId?: string) {
    if (isReading) {
      const chapId = chapterId || chapters[0]?.id
      if (chapId) navigate(`/reader/${id}?ch=${chapId}`)
    } else {
      const epId = episodeId || resumeEpisode?.id || episodes[0]?.id
      if (episodes.length > 0 && epId) {
        navigate(`/player/${id}?ep=${epId}`)
      } else {
        navigate(`/player/${id}`)
      }
    }
  }

  const typeLabel: Record<string, string> = {
    film: 'Film', serie: 'Série', anime: 'Anime', manga: 'Manga', webtoon: 'Webtoon',
  }

  const typeColor: Record<string, string> = {
    film: 'var(--red)', serie: 'var(--blue)', anime: 'var(--teal)',
    manga: 'var(--purple)', webtoon: 'var(--orange)',
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>

      {/* ── BACKDROP ── */}
      <div className="relative h-[420px] overflow-hidden">
        {media.backdropPath && !imgErr ? (
          <img
            src={media.backdropPath}
            alt=""
            className="w-full h-full object-cover"
            style={{ filter: 'brightness(0.35)' }}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="w-full h-full" style={{ background: 'var(--surface)' }} />
        )}

        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, var(--bg) 90%)' }}
        />

        {/* Back button */}
        <button
          className="absolute top-5 left-5 flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white transition-colors"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} strokeWidth={2} /> Retour
        </button>
      </div>

      {/* ── CONTENT ── */}
      <div className="px-7 pb-10" style={{ marginTop: '-200px', position: 'relative' }}>
        <div className="flex gap-6 mb-6">

          {/* Poster */}
          {media.posterPath && (
            <img
              src={media.posterPath}
              alt={media.title}
              className="rounded-xl flex-shrink-0 object-cover"
              style={{
                width:     '160px',
                height:    '230px',
                boxShadow: 'var(--shadow-lg)',
              }}
            />
          )}

          {/* Info */}
          <div className="flex-1 min-w-0 pt-20">
            {/* Type badge */}
            <div
              className="badge mb-2 text-[11px]"
              style={{
                background: `color-mix(in srgb, ${typeColor[media.type]} 15%, transparent)`,
                color:      typeColor[media.type],
              }}
            >
              {typeLabel[media.type]}
            </div>

            <h1 className="text-[28px] font-bold tracking-tight mb-1 leading-tight"
              style={{ color: 'var(--text)' }}>
              {media.title}
            </h1>

            {media.originalTitle && media.originalTitle !== media.title && (
              <p className="text-[13px] mb-2" style={{ color: 'var(--text3)' }}>
                {media.originalTitle}
              </p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {media.year && (
                <div className="flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--text3)' }}>
                  <Calendar size={12} strokeWidth={2} /> {media.year}
                </div>
              )}
              {media.rating && (
                <div className="flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--yellow)' }}>
                  <Star size={12} fill="var(--yellow)" color="var(--yellow)" />
                  {Number(media.rating).toFixed(1)}
                  {media.voteCount && (
                    <span style={{ color: 'var(--text3)' }}>({media.voteCount.toLocaleString()})</span>
                  )}
                </div>
              )}
              {media.duration && (
                <div className="flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--text3)' }}>
                  <Clock size={12} strokeWidth={2} /> {formatDuration(media.duration)}
                </div>
              )}
              {media.language && (
                <div className="flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--text3)' }}>
                  <Globe size={12} strokeWidth={2} /> {media.language.toUpperCase()}
                </div>
              )}
              {media.fileSize && (
                <div className="flex items-center gap-1 text-[12.5px] font-mono" style={{ color: 'var(--text3)' }}>
                  <Layers size={12} strokeWidth={2} /> {formatBytes(media.fileSize)}
                </div>
              )}
            </div>

            {/* Genres */}
            {media.genres && media.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {media.genres.slice(0, 6).map((g) => (
                  <span key={g} className="badge text-[11px]"
                    style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2.5">
              <button
                className="btn-primary text-[13px] px-5 py-2.5"
                onClick={() => play()}
              >
                <Play size={14} fill="white" strokeWidth={0} />
                {progress && progressPct > 0 && progressPct < 95
                  ? `Reprendre (${progressPct}%)`
                  : isReading ? 'Lire' : 'Regarder'
                }
              </button>

              <button
                className="btn-ghost text-[13px] px-4 py-2.5"
                onClick={() => favMut.mutate()}
                disabled={favMut.isPending}
              >
                <Heart
                  size={14}
                  strokeWidth={2}
                  style={{
                    color: isFav ? 'var(--red)' : 'var(--text2)',
                    fill:  isFav ? 'var(--red)' : 'transparent',
                  }}
                />
                {isFav ? 'Favori' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>

        {/* Overview */}
        {media.overview && (
          <div className="card p-5 mb-5 animate-fade-up">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: 'var(--text3)' }}>
              Synopsis
            </h2>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text2)' }}>
              {media.overview}
            </p>
          </div>
        )}

        {/* Episodes */}
        {episodes.length > 0 && (
          <div className="card overflow-hidden mb-5 animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="px-5 pt-5 pb-0 mb-4">
              <h2 className="text-[14px] font-semibold mb-3" style={{ color: 'var(--text)' }}>
                Épisodes
              </h2>
              {/* Season tabs */}
              {seasons.length > 1 && (
                <div className="flex gap-2 mb-1">
                  {seasons.map((s) => (
                    <button
                      key={s}
                      className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
                      style={{
                        background: activeSeason === s ? 'var(--blue)' : 'var(--surface2)',
                        color:      activeSeason === s ? 'white'       : 'var(--text3)',
                        border:     `1px solid ${activeSeason === s ? 'var(--blue)' : 'var(--border)'}`,
                      }}
                      onClick={() => setActiveSeason(s)}
                    >
                      Saison {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pb-2">
              {episodes
                .filter((e) => (e.season || 1) === activeSeason)
                .map((ep) => {
                  const epProgress = progress?.episodeId === ep.id ? progress : null
                  const epPct = epProgress && epProgress.duration
                    ? Math.round((epProgress.progress / epProgress.duration) * 100)
                    : 0

                  return (
                    <div
                      key={ep.id}
                      className="flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors border-b"
                      style={{
                        borderColor: 'var(--border)',
                        background:  epProgress ? 'var(--blue-dim)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (!epProgress) e.currentTarget.style.background = 'var(--surface2)' }}
                      onMouseLeave={(e) => { if (!epProgress) e.currentTarget.style.background = 'transparent' }}
                      onClick={() => play(ep.id)}
                    >
                      {/* Number */}
                      <span
                        className="text-[12px] font-mono w-7 flex-shrink-0"
                        style={{ color: 'var(--text3)' }}
                      >
                        {ep.episodeNumber}
                      </span>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate"
                          style={{ color: epProgress ? 'var(--blue)' : 'var(--text)' }}>
                          {ep.title || `Épisode ${ep.episodeNumber}`}
                        </div>
                        {ep.overview && (
                          <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--text3)' }}>
                            {ep.overview}
                          </div>
                        )}
                        {/* Episode progress bar */}
                        {epPct > 0 && epPct < 95 && (
                          <div className="mt-1.5 h-[3px] rounded-full overflow-hidden"
                            style={{ background: 'var(--surface3)', width: '120px' }}>
                            <div className="h-full rounded-full"
                              style={{ width: `${epPct}%`, background: 'var(--blue)' }} />
                          </div>
                        )}
                      </div>

                      {/* Duration */}
                      {ep.duration && (
                        <span className="text-[11.5px] font-mono flex-shrink-0"
                          style={{ color: 'var(--text3)' }}>
                          {formatDuration(ep.duration)}
                        </span>
                      )}

                      <ChevronRight size={14} strokeWidth={2} style={{ color: 'var(--text3)', flexShrink: 0 }} />
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* Chapters */}
        {chapters.length > 0 && (
          <div className="card overflow-hidden animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                Chapitres ({chapters.length})
              </h2>
              <button className="btn-primary text-[12px]" onClick={() => play(undefined, chapters[0]?.id)}>
                <BookOpen size={12} strokeWidth={2} /> Commencer la lecture
              </button>
            </div>
            <div className="pb-2">
              {chapters.map((chap) => (
                <div
                  key={chap.id}
                  className="flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors border-b"
                  style={{ borderColor: 'var(--border)', background: 'transparent' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  onClick={() => play(undefined, chap.id)}
                >
                  <span className="text-[12px] font-mono w-14 flex-shrink-0" style={{ color: 'var(--text3)' }}>
                    Ch.{chap.chapterNumber}
                  </span>
                  <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--text)' }}>
                    {chap.title || `Chapitre ${chap.chapterNumber}`}
                  </span>
                  {chap.pageCount ? (
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text3)' }}>
                      {chap.pageCount}p
                    </span>
                  ) : null}
                  <ChevronRight size={13} strokeWidth={2} style={{ color: 'var(--text3)' }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
