import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Star, ChevronRight } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { filesService } from '@/services/filesService'
import { formatDuration } from '@/utils'
import '@/assets/plyr-nexus.css'
import type { Episode } from '@/types'

export default function PlayerPage() {
  const { id }              = useParams<{ id: string }>()
  const [searchParams]      = useSearchParams()
  const navigate            = useNavigate()
  const episodeId           = searchParams.get('ep') || undefined

  const videoRef    = useRef<HTMLVideoElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef   = useRef<any>(null)
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

  // Determine which file to play
  const currentEpisode = episodeId
    ? media?.episodes?.find((e: Episode) => e.id === episodeId)
    : null

  const filePath = currentEpisode?.filePath || media?.filePath || ''
  const streamUrl = filePath ? filesService.getStreamUrl(filePath) : ''

  // Load Plyr
  useEffect(() => {
    if (!videoRef.current || !streamUrl) return

    async function initPlyr() {
      const Plyr = (await import('plyr')).default
      // @ts-expect-error — CSS module lacks type declarations
      await import('plyr/dist/plyr.css')

      if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }

      const player = new Plyr(videoRef.current!, {
        controls: [
          'play-large', 'play', 'rewind', 'fast-forward',
          'progress', 'current-time', 'duration',
          'mute', 'volume', 'captions', 'settings',
          'pip', 'fullscreen',
        ],
        settings:    ['quality', 'speed', 'captions'],
        speed:       { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
        keyboard:    { focused: true, global: true },
        tooltips:    { controls: true, seek: true },
        i18n: {
          play:             'Lecture',
          pause:            'Pause',
          mute:             'Muet',
          unmute:           'Son',
          fullscreen:       'Plein écran',
          exitFullscreen:   'Quitter plein écran',
          speed:            'Vitesse',
          settings:         'Paramètres',
          captions:         'Sous-titres',
          pip:              'Picture in picture',
        },
      })

      playerRef.current = player

      // Show resume prompt if > 30s watched
      if (savedProgress && savedProgress.progress > 30) {
        setResumeAt(savedProgress.progress)
        setShowResume(true)
      }

      // Save progress every 5 seconds
      player.on('timeupdate', () => {
        if (progressRef.current) return
        progressRef.current = setInterval(async () => {
          if (!player.playing) return
          const current  = player.currentTime
          const duration = player.duration
          if (current > 0 && duration > 0 && id) {
            await mediaService.saveProgress(id, Math.floor(current), Math.floor(duration), episodeId)
          }
        }, 5000)
      })

      player.on('pause', () => {
        if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null }
      })

      player.on('ended', () => {
        if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null }
        // Auto next episode
        if (media?.episodes && episodeId) {
          const idx  = media.episodes.findIndex((e: Episode) => e.id === episodeId)
          const next = media.episodes[idx + 1]
          if (next) navigate(`/player/${id}?ep=${next.id}`)
        }
      })

    }

    initPlyr()

    return () => {
      if (progressRef.current) clearInterval(progressRef.current)
      playerRef.current?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, id, episodeId])

  function resume() {
    if (playerRef.current && resumeAt) {
      playerRef.current.currentTime = resumeAt
      playerRef.current.play()
    }
    setShowResume(false)
  }

  const episodes: Episode[] = media?.episodes || []
  const seasons = [...new Set(episodes.map((e) => e.season || 1))].sort()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#000' }}>

      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 absolute top-0 left-0 right-0 z-20"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)' }}
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

      {/* Video */}
      <div className="flex-1 flex items-center justify-center relative" style={{ minHeight: '60vh' }}>
        <video ref={videoRef} className="w-full" style={{ maxHeight: '75vh' }}>
          {streamUrl && <source src={streamUrl} />}
        </video>

        {/* Resume prompt */}
        {showResume && resumeAt && (
          <div
            className="absolute bottom-20 right-6 card p-4 flex items-center gap-3 animate-fade-up"
            style={{ boxShadow: 'var(--shadow-lg)', minWidth: '260px' }}
          >
            <div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Reprendre ?</p>
              <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                Vous vous étiez arrêté à {formatDuration(resumeAt)}
              </p>
            </div>
            <div className="flex gap-2 ml-auto">
              <button className="btn-ghost text-[12px]" onClick={() => setShowResume(false)}>Non</button>
              <button className="btn-primary text-[12px]" onClick={resume}>Reprendre</button>
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
                    <Star size={11} fill="var(--yellow)" color="var(--yellow)" /> {media.rating.toFixed(1)}
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
