import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Star, BookOpen,
  Calendar, Globe, Clock, Layers, ChevronRight, RefreshCw, Tv, Plus, Check,
} from 'lucide-react'
import MediaRow from '@/components/media/MediaRow'
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

  // "More like this": same type, sharing the main genre
  const { data: similarData } = useQuery({
    queryKey: ['media', 'similar', id, media?.type, media?.genres?.[0]],
    queryFn:  () => mediaService.getAll({ type: media!.type, genre: media!.genres[0], limit: 25, sortBy: 'rating', sortDir: 'desc' }),
    enabled:  !!media?.genres?.length,
  })
  const similar = (similarData?.items ?? []).filter((m) => m.id !== id).slice(0, 20)

  const favMut = useMutation({
    mutationFn: () => mediaService.toggleFavorite(id!),
    onSuccess:  (result) => {
      setIsFav(result)
      toast.success(result ? 'Ajouté à ma liste' : 'Retiré de ma liste')
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

  const seasonsCount = seasons.length
  const metaBits = [
    media.year ? String(media.year) : null,
    isShow && seasonsCount ? `${seasonsCount} saison${seasonsCount > 1 ? 's' : ''}` : null,
    isShow && episodes.length ? `${episodes.length} épisode${episodes.length > 1 ? 's' : ''}` : null,
    !isShow && media.duration ? formatDuration(media.duration) : null,
    isReading && chapters.length ? `${chapters.length} chapitre${chapters.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean) as string[]
  const art = !imgErr ? (media.backdropPath || media.posterPath) : null

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>

      {/* ── BILLBOARD ── */}
      <section className="relative">
        <div className="relative h-[62vh] min-h-[360px] max-h-[640px] sm:h-[520px] lg:h-[600px] overflow-hidden">
          {art ? (
            <img
              src={art}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover ${media.backdropPath ? 'object-center' : 'object-top'}`}
              onError={() => setImgErr(true)}
            />
          ) : (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #2a2a3d, #0a0a0f)' }} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.25) 100%)' }} />
          <div className="absolute inset-0 hidden sm:block" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.3) 55%, transparent 80%)' }} />

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 sm:px-6 lg:px-7 pt-4 sm:pt-5"
            style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
            <button
              className="flex items-center gap-1.5 text-[13px] font-medium text-white/80 hover:text-white transition-colors px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.35)' }}
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={16} strokeWidth={2} /> Retour
            </button>
            {(isReading || isShow) && (
              <button
                className="flex items-center gap-1.5 text-[12px] font-medium text-white/80 hover:text-white transition-colors px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(0,0,0,0.35)' }}
                onClick={scan}
                disabled={scanning}
              >
                <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} />
                Scanner
              </button>
            )}
          </div>

          {/* Title block */}
          <div className="absolute inset-x-0 bottom-0 px-4 sm:px-6 lg:px-7 pb-6 sm:pb-10 flex items-end gap-6">
            {!media.backdropPath && media.posterPath && !imgErr && (
              <img src={media.posterPath} alt="" className="hidden md:block w-[170px] aspect-[2/3] rounded-lg object-cover flex-shrink-0 shadow-2xl" />
            )}
            <div className="min-w-0 max-w-3xl">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: typeColor[media.type] }}>
                {typeLabel[media.type]}
              </span>
              <h1 className="mt-1.5 text-[28px] sm:text-[40px] lg:text-[52px] font-extrabold tracking-tight leading-[1.05] text-white break-words drop-shadow-lg">
                {media.title}
              </h1>
              {media.originalTitle && media.originalTitle !== media.title && (
                <p className="text-[13px] mt-1 text-white/60">{media.originalTitle}</p>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[13px] sm:text-[14px] text-white/85">
                {media.rating != null && Number(media.rating) > 0 && (
                  <span className="flex items-center gap-1 font-semibold" style={{ color: 'var(--green)' }}>
                    <Star size={13} fill="currentColor" /> {Number(media.rating).toFixed(1)}
                    {media.voteCount ? <span className="font-normal text-white/50">({media.voteCount.toLocaleString('fr-FR')})</span> : null}
                  </span>
                )}
                {metaBits.map((b) => <span key={b}>{b}</span>)}
                {media.language && (
                  <span className="px-1.5 py-px rounded border border-white/40 text-[11px] font-semibold">{media.language.toUpperCase()}</span>
                )}
                {media.fileSize ? (
                  <span className="flex items-center gap-1 text-white/60 font-mono text-[12px]"><Layers size={12} /> {formatBytes(media.fileSize)}</span>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2.5 mt-5">
                <button
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-7 py-3 rounded-md text-[15px] font-bold bg-white text-black hover:bg-white/85 transition-colors disabled:opacity-50"
                  onClick={() => play()}
                  disabled={isShow && episodes.length === 0}
                >
                  <Play size={18} fill="black" strokeWidth={0} />
                  {isShow
                    ? episodes.length === 0
                      ? 'Aucun épisode'
                      : `${nextResumes ? 'Reprendre' : 'Lecture'} · S${nextEpisode?.season ?? 1} É${nextEpisode?.episodeNumber}`
                    : progress && progressPct > 0 && progressPct < 95
                      ? `Reprendre · ${progressPct}%`
                      : isReading ? 'Lire' : 'Lecture'}
                </button>
                <button
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-md text-[15px] font-bold text-white transition-colors hover:bg-white/30"
                  style={{ background: 'rgba(109,109,110,0.7)' }}
                  onClick={() => favMut.mutate()}
                  disabled={favMut.isPending}
                  aria-pressed={isFav === true}
                >
                  {isFav === true ? <Check size={18} strokeWidth={2.5} /> : <Plus size={18} strokeWidth={2.5} />}
                  Ma liste
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DETAILS ── */}
      <div className="relative px-4 sm:px-6 lg:px-7 pb-12 pt-5 sm:pt-6">
        <div className="grid gap-5 lg:gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] mb-8">
          <div className="min-w-0">
            {nextEpisode && isShow && (
              <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--text)' }}>
                S{nextEpisode.season ?? 1}:É{nextEpisode.episodeNumber}
                {nextEpisode.title ? ` « ${nextEpisode.title} »` : ''}
              </p>
            )}
            <p className="text-[14px] sm:text-[15px] leading-relaxed" style={{ color: 'var(--text2)' }}>
              {media.overview || 'Aucun synopsis disponible.'}
            </p>
          </div>
          <dl className="text-[13px] leading-relaxed flex flex-col gap-2">
            {media.genres && media.genres.length > 0 && (
              <div>
                <dt className="inline" style={{ color: 'var(--text3)' }}>Genres : </dt>
                <dd className="inline" style={{ color: 'var(--text)' }}>{media.genres.join(', ')}</dd>
              </div>
            )}
            {media.status && (
              <div>
                <dt className="inline" style={{ color: 'var(--text3)' }}>Statut : </dt>
                <dd className="inline" style={{ color: 'var(--text)' }}>{media.status}</dd>
              </div>
            )}
            {media.year && (
              <div className="flex items-center gap-1.5" style={{ color: 'var(--text3)' }}>
                <Calendar size={12} /> <span style={{ color: 'var(--text)' }}>{media.year}</span>
                {media.duration ? <><Clock size={12} className="ml-2" /> <span style={{ color: 'var(--text)' }}>{formatDuration(media.duration)}</span></> : null}
                {media.language ? <><Globe size={12} className="ml-2" /> <span style={{ color: 'var(--text)' }}>{media.language.toUpperCase()}</span></> : null}
              </div>
            )}
          </dl>
        </div>
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

        {/* More like this */}
        {similar.length > 0 && <MediaRow title="Titres similaires" items={similar} />}
      </div>
    </div>
  )
}
