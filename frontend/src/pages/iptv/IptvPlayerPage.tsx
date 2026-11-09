import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronLeft, Heart, Maximize, Minimize, Pause, PictureInPicture2, Play, RefreshCw, SkipBack, SkipForward,
  Volume2, VolumeX,
} from 'lucide-react'
import type Hls from 'hls.js'
import Spinner from '@/components/ui/Spinner'
import { getStreamToken } from '@/services/streamToken'
import { iptvService, type IptvChannel } from '@/services/iptvService'
import { cn } from '@/utils'
import { ChannelLogo, readQueue, rememberQueue, useToggleFavorite } from './ChannelTile'
import { categoryName, countryName, flag } from './labels'

/** Safari plays HLS itself (AirPlay, Picture in Picture); elsewhere hls.js */
const NATIVE_HLS = typeof document !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

type Phase = 'loading' | 'playing' | 'paused' | 'error'

/**
 * Live player of an IPTV channel. The stream comes through the Nexus server (CORS, http
 * streams on an https page, Referer / User-Agent of the catalogue), nothing is stored.
 * A stream that fails falls back to the channel's next stream; when all fail the channel is
 * checked for real and the reason is shown.
 */
export default function IptvPlayerPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recorded = useRef('')

  const [stream, setStream] = useState(0)
  /** « Réessayer » starts the streams again from the first one */
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [controls, setControls] = useState(true)
  const [dvr, setDvr] = useState<{ start: number; end: number; now: number } | null>(null)

  const { data: channel, isError } = useQuery({ queryKey: ['iptv', 'channel', id], queryFn: () => iptvService.channel(id), retry: 1 })
  const { data: token } = useQuery({ queryKey: ['stream-token'], queryFn: getStreamToken, staleTime: 30 * 60_000 })
  const fav = useToggleFavorite()

  // Previous / next channel: the list it was opened from (else the favourites)
  const queue = useRef<string[]>(readQueue())
  const { data: favs } = useQuery({ queryKey: ['iptv', 'favorites'], queryFn: iptvService.favorites, enabled: queue.current.length === 0 })
  useEffect(() => {
    if (!queue.current.length && favs?.length) { queue.current = favs.map((c) => c.id); rememberQueue(queue.current) }
  }, [favs])
  const neighbour = (d: -1 | 1) => {
    const q = queue.current
    const i = q.indexOf(id)
    if (q.length < 2 || i < 0) return null
    return q[(i + d + q.length) % q.length]
  }
  const zap = (d: -1 | 1) => {
    const next = neighbour(d)
    if (next) navigate(`/iptv/watch/${encodeURIComponent(next)}`, { replace: true })
  }

  useEffect(() => { setStream(0); setError(null); setPhase('loading'); setDvr(null) }, [id])

  const reveal = useCallback(() => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (!videoRef.current?.paused) setControls(false) }, 3500)
  }, [])

  /** Every stream failed: check the channel for real and say why */
  const giveUp = useCallback(async (fallback: string) => {
    setPhase('error')
    setError(fallback)
    try {
      const checked = await iptvService.check(id)
      qc.setQueryData(['iptv', 'channel', id], checked)
      if (checked.status === 'offline' && checked.statusReason) setError(`Chaîne indisponible : ${checked.statusReason}.`)
    } catch { /* keep the first message */ }
  }, [id, qc])

  // ── Source ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v || !channel || !token) return
    if (stream >= channel.streams.length) { void giveUp('Aucun des flux de cette chaîne ne répond.'); return }
    let cancelled = false
    setPhase('loading')
    setError(null)
    const url = iptvService.playUrl(channel.id, stream, token)
    const nextStream = () => { if (!cancelled) setStream((s) => s + 1) }

    if (NATIVE_HLS && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url
      v.onerror = nextStream
      void v.play().catch(() => setPhase('paused'))
    } else {
      void import('hls.js').then(({ default: HlsJs }) => {
        if (cancelled) return
        if (!HlsJs.isSupported()) { setPhase('error'); setError('Ce navigateur ne sait pas lire les flux en direct.'); return }
        const hls = new HlsJs({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 60, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2 })
        hlsRef.current = hls
        let recoveries = 0
        hls.on(HlsJs.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR && recoveries++ < 2) { hls.recoverMediaError(); return }
          hls.destroy()
          hlsRef.current = null
          nextStream()
        })
        hls.on(HlsJs.Events.MANIFEST_PARSED, () => { void v.play().catch(() => setPhase('paused')) })
        hls.loadSource(url)
        hls.attachMedia(v)
      })
    }
    return () => {
      cancelled = true
      v.onerror = null
      hlsRef.current?.destroy()
      hlsRef.current = null
      v.removeAttribute('src')
      v.load()
    }
  }, [channel?.id, stream, token, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Media events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlaying = () => {
      setPhase('playing')
      reveal()
      if (recorded.current !== id) { recorded.current = id; void iptvService.watched(id).then(() => qc.invalidateQueries({ queryKey: ['iptv', 'summary'] })) }
    }
    const onPause = () => { setPhase((p) => (p === 'error' ? p : 'paused')); setControls(true) }
    const onWaiting = () => setPhase((p) => (p === 'error' ? p : 'loading'))
    const onVolume = () => { setMuted(v.muted); setVolume(v.volume) }
    const onTime = () => {
      // A live stream with a seekable window of more than a minute can be rewound (DVR)
      const s = v.seekable
      if (s.length && s.end(s.length - 1) - s.start(0) > 60) setDvr({ start: s.start(0), end: s.end(s.length - 1), now: v.currentTime })
      else setDvr(null)
    }
    v.addEventListener('playing', onPlaying)
    v.addEventListener('pause', onPause)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('volumechange', onVolume)
    v.addEventListener('timeupdate', onTime)
    return () => {
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('volumechange', onVolume)
      v.removeEventListener('timeupdate', onTime)
    }
  }, [id, qc, reveal])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Lock screen / Control Center: channel name, play / pause, previous / next channel
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || !channel || typeof MediaMetadata === 'undefined') return
    ms.metadata = new MediaMetadata({ title: channel.name, artist: 'Nexus · en direct', artwork: channel.logo ? [{ src: new URL(channel.logo, location.href).toString() }] : [] })
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h) } catch { /* unsupported */ } }
    set('play', () => { void videoRef.current?.play() })
    set('pause', () => videoRef.current?.pause())
    set('previoustrack', () => zap(-1))
    set('nexttrack', () => zap(1))
    return () => { for (const a of ['play', 'pause', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) set(a, null) }
  }, [channel]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return }
    const el = boxRef.current
    if (el?.requestFullscreen) { void el.requestFullscreen().catch(() => {}); return }
    (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.()
  }
  const togglePip = async () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }) | null
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else if (document.pictureInPictureEnabled) await v.requestPictureInPicture()
      else v.webkitSetPresentationMode?.('picture-in-picture')
    } catch { /* not available here */ }
  }
  const retry = () => { setError(null); setPhase('loading'); setStream(0); setAttempt((a) => a + 1) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const v = videoRef.current
      if (!v) return
      if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); togglePlay() }
      else if (e.code === 'ArrowUp' || e.code === 'PageUp') { e.preventDefault(); zap(-1) }
      else if (e.code === 'ArrowDown' || e.code === 'PageDown') { e.preventDefault(); zap(1) }
      else if (e.code === 'KeyM') v.muted = !v.muted
      else if (e.code === 'KeyF') toggleFullscreen()
      else if (e.code === 'Escape' && !document.fullscreenElement) navigate(-1)
      reveal()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }) // re-bound each render: always the current channel

  const show = controls || phase !== 'playing'
  const fade = (on: boolean): React.CSSProperties => ({
    opacity: on ? 1 : 0, pointerEvents: on ? 'auto' : 'none',
    transition: 'opacity 250ms var(--ease-out), transform 500ms var(--ease-spring)', transform: on ? 'none' : 'translateY(6px)',
  })
  const btn = 'w-11 h-11 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20 active:scale-95 transition-transform'
  const now = channel?.guide?.find((g) => new Date(g.start) <= new Date() && new Date(g.end) > new Date())
  const next = channel?.guide?.find((g) => new Date(g.start) > new Date())

  return (
    <div
      ref={boxRef}
      className="fixed inset-0 bg-black text-white select-none"
      onMouseMove={reveal}
      onPointerDown={reveal}
    >
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline autoPlay onClick={togglePlay} />

      {/* Loading / error */}
      {(phase === 'loading' || isError) && !error && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none" role="status" aria-live="polite">
          <Spinner size={36} label="Chargement de la chaîne" color="rgba(255,255,255,.9)" />
        </div>
      )}
      {(error || isError) && (
        <div className="absolute inset-0 grid place-items-center px-6" role="alert">
          <div className="max-w-[380px] text-center flex flex-col items-center gap-3">
            <AlertTriangle size={30} strokeWidth={1.5} className="text-white/70" aria-hidden="true" />
            <p className="text-[17px] font-semibold">{isError ? 'Chaîne introuvable' : 'Lecture impossible'}</p>
            <p className="text-[14px] text-white/70">{isError ? 'Elle n’est plus dans le catalogue.' : error}</p>
            {!isError && (
              <div className="flex gap-2 mt-1">
                <button type="button" className="h-11 px-4 rounded-pill glass-media text-[15px] font-semibold inline-flex items-center gap-2" onClick={retry}>
                  <RefreshCw size={16} aria-hidden="true" /> Réessayer
                </button>
                {neighbour(1) && <button type="button" className="h-11 px-4 rounded-pill bg-white text-black text-[15px] font-semibold" onClick={() => zap(1)}>Chaîne suivante</button>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top: back, channel identity, live badge, favourite */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-3 px-3 sm:px-5" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 0px))', ...fade(show) }}>
        <button type="button" className="h-11 min-w-11 px-2.5 sm:pl-2 sm:pr-4 rounded-pill glass-media flex items-center justify-center gap-1 text-[15px] font-semibold flex-shrink-0" onClick={() => navigate(-1)} aria-label="Retour">
          <ChevronLeft size={22} aria-hidden="true" /> <span className="hidden sm:inline">Retour</span>
        </button>
        {channel && (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <ChannelLogo channel={channel} className="w-14 h-9 rounded-[10px] flex-shrink-0 hidden sm:grid" />
            <div className="min-w-0">
              <p className="text-[17px] font-semibold truncate" style={{ textShadow: '0 1px 6px rgba(0,0,0,.6)' }}>{channel.name}</p>
              <p className="text-[12px] text-white/75 truncate">
                {[channel.country && `${flag(channel.country)} ${countryName(channel.country)}`, channel.categories[0] && categoryName(channel.categories[0])].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        )}
        <span className="flex items-center gap-1.5 h-7 px-2.5 rounded-pill bg-danger text-[11px] font-bold tracking-wide flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-white" aria-hidden="true" /> EN DIRECT
        </span>
        {channel && (
          <button type="button" className={cn(btn, 'glass-media flex-shrink-0')} onClick={() => fav.mutate(channel as IptvChannel)}
            aria-label={channel.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={channel.favorite}>
            <Heart size={19} className={channel.favorite ? 'fill-white' : ''} />
          </button>
        )}
      </div>

      {/* Bottom: guide (when one is configured), transport */}
      <div className="absolute inset-x-0 bottom-0 px-3 sm:px-0 flex flex-col items-center gap-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))', ...fade(show) }}>
        {now && (
          <div className="w-full sm:w-[min(680px,calc(100%-32px))] px-4 py-2.5 rounded-[20px] glass-media">
            <p className="text-[13px]"><span className="text-white/60">{fmtTime(now.start)}–{fmtTime(now.end)} · </span><span className="font-semibold">{now.title}</span></p>
            {next && <p className="text-[12px] text-white/60 truncate">Ensuite, {fmtTime(next.start)} : {next.title}</p>}
          </div>
        )}
        <div className="w-full sm:w-[min(680px,calc(100%-32px))] glass-media rounded-[26px] px-2 py-1.5 sm:px-3">
          {dvr && (
            <div className="flex items-center gap-2 px-2 pt-1 text-[11px] text-white/80 tabular">
              <input type="range" className="flex-1" min={dvr.start} max={dvr.end} step={1} value={dvr.now} style={{ accentColor: 'white' }}
                onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value) }} aria-label="Position dans le direct" />
              <button type="button" className="px-2 h-7 rounded-pill hover:bg-white/10 font-semibold" onClick={() => { if (videoRef.current) videoRef.current.currentTime = dvr.end }}>
                {dvr.end - dvr.now > 10 ? `-${Math.round((dvr.end - dvr.now) / 60)} min · Direct` : 'Direct'}
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button type="button" className={btn} onClick={() => zap(-1)} disabled={!neighbour(-1)} aria-label="Chaîne précédente"><SkipBack size={20} fill="white" strokeWidth={1.5} /></button>
            <button type="button" className={btn} onClick={togglePlay} aria-label={phase === 'playing' ? 'Pause' : 'Lecture'}>
              {phase === 'playing' ? <Pause size={22} fill="white" strokeWidth={0} /> : <Play size={22} fill="white" strokeWidth={0} style={{ marginLeft: 2 }} />}
            </button>
            <button type="button" className={btn} onClick={() => zap(1)} disabled={!neighbour(1)} aria-label="Chaîne suivante"><SkipForward size={20} fill="white" strokeWidth={1.5} /></button>
            <p className="flex-1 min-w-0 px-2 text-[13px] text-white/75 truncate">
              <span className="hidden sm:inline">
                {channel?.streams[stream]?.quality ? `${channel.streams[stream].quality}` : ''}
                {channel && channel.streams.length > 1 ? ` · flux ${Math.min(stream + 1, channel.streams.length)}/${channel.streams.length}` : ''}
              </span>
            </p>
            <button type="button" className={btn} onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted }} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
              {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} className="hidden sm:block w-24" style={{ accentColor: 'white' }}
              onChange={(e) => { const v = videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = v.volume === 0 } }} aria-label="Volume" />
            <button type="button" className={btn} onClick={togglePip} aria-label="Image dans l’image"><PictureInPicture2 size={19} /></button>
            <button type="button" className={btn} onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
      {error && channel?.labels.includes('Geo-blocked') && (
        <p className="absolute inset-x-0 bottom-28 text-center text-[12px] text-white/60 px-6">iptv-org signale cette chaîne comme réservée à son pays.</p>
      )}
    </div>
  )
}
