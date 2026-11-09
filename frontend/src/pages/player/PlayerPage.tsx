import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { getStreamToken } from '@/services/streamToken'
import { useAuthStore } from '@/stores/authStore'
import { formatDuration } from '@/utils'
import VideoPlayer from './VideoPlayer'
import Artwork from '@/components/media/Artwork'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import { Group, ListRow } from '@/components/ui/GroupedList'
import { rating } from '@/components/media/mediaActions'
import type { Episode } from '@/types'

/** Human-readable reason why the playback authorisation failed. */
function describeTokenError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 404) return 'Le serveur ne connaît pas l’autorisation de lecture (erreur 404) : il n’est pas à jour, relance le déploiement.'
  if (status === 401) return 'Session expirée (erreur 401) : reconnecte-toi.'
  if (status === 429) return 'Trop de requêtes (erreur 429) : attends quelques minutes ou augmente RATE_LIMIT_MAX dans backend/.env.'
  if (status) return `Le serveur a refusé la lecture (erreur ${status}).`
  if (err instanceof Error && err.message) return err.message
  return 'Le serveur n’a pas autorisé la lecture.'
}


/** The last progress save in flight: the next player waits for it before reading the position. */
let lastSave: Promise<void> = Promise.resolve()

export default function PlayerPage() {
  const { id }         = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()
  const qc = useQueryClient()
  const episodeId      = searchParams.get('ep') || undefined

  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Latest playback position, read by the periodic save (a closure would freeze it)
  const latestRef   = useRef<{ t: number; d: number }>({ t: 0, d: 0 })
  const [resumeAt,   setResumeAt]   = useState<number | null>(null)
  const [showResume, setShowResume] = useState(false)
  const [seekTo,     setSeekTo]     = useState<{ time: number; key: number } | undefined>()
  /** Right of the top bar: the player puts AirPlay / Image dans l’image / lock there */
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  /** Under the video (phone): « Épisodes » / « Épisode suivant » */
  const [belowSlot, setBelowSlot] = useState<HTMLDivElement | null>(null)

  const { data: media } = useQuery({
    queryKey: ['media', id],
    queryFn:  () => mediaService.getById(id!),
    enabled:  !!id,
  })

  // Always the position saved last, never a cached one: opening the film again right after
  // leaving it resumed from the old cached position (or from 0 the first time). The save
  // made when leaving is waited for first, so its position is the one read.
  const { data: savedProgress, isFetchedAfterMount: progressFetched, isError: progressError } = useQuery({
    queryKey: ['progress', id, episodeId],
    queryFn:  async () => { await lastSave; return mediaService.getProgress(id!, episodeId) },
    enabled:  !!id,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // A series/anime opened without ?ep= : jump to the episode to watch next
  // (never try to stream the show's folder)
  const { data: episodesProgress } = useQuery({
    queryKey: ['episodes-progress', id],
    queryFn:  async () => { await lastSave; return mediaService.getEpisodesProgress(id!) },
    staleTime: 0,
    refetchOnMount: 'always',
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
  const progressReady = progressFetched || progressError
  // Computed synchronously (not from state) so the player gets it on its very first render
  const resumePosition = savedProgress && savedProgress.progress > 30 && !savedProgress.completed
    ? savedProgress.progress : undefined
  // Mount the player once the saved position is known: a converted stream starts at that position
  const canPlay = !!filePath && !!streamToken && progressReady

  // Netflix-like: resume automatically where the user stopped (unless almost finished)
  useEffect(() => {
    setResumeAt(null); setShowResume(false)
    if (savedProgress && savedProgress.progress > 30 && !savedProgress.completed) {
      setResumeAt(savedProgress.progress)
      setShowResume(true)
    }
  }, [savedProgress])

  function saveNow(completed = false, refresh = false) {
    const { t, d } = latestRef.current
    if (!id || !(d > 0) || !(t > 0)) return
    const saved = mediaService.saveProgress(id, Math.floor(completed ? d : t), Math.floor(d), episodeId).catch(() => {})
    lastSave = saved
    // Leaving the film / an episode ending: « Reprendre », the title page's progress and
    // the next resume position are up to date at once (no library scan needed)
    if (refresh) {
      void saved.then(() => {
        void qc.invalidateQueries({ queryKey: ['media', 'continue'] })
        void qc.invalidateQueries({ queryKey: ['progress', id] })
        void qc.invalidateQueries({ queryKey: ['episodes-progress', id] })
      })
    }
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
      saveNow(false, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, episodeId])

  function handleEnded() {
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null }
    saveNow(true, true)
    if (media?.episodes && episodeId) {
      const idx  = media.episodes.findIndex((e: Episode) => e.id === episodeId)
      const next = media.episodes[idx + 1]
      if (next) navigate(`/player/${id}?ep=${next.id}`)
    }
  }

  const episodes: Episode[] = media?.episodes || []
  const epIndex = episodeId ? episodes.findIndex((e) => e.id === episodeId) : -1
  const nextEpisode = epIndex >= 0 ? episodes[epIndex + 1] : undefined
  const playerTitle = media
    ? currentEpisode ? `${media.title} · S${currentEpisode.season ?? 1}, É${currentEpisode.episodeNumber}` : media.title
    : undefined
  const playerEpisodes = episodes.length > 1 ? episodes.map((e) => ({
    id: e.id,
    title: `${e.season ? `S${e.season}, ` : ''}É${e.episodeNumber}${e.title ? ` · ${e.title}` : ''}`,
    subtitle: e.duration ? formatDuration(e.duration) : undefined,
    current: e.id === episodeId,
  })) : undefined
  const seasons = [...new Set(episodes.map((e) => e.season || 1))].sort()

  const frame = 'flex flex-col items-center justify-center gap-2 text-center px-6 w-full'
  const frameStyle = { aspectRatio: '16/9', maxHeight: '75vh' } as const
  const r = rating(media?.rating)

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg">
      {/* Player area: always dark */}
      <div className="bg-black">
        <div className="flex items-center gap-2 min-h-[44px] px-2 text-white" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <button type="button" className="flex items-center h-9 my-1 pl-1.5 pr-3.5 rounded-pill glass-clear text-[15px] md:text-body font-medium text-white" onClick={() => navigate(-1)}>
            <ChevronLeft size={26} strokeWidth={2} className="md:w-5 md:h-5" aria-hidden="true" /> Retour
          </button>
          <span className="flex-1 min-w-0 text-center text-subhead text-white/70 truncate">
            {media && <>{media.title}{currentEpisode && ` · S${currentEpisode.season ?? 1}, É${currentEpisode.episodeNumber}`}</>}
          </span>
          <div ref={setToolbarSlot} className="flex-shrink-0 flex justify-end min-w-[88px]" />
        </div>

        <div className="relative">
          {media && isShow && !media.episodes?.length && (
            <div className={frame} style={frameStyle}>
              <p className="text-[15px] font-semibold text-white/85">Aucun épisode trouvé pour cette série</p>
              <p className="text-[13px] text-white/55">Lance une analyse depuis la page de la série.</p>
            </div>
          )}
          {/* Could not get a playback authorisation: say so instead of a blank page */}
          {streamTokenError && (
            <div className={frame} style={frameStyle} role="alert">
              <p className="text-[15px] font-semibold text-white/90">Lecture impossible</p>
              <p className="text-[13px] text-white/60 max-w-sm">{describeTokenError(streamTokenError)}</p>
              <button type="button" className="mt-2 px-4 min-h-[32px] rounded-full bg-white/15 text-white text-[13px] font-medium hover:bg-white/25" onClick={() => retryToken()}>Réessayer</button>
            </div>
          )}
          {!streamTokenError && filePath && !streamToken && (
            <div className={frame} style={frameStyle}><Spinner size={32} color="rgba(255,255,255,.9)" /></div>
          )}
          {canPlay && (
            <VideoPlayer
              key={filePath}
              filePath={filePath}
              streamToken={streamToken!}
              initialTime={resumePosition}
              seekTo={seekTo}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              title={playerTitle}
              toolbarSlot={toolbarSlot}
              belowSlot={belowSlot}
              artwork={media?.posterPath}
              episodes={playerEpisodes}
              onSelectEpisode={(epId) => navigate(`/player/${id}?ep=${epId}`, { replace: true })}
              onNext={nextEpisode ? () => navigate(`/player/${id}?ep=${nextEpisode.id}`, { replace: true }) : undefined}
            />
          )}

          {/* Resume prompt: under the video on phones, floating top-right on larger screens */}
          {showResume && resumeAt && (
            <div
              role="status"
              className="relative mx-3 my-3 sm:m-0 sm:absolute sm:top-4 sm:right-4 z-30 flex flex-wrap items-center gap-3 rounded-[22px] px-4 py-3 glass-media"
              style={{ animation: 'nx-pop 380ms var(--ease-spring) both' }}
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Reprise à {formatDuration(resumeAt)}</p>
                <p className="text-[12px] text-white/65">La lecture reprend là où tu t’étais arrêté.</p>
              </div>
              <div className="flex gap-2 ml-auto">
                <button type="button" className="px-3 min-h-[30px] rounded-full bg-white/15 text-[13px] font-medium hover:bg-white/25"
                  onClick={() => { setSeekTo({ time: 0, key: Date.now() }); setShowResume(false) }}>
                  Recommencer
                </button>
                <button type="button" className="px-3 min-h-[30px] rounded-full bg-white text-black text-[13px] font-medium" onClick={() => setShowResume(false)}>OK</button>
              </div>
            </div>
          )}
        </div>
        {/* Phone: « Épisodes » / « Épisode suivant » (put here by the player) */}
        <div ref={setBelowSlot} />
      </div>

      {/* Media info + episodes */}
      {media && (
        <div className="w-full max-w-[1100px] mx-auto gutter safe-x py-6 flex flex-col gap-8" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <div className="flex items-start gap-4">
            <Artwork src={media.posterPath} alt="" type={media.type} className="w-16 flex-shrink-0 rounded-[6px]" />
            <div className="flex-1 min-w-0">
              <h1 className="text-title text-label break-words">{media.title}</h1>
              <p className="text-subhead text-label2 mt-0.5 tabular">
                {[media.year, r && `${r} / 10`, ...(media.genres?.slice(0, 3) ?? [])].filter(Boolean).join(' · ')}
              </p>
              {media.overview && <p className="text-callout text-label2 mt-2 line-clamp-3 max-w-[70ch]">{media.overview}</p>}
            </div>
          </div>

          {episodes.length > 0 && seasons.map((season) => (
            <Group key={season} header={season === 0 ? 'Spéciaux' : `Saison ${season}`}>
              {episodes.filter((e) => (e.season || 1) === season).map((ep) => (
                <ListRow
                  key={ep.id}
                  onClick={() => navigate(`/player/${id}?ep=${ep.id}`)}
                  selected={ep.id === episodeId}
                  title={<><span className="text-label2 tabular mr-2">{ep.episodeNumber}</span>{ep.title || `Épisode ${ep.episodeNumber}`}</>}
                  detail={ep.id === episodeId ? 'En lecture' : ep.duration ? formatDuration(ep.duration) : undefined}
                  accessory={ep.id === episodeId ? undefined : 'chevron'}
                />
              ))}
            </Group>
          ))}
          {media.type !== 'film' && <Button variant="plain" className="self-start" onClick={() => navigate(`/media/${media.id}`)}>Voir la fiche complète</Button>}
        </div>
      )}
    </div>
  )
}
