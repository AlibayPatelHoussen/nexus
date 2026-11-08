import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Play, Pause, Volume2, VolumeX,
  Maximize, Minimize, RotateCcw, RotateCw, AlertTriangle,
} from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import type Hls from 'hls.js'
import { filesService } from '@/services/filesService'
import { getPlayInfo, getTranscodeStatus, startTranscode, stopTranscode } from '@/services/playbackService'

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
  /**
   * Resume position (local time) not reached yet. The iPhone ignores a position set too
   * early: it is set again on every media event until the video really is there, and
   * nothing is saved meanwhile (it would overwrite the resume point with « 0:03 » and
   * drop the film from « Reprendre »). Given up after 20 s.
   */
  const pendingSeek  = useRef<number | null>(null)
  const pendingSince = useRef(0)
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
  /** Remux being prepared before playback: percent done */
  const [prepared,     setPrepared]     = useState<number | null>(null)
  const generation   = useRef(0)

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

    const applyResume = () => {
      const t = pendingSeek.current
      if (t == null || v.readyState < 1) return
      if (Math.abs(v.currentTime - t) <= 1.5 || Date.now() - pendingSince.current > 20_000
        || (isFinite(v.duration) && t >= v.duration)) { pendingSeek.current = null; return }
      if (!v.seeking) { try { v.currentTime = t } catch { /* not seekable yet */ } }
    }
    const onLoaded = () => {
      setDuration(total())
      applyResume()
      if (resumePlay.current) { resumePlay.current = false; v.play().catch(() => {}) }
    }
    const onTime = () => {
      applyResume()
      const t = now()
      setCurrent(scrubTarget.current ?? t)
      setDuration(total())
      if (v.buffered.length > 0) setBuffered(offset() + v.buffered.end(v.buffered.length - 1))
      // Not saved before the resume position is reached (see pendingSeek)
      if (pendingSeek.current == null) onTimeRef.current?.(t, total())
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
    const onReady   = () => { setLoading(false); applyResume() }
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
    generation.current++
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
    detach()
    const gen = ++generation.current
    setLoading(true); setConverting(true); setError(null); setPrepared(null)
    try {
      const session = await startTranscode(filePath, at)
      sourceRef.current = { kind: 'hls', jobId: session.id, offset: session.start, total: session.duration ?? 0 }
      setCurrent(at)
      setDuration(session.duration ?? 0)
      // A remux (fast copy) is prepared completely first: the whole film is then in the
      // player, also in the iPhone full-screen player (not just the part converted so far)
      for (;;) {
        const st = await getTranscodeStatus(session.id)
        if (gen !== generation.current) return
        if (st.failed) throw new Error(st.failed)
        if (st.ready) break
        setPrepared(st.percent)
        await new Promise((r) => setTimeout(r, 700))
        if (gen !== generation.current) return
      }
      setPrepared(null)
      resumePlay.current = autoplay
      const seekLocal = Math.max(0, at - session.start)
      const url = `${session.playlist}?token=${encodeURIComponent(streamToken)}`

      const { default: HlsJs } = await import('hls.js')
      if (gen !== generation.current) return
      if (HlsJs.isSupported()) {
        // startPosition, and the resume check too (iPhone: hls.js on ManagedMediaSource)
        pendingSeek.current = seekLocal > 1 ? seekLocal : null
        pendingSince.current = Date.now()
        const hls = new HlsJs({ startPosition: seekLocal > 1 ? seekLocal : 0, maxBufferLength: 30 })
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
        pendingSeek.current = seekLocal > 1 ? seekLocal : null
        pendingSince.current = Date.now()
        v.src = url            // Safari / iPhone: native HLS
        v.load()
      } else {
        setError('Ce navigateur ne sait pas lire les vidéos converties.')
        setLoading(false)
      }
    } catch (err) {
      if (gen !== generation.current) return
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ? `Conversion impossible : ${msg}` : 'Impossible de préparer la vidéo.')
      setLoading(false); setPrepared(null)
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
          pendingSince.current = Date.now()
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
    pendingSeek.current = null       // the user chose a position: no more resume
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
    if (v.currentTime >= 1) return
    pendingSeek.current = initialTime
    pendingSince.current = Date.now()
    if (v.readyState >= 1 && initialTime < v.duration) v.currentTime = initialTime
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
        style={{ bottom: 96, cursor: playing && !showControls ? 'none' : 'default' }}
        onClick={onVideoTap}
      />

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6" role="alert">
          <div className="text-center text-white/90 max-w-[340px]">
            <AlertTriangle size={28} strokeWidth={1.5} className="mx-auto mb-2 text-white/70" aria-hidden="true" />
            <p className="text-[15px] font-semibold">Impossible de lire la vidéo</p>
            <p className="text-[13px] mt-1 text-white/65">{error} Réessaie, ou vérifie le fichier sur le serveur.</p>
          </div>
        </div>
      )}

      {/* Loading (initial load, buffering, conversion starting) */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none" style={{ bottom: 96 }} role="status" aria-live="polite">
          <span className="text-white"><Spinner size={36} label="Chargement de la vidéo" color="rgba(255,255,255,.9)" /></span>
          {converting && (
            <span className="text-[13px] font-medium px-3.5 py-1.5 rounded-pill glass-media tabular">
              Préparation de la vidéo…{prepared != null ? ` ${prepared} %` : ''}
            </span>
          )}
        </div>
      )}

      {/* Centre play button (paused) */}
      {!playing && !error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ bottom: 96 }}>
          <div className="grid place-items-center rounded-full glass-media" style={{ width: 'clamp(60px, 12vw, 80px)', height: 'clamp(60px, 12vw, 80px)', animation: 'nx-pop 380ms var(--ease-spring) both' }}>
            <Play size={30} fill="white" strokeWidth={0} style={{ marginLeft: 4 }} />
          </div>
        </div>
      )}

      {/* Floating control bar (AVKit / QuickTime): appears on move / tap, fades out while playing */}
      <div
        className="absolute left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[min(680px,calc(100%-32px))]"
        style={{ bottom: 'max(8px, env(safe-area-inset-bottom, 0px))', pointerEvents: showControls ? 'auto' : 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
      <div
        // Liquid Glass control bar over the video: fades in / out, settles on a spring
        className="glass-media rounded-[26px] px-2.5 sm:px-4 py-1 sm:pt-2 sm:pb-2.5"
        style={{
          opacity: showControls ? 1 : 0,
          transform: showControls ? 'none' : 'translateY(8px) scale(0.98)',
          transition: 'opacity 250ms var(--ease-out), transform 500ms var(--ease-spring)',
        }}
      >
        <div className="hidden sm:flex items-center gap-2">
          <button type="button" className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20" onClick={() => seek(-10)} aria-label="Reculer de 10 secondes" title="Reculer de 10 s">
            <RotateCcw size={18} strokeWidth={1.75} />
          </button>
          <button type="button" className="w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause size={22} fill="white" strokeWidth={0} /> : <Play size={22} fill="white" strokeWidth={0} style={{ marginLeft: 2 }} />}
          </button>
          <button type="button" className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20" onClick={() => seek(10)} aria-label="Avancer de 10 secondes" title="Avancer de 10 s">
            <RotateCw size={18} strokeWidth={1.75} />
          </button>
          <div className="flex-1" />
          <button type="button" className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20" onClick={toggleMute} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
            {muted || volume === 0 ? <VolumeX size={18} strokeWidth={1.75} /> : <Volume2 size={18} strokeWidth={1.75} />}
          </button>
          <input
            type="range" min={0} max={1} step={0.02}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="hidden sm:block w-[84px]"
            aria-label="Volume"
            style={{ accentColor: 'white' }}
          />
          <button type="button" className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20" onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize size={17} strokeWidth={1.75} /> : <Maximize size={17} strokeWidth={1.75} />}
          </button>
        </div>

        {/* Scrubber with elapsed / remaining time */}
        <div className="flex items-center gap-2 sm:gap-2.5 text-[11px] text-white/80 tabular">
          <button type="button" className="sm:hidden w-9 h-9 -ml-1 grid place-items-center rounded-full active:bg-white/20 text-white" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause size={20} fill="white" strokeWidth={0} /> : <Play size={20} fill="white" strokeWidth={0} style={{ marginLeft: 2 }} />}
          </button>
          <span className="w-[40px] sm:w-[44px] text-right">{fmt(current)}</span>
          <div
            ref={scrubberRef}
            className="relative flex-1 flex items-center"
            style={{ height: 24, touchAction: 'none' }}
            onPointerDown={onScrubStart}
            onMouseEnter={() => setScrubHover(true)}
            onMouseLeave={() => setScrubHover(false)}
            role="slider"
            aria-label="Position dans la vidéo"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${fmt(current)} sur ${fmt(duration)}`}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') { seek(-5); e.preventDefault() } else if (e.key === 'ArrowRight') { seek(5); e.preventDefault() } }}
          >
            <div className="absolute inset-x-0 rounded-full" style={{ height: thumbVisible ? 6 : 4, background: 'rgba(255,255,255,.22)', transition: 'height 150ms' }} />
            <div className="absolute left-0 rounded-full" style={{ width: `${bufPct}%`, height: thumbVisible ? 6 : 4, background: 'rgba(255,255,255,.32)', transition: 'height 150ms' }} />
            <div className="absolute left-0 rounded-full bg-white" style={{ width: `${pct}%`, height: thumbVisible ? 6 : 4, transition: 'height 150ms' }} />
            <div className="absolute rounded-full bg-white pointer-events-none" style={{ left: `${pct}%`, transform: 'translateX(-50%)', width: thumbVisible ? 12 : 0, height: thumbVisible ? 12 : 0, boxShadow: '0 1px 4px rgba(0,0,0,.4)', transition: 'width 150ms, height 150ms' }} />
          </div>
          <span className="w-[40px] sm:w-[44px]">-{fmt(Math.max(0, duration - current))}</span>
          <button type="button" className="sm:hidden w-9 h-9 -mr-1 grid place-items-center rounded-full active:bg-white/20 text-white" onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize size={17} strokeWidth={1.75} /> : <Maximize size={17} strokeWidth={1.75} />}
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}
