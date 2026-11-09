import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronLeft, ExternalLink, Heart, Maximize, Minimize, Pause, PictureInPicture2, Play, RefreshCw, ServerCog, SkipBack,
  SkipForward, Volume2, VolumeX,
} from 'lucide-react'
import type Hls from 'hls.js'
import toast from 'react-hot-toast'
import Spinner from '@/components/ui/Spinner'
import { getStreamToken } from '@/services/streamToken'
import { iptvService, type IptvChannel, type PictureAnswer, type PictureReason } from '@/services/iptvService'
import { cn } from '@/utils'
import { ChannelLogo, readQueue, rememberQueue, useToggleFavorite } from './ChannelTile'
import { categoryName, countryName, flag } from './labels'
import {
  SOUND_ONLY, describeStream, framesReported, needsConversion, rememberConverted, rememberFramesReported, variantsToDrop, wasConverted,
  type Reader,
} from './picture'

/** Safari plays HLS itself (AirPlay, Picture in Picture); elsewhere hls.js */
const NATIVE_HLS = typeof document !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

type Phase = 'loading' | 'playing' | 'paused' | 'error'
/** hls.js: the browser cannot decode what the stream holds (HEVC without support, for instance) */
const CODEC_ERRORS = new Set(['bufferAddCodecError', 'bufferIncompatibleCodecsError', 'manifestIncompatibleCodecsError'])
const NO_CODEC = 'Ce navigateur ne lit pas le format vidéo de cette chaîne, et le serveur n’a pas pu le convertir.'
/** Video formats Safari plays by itself */
const SAFARI_READS = new Set(['h264', 'hevc'])
/** What the player says while the server prepares a conversion, by what led to it */
const ASKING = {
  silent: 'Ce navigateur n’affiche pas l’image de cette chaîne. Le serveur regarde s’il peut la convertir…',
  unfit: 'Cette chaîne est diffusée dans un format que ce navigateur lit mal. Le serveur la convertit…',
  failed: 'Lecture directe impossible. Le serveur essaie de convertir la chaîne…',
  asked: 'Conversion de la chaîne par le serveur…',
}
const supports = (type: string) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)
/** A video element that tells when it shows a frame (Safari 15.4+, Chromium) */
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (handle: number) => void }

/** The site of a « page » stream (the live of a YouTube / Twitch / Dailymotion page) */
function siteName(page: string | null | undefined): string | null {
  if (!page) return null
  try {
    const host = new URL(page).hostname.replace(/^www\./, '')
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'YouTube'
    if (/(^|\.)twitch\.tv$/.test(host)) return 'Twitch'
    if (/(^|\.)(dailymotion\.com|dai\.ly)$/.test(host)) return 'Dailymotion'
    return host
  } catch { return null }
}

/**
 * Live player of an IPTV channel. The stream comes through the Nexus server (CORS, http
 * streams on an https page, Referer / User-Agent of the catalogue), nothing is stored.
 * The stream the last check found working is tried first; a stream that fails falls back to
 * the channel's next one; when all fail the channel is checked for real and the reason is shown.
 * A « page » stream (YouTube, Twitch, Dailymotion) is looked up by the server when it is played,
 * which takes a few seconds: the player says so while it waits.
 * Sound without a picture (see ./picture): sound-only variants of a stream are left out; a stream
 * that still shows nothing gives way to the channel's next one; when none has a picture the server
 * converts the first one (MPEG-2, HEVC… to H.264), or the channel is said to be sound only.
 * Safari (iPhone) reads streams itself and sometimes plays the sound of a stream it could show
 * without its picture, until the stream is loaded again: that is tried first there.
 * The server also says what each stream holds while it starts: one this browser is known to play
 * badly (interlaced broadcast video on Safari, Dolby sound elsewhere, MPEG-2…) is converted
 * without waiting for the trouble; a channel no stream of which starts is tried through the
 * conversion before giving up; and the viewer can ask for the conversion (the button in the bar).
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

  /** « Réessayer » starts the streams again from the first one */
  const [attempt, setAttempt] = useState(0)
  /** How many streams of this channel failed in this attempt (a new channel or attempt starts at 0) */
  const run = `${id}#${attempt}`
  const [failed, setFailed] = useState({ run, n: 0 })
  const step = failed.run === run ? failed.n : 0
  /** False until the stream being loaded starts playing */
  const [started, setStarted] = useState(false)
  /** A stream of this attempt played with sound only: its picture converted by the server
   *  ('converted'), or that stream kept as it is ('sound'). `n` counts the tries. */
  const [rescue, setRescue] = useState<{ run: string; index: number; mode: 'converted' | 'sound'; why: PictureReason | null; n: number } | null>(null)
  const saved = rescue?.run === run ? rescue : null
  /** The server is looking at a stream / starting its conversion: what to say meanwhile */
  const [rescuing, setRescuing] = useState<string | null>(null)
  /** Sound without a picture, kept as it is: why */
  const [quiet, setQuiet] = useState<{ run: string; why: PictureReason } | null>(null)
  const quietWhy = quiet?.run === run ? quiet.why : null
  /** The video element shows a picture */
  const [picture, setPicture] = useState(false)
  /** Streams of this attempt that gave sound but no picture, in the order they were tried
   *  (`codec`: one of them in a format the browser refuses altogether; `again`: those already
   *  loaded a second time for their picture) */
  const silentStreams = useRef<{ run: string; list: number[]; codec: boolean; again: number[]; asked: number[]; last: boolean }>(
    { run, list: [], codec: false, again: [], asked: [], last: false })
  /** The viewer asked for the conversion (the button): told when it cannot be done */
  const manual = useRef(false)
  /** Bumped to load the current stream again as it is */
  const [reload, setReload] = useState(0)
  /** What the player is doing, for the playback details (three taps on « EN DIRECT ») */
  const trace = useRef({ engine: '', mode: 'direct', shown: null as boolean | null, loads: 0, note: '', next: '', held: '' })
  const [details, setDetails] = useState<string[] | null>(null)
  const taps = useRef<number[]>([])
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

  useEffect(() => { setError(null); setPhase('loading'); setDvr(null) }, [id])

  // The order the streams are tried in: the one the last check found working, then the others
  // in the catalogue's order. Kept for the whole attempt (a check in between does not reorder it).
  const order = useMemo(() => {
    const all = (channel?.streams ?? []).map((_, i) => i)
    const best = channel?.bestStream
    return best != null && best > 0 && best < all.length ? [best, ...all.filter((i) => i !== best)] : all
  }, [channel?.id, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  const index = saved ? saved.index : order[Math.min(step, order.length - 1)] ?? 0
  const current = channel?.streams[index]
  const site = current?.kind === 'page' ? siteName(current.page) : null

  const reveal = useCallback(() => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (!videoRef.current?.paused) setControls(false) }, 3500)
  }, [])

  /** Every stream failed: check the channel for real and say why (`gone`: the viewer moved on meanwhile) */
  const giveUp = useCallback(async (fallback: string, gone: () => boolean) => {
    setPhase('error')
    setError(fallback)
    try {
      const checked = await iptvService.check(id)
      qc.setQueryData(['iptv', 'channel', id], checked)
      // « unknown » has a reason too (yt-dlp missing on the server, for instance)
      if (!gone() && checked.status !== 'online' && checked.statusReason) setError(`Chaîne indisponible : ${checked.statusReason}.`)
    } catch { /* keep the first message */ }
  }, [id, qc])

  // ── Source ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v || !channel || !token) return
    let cancelled = false
    if (silentStreams.current.run !== run) silentStreams.current = { run, list: [], codec: false, again: [], asked: [], last: false }
    const memo = silentStreams.current
    const mode = saved?.mode ?? 'direct'
    const tries = saved?.n ?? 0
    const nextStream = () => { if (!cancelled) setFailed((f) => ({ run, n: (f.run === run ? f.n : 0) + 1 })) }
    const stopHls = () => { hlsRef.current?.destroy(); hlsRef.current = null }

    const noStream = () => giveUp(memo.codec ? NO_CODEC : 'Aucun des flux de cette chaîne ne répond.', () => cancelled)
    /**
     * Asks the server to convert stream `i`: played from the converted stream when it can.
     * When it cannot, by what led here (`how`):
     * - 'silent' (sound without a picture): the stream is kept for its sound — as it plays now
     *   when `here` (stream `i` is the one playing), else loaded for that;
     * - 'unfit' (a format this browser plays badly): the stream goes on as it is;
     * - 'failed' (no stream of the channel started): the channel is given up;
     * - 'asked' (remembered from last time, or the viewer's button): the stream is played as it is.
     */
    const rescuePicture = async (i: number, how: keyof typeof ASKING, here = false) => {
      setRescuing(ASKING[how])
      let res: PictureAnswer
      try { res = await iptvService.convert(channel.id, i) } catch { res = { video: null, audio: null, interlaced: false, plain: true, convert: false, reason: 'failed' } }
      if (cancelled) return
      setRescuing(null)
      rememberConverted(channel.id, i, res.convert)
      const n = tries + 1
      const why = res.reason ?? 'failed'
      if (manual.current) { manual.current = false; if (!res.convert) toast.error(SOUND_ONLY[why]) }
      if (res.convert) setRescue({ run, index: i, mode: 'converted', why: null, n })
      else if (how === 'asked') { memo.asked.push(i); setReload((r) => r + 1) }
      else if (how === 'unfit') trace.current.note = `conversion impossible (${why})`
      else if (how === 'failed') void noStream()
      else if (here) setQuiet({ run, why })
      else setRescue({ run, index: i, mode: 'sound', why, n })
    }

    setRescuing(null)
    if (!saved && step >= order.length) {
      // No stream with a picture, but one with sound: its picture from the server, else its sound.
      // No stream started at all: the server may still read one (a slow source, a bare MPEG-TS
      // stream, a format the browser refuses) and convert it.
      if (memo.list.length) void rescuePicture(memo.list[0], 'silent')
      else if (!memo.last && order.length) { memo.last = true; void rescuePicture(order[0], 'failed') }
      else void noStream()
      return () => { cancelled = true }
    }
    const idx = saved ? saved.index : order[step]
    setPhase('loading')
    setError(null)
    setStarted(false)
    setPicture(false)
    setQuiet(saved?.mode === 'sound' ? { run, why: saved.why ?? 'failed' } : null)
    // This browser needed the conversion for this stream last time: asked at once
    if (mode === 'direct' && wasConverted(channel.id, idx) && !memo.asked.includes(idx)) {
      void rescuePicture(idx, 'asked')
      return () => { cancelled = true }
    }
    const page = mode !== 'converted' && channel.streams[idx]?.kind === 'page'
    const url = mode === 'converted' ? iptvService.convertedUrl(channel.id, idx, token) : iptvService.playUrl(channel.id, idx, token)

    /** The stream stopped, or never started */
    const fail = () => {
      if (cancelled) return
      stopHls()
      if (mode === 'direct') nextStream()
      else if (mode === 'sound') void giveUp(memo.codec ? NO_CODEC : 'Le flux de cette chaîne s’est arrêté.', () => cancelled)
      else if (tries < 3) void rescuePicture(idx, 'silent')           // the conversion stopped: started again
      else setRescue({ run, index: idx, mode: 'sound', why: 'failed', n: tries + 1 })
    }
    /** Sound, but no picture (`playing`: the sound is running now) */
    const noPicture = (playing: boolean) => {
      if (cancelled || mode === 'sound') return
      clearInterval(watch)
      if (mode === 'converted') { if (playing) setQuiet({ run, why: 'failed' }); else fail(); return }
      if (!memo.list.includes(idx)) memo.list.push(idx)
      if (step < order.length - 1) { stopHls(); nextStream() }      // another stream of the channel may have a picture
      else void rescuePicture(memo.list[0], 'silent', playing && memo.list[0] === idx)
    }

    // Variants of this stream found to carry sound only (hls.js)
    const silent = new Set<string>()
    let restarts = 0
    // Playback that runs for a few seconds without any picture is a stream with sound only
    const native = NATIVE_HLS && !!v.canPlayType('application/vnd.apple.mpegurl')
    // Safari can size a picture and show none of it: where the browser is known to tell which
    // frames it shows, a picture counts once a frame of this load was shown
    const frames = v as FrameVideo
    const tells = !!frames.requestVideoFrameCallback
    const trusted = native && tells && framesReported()
    let shown = false
    const frameHandle = tells ? frames.requestVideoFrameCallback!(() => { shown = true; trace.current.shown = true; if (native) rememberFramesReported() }) : 0
    trace.current = { engine: native ? 'Safari' : 'hls.js', mode, shown: tells ? false : null, loads: trace.current.loads + 1, note: trace.current.next, next: '', held: trace.current.held }
    // Told by the server while the stream starts (below): a format this browser often shows
    // nothing of — converted when no frame of it was shown once playback had its chance
    let risky: string | null = null
    let probing = false
    let from: number | null = null
    const watch = setInterval(() => {
      if (mode === 'sound' || v.paused || v.readyState < 2) return
      const sized = v.videoWidth > 0
      if (sized && shown) { clearInterval(watch); return }
      if (from == null) { from = v.currentTime; return }
      const levels = hlsRef.current?.levels
      // hls.js already saw that no variant has a picture: no need to wait as long
      const known = !!levels?.length && levels.every((l) => silent.has(l.uri))
      if (v.currentTime - from < (known ? 1.5 : native ? 3 : 4)) return
      // Sized, and nothing here tells whether it is shown: taken as a picture (once the server
      // said what the stream holds)
      if (sized && !trusted && !(risky && tells)) { if (!probing) clearInterval(watch); return }
      clearInterval(watch)
      if (risky && mode === 'direct' && !memo.asked.includes(idx)) {
        memo.asked.push(idx)
        trace.current.next = `converti : ${risky}`
        void rescuePicture(idx, 'unfit', true)
      } else if (sized) {
        // Safari knows the picture but shows none of it: the stream loaded again, once, then converted
        trace.current.note = 'image connue mais non affichée'
        if (!memo.again.includes(idx)) { memo.again.push(idx); trace.current.next = 'rechargé : image connue mais non affichée'; setReload((r) => r + 1) }
        else noPicture(true)
      } else if (native && mode === 'direct' && !memo.again.includes(idx)) void loadAgain()
      else noPicture(true)
    }, 500)
    /** Safari, sound without a picture: when the stream holds a picture Safari reads, loading it
     *  again brings it (once per stream); otherwise it is handled like anywhere else. */
    const loadAgain = async () => {
      memo.again.push(idx)
      let res: PictureAnswer | null = null
      try { res = await iptvService.convert(channel.id, idx, true) } catch { /* not known: tried anyway */ }
      if (cancelled) return
      if (res?.video ? SAFARI_READS.has(res.video) : res?.reason !== 'audio') { trace.current.next = 'rechargé : son sans image'; setReload((r) => r + 1) }
      else noPicture(true)
    }

    // What the stream holds, asked while it starts: a stream this browser is known to play badly
    // is converted without waiting for the trouble to show
    if (mode === 'direct' && !page) {
      const reader: Reader = {
        native, hevc: native || supports('video/mp4; codecs="hvc1.1.6.L93.B0"'),
        ac3: supports('audio/mp4; codecs="ac-3"'), eac3: supports('audio/mp4; codecs="ec-3"'),
      }
      probing = true
      void iptvService.convert(channel.id, idx, true).then((held) => {
        probing = false
        if (cancelled) return
        trace.current.held = describeStream(held)
        const need = needsConversion(held, reader)
        if (!need || memo.asked.includes(idx) || (need.unsure && shown)) return
        // It may still show: left to the check above, where the browser tells which frames it shows
        if (need.unsure && tells) { risky = need.why; return }
        memo.asked.push(idx)
        clearInterval(watch)
        trace.current.next = `converti : ${need.why}`
        void rescuePicture(idx, 'unfit')
      }, () => { probing = false /* not known: the stream plays as it comes */ })
    }

    if (native) {
      v.src = url
      v.onerror = fail
      v.onended = mode === 'converted' ? fail : null
      void v.play().catch(() => setPhase('paused'))
    } else {
      void import('hls.js').then(({ default: HlsJs }) => {
        if (cancelled) return
        if (!HlsJs.isSupported()) { setPhase('error'); setError('Ce navigateur ne sait pas lire les flux en direct.'); return }
        const open = () => {
          const hls = new HlsJs({
            liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 60, levelLoadingMaxRetry: 2,
            // The server looks a page stream up before it answers (up to 45 s): wait for it, once.
            // Other sources may only start their stream when it is asked for: they get time too.
            ...(page ? { manifestLoadingTimeOut: 50_000, manifestLoadingMaxRetry: 0 } : { manifestLoadingTimeOut: 25_000, manifestLoadingMaxRetry: 1 }),
            levelLoadingTimeOut: 20_000,
          })
          hlsRef.current = hls
          let recoveries = 0
          hls.on(HlsJs.Events.ERROR, (_e, data) => {
            if (!data.fatal || hlsRef.current !== hls) return
            const codec = CODEC_ERRORS.has(data.details)
            if (!codec && data.type === HlsJs.ErrorTypes.MEDIA_ERROR && recoveries++ < 2) { hls.recoverMediaError(); return }
            stopHls()
            // A format the browser refuses: like a stream without a picture, the server may convert it
            if (codec && mode === 'direct') { memo.codec = true; noPicture(false) } else fail()
          })
          hls.on(HlsJs.Events.MANIFEST_PARSED, () => {
            // Sound-only variants are left out: started on one, hls.js never brings the picture in
            for (const i of variantsToDrop(hls.levels, silent)) hls.removeLevel(i)
            void v.play().catch(() => setPhase('paused'))
          })
          hls.on(HlsJs.Events.FRAG_PARSING_INIT_SEGMENT, (_e, data) => {
            // hls.js gives { id, frag, tracks } but declares nothing for this event
            const init = data as unknown as { id: string; frag: { level: number }; tracks: { video?: unknown; audiovideo?: unknown } }
            if (init.id !== 'main' || init.tracks.video || init.tracks.audiovideo) return
            const uri = hls.levels[init.frag.level]?.uri
            if (!uri || silent.has(uri)) return
            silent.add(uri)
            // This variant has no picture and was not announced as such; others may: start again without it
            if (hls.levels.some((l) => !silent.has(l.uri)) && restarts++ < 6) {
              setTimeout(() => { if (cancelled || hlsRef.current !== hls) return; stopHls(); from = null; open() }, 0)
            }
          })
          if (mode === 'converted') v.onended = fail
          hls.loadSource(url)
          hls.attachMedia(v)
        }
        open()
      })
    }
    return () => {
      cancelled = true
      clearInterval(watch)
      if (frameHandle) frames.cancelVideoFrameCallback?.(frameHandle)
      v.onerror = null
      v.onended = null
      stopHls()
      v.removeAttribute('src')
      v.load()
    }
  }, [channel?.id, step, token, attempt, saved?.mode, saved?.index, saved?.n, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Media events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlaying = () => {
      setPhase('playing')
      setStarted(true)
      reveal()
      if (recorded.current !== id) { recorded.current = id; void iptvService.watched(id).then(() => qc.invalidateQueries({ queryKey: ['iptv', 'summary'] })) }
    }
    const onPause = () => { setPhase((p) => (p === 'error' ? p : 'paused')); setControls(true) }
    const onWaiting = () => setPhase((p) => (p === 'error' ? p : 'loading'))
    const onVolume = () => { setMuted(v.muted); setVolume(v.volume) }
    const onPicture = () => setPicture(v.videoWidth > 0)
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
    for (const e of ['resize', 'loadedmetadata', 'emptied']) v.addEventListener(e, onPicture)
    return () => {
      for (const e of ['resize', 'loadedmetadata', 'emptied']) v.removeEventListener(e, onPicture)
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('volumechange', onVolume)
      v.removeEventListener('timeupdate', onTime)
    }
  }, [id, qc, reveal])

  // Playback details, refreshed while they are shown
  const shownDetails = details !== null
  useEffect(() => {
    if (!shownDetails) return
    const read = () => {
      const v = videoRef.current
      const t = trace.current
      if (!v) return
      const hls = hlsRef.current
      setDetails([
        `Lecteur : ${t.engine || '…'} · ${t.mode === 'converted' ? 'image convertie par le serveur' : t.mode === 'sound' ? 'son seul' : 'flux direct'} · chargement n° ${t.loads}`,
        `Image : ${v.videoWidth}×${v.videoHeight} · affichée : ${t.shown == null ? 'inconnu' : t.shown ? 'oui' : 'non'} · état ${v.readyState} · ${v.paused ? 'en pause' : 'en lecture'} · ${v.currentTime.toFixed(0)} s`,
        `Flux ${index + 1}/${channel?.streams.length ?? 0}${t.held ? ` : ${t.held}` : ''}${hls ? ` · ${hls.levels.length} variante(s), niveau ${hls.currentLevel}` : ''}`,
        ...(t.note ? [t.note] : []),
      ])
    }
    read()
    const timer = setInterval(read, 1000)
    return () => clearInterval(timer)
  }, [shownDetails, index, channel?.streams.length])

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
  const retry = () => { setError(null); setPhase('loading'); setAttempt((a) => a + 1) }
  /** The viewer's own switch: this stream converted by the server (remembered for this browser), or back as it is */
  const converted = saved?.mode === 'converted'
  const toggleConversion = () => {
    if (!channel) return
    const memo = silentStreams.current
    if (converted) {
      rememberConverted(channel.id, index, false)
      if (memo.run === run) memo.asked.push(index)          // not converted again by itself in this attempt
    } else {
      rememberConverted(channel.id, index, true)
      if (memo.run === run) memo.asked = memo.asked.filter((i) => i !== index)
      manual.current = true
    }
    setRescue(null)
    setQuiet(null)
    setReload((r) => r + 1)
  }

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
  // When nothing plays here: the channel's own page (its live on YouTube…), else its website
  const pageStream = channel?.streams.find((st) => st.kind === 'page' && st.page)
  const outside = pageStream?.page
    ? { href: pageStream.page, label: `Ouvrir sur ${siteName(pageStream.page)}` }
    : channel?.website ? { href: channel.website, label: 'Site officiel' } : null

  return (
    <div
      ref={boxRef}
      className="fixed inset-0 bg-black text-white select-none"
      onMouseMove={reveal}
      onPointerDown={reveal}
    >
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline autoPlay onClick={togglePlay} />

      {/* Loading / error */}
      {(phase === 'loading' || isError || rescuing) && !error && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3 px-6 text-center max-w-[380px]">
            <Spinner size={36} label="Chargement de la chaîne" color="rgba(255,255,255,.9)" />
            {rescuing
              ? <p className="text-[14px] text-white/75" style={{ textShadow: '0 1px 6px rgba(0,0,0,.8)' }}>{rescuing}</p>
              : site && !started && <p className="text-[14px] text-white/75">Recherche du direct sur {site}…</p>}
          </div>
        </div>
      )}
      {/* Paused (or the browser refused to start by itself): one large button to start */}
      {phase === 'paused' && !error && !isError && !rescuing && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <button type="button" className="pointer-events-auto w-[72px] h-[72px] grid place-items-center rounded-full glass-media active:scale-95 transition-transform" onClick={togglePlay} aria-label="Lecture">
            <Play size={30} fill="white" strokeWidth={0} style={{ marginLeft: 3 }} aria-hidden="true" />
          </button>
        </div>
      )}
      {/* Sound without a picture: said as such, the sound goes on */}
      {quietWhy && !picture && !error && !rescuing && phase === 'playing' && (
        <div className="absolute inset-0 grid place-items-center px-6 pointer-events-none" role="status" aria-live="polite">
          <div className="max-w-[380px] text-center flex flex-col items-center gap-3">
            {channel && <ChannelLogo channel={channel} className="w-40 h-24 rounded-card" />}
            <p className="text-[17px] font-semibold inline-flex items-center gap-2"><Volume2 size={18} aria-hidden="true" /> Son uniquement</p>
            <p className="text-[14px] text-white/70">{SOUND_ONLY[quietWhy]}</p>
            {quietWhy !== 'audio' && (
              <button type="button" className="pointer-events-auto h-11 px-4 mt-1 rounded-pill glass-media text-[15px] font-semibold inline-flex items-center gap-2" onClick={retry}>
                <RefreshCw size={16} aria-hidden="true" /> Réessayer
              </button>
            )}
          </div>
        </div>
      )}
      {(error || isError) && (
        <div className="absolute inset-0 grid place-items-center px-6" role="alert">
          <div className="max-w-[380px] text-center flex flex-col items-center gap-3">
            <AlertTriangle size={30} strokeWidth={1.5} className="text-white/70" aria-hidden="true" />
            <p className="text-[17px] font-semibold">{isError ? 'Chaîne introuvable' : 'Lecture impossible'}</p>
            <p className="text-[14px] text-white/70">{isError ? 'Elle n’est plus dans le catalogue.' : error}</p>
            {!isError && (
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                <button type="button" className="h-11 px-4 rounded-pill glass-media text-[15px] font-semibold inline-flex items-center gap-2" onClick={retry}>
                  <RefreshCw size={16} aria-hidden="true" /> Réessayer
                </button>
                {neighbour(1) && <button type="button" className="h-11 px-4 rounded-pill bg-white text-black text-[15px] font-semibold" onClick={() => zap(1)}>Chaîne suivante</button>}
                {outside && (
                  <a href={outside.href} target="_blank" rel="noreferrer" className="h-11 px-4 rounded-pill glass-media text-[15px] font-semibold inline-flex items-center gap-2">
                    <ExternalLink size={16} aria-hidden="true" /> {outside.label}
                  </a>
                )}
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
        {/* Three quick taps: the playback details (what the browser really plays), to report a problem */}
        <span className="flex items-center gap-1.5 h-7 px-2.5 rounded-pill bg-danger text-[11px] font-bold tracking-wide flex-shrink-0"
          onClick={() => {
            const now = Date.now()
            taps.current = [...taps.current.filter((t) => now - t < 1200), now]
            if (taps.current.length >= 3) { taps.current = []; setDetails((d) => (d ? null : [])) }
          }}>
          <span className="w-1.5 h-1.5 rounded-full bg-white" aria-hidden="true" /> EN DIRECT
        </span>
        {channel && (
          <button type="button" className={cn(btn, 'glass-media flex-shrink-0')} onClick={() => fav.mutate(channel as IptvChannel)}
            aria-label={channel.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={channel.favorite}>
            <Heart size={19} className={channel.favorite ? 'fill-white' : ''} />
          </button>
        )}
      </div>

      {details && (
        <div className="absolute left-3 sm:left-5 right-3 text-[11px] leading-[1.45] text-white/90 tabular pointer-events-none" role="status"
          style={{ top: 'calc(max(12px, env(safe-area-inset-top, 0px)) + 56px)', textShadow: '0 1px 3px rgba(0,0,0,.9)' }}>
          {details.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}

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
                {[current?.quality, site, channel && channel.streams.length > 1 && `flux ${index + 1}/${channel.streams.length}`,
                  converted && 'image convertie par le serveur'].filter(Boolean).join(' · ')}
              </span>
            </p>
            <button type="button" className={btn} onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted }} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
              {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} className="hidden sm:block w-24" style={{ accentColor: 'white' }}
              onChange={(e) => { const v = videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = v.volume === 0 } }} aria-label="Volume" />
            <button type="button" className={cn(btn, converted && 'bg-white/20')} onClick={toggleConversion} aria-pressed={converted} disabled={!channel || !!rescuing}
              aria-label={converted ? 'Revenir au flux direct' : 'Image ou son absent : faire convertir la chaîne par le serveur'}
              title={converted ? 'Revenir au flux direct' : 'Image ou son absent ? Convertir par le serveur'}>
              <ServerCog size={19} />
            </button>
            <button type="button" className={btn} onClick={togglePip} aria-label="Image dans l’image"><PictureInPicture2 size={19} /></button>
            <button type="button" className={btn} onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
      {error && channel?.labels.includes('Geo-blocked') && (
        <p className="absolute inset-x-0 bottom-28 text-center text-[12px] text-white/60 px-6">Cette chaîne est signalée comme réservée à son pays.</p>
      )}
    </div>
  )
}
