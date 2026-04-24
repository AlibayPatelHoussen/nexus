import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Star, ChevronRight } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { filesService } from '@/services/filesService'
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

  const currentEpisode = episodeId
    ? media?.episodes?.find((e: Episode) => e.id === episodeId)
    : null

  const filePath  = currentEpisode?.filePath || media?.filePath || ''
  const streamUrl = filePath ? filesService.getStreamUrl(filePath) : ''

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
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <button
          className="flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white transition-colors"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} strokeWidth={2} /> Retour
        </button>
        {media && (
          <span className="text-white/50 text-[13px]">
            {media.title}
            {currentEpisode && ` · S${currentEpisode.season}E${currentEpisode.episodeNumber}`}
          </span>
        )}
      </div>

      {/* Player */}
      <div className="relative">
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
            className="absolute bottom-20 right-6 card p-4 flex items-center gap-3"
            style={{ boxShadow: 'var(--shadow-lg)', minWidth: '260px', zIndex: 30 }}
          >
            <div>
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
        <div className="px-6 py-4" style={{ background: 'var(--bg)' }}>
          <div className="flex items-start gap-4 mb-4">
            {media.posterPath && (
              <img src={media.posterPath} alt={media.title}
                className="w-16 h-24 rounded-lg object-cover flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-[20px] font-bold tracking-tight mb-1" style={{ color: 'var(--text)' }}>
                {media.title}
              </h1>
              <div className="flex items-center gap-3 mb-2">
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
                          <span className="text-[11px] font-mono w-6" style={{ color: 'var(--text3)' }}>
                            {ep.episodeNumber}
                          </span>
                          <span className="text-[13px] flex-1 truncate"
                            style={{ color: ep.id === episodeId ? 'var(--blue)' : 'var(--text)' }}>
                            {ep.title || `Épisode ${ep.episodeNumber}`}
                          </span>
                          {ep.duration && (
                            <span className="text-[11px] font-mono" style={{ color: 'var(--text3)' }}>
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
