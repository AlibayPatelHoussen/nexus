import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Play, Pause, Volume2, VolumeX,
  Maximize, Minimize, RotateCcw, RotateCw,
} from 'lucide-react'

interface Props {
  src: string
  onTimeUpdate?: (current: number, duration: number) => void
  onEnded?: () => void
  initialTime?: number
  /** Imperative seek (e.g. "Recommencer"): a new key triggers the seek */
  seekTo?: { time: number; key: number }
}

/** Browsers (Safari / iPhone especially) cannot play some containers natively. */
function unsupportedHint(src: string): string | null {
  let file = ''
  try { file = new URL(src, window.location.origin).searchParams.get('path') ?? '' } catch { /* ignore */ }
  const ext = file.split('.').pop()?.toLowerCase()
  if (ext === 'mkv' || ext === 'avi' || ext === 'wmv' || ext === 'flv') {
    return `Le format .${ext} n'est pas lu par ce navigateur (surtout sur iPhone). Convertis-le en .mp4 (H.264) ou ouvre-le avec VLC / Jellyfin.`
  }
  return null
}

export default function VideoPlayer({ src, onTimeUpdate, onEnded, initialTime, seekTo }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrubberRef  = useRef<HTMLDivElement>(null)
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointer  = useRef<string>('mouse')

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
  const [error,        setError]        = useState(false)

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

  // ── Video events ───────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onLoaded = () => {
      setDuration(v.duration)
      setError(false)
      if (initialTime && initialTime > 0 && isFinite(v.duration)) v.currentTime = initialTime
    }
    const onTime   = () => {
      setCurrent(v.currentTime)
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1))
      onTimeUpdate?.(v.currentTime, v.duration)
    }
    const onPlay   = () => { setPlaying(true);  setError(false); scheduleHide() }
    const onPause  = () => {
      setPlaying(false)
      setShowControls(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
    const onEnded_ = () => { setPlaying(false); setShowControls(true); onEnded?.() }
    const onVol    = () => { setVolume(v.volume); setMuted(v.muted) }
    const onErr    = () => { setError(true); setPlaying(false); setShowControls(true) }

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate',     onTime)
    v.addEventListener('play',           onPlay)
    v.addEventListener('pause',          onPause)
    v.addEventListener('ended',          onEnded_)
    v.addEventListener('volumechange',   onVol)
    v.addEventListener('error',          onErr)

    if (src) v.load()

    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate',     onTime)
      v.removeEventListener('play',           onPlay)
      v.removeEventListener('pause',          onPause)
      v.removeEventListener('ended',          onEnded_)
      v.removeEventListener('volumechange',   onVol)
      v.removeEventListener('error',          onErr)
    }
  }, [src, onTimeUpdate, onEnded, scheduleHide, initialTime])

  useEffect(() => {
    const v = videoRef.current
    if (v && seekTo) { v.currentTime = seekTo.time; setCurrent(seekTo.time) }
  }, [seekTo])

  // Resume position known only after the metadata loaded: seek once, if still at the start
  useEffect(() => {
    const v = videoRef.current
    if (v && initialTime && initialTime > 0 && v.readyState >= 1 && v.currentTime < 1 && initialTime < v.duration) {
      v.currentTime = initialTime
    }
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
    v.paused ? v.play() : v.pause()
  }

  function seek(delta: number) {
    const v = videoRef.current
    if (!v || !isFinite(v.duration)) return
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta))
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
  function scrubAt(clientX: number) {
    const bar = scrubberRef.current
    const v   = videoRef.current
    if (!bar || !v || !duration) return
    const rect = bar.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    v.currentTime = pct * duration
    setCurrent(pct * duration)
  }

  // Pointer events cover mouse, touch and pen
  function onScrubStart(e: React.PointerEvent) {
    e.stopPropagation()
    setScrubbing(true)
    scrubAt(e.clientX)
    if (hideTimer.current) clearTimeout(hideTimer.current)

    function onMove(ev: PointerEvent) { scrubAt(ev.clientX) }
    function onUp() {
      setScrubbing(false)
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
        src={src}
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)' }}>
            <div style={{ fontSize: 13 }}>Impossible de lire la vidéo</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6, maxWidth: 320, padding: '0 16px' }}>
              {unsupportedHint(src) ?? 'Vérifiez le fichier ou rechargez'}
            </div>
          </div>
        </div>
      )}

      {/* Center play icon */}
      {!playing && !error && (
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
