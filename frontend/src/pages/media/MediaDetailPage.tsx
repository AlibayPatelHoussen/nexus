import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Heart, Star, BookOpen,
  Calendar, Globe, Clock, Layers, ChevronRight, RefreshCw, Tv,
} from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { formatDuration, formatBytes } from '@/utils'
import EpisodesSection from '@/components/media/EpisodesSection'
import type { Episode, Chapter } from '@/types'
import toast from 'react-hot-toast'

export default function MediaDetailPage() {
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const [isFav, setIsFav] = useState<boolean | null>(null)
  const [imgErr, setImgErr] = useState(false)
  const [activeSeason, setActiveSeason] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn:  () => mediaService.getById(id!),
    enabled:  !!id,
  })

  const isShowType = (t?: string) => t === 'serie' || t === 'anime'

  const { data: episodesProgress = [] } = useQuery({
    queryKey: ['episodes-progress', id],
    queryFn:  () => mediaService.getEpisodesProgress(id!),
    enabled:  !!id,
  })

  const { data: progress } = useQuery({
    queryKey: ['progress', id],
    queryFn:  () => mediaService.getProgress(id!),
    enabled:  !!id,
  })

  useQuery({
    queryKey: ['favorite', id],
    queryFn:  async () => {
      const favs = await mediaService.getFavorites()
      const fav = favs.some((f: { id: string }) => f.id === id)
      setIsFav(fav)
      return fav
    },
    enabled: !!id,
  })

  const favMut = useMutation({
    mutationFn: () => mediaService.toggleFavorite(id!),
    onSuccess:  (result) => {
      setIsFav(result)
      toast.success(result ? 'Ajouté aux favoris' : 'Retiré des favoris')
      qc.invalidateQueries({ queryKey: ['media', 'favorites'] })
    },
  })

  async function scan() {
    setScanning(true)
    try {
      const scanType = media?.type === 'serie' ? 'series' : media?.type === 'anime' ? 'animes' : 'manga'
      await mediaService.scan(scanType)
      toast.success('Scan lancé — rechargement dans 4s')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media', id] }), 4000)
    } catch { toast.error('Erreur scan') }
    finally { setScanning(false) }
  }

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
  const seasons  = [...new Set(episodes.map((e) => e.season ?? 1))].sort((a, b) => a - b)
  const isReading = ['manga', 'webtoon'].includes(media.type)
  const isShow    = isShowType(media.type)

  // Streaming-style "next up": resume the last episode in progress, or the one
  // after the last finished episode, otherwise the first episode
  const progressByEpisode = new Map(episodesProgress.map((p) => [p.episodeId, p]))
  const lastWatched = episodesProgress[0]
  const lastIndex   = lastWatched ? episodes.findIndex((e) => e.id === lastWatched.episodeId) : -1
  const nextEpisode = lastIndex === -1
    ? episodes[0]
    : lastWatched.completed ? (episodes[lastIndex + 1] ?? episodes[lastIndex]) : episodes[lastIndex]
  const nextProgress = nextEpisode ? progressByEpisode.get(nextEpisode.id) : undefined
  const nextResumes  = !!nextProgress && !nextProgress.completed && nextProgress.progress > 30
  const currentSeason = activeSeason ?? nextEpisode?.season ?? seasons[0] ?? 1

  const resumeEpisode = nextEpisode

  const progressPct = progress && progress.duration
    ? Math.round((progress.progress / progress.duration) * 100)
    : 0

  function play(episodeId?: string, chapterId?: string) {
    if (isReading) {
      const chapId = chapterId || chapters[0]?.id
      if (!chapId) { toast.error('Aucun chapitre — lancez un scan'); return }
      navigate(`/reader/${id}?ch=${chapId}`)
    } else if (isShow) {
      // A series is never played as a whole: always open a specific episode
      const epId = episodeId || resumeEpisode?.id || episodes[0]?.id
      if (!epId) { toast.error('Aucun épisode — lancez un scan'); return }
      navigate(`/player/${id}?ep=${epId}`)
    } else {
      navigate(`/player/${id}`)
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
      <div className="relative h-[240px] sm:h-[340px] lg:h-[420px] overflow-hidden">
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
          className="absolute top-4 left-4 sm:top-5 sm:left-5 flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white transition-colors p-1 -m-1"
          style={{ marginTop: 'env(safe-area-inset-top)' }}
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} strokeWidth={2} /> Retour
        </button>

        {/* Scan button (manga / series / anime) */}
        {(isReading || isShow) && (
          <button
            className="absolute top-4 right-4 sm:top-5 sm:right-5 flex items-center gap-1.5 text-[12px] font-medium text-white/60 hover:text-white transition-colors p-1 -m-1"
            style={{ marginTop: 'env(safe-area-inset-top)' }}
            onClick={scan}
            disabled={scanning}
          >
            <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} />
            Scanner
          </button>
        )}
      </div>

      {/* ── CONTENT ── */}
      <div className="relative px-4 sm:px-6 lg:px-7 pb-10 -mt-[150px] sm:-mt-[200px]">
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6">

          {/* Poster */}
          {media.posterPath && (
            <img
              src={media.posterPath}
              alt={media.title}
              className="rounded-xl flex-shrink-0 object-cover w-[110px] h-[158px] sm:w-[160px] sm:h-[230px]"
              style={{ boxShadow: 'var(--shadow-lg)' }}
            />
          )}

          {/* Info */}
          <div className="flex-1 min-w-0 sm:pt-20">
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

            <h1 className="text-[22px] sm:text-[28px] font-bold tracking-tight mb-1 leading-tight break-words"
              style={{ color: 'var(--text)' }}>
              {media.title}
            </h1>

            {media.originalTitle && media.originalTitle !== media.title && (
              <p className="text-[13px] mb-2" style={{ color: 'var(--text3)' }}>
                {media.originalTitle}
              </p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-4">
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
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                className="btn-primary text-[13px] px-5 py-2.5 flex-1 sm:flex-none justify-center disabled:opacity-50"
                onClick={() => play()}
                disabled={isShow && episodes.length === 0}
              >
                <Play size={14} fill="white" strokeWidth={0} />
                {isShow
                  ? episodes.length === 0
                    ? 'Aucun épisode'
                    : `${nextResumes ? 'Reprendre' : 'Regarder'} S${nextEpisode?.season ?? 1} · É${nextEpisode?.episodeNumber}`
                  : progress && progressPct > 0 && progressPct < 95
                    ? `Reprendre (${progressPct}%)`
                    : isReading ? 'Lire' : 'Regarder'
                }
              </button>

              <button
                className="btn-ghost text-[13px] px-4 py-2.5 justify-center"
                onClick={() => favMut.mutate()}
                disabled={favMut.isPending}
              >
                <Heart
                  size={14}
                  strokeWidth={2}
                  style={{
                    color: isFav === true ? 'var(--red)' : 'var(--text2)',
                    fill:  isFav === true ? 'var(--red)' : 'transparent',
                  }}
                />
                {isFav === true ? 'Favori' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>

        {/* Overview */}
        {media.overview && (
          <div className="card p-4 sm:p-5 mb-5 animate-fade-up">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: 'var(--text3)' }}>
              Synopsis
            </h2>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text2)' }}>
              {media.overview}
            </p>
          </div>
        )}

        {/* Episodes (series / anime) */}
        {isShow && episodes.length > 0 && (
          <EpisodesSection
            episodes={episodes}
            seasons={seasons}
            activeSeason={currentSeason}
            onSeasonChange={setActiveSeason}
            progress={progressByEpisode}
            nextEpisodeId={nextEpisode?.id}
            onPlay={(epId) => play(epId)}
          />
        )}

        {/* Show without indexed episodes */}
        {isShow && episodes.length === 0 && (
          <div className="card p-5 sm:p-6 mb-5 flex flex-col items-center text-center gap-2 animate-fade-up">
            <Tv size={32} strokeWidth={1.5} style={{ color: 'var(--text3)' }} />
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Aucun épisode trouvé</p>
            <p className="text-[12px] max-w-sm" style={{ color: 'var(--text3)' }}>
              Range les vidéos dans le dossier de la série (ex. <span className="font-mono">Saison 1/S01E01.mkv</span>) puis relance un scan.
            </p>
            <button className="btn-primary text-[12.5px] mt-2" onClick={scan} disabled={scanning}>
              <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} /> Scanner les épisodes
            </button>
          </div>
        )}

        {/* Chapters */}
        {chapters.length > 0 && (
          <div className="card overflow-hidden animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                Chapitres ({chapters.length})
              </h2>
              <button className="btn-primary text-[12px]" onClick={() => play(undefined, chapters[0]?.id)}>
                <BookOpen size={12} strokeWidth={2} /> <span className="hidden min-[400px]:inline">Commencer la lecture</span><span className="min-[400px]:hidden">Lire</span>
              </button>
            </div>
            <div className="pb-2">
              {chapters.map((chap) => (
                <div
                  key={chap.id}
                  className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-2.5 cursor-pointer transition-colors border-b"
                  style={{ borderColor: 'var(--border)', background: 'transparent' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  onClick={() => play(undefined, chap.id)}
                >
                  <span className="flex-1 text-[13px]" style={{ color: 'var(--text)' }}>
                    Chapitre {chap.chapterNumber}
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
