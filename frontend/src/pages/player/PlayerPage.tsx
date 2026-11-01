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

export default function PlayerPage() {
  const { id }         = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()
  const episodeId      = searchParams.get('ep') || undefined

  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [resumeAt,   setResumeAt]   = useState<number | null>(null)
  const [showResume, setShowResume] = useState(false)

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
  const { data: streamToken } = useQuery({
    queryKey:  ['stream-token', userId],
    queryFn:   getStreamToken,
    staleTime: 60 * 60 * 1000,
  })

  const isShow    = media?.type === 'serie' || media?.type === 'anime'
  const filePath  = currentEpisode?.filePath || (isShow ? '' : media?.filePath) || ''
  const streamUrl = filePath && streamToken ? filesService.buildStreamUrl(filePath, streamToken) : ''

  useEffect(() => {
    if (savedProgress && savedProgress.progress > 30) {
      setResumeAt(savedProgress.progress)
      setShowResume(true)
    }
  }, [savedProgress])

  function handleTimeUpdate(current: number, duration: number) {
    if (progressRef.current) return
    progressRef.current = setInterval(async () => {
      if (current > 0 && duration > 0 && id) {
        await mediaService.saveProgress(id, Math.floor(current), Math.floor(duration), episodeId)
      }
    }, 5000)
  }

  function handleEnded() {
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null }
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
        {streamUrl && (
          <VideoPlayer
            src={streamUrl}
            initialTime={showResume && resumeAt ? resumeAt : undefined}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
          />
        )}

        {/* Resume prompt */}
        {showResume && resumeAt && (
          <div
            className="absolute bottom-16 sm:bottom-20 left-3 right-3 sm:left-auto sm:right-6 card p-3 sm:p-4 flex flex-wrap items-center gap-3 sm:min-w-[260px]"
            style={{ boxShadow: 'var(--shadow-lg)', zIndex: 30 }}
          >
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Reprendre ?</p>
              <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                Vous vous étiez arrêté à {formatDuration(resumeAt)}
              </p>
            </div>
            <div className="flex gap-2 ml-auto">
              <button className="btn-ghost text-[12px]" onClick={() => setShowResume(false)}>Non</button>
              <button className="btn-primary text-[12px]" onClick={() => setShowResume(false)}>Reprendre</button>
            </div>
          </div>
        )}
      </div>

      {/* Media info + episodes */}
      {media && (
        <div className="px-4 sm:px-6 py-4" style={{ background: 'var(--bg)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-start gap-4 mb-4">
            {media.posterPath && (
              <img src={media.posterPath} alt={media.title}
                className="w-16 h-24 rounded-lg object-cover flex-shrink-0" />
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
