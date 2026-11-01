import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Star, ChevronRight } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { filesService } from '@/services/filesService'
import { getStreamToken } from '@/services/streamToken'
import { useAuthStore } from '@/stores/authStore'
import { formatDuration } from '@/utils'
import VideoPlayer from './VideoPlayer'
import type { Episode } from '@/types'

/** Human-readable reason why the playback authorisation failed. */
function describeTokenError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 404) return 'Le serveur ne connaît pas l\'autorisation de lecture (erreur 404) : le backend n\'est pas à jour, relance le déploiement.'
  if (status === 401) return 'Session expirée (erreur 401) : reconnecte-toi.'
  if (status === 429) return 'Trop de requêtes (erreur 429) : attends quelques minutes ou augmente RATE_LIMIT_MAX dans backend/.env.'
  if (status) return `Le serveur a refusé la lecture (erreur ${status}).`
  if (err instanceof Error && err.message) return err.message
  return 'Le serveur n\'a pas autorisé la lecture.'
}

export default function PlayerPage() {
  const { id }         = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()
  const episodeId      = searchParams.get('ep') || undefined

  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Latest playback position, read by the periodic save (a closure would freeze it)
  const latestRef   = useRef<{ t: number; d: number }>({ t: 0, d: 0 })
  const [resumeAt,   setResumeAt]   = useState<number | null>(null)
  const [showResume, setShowResume] = useState(false)
  const [seekTo,     setSeekTo]     = useState<{ time: number; key: number } | undefined>()

  const { data: media } = useQuery({
    queryKey: ['media', id],
    queryFn:  () => mediaService.getById(id!),
    enabled:  !!id,
  })

  const { data: savedProgress } = useQuery({
    queryKey: ['progress', id, episodeId],
    queryFn:  () => mediaService.getProgress(id!, episodeId),
    enabled:  !!id,
  })

  // A series/anime opened without ?ep= : jump to the episode to watch next
  // (never try to stream the show's folder)
  const { data: episodesProgress } = useQuery({
    queryKey: ['episodes-progress', id],
    queryFn:  () => mediaService.getEpisodesProgress(id!),
    enabled:  !!id && !episodeId,
  })
  useEffect(() => {
    if (episodeId || !media?.episodes?.length || !episodesProgress) return
    const eps  = media.episodes
    const last = episodesProgress[0]
    const idx  = last ? eps.findIndex((e: Episode) => e.id === last.episodeId) : -1
    const next = idx === -1 ? eps[0] : last.completed ? (eps[idx + 1] ?? eps[idx]) : eps[idx]
    navigate(`/player/${id}?ep=${next.id}`, { replace: true })
  }, [episodeId, media, episodesProgress, id, navigate])

  const currentEpisode = episodeId
    ? media?.episodes?.find((e: Episode) => e.id === episodeId)
    : null

  const userId = useAuthStore((s) => s.user?.id)
  const { data: streamToken, error: streamTokenError, refetch: retryToken } = useQuery({
    queryKey:  ['stream-token', userId],
    queryFn:   getStreamToken,
    staleTime: 60 * 60 * 1000,
    retry:     1,
  })

  const isShow    = media?.type === 'serie' || media?.type === 'anime'
  const filePath  = currentEpisode?.filePath || (isShow ? '' : media?.filePath) || ''
  const streamUrl = filePath && streamToken ? filesService.buildStreamUrl(filePath, streamToken) : ''

  // Netflix-like: resume automatically where the user stopped (unless almost finished)
  useEffect(() => {
    setResumeAt(null); setShowResume(false)
    if (savedProgress && savedProgress.progress > 30 && !savedProgress.completed) {
      setResumeAt(savedProgress.progress)
      setShowResume(true)
    }
  }, [savedProgress])

  function saveNow(completed = false) {
    const { t, d } = latestRef.current
    if (!id || !(d > 0) || !(t > 0)) return
    mediaService.saveProgress(id, Math.floor(completed ? d : t), Math.floor(d), episodeId).catch(() => {})
  }

  function handleTimeUpdate(current: number, duration: number) {
    latestRef.current = { t: current, d: duration }
    if (!progressRef.current) progressRef.current = setInterval(() => saveNow(), 5000)
  }

  // Save when leaving the page or switching episode
  useEffect(() => {
    latestRef.current = { t: 0, d: 0 }
    return () => {
      if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null }
      saveNow()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, episodeId])

  function handleEnded() {
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null }
    saveNow(true)
    if (media?.episodes && episodeId) {
      const idx  = media.episodes.findIndex((e: Episode) => e.id === episodeId)
      const next = media.episodes[idx + 1]
      if (next) navigate(`/player/${id}?ep=${next.id}`)
    }
  }

  const episodes: Episode[] = media?.episodes || []
  const seasons = [...new Set(episodes.map((e) => e.season || 1))].sort()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#000' }}>

      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 min-w-0"
        style={{ background: 'rgba(0,0,0,0.6)', paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <button
          className="flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white transition-colors flex-shrink-0"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} strokeWidth={2} /> Retour
        </button>
        {media && (
          <span className="text-white/50 text-[13px] truncate min-w-0">
            {media.title}
            {currentEpisode && ` · S${currentEpisode.season}E${currentEpisode.episodeNumber}`}
          </span>
        )}
      </div>

      {/* Player */}
      <div className="relative">
        {media && isShow && !media.episodes?.length && (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ aspectRatio: '16/9', maxHeight: '75vh' }}>
            <p className="text-[14px] font-semibold text-white/80">Aucun épisode trouvé pour cette série</p>
            <p className="text-[12px] text-white/50">Lance un scan depuis la page de la série.</p>
          </div>
        )}
        {/* Could not get a playback authorisation: say so instead of a blank page */}
        {streamTokenError && (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ aspectRatio: '16/9', maxHeight: '75vh' }}>
            <p className="text-[14px] font-semibold text-white/85">Lecture impossible</p>
            <p className="text-[12px] text-white/55 max-w-sm">{describeTokenError(streamTokenError)}</p>
            <button className="btn-ghost text-[12px] mt-1" onClick={() => retryToken()}>Réessayer</button>
          </div>
        )}
        {!streamTokenError && filePath && !streamToken && (
          <div className="flex items-center justify-center" style={{ aspectRatio: '16/9', maxHeight: '75vh' }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'white' }} />
          </div>
        )}
        {streamUrl && (
          <VideoPlayer
            src={streamUrl}
            initialTime={resumeAt ?? undefined}
            seekTo={seekTo}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
          />
        )}

        {/* Resume prompt */}
        {showResume && resumeAt && (
          // Below the video on phones (never over the controls), floating on larger screens
          <div
            className="relative mx-3 mt-3 sm:m-0 sm:absolute sm:bottom-20 sm:right-6 card p-3 sm:p-4 flex flex-wrap items-center gap-3 sm:min-w-[280px]"
            style={{ boxShadow: 'var(--shadow-lg)', zIndex: 30 }}
          >
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Reprise à {formatDuration(resumeAt)}</p>
              <p className="text-[11px]" style={{ color: 'var(--text3)' }}>La lecture reprend là où tu t'étais arrêté.</p>
            </div>
            <div className="flex gap-2 ml-auto">
              <button className="btn-ghost text-[12px]"
                onClick={() => { setSeekTo({ time: 0, key: Date.now() }); setShowResume(false) }}>
                Recommencer
              </button>
              <button className="btn-primary text-[12px]" onClick={() => setShowResume(false)}>OK</button>
            </div>
          </div>
        )}
      </div>

      {/* Media info + episodes */}
      {media && (
        <div className="px-4 sm:px-6 py-4" style={{ background: 'var(--bg)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-start gap-4 mb-4">
            {media.posterPath && (
              <img src={media.posterPath} alt=""
                className="w-16 h-24 rounded-lg object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-[18px] sm:text-[20px] font-bold tracking-tight mb-1 break-words" style={{ color: 'var(--text)' }}>
                {media.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
                {media.year && <span className="text-[12px] font-mono" style={{ color: 'var(--text3)' }}>{media.year}</span>}
                {media.rating && (
                  <span className="flex items-center gap-1 text-[12px] font-mono" style={{ color: 'var(--yellow)' }}>
                    <Star size={11} fill="var(--yellow)" color="var(--yellow)" /> {Number(media.rating).toFixed(1)}
                  </span>
                )}
                {media.genres?.slice(0, 3).map((g) => (
                  <span key={g} className="badge text-[10px]"
                    style={{ background: 'var(--surface2)', color: 'var(--text3)' }}>{g}</span>
                ))}
              </div>
              {media.overview && (
                <p className="text-[12.5px] leading-relaxed line-clamp-3" style={{ color: 'var(--text2)' }}>
                  {media.overview}
                </p>
              )}
            </div>
          </div>

          {/* Episodes */}
          {episodes.length > 0 && (
            <div>
              <h2 className="text-[14px] font-semibold mb-3" style={{ color: 'var(--text)' }}>Épisodes</h2>
              {seasons.map((season) => (
                <div key={season} className="mb-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text3)' }}>
                    Saison {season}
                  </div>
                  <div className="flex flex-col gap-1">
                    {episodes
                      .filter((e) => (e.season || 1) === season)
                      .map((ep) => (
                        <button
                          key={ep.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
                          style={{
                            background: ep.id === episodeId ? 'var(--blue-dim)' : 'transparent',
                            border:     `1px solid ${ep.id === episodeId ? 'var(--blue)' : 'transparent'}`,
                          }}
                          onMouseEnter={(e) => { if (ep.id !== episodeId) e.currentTarget.style.background = 'var(--surface2)' }}
                          onMouseLeave={(e) => { if (ep.id !== episodeId) e.currentTarget.style.background = 'transparent' }}
                          onClick={() => navigate(`/player/${id}?ep=${ep.id}`)}
                        >
                          <span className="text-[11px] font-mono w-6 flex-shrink-0" style={{ color: 'var(--text3)' }}>
                            {ep.episodeNumber}
                          </span>
                          <span className="text-[13px] flex-1 truncate"
                            style={{ color: ep.id === episodeId ? 'var(--blue)' : 'var(--text)' }}>
                            {ep.title || `Épisode ${ep.episodeNumber}`}
                          </span>
                          {ep.duration && (
                            <span className="text-[11px] font-mono flex-shrink-0" style={{ color: 'var(--text3)' }}>
                              {formatDuration(ep.duration)}
                            </span>
                          )}
                          <ChevronRight size={13} strokeWidth={2} style={{ color: 'var(--text3)' }} />
                        </button>
                      ))
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
