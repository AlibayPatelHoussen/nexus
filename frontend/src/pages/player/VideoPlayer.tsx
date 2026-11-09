import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Play, Pause, Volume2, VolumeX,
  Maximize, Minimize, RotateCcw, RotateCw, AlertTriangle,
  Airplay, Cast, PictureInPicture2, Lock, LockOpen, ListVideo, SkipForward, X, Tv, RefreshCw, Square,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Spinner from '@/components/ui/Spinner'
import { castService, type CastDevice, type CastStatus } from '@/services/castService'
import { serverError, showError } from '@/utils/errorToast'
import PlayerPanel, { PanelRow } from './PlayerPanel'
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
  /** Shown in full screen, on the lock screen / in Picture in Picture, and sent to the TV */
  title?: string
  artwork?: string | null
  /** Series: « Épisodes » panel and « Épisode suivant » */
  episodes?: { id: string; title: string; subtitle?: string; current?: boolean }[]
  onSelectEpisode?: (id: string) => void
  onNext?: () => void
  /** Outside full screen the Diffuser / Image dans l’image / lock buttons sit in the page's top bar */
  toolbarSlot?: HTMLElement | null
}

type WebkitVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void
  webkitCurrentPlaybackTargetIsWireless?: boolean
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
  remote?: { prompt: () => Promise<void>; state: string }
}

/** Safari (Mac, iPhone, iPad): AirPlay. Elsewhere: Chromecast through the browser (Remote Playback). */
const HAS_AIRPLAY = typeof window !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window
const HAS_REMOTE  = typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype && !HAS_AIRPLAY
const IS_IOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
/** Nexus opened from its Home Screen icon: iOS gives such apps no Picture in Picture (WebKit bug 303885) */
const STANDALONE = typeof window !== 'undefined' && ((navigator as Navigator & { standalone?: boolean }).standalone === true
  || !!window.matchMedia?.('(display-mode: standalone)').matches)

/** « 10 s » skip glyph (like SF Symbols gobackward.10 / goforward.10) */
function Skip10({ forward, size = 30 }: { forward?: boolean; size?: number }) {
  const Icon = forward ? RotateCw : RotateCcw
  return (
    <span className="relative grid place-items-center" aria-hidden="true">
      <Icon size={size} strokeWidth={1.6} />
      <span className="absolute text-[10px] font-bold tabular" style={{ fontSize: size * 0.32, paddingTop: 1 }}>10</span>
    </span>
  )
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

export default function VideoPlayer({
  filePath, streamToken, onTimeUpdate, onEnded, initialTime, seekTo, title, artwork, episodes, onSelectEpisode, onNext, toolbarSlot,
}: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrubberRef  = useRef<HTMLDivElement>(null)
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointer  = useRef<string>('mouse')
  const hlsRef       = useRef<Hls | null>(null)
  const sourceRef    = useRef<Source | null>(null)
  /** Playlist of the converted stream (native HLS takes over from hls.js for AirPlay) */
  const hlsUrlRef    = useRef<string | null>(null)
  const panelRef     = useRef<'episodes' | 'cast' | 'pip' | null>(null)
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
  /** Touch screen: big centred transport controls (iOS); mouse: the floating bar (macOS) */
  const [touch,   setTouch]   = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches)
  const [locked,  setLocked]  = useState(false)
  const [panel,   setPanelState] = useState<'episodes' | 'cast' | 'pip' | null>(null)
  const [pip,     setPip]     = useState(false)
  const [wireless, setWireless] = useState(false)
  const [devices, setDevices] = useState<CastDevice[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [cast,    setCast]    = useState<{ device: CastDevice; status: CastStatus | null } | null>(null)
  const pipSupported = typeof document !== 'undefined' && (!!document.pictureInPictureEnabled
    || !!(videoRef.current as WebkitVideo | null)?.webkitSupportsPresentationMode?.('picture-in-picture')
    || /iP(hone|ad|od)/.test(navigator.userAgent))
  function setPanel(p: 'episodes' | 'cast' | 'pip' | null) {
    panelRef.current = p
    setPanelState(p)
    if (p) { setShowControls(true); if (hideTimer.current) clearTimeout(hideTimer.current) } else scheduleHide()
  }

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
      if (!videoRef.current?.paused && !panelRef.current) setShowControls(false)
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
      // Given up 20 s after playback really started (the iPhone loads nothing before ▶ is
      // tapped: counting from the opening gave up while the user had not pressed play yet)
      if (Math.abs(v.currentTime - t) <= 1.5 || (pendingSince.current > 0 && Date.now() - pendingSince.current > 20_000)
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
    const onPlaying = () => {
      if (pendingSeek.current != null && pendingSince.current === 0) pendingSince.current = Date.now()
      onReady()
    }
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
    v.addEventListener('playing',        onPlaying)
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
      v.removeEventListener('playing',        onPlaying)
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
      hlsUrlRef.current = url

      const { default: HlsJs } = await import('hls.js')
      if (gen !== generation.current) return
      // Safari (iPhone, iPad, Mac): its own HLS player, the only one AirPlay and Picture in Picture accept
      if (!(HAS_AIRPLAY && v.canPlayType('application/vnd.apple.mpegurl')) && HlsJs.isSupported()) {
        // startPosition, and the resume check too
        pendingSeek.current = seekLocal > 1 ? seekLocal : null
        pendingSince.current = 0
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
        pendingSince.current = 0
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
          pendingSince.current = 0
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
      if (document.pictureInPictureElement) return     // still playing in Picture in Picture
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
    pendingSince.current = 0
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
      if (!v || (e.target as HTMLElement).tagName === 'INPUT' || panelRef.current) return
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
    if (panelRef.current) { setPanel(null); return }
    if (locked) { revealControls(); return }
    // Touch (iOS): a tap shows / hides the controls, the centre button plays
    if (lastPointer.current !== 'mouse') {
      if (showControls && !videoRef.current?.paused) { setShowControls(false); if (hideTimer.current) clearTimeout(hideTimer.current) }
      else revealControls()
      return
    }
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

  // ── Picture in Picture ─────────────────────────────
  useEffect(() => {
    const v = videoRef.current as WebkitVideo | null
    if (!v) return
    // Safari: the video goes on in Picture in Picture by itself when the app is left
    v.setAttribute('autopictureinpicture', '')
    const onEnter = () => setPip(true)
    const onLeave = () => setPip(false)
    const onMode  = () => setPip(v.webkitPresentationMode === 'picture-in-picture')
    const onWireless = () => setWireless(!!v.webkitCurrentPlaybackTargetIsWireless)
    v.addEventListener('enterpictureinpicture', onEnter)
    v.addEventListener('leavepictureinpicture', onLeave)
    v.addEventListener('webkitpresentationmodechanged', onMode)
    v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless)
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter)
      v.removeEventListener('leavepictureinpicture', onLeave)
      v.removeEventListener('webkitpresentationmodechanged', onMode)
      v.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless)
    }
  }, [])

  async function togglePip() {
    const v = videoRef.current as WebkitVideo | null
    if (!v) return
    const unavailable = () => {
      if (IS_IOS && STANDALONE) setPanel('pip')
      else toast.error(v.readyState < 1 ? 'Lance d’abord la lecture' : 'Image dans l’image indisponible sur ce navigateur')
    }
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return }
      if (v.webkitPresentationMode === 'picture-in-picture') { v.webkitSetPresentationMode?.('inline'); return }
      if (v.webkitSupportsPresentationMode?.('picture-in-picture') && v.webkitSetPresentationMode) {
        v.webkitSetPresentationMode('picture-in-picture')
        // iOS can accept the call and do nothing (Home Screen apps)
        setTimeout(() => { if (v.webkitPresentationMode !== 'picture-in-picture' && !document.pictureInPictureElement) unavailable() }, 800)
        return
      }
      if (document.pictureInPictureEnabled && v.requestPictureInPicture) { await v.requestPictureInPicture(); return }
      unavailable()
    } catch {
      unavailable()
    }
  }

  /** iOS: the same page in Safari, where Picture in Picture works (x-safari-https opens Safari from an app) */
  function openInSafari() {
    videoRef.current?.pause()
    window.location.href = `x-safari-${location.protocol.replace(':', '')}://${location.host}${location.pathname}${location.search}`
  }

  // ── Lock screen / Control Center / Picture in Picture buttons (Media Session) ──
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms || typeof MediaMetadata === 'undefined') return
    ms.metadata = new MediaMetadata({
      title: title || 'Nexus',
      artist: 'Nexus',
      artwork: artwork ? [{ src: new URL(artwork, location.href).toString(), sizes: '500x750' }] : [],
    })
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h) } catch { /* unsupported */ } }
    set('play', () => { void videoRef.current?.play() })
    set('pause', () => videoRef.current?.pause())
    set('seekbackward', () => seek(-10))
    set('seekforward', () => seek(10))
    set('seekto', (d) => { if (d.seekTime != null) seekAbs(d.seekTime) })
    set('nexttrack', onNext ? () => onNext() : null)
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack'] as MediaSessionAction[]) set(a, null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, artwork, onNext])

  const posBucket = Math.floor(current / 5)
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms?.setPositionState || !duration || current > duration) return
    try { ms.setPositionState({ duration, position: current, playbackRate: 1 }) } catch { /* ignored */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posBucket, duration])

  // ── Diffuser : AirPlay, Chromecast, TVs on the server's network ──
  async function loadDevices(refresh: boolean) {
    setSearching(true)
    try { setDevices(await castService.devices(refresh)) } catch { setDevices([]) } finally { setSearching(false) }
  }
  function openCast() {
    // iPhone / iPad / Mac: the system AirPlay list (every AirPlay TV on this device's network)
    if (HAS_AIRPLAY) { airplay(); return }
    setPanel('cast')
    if (!devices) void loadDevices(false)
  }

  function airplay() {
    const v = videoRef.current as WebkitVideo | null
    if (!v?.webkitShowPlaybackTargetPicker) return
    // AirPlay cannot send a hls.js stream (Managed Media Source): Safari's own HLS takes over
    if (hlsRef.current && hlsUrlRef.current && v.canPlayType('application/vnd.apple.mpegurl')) {
      const at = v.currentTime
      resumePlay.current = !v.paused
      hlsRef.current.destroy()
      hlsRef.current = null
      pendingSeek.current = at > 1 ? at : null
      pendingSince.current = 0
      v.src = hlsUrlRef.current
      v.load()
    }
    v.disableRemotePlayback = false
    v.webkitShowPlaybackTargetPicker()
    setPanel(null)
  }

  function chromecast() {
    const v = videoRef.current as WebkitVideo | null
    v?.remote?.prompt().catch(() => toast.error('Aucun Chromecast trouvé'))
    setPanel(null)
  }

  async function castTo(d: CastDevice) {
    const at = now()
    setPanel(null)
    const id = toast.loading(`Envoi vers ${d.name}…`)
    try {
      await castService.play(d.id, filePath, title || '', at)
      videoRef.current?.pause()
      setCast({ device: d, status: null })
      toast.success(`Lecture sur ${d.name}`, { id })
    } catch (err) {
      toast.dismiss(id)
      showError(`${d.name} n’a pas accepté la vidéo`, serverError(err))
    }
  }

  // While the TV plays: its position, saved like local playback (« Reprendre »)
  useEffect(() => {
    if (!cast) return
    let alive = true
    const tick = async () => {
      try {
        const st = await castService.status(cast.device.id)
        if (!alive) return
        setCast((c) => (c ? { ...c, status: st } : c))
        if (st.position != null && st.duration) { setCurrent(st.position); setDuration(st.duration); onTimeRef.current?.(st.position, st.duration) }
      } catch { /* the TV may not answer while loading */ }
    }
    void tick()
    const t = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast?.device.id])

  function castCommand(action: 'play' | 'pause' | 'seek', position?: number) {
    if (!cast) return
    castService.control(cast.device.id, action, position).catch(() => toast.error('La TV ne répond pas'))
    setCast((c) => (c?.status ? { ...c, status: { ...c.status, state: action === 'pause' ? 'paused' : 'playing', position: position ?? c.status.position } } : c))
  }

  async function stopCast() {
    if (!cast) return
    const pos = cast.status?.position
    setCast(null)
    await castService.control(cast.device.id, 'stop').catch(() => {})
    // Back on this device, where the TV stopped
    if (pos != null && pos > 0) seekAbs(pos)
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
  const barsVisible = showControls && !cast
  const fade = (on: boolean, y = 8): React.CSSProperties => ({
    opacity: on ? 1 : 0,
    transform: on ? 'none' : `translateY(${y}px) scale(0.98)`,
    transition: 'opacity 250ms var(--ease-out), transform 500ms var(--ease-spring)',
    pointerEvents: on ? 'auto' : 'none',
  })
  const iconBtn = 'w-11 h-11 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20 active:scale-95 transition-transform'
  const iconBtnBar = 'w-11 h-9 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20 active:scale-95 transition-transform'
  const CastIcon = HAS_AIRPLAY ? Airplay : Cast
  const castPlaying = cast?.status?.state !== 'paused'
  /** Outside full screen the buttons sit in the page's top bar (above the video), else over it */
  const inPlayerActions = fullscreen || !toolbarSlot
  const actions = (glass: 'media' | 'bar') => (
    <div className={`flex items-center rounded-pill p-0.5 flex-shrink-0 ${glass === 'media' ? 'glass-media' : 'glass-clear text-white'}`}>
      <button type="button" className={glass === 'media' ? iconBtn : iconBtnBar} onClick={openCast} aria-label={HAS_AIRPLAY ? 'AirPlay' : 'Diffuser sur un écran'} title={HAS_AIRPLAY ? 'AirPlay' : 'Diffuser'}>
        <CastIcon size={glass === 'media' ? 20 : 19} strokeWidth={1.75} />
      </button>
      {pipSupported && (
        <button type="button" className={glass === 'media' ? iconBtn : iconBtnBar} onClick={togglePip} aria-label={pip ? 'Quitter l’image dans l’image' : 'Image dans l’image'} aria-pressed={pip} title="Image dans l’image">
          <PictureInPicture2 size={glass === 'media' ? 20 : 19} strokeWidth={1.75} />
        </button>
      )}
      {touch && (
        <button type="button" className={glass === 'media' ? iconBtn : iconBtnBar} onClick={() => { setLocked(true); setShowControls(false); setPanel(null) }} aria-label="Verrouiller l’écran" title="Verrouiller">
          <Lock size={glass === 'media' ? 19 : 18} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none overflow-hidden"
      style={{ background: '#000', aspectRatio: '16/9', maxHeight: fullscreen ? '100vh' : '75vh' }}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing && !panelRef.current) setShowControls(false) }}
      onPointerDown={(e) => { lastPointer.current = e.pointerType; setTouch(e.pointerType !== 'mouse') }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        style={{ display: 'block', opacity: cast ? 0.25 : 1 }}
        playsInline
        x-webkit-airplay="allow"
      />

      {/* Click-to-play zone (covers video area, stops above controls bar) */}
      <div
        className="absolute left-0 right-0 top-0"
        style={{ bottom: 96, cursor: playing && !showControls ? 'none' : 'default' }}
        onClick={onVideoTap}
      />

      {/* Error */}
      {error && !cast && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6" role="alert">
          <div className="text-center text-white/90 max-w-[340px]">
            <AlertTriangle size={28} strokeWidth={1.5} className="mx-auto mb-2 text-white/70" aria-hidden="true" />
            <p className="text-[15px] font-semibold">Impossible de lire la vidéo</p>
            <p className="text-[13px] mt-1 text-white/65">{error} Réessaie, ou vérifie le fichier sur le serveur.</p>
          </div>
        </div>
      )}

      {/* Loading (initial load, buffering, conversion starting) */}
      {loading && !error && !cast && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none" style={{ bottom: 96 }} role="status" aria-live="polite">
          <span className="text-white"><Spinner size={36} label="Chargement de la vidéo" color="rgba(255,255,255,.9)" /></span>
          {converting && (
            <span className="text-[13px] font-medium px-3.5 py-1.5 rounded-pill glass-media tabular">
              Préparation de la vidéo…{prepared != null ? ` ${prepared} %` : ''}
            </span>
          )}
        </div>
      )}

      {/* Playing on another screen (AirPlay by Safari, Picture in Picture) */}
      {(wireless || pip) && !cast && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none text-white/85" style={{ bottom: 96 }}>
          {pip ? <PictureInPicture2 size={40} strokeWidth={1.4} aria-hidden="true" /> : <Airplay size={40} strokeWidth={1.4} aria-hidden="true" />}
          <p className="text-[15px] font-semibold">{pip ? 'Lecture en image dans l’image' : 'Lecture via AirPlay'}</p>
        </div>
      )}

      {/* Centre play button (paused, mouse) */}
      {!touch && !playing && !error && !loading && !cast && !locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ bottom: 96 }}>
          <div className="grid place-items-center rounded-full glass-media" style={{ width: 'clamp(60px, 12vw, 80px)', height: 'clamp(60px, 12vw, 80px)', animation: 'nx-pop 380ms var(--ease-spring) both' }}>
            <Play size={30} fill="white" strokeWidth={0} style={{ marginLeft: 4 }} />
          </div>
        </div>
      )}

      {/* Touch (iOS): big centred transport controls */}
      {touch && !error && !cast && !locked && (
        <div className="absolute inset-x-0 flex items-center justify-center pointer-events-none" style={{ top: 48, bottom: episodes?.length || onNext ? 96 : 64, gap: 'clamp(28px, 11vw, 120px)' }}>
          <button type="button" className="pointer-events-auto w-14 h-14 grid place-items-center rounded-full glass-media active:scale-90 transition-transform" style={fade(barsVisible, 0)} onClick={() => seek(-10)} aria-label="Reculer de 10 secondes">
            <Skip10 />
          </button>
          {loading ? <span className="w-[72px] h-[72px]" aria-hidden="true" /> : (
            <button type="button" className="pointer-events-auto w-[72px] h-[72px] grid place-items-center rounded-full glass-media active:scale-90 transition-transform" style={fade(barsVisible || !playing, 0)} onClick={() => { togglePlay(); revealControls() }} aria-label={playing ? 'Pause' : 'Lecture'}>
              {playing ? <Pause size={32} fill="white" strokeWidth={0} /> : <Play size={32} fill="white" strokeWidth={0} style={{ marginLeft: 4 }} />}
            </button>
          )}
          <button type="button" className="pointer-events-auto w-14 h-14 grid place-items-center rounded-full glass-media active:scale-90 transition-transform" style={fade(barsVisible, 0)} onClick={() => seek(10)} aria-label="Avancer de 10 secondes">
            <Skip10 forward />
          </button>
        </div>
      )}

      {/* Top bar: close + title (full screen), Diffuser / Picture in Picture / lock */}
      <div
        className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3"
        style={{ paddingTop: 'max(10px, env(safe-area-inset-top, 0px))', ...fade(barsVisible || (locked && showControls), -8) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {fullscreen && !locked && (
            <button type="button" className="w-11 h-11 grid place-items-center rounded-full glass-media flex-shrink-0 active:scale-95 transition-transform" onClick={toggleFullscreen} aria-label="Quitter le plein écran">
              <X size={20} strokeWidth={2} />
            </button>
          )}
          {fullscreen && title && !locked && <span className="text-[15px] font-semibold text-white truncate" style={{ textShadow: '0 1px 6px rgba(0,0,0,.5)' }}>{title}</span>}
        </div>
        {locked ? (
          <button type="button" className="h-11 pl-3.5 pr-4 flex items-center gap-2 rounded-pill glass-media text-[15px] font-semibold active:scale-95 transition-transform" onClick={() => { setLocked(false); revealControls() }}>
            <LockOpen size={18} strokeWidth={2} aria-hidden="true" /> Déverrouiller
          </button>
        ) : (
          inPlayerActions && actions('media')
        )}
      </div>

      {/* Playing on a TV: the remote */}
      {cast && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 text-white" role="region" aria-label={`Lecture sur ${cast.device.name}`}>
          <div className="flex flex-col items-center gap-1 text-center">
            <Tv size={36} strokeWidth={1.4} aria-hidden="true" className="text-white/85" />
            <p className="text-[17px] font-semibold">Lecture sur {cast.device.name}</p>
            <p className="text-[13px] text-white/65 tabular">
              {cast.status?.state === 'loading' || !cast.status ? 'Chargement sur la TV…'
                : `${fmt(cast.status.position ?? 0)} / ${fmt(cast.status.duration ?? duration)}`}
            </p>
          </div>
          <div className="flex items-center gap-5">
            {cast.device.kind === 'dlna' && (
              <button type="button" className="w-14 h-14 grid place-items-center rounded-full glass-media active:scale-90 transition-transform" onClick={() => castCommand('seek', Math.max(0, (cast.status?.position ?? 0) - 10))} aria-label="Reculer de 10 secondes">
                <Skip10 />
              </button>
            )}
            <button type="button" className="w-[72px] h-[72px] grid place-items-center rounded-full glass-media active:scale-90 transition-transform" onClick={() => castCommand(castPlaying ? 'pause' : 'play')} aria-label={castPlaying ? 'Pause' : 'Lecture'}>
              {castPlaying ? <Pause size={32} fill="white" strokeWidth={0} /> : <Play size={32} fill="white" strokeWidth={0} style={{ marginLeft: 4 }} />}
            </button>
            {cast.device.kind === 'dlna' && (
              <button type="button" className="w-14 h-14 grid place-items-center rounded-full glass-media active:scale-90 transition-transform" onClick={() => castCommand('seek', (cast.status?.position ?? 0) + 10)} aria-label="Avancer de 10 secondes">
                <Skip10 forward />
              </button>
            )}
          </div>
          <button type="button" className="h-11 px-5 flex items-center gap-2 rounded-pill glass-media text-[15px] font-semibold active:scale-95 transition-transform" onClick={stopCast}>
            <Square size={14} fill="white" strokeWidth={0} aria-hidden="true" /> Arrêter la diffusion
          </button>
        </div>
      )}

      {/* Floating control bar (AVKit / QuickTime): appears on move / tap, fades out while playing */}
      <div
        className="absolute z-20 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[min(680px,calc(100%-32px))]"
        style={{ bottom: 'max(8px, env(safe-area-inset-bottom, 0px))', pointerEvents: barsVisible && !locked ? 'auto' : 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
      <div
        // Liquid Glass control bar over the video: fades in / out, settles on a spring
        className={`glass-media rounded-[26px] px-2.5 py-1 ${touch ? '' : 'sm:px-4 sm:pt-2 sm:pb-2.5'}`}
        style={fade(barsVisible && !locked)}
      >
        <div className={touch ? 'hidden' : 'hidden sm:flex items-center gap-2'}>
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
          {!touch && (
            <button type="button" className="sm:hidden w-9 h-9 -ml-1 grid place-items-center rounded-full active:bg-white/20 text-white" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Lecture'}>
              {playing ? <Pause size={20} fill="white" strokeWidth={0} /> : <Play size={20} fill="white" strokeWidth={0} style={{ marginLeft: 2 }} />}
            </button>
          )}
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
          <button type="button" className={`${touch ? '' : 'sm:hidden '}w-9 h-9 -mr-1 grid place-items-center rounded-full active:bg-white/20 text-white`} onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize size={17} strokeWidth={1.75} /> : <Maximize size={17} strokeWidth={1.75} />}
          </button>
        </div>

        {/* Series: « Épisodes » and « Épisode suivant » */}
        {(episodes?.length || onNext) && (
          <div className={`flex items-center justify-between gap-2 -mx-1 pb-0.5 ${touch ? '' : 'sm:mx-0 sm:pb-0 sm:pt-1'}`}>
            {episodes?.length ? (
              <button type="button" className="h-9 pl-2.5 pr-3.5 flex items-center gap-2 rounded-pill hover:bg-white/10 active:bg-white/20 text-[13px] font-semibold" onClick={() => setPanel('episodes')}>
                <ListVideo size={18} strokeWidth={1.75} aria-hidden="true" /> Épisodes
              </button>
            ) : <span />}
            {onNext && (
              <button type="button" className="h-9 pl-2.5 pr-3.5 flex items-center gap-2 rounded-pill hover:bg-white/10 active:bg-white/20 text-[13px] font-semibold" onClick={onNext}>
                <SkipForward size={16} fill="white" strokeWidth={1.5} aria-hidden="true" /> Épisode suivant
              </button>
            )}
          </div>
        )}
      </div>
      </div>

      {!inPlayerActions && !locked && createPortal(actions('bar'), toolbarSlot!)}

      <PlayerPanel open={panel === 'pip'} title="Image dans l’image" onClose={() => setPanel(null)}>
        <div className="px-3 pb-2 flex flex-col gap-3 text-[14px] text-white/80">
          <p>iOS ne permet pas l’image dans l’image dans les apps ajoutées à l’écran d’accueil (limite d’Apple).</p>
          <p>Ouvre ce film dans Safari : l’image dans l’image y marche, et la vidéo continue toute seule en petit quand tu quittes Safari. La lecture reprend au même endroit (connecte-toi dans Safari la première fois).</p>
          <button type="button" className="self-start h-11 px-5 rounded-pill bg-white text-black text-[15px] font-semibold active:scale-95 transition-transform" onClick={openInSafari}>
            Ouvrir dans Safari
          </button>
        </div>
      </PlayerPanel>

      <PlayerPanel open={panel === 'episodes'} title="Épisodes" onClose={() => setPanel(null)}>
        {episodes?.map((ep) => (
          <PanelRow key={ep.id} title={ep.title} subtitle={ep.current ? 'En lecture' : ep.subtitle} selected={ep.current}
            onClick={() => { setPanel(null); if (!ep.current) onSelectEpisode?.(ep.id) }} />
        ))}
      </PlayerPanel>

      <PlayerPanel open={panel === 'cast'} title="Diffuser" onClose={() => setPanel(null)}>
        {HAS_AIRPLAY && (
          <PanelRow icon={<Airplay size={22} strokeWidth={1.6} />} title="AirPlay" subtitle="Apple TV et TV compatibles AirPlay" onClick={airplay} />
        )}
        {HAS_REMOTE && (
          <PanelRow icon={<Cast size={22} strokeWidth={1.6} />} title="Chromecast"
            subtitle={sourceRef.current?.kind === 'direct' ? 'Chromecast et Google TV' : 'Indisponible pour cette vidéo (convertie par le serveur)'}
            disabled={sourceRef.current?.kind !== 'direct'} onClick={chromecast} />
        )}
        <div className="flex items-center justify-between gap-2 pl-3 pr-1 pt-3 pb-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-white/55">TV sur le réseau du serveur</p>
          <button type="button" className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20 disabled:opacity-40" onClick={() => loadDevices(true)} disabled={searching} aria-label="Rechercher à nouveau">
            <RefreshCw size={17} strokeWidth={1.75} className={searching ? 'animate-spin motion-reduce:animate-none' : ''} />
          </button>
        </div>
        {devices?.map((d) => (
          <PanelRow key={d.id} icon={<Tv size={22} strokeWidth={1.6} />} title={d.name}
            subtitle={[d.kind === 'roku' ? 'Roku' : 'DLNA', d.model].filter(Boolean).join(' · ')}
            selected={cast?.device.id === d.id} onClick={() => castTo(d)} />
        ))}
        {devices && !devices.length && !searching && (
          <p className="px-3 py-2 text-[13px] text-white/60">
            Aucune TV trouvée. Les TV Samsung, LG, Sony, Philips, Roku, Android TV ou Fire TV (DLNA) doivent être allumées et sur le même réseau que le serveur.
          </p>
        )}
        {searching && !devices?.length && <p className="px-3 py-2 text-[13px] text-white/60" role="status">Recherche des TV…</p>}
      </PlayerPanel>
    </div>
  )
}
