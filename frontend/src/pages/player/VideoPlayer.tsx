import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Play, Pause, Volume2, VolumeX,
  Maximize, Minimize, RotateCcw, RotateCw,
} from 'lucide-react'
import type Hls from 'hls.js'
import { filesService } from '@/services/filesService'
import { getPlayInfo, startTranscode, stopTranscode } from '@/services/playbackService'

interface Props {
  /** Video file on the server */
  filePath: string
  /** Read-only stream token (media elements cannot send headers) */
  streamToken: string
  onTimeUpdate?: (current: number, duration: number) => void
  onEnded?: () => void
  initialTime?: number
  /** Imperative seek (e.g. "Recommencer"): a new key triggers the seek */
  seekTo?: { time: number; key: number }
}

/**
 * Playback source:
 * - direct: the browser reads the file itself (HTTP range requests)
 * - hls:    the server converts it on the fly (ffmpeg → HLS) starting at `offset`;
 *           the player shows a virtual timeline `offset + video.currentTime`
 *           over the real duration, and restarts the conversion when the user
 *           seeks outside of what has been converted.
 */
type Source =
  | { kind: 'direct' }
  | { kind: 'hls'; jobId: string; offset: number; total: number }

export default function VideoPlayer({ filePath, streamToken, onTimeUpdate, onEnded, initialTime, seekTo }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrubberRef  = useRef<HTMLDivElement>(null)
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointer  = useRef<string>('mouse')
  const hlsRef       = useRef<Hls | null>(null)
  const sourceRef    = useRef<Source | null>(null)
  const pendingSeek  = useRef<number | null>(null)
  const resumePlay   = useRef(false)
  const scrubTarget  = useRef<number | null>(null)
  // Latest callbacks without re-binding the media listeners on every render
  const onTimeRef    = useRef(onTimeUpdate)
  const onEndedRef   = useRef(onEnded)
  onTimeRef.current  = onTimeUpdate
  onEndedRef.current = onEnded

  const [playing,      setPlaying]      = useState(false)
  const [current,      setCurrent]      = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [volume,       setVolume]       = useState(1)
  const [muted,        setMuted]        = useState(false)
  const [fullscreen,   setFullscreen]   = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [scrubbing,    setScrubbing]    = useState(false)
  const [scrubHover,   setScrubHover]   = useState(false)
  const [buffered,     setBuffered]     = useState(0)
  const [error,        setError]        = useState<string | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [converting,   setConverting]   = useState(false)

  // ── Virtual timeline (identity for direct playback) ─
  const offset = () => (sourceRef.current?.kind === 'hls' ? sourceRef.current.offset : 0)
  const total  = () => {
    const s = sourceRef.current
    if (s?.kind === 'hls') return s.total
    const d = videoRef.current?.duration ?? 0
    return isFinite(d) ? d : 0
  }
  const now = () => offset() + (videoRef.current?.currentTime ?? 0)

  // ── Auto-hide controls ─────────────────────────────
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) setShowControls(false)
    }, 3000)
  }, [])

  function revealControls() {
    setShowControls(true)
    scheduleHide()
  }

  // ── Media element events (bound once) ──────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onLoaded = () => {
      setDuration(total())
      if (pendingSeek.current != null) {
        const t = pendingSeek.current
        pendingSeek.current = null
        if (t > 0 && t < v.duration) v.currentTime = t
      }
      if (resumePlay.current) { resumePlay.current = false; v.play().catch(() => {}) }
    }
    const onTime = () => {
      const t = now()
      setCurrent(scrubTarget.current ?? t)
      setDuration(total())
      if (v.buffered.length > 0) setBuffered(offset() + v.buffered.end(v.buffered.length - 1))
      onTimeRef.current?.(t, total())
    }
    const onPlay    = () => { setPlaying(true);  setError(null); scheduleHide() }
    const onPause   = () => {
      setPlaying(false)
      setShowControls(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
    const onEnded_  = () => { setPlaying(false); setShowControls(true); onEndedRef.current?.() }
    const onVol     = () => { setVolume(v.volume); setMuted(v.muted) }
    const onWaiting = () => setLoading(true)
    const onReady   = () => setLoading(false)
    const onErr     = () => {
      // hls.js reports its own (recoverable) errors; only native errors land here
      if (hlsRef.current) return
      setError('Le navigateur n\'a pas pu lire ce flux.')
      setLoading(false); setPlaying(false); setShowControls(true)
    }

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate',     onTime)
    v.addEventListener('play',           onPlay)
    v.addEventListener('pause',          onPause)
    v.addEventListener('ended',          onEnded_)
    v.addEventListener('volumechange',   onVol)
    v.addEventListener('waiting',        onWaiting)
    v.addEventListener('playing',        onReady)
    v.addEventListener('canplay',        onReady)
    v.addEventListener('error',          onErr)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate',     onTime)
      v.removeEventListener('play',           onPlay)
      v.removeEventListener('pause',          onPause)
      v.removeEventListener('ended',          onEnded_)
      v.removeEventListener('volumechange',   onVol)
      v.removeEventListener('waiting',        onWaiting)
      v.removeEventListener('playing',        onReady)
      v.removeEventListener('canplay',        onReady)
      v.removeEventListener('error',          onErr)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sources ────────────────────────────────────────
  function detach() {
    hlsRef.current?.destroy()
    hlsRef.current = null
    const s = sourceRef.current
    if (s?.kind === 'hls') stopTranscode(s.jobId)
    sourceRef.current = null
  }

  /** (Re)start the server-side conversion at `at` seconds and attach the HLS stream. */
  async function playConverted(at: number, autoplay: boolean) {
    const v = videoRef.current
    if (!v) return
    setLoading(true); setConverting(true); setError(null)
    detach()
    try {
      const session = await startTranscode(filePath, at)
      sourceRef.current = { kind: 'hls', jobId: session.id, offset: session.start, total: session.duration ?? 0 }
      setCurrent(session.start)
      setDuration(session.duration ?? 0)
      resumePlay.current = autoplay
      const url = `${session.playlist}?token=${encodeURIComponent(streamToken)}`

      const { default: HlsJs } = await import('hls.js')
      if (HlsJs.isSupported()) {
        const hls = new HlsJs({ startPosition: 0, maxBufferLength: 30 })
        hls.on(HlsJs.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return }
          setError('La conversion de la vidéo a échoué.')
          setLoading(false)
        })
        hls.loadSource(url)
        hls.attachMedia(v)
        hlsRef.current = hls
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url            // Safari / iPhone: native HLS
        v.load()
      } else {
        setError('Ce navigateur ne sait pas lire les vidéos converties.')
        setLoading(false)
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ? `Conversion impossible : ${msg}` : 'Impossible de préparer la vidéo.')
      setLoading(false)
    }
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v || !filePath || !streamToken) return
    let cancelled = false
    setLoading(true); setError(null); setConverting(false)

    getPlayInfo(filePath)
      .catch(() => null)
      .then((info) => {
        if (cancelled) return
        if (!info || info.mode === 'direct') {
          sourceRef.current = { kind: 'direct' }
          pendingSeek.current = initialTime && initialTime > 0 ? initialTime : null
          v.src = filesService.buildStreamUrl(filePath, streamToken)
          v.load()
        } else {
          playConverted(initialTime && initialTime > 0 ? initialTime : 0, false)
        }
      })

    return () => {
      cancelled = true
      detach()
      v.removeAttribute('src')
      v.load()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, streamToken])

  // Tab closed / app sent to background on a phone: stop the conversion now
  // (the server also stops it by itself after a short idle time)
  useEffect(() => {
    const onHide = () => {
      const s = sourceRef.current
      if (s?.kind === 'hls') stopTranscode(s.jobId)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  /** Seek on the virtual timeline (restarts the conversion when needed). */
  function seekAbs(t: number) {
    const v = videoRef.current
    const s = sourceRef.current
    if (!v || !s) return
    const target = Math.max(0, Math.min(total() || t, t))
    if (s.kind === 'direct') { v.currentTime = target; setCurrent(target); return }

    const local = target - s.offset
    const seekableEnd = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0
    if (local >= 0 && local <= seekableEnd - 1) {
      v.currentTime = local
      setCurrent(target)
    } else {
      playConverted(target, !v.paused || resumePlay.current)
    }
  }

  // "Recommencer" & co
  useEffect(() => {
    if (seekTo) seekAbs(seekTo.time)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo])

  // Resume position known only after the source started (direct playback)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !initialTime || initialTime <= 0 || sourceRef.current?.kind !== 'direct') return
    if (v.readyState >= 1) { if (v.currentTime < 1 && initialTime < v.duration) v.currentTime = initialTime }
    else pendingSeek.current = initialTime
  }, [initialTime])

  // ── Fullscreen ─────────────────────────────────────
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const v = videoRef.current
      if (!v || (e.target as HTMLElement).tagName === 'INPUT') return
      switch (e.code) {
        case 'Space': case 'KeyK':  e.preventDefault(); togglePlay(); break
        case 'ArrowRight': case 'KeyL': e.preventDefault(); seek(10); break
        case 'ArrowLeft':  case 'KeyJ': e.preventDefault(); seek(-10); break
        case 'ArrowUp':   e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); break
        case 'ArrowDown': e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); break
        case 'KeyM':  e.preventDefault(); v.muted = !v.muted; break
        case 'KeyF':  e.preventDefault(); toggleFullscreen(); break
      }
      revealControls()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // ── Controls ───────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  function seek(delta: number) {
    if (!total()) return
    seekAbs(now() + delta)
    revealControls()
  }

  function toggleMute() {
    const v = videoRef.current
    if (v) v.muted = !v.muted
  }

  function changeVolume(val: number) {
    const v = videoRef.current
    if (!v) return
    v.volume = val
    v.muted  = val === 0
  }

  function toggleFullscreen() {
    const el = containerRef.current
    if (document.fullscreenElement) { document.exitFullscreen(); return }
    if (el?.requestFullscreen) {
      el.requestFullscreen()
        // Lock to landscape on phones when supported
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
          .lock?.('landscape').catch(() => {}))
        .catch(() => {})
      return
    }
    // iOS Safari: only the <video> element itself can go fullscreen
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    v?.webkitEnterFullscreen?.()
  }

  // Tap on touch screens: first tap shows the controls, next tap toggles play
  function onVideoTap() {
    if (lastPointer.current !== 'mouse' && !showControls) { revealControls(); return }
    togglePlay()
    revealControls()
  }

  // ── Scrubber ───────────────────────────────────────
  // While dragging only the position preview moves; the seek happens on release
  // (each seek outside the converted part restarts ffmpeg on the server).
  function scrubPosition(clientX: number): number | null {
    const bar = scrubberRef.current
    if (!bar || !duration) return null
    const rect = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
  }

  function onScrubStart(e: React.PointerEvent) {
    e.stopPropagation()
    setScrubbing(true)
    const first = scrubPosition(e.clientX)
    if (first != null) { scrubTarget.current = first; setCurrent(first) }
    if (hideTimer.current) clearTimeout(hideTimer.current)

    function onMove(ev: PointerEvent) {
      const t = scrubPosition(ev.clientX)
      if (t != null) { scrubTarget.current = t; setCurrent(t) }
    }
    function onUp() {
      setScrubbing(false)
      const t = scrubTarget.current
      scrubTarget.current = null
      if (t != null) seekAbs(t)
      scheduleHide()
      window.removeEventListener('pointermove',   onMove)
      window.removeEventListener('pointerup',     onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove',   onMove)
    window.addEventListener('pointerup',     onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // ── Helpers ────────────────────────────────────────
  function fmt(s: number) {
    if (!s || isNaN(s)) return '0:00'
    const h   = Math.floor(s / 3600)
    const m   = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const pct    = duration ? (current  / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0
  const thumbVisible = scrubbing || scrubHover

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ background: '#000', aspectRatio: '16/9', maxHeight: '75vh' }}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing) setShowControls(false) }}
      onPointerDown={(e) => { lastPointer.current = e.pointerType }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        style={{ display: 'block' }}
        playsInline
      />

      {/* Click-to-play zone (covers video area, stops above controls bar) */}
      <div
        className="absolute left-0 right-0 top-0"
        style={{ bottom: 72, cursor: playing ? 'none' : 'pointer' }}
        onClick={onVideoTap}
      />

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" role="alert">
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.75)' }}>
            <div style={{ fontSize: 13 }}>Impossible de lire la vidéo</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.65, maxWidth: 320, padding: '0 16px' }}>
              {error} Réessaie, ou vérifie le fichier sur le serveur.
            </div>
          </div>
        </div>
      )}

      {/* Loading spinner (initial load, buffering, conversion starting) */}
      {loading && !error && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none"
          style={{ bottom: 72 }}
          role="status"
          aria-live="polite"
        >
          <div
            className="rounded-full animate-spin"
            style={{
              width: 'clamp(40px, 9vw, 56px)', height: 'clamp(40px, 9vw, 56px)',
              border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'white',
            }}
          />
          {converting && (
            <span className="text-[12px] sm:text-[13px] font-medium px-3 py-1 rounded-full"
              style={{ color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.45)' }}>
              Préparation de la vidéo…
            </span>
          )}
        </div>
      )}

      {/* Center play icon */}
      {!playing && !error && !loading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ bottom: 72 }}
        >
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 'clamp(52px, 12vw, 72px)', height: 'clamp(52px, 12vw, 72px)',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Play size={32} fill="white" color="white" style={{ marginLeft: 4 }} />
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          opacity:       showControls ? 1 : 0,
          transition:    'opacity 0.3s ease',
          pointerEvents: showControls ? 'auto' : 'none',
          background:    'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
          paddingTop:    32,
        }}
      >
        {/* Scrubber */}
        <div className="px-3 sm:px-4 pb-1">
          <div
            ref={scrubberRef}
            style={{ height: 28, display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative', touchAction: 'none' }}
            onPointerDown={onScrubStart}
            onMouseEnter={() => setScrubHover(true)}
            onMouseLeave={() => setScrubHover(false)}
          >
            {/* Track background */}
            <div style={{
              position: 'absolute', left: 0, right: 0,
              height: thumbVisible ? 5 : 3,
              background: 'rgba(255,255,255,0.25)',
              borderRadius: 99,
              transition: 'height 0.15s',
            }} />
            {/* Buffer */}
            <div style={{
              position: 'absolute', left: 0,
              width: `${bufPct}%`,
              height: thumbVisible ? 5 : 3,
              background: 'rgba(255,255,255,0.35)',
              borderRadius: 99,
              transition: 'height 0.15s',
            }} />
            {/* Progress */}
            <div style={{
              position: 'absolute', left: 0,
              width: `${pct}%`,
              height: thumbVisible ? 5 : 3,
              background: 'white',
              borderRadius: 99,
              transition: 'height 0.15s',
            }} />
            {/* Thumb */}
            <div style={{
              position: 'absolute',
              left: `${pct}%`,
              transform: 'translateX(-50%)',
              width:  thumbVisible ? 14 : 0,
              height: thumbVisible ? 14 : 0,
              background: 'white',
              borderRadius: '50%',
              boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
              transition: 'width 0.15s, height 0.15s',
              pointerEvents: 'none',
            }} />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 pb-2 sm:pb-4" style={{ color: 'white' }}>
          {/* Play/Pause */}
          <button
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.9')}
            onClick={(e) => { e.stopPropagation(); togglePlay() }}
            aria-label={playing ? 'Pause' : 'Lecture'}
          >
            {playing
              ? <Pause size={22} fill="white" color="white" />
              : <Play  size={22} fill="white" color="white" style={{ marginLeft: 2 }} />
            }
          </button>

          {/* Rewind */}
          <button
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}
            onClick={(e) => { e.stopPropagation(); seek(-10) }}
            aria-label="Reculer de 10 secondes"
          >
            <RotateCcw size={18} color="white" />
          </button>

          {/* Forward */}
          <button
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}
            onClick={(e) => { e.stopPropagation(); seek(10) }}
            aria-label="Avancer de 10 secondes"
          >
            <RotateCw size={18} color="white" />
          </button>

          {/* Time */}
          <span className="text-[11.5px] sm:text-[13px] whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85, marginLeft: 2 }}>
            {fmt(current)} / {fmt(duration)}
          </span>

          <div style={{ flex: 1 }} />

          {/* Volume */}
          <button
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}
            onClick={(e) => { e.stopPropagation(); toggleMute() }}
            aria-label={muted ? 'Activer le son' : 'Couper le son'}
          >
            {muted || volume === 0 ? <VolumeX size={18} color="white" /> : <Volume2 size={18} color="white" />}
          </button>
          <input
            type="range" min={0} max={1} step={0.02}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            className="hidden sm:block"
            aria-label="Volume"
            style={{ width: 80, accentColor: 'white', cursor: 'pointer' }}
          />

          {/* Fullscreen */}
          <button
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}
            onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
            aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
          >
            {fullscreen ? <Minimize size={18} color="white" /> : <Maximize size={18} color="white" />}
          </button>
        </div>
      </div>
    </div>
  )
}
