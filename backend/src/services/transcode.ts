import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logger } from '../utils/logger'

const execFileAsync = promisify(execFile)

// ─── Configuration ────────────────────────────────────
const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'
/** HLS segment length in seconds */
export const SEGMENT_SECONDS = 6
/** Kill a transcode when the player stopped asking for it (no playlist/segment request) */
const IDLE_MS = parseInt(process.env.TRANSCODE_IDLE_MS || '30000', 10)
/** Old CPUs cannot run many encodes at once */
const MAX_JOBS = parseInt(process.env.TRANSCODE_MAX_JOBS || '3', 10)
const BASE = process.env.TRANSCODE_DIR || path.join(os.tmpdir(), 'nexus-hls')
/** One directory per backend process, so a restart never deletes a running conversion of another process */
const ROOT = path.join(BASE, String(process.pid))

// ─── Probing ──────────────────────────────────────────
export interface ProbeStream {
  index:       number
  codec_type:  'video' | 'audio' | 'subtitle' | string
  codec_name?: string
  pix_fmt?:    string
  width?:      number
  height?:     number
}
export interface ProbeResult {
  format:   { format_name?: string; duration?: string }
  streams:  ProbeStream[]
}

let ffmpegAvailable: boolean | null = null

/** True when ffmpeg and ffprobe can be executed (checked once). */
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    await Promise.all([
      execFileAsync(FFMPEG, ['-version'], { timeout: 5000 }),
      execFileAsync(FFPROBE, ['-version'], { timeout: 5000 }),
    ])
    ffmpegAvailable = true
  } catch {
    ffmpegAvailable = false
    logger.warn('ffmpeg/ffprobe not found: videos will only be streamed as-is (no conversion)')
  }
  return ffmpegAvailable
}

const probeCache = new Map<string, ProbeResult>()

export async function probe(filePath: string): Promise<ProbeResult> {
  const st  = await fs.promises.stat(filePath)
  const key = `${filePath}|${st.size}|${st.mtimeMs}`
  const hit = probeCache.get(key)
  if (hit) return hit

  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,pix_fmt,width,height',
    '-of', 'json',
    filePath,
  ], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })

  const result = JSON.parse(stdout) as ProbeResult
  if (probeCache.size > 500) probeCache.delete(probeCache.keys().next().value as string)
  probeCache.set(key, result)
  return result
}

// ─── Decision ─────────────────────────────────────────
export type PlayMode = 'direct' | 'remux' | 'transcode'

export interface PlayDecision {
  mode:      PlayMode
  duration:  number | null
  video:     string | null
  audio:     string | null
  reason:    string
}

export interface ClientCaps {
  /** The browser can play WebM (VP8/VP9 + Opus/Vorbis) natively */
  webm?: boolean
}

const BROWSER_PIX_FMTS = ['yuv420p', 'yuvj420p']

/**
 * Can a browser play this file as-is?
 * - direct    : MP4/MOV + H.264 (8-bit 4:2:0) + AAC/MP3 (or no audio); WebM when the client supports it
 * - remux     : H.264 video in another container or with another audio codec → copy video, convert audio to AAC
 * - transcode : anything else (HEVC, MPEG-4, 10-bit…) → re-encode with libx264
 */
export function decide(p: ProbeResult, caps: ClientCaps = {}): PlayDecision {
  const v = p.streams.find((s) => s.codec_type === 'video')
  const a = p.streams.find((s) => s.codec_type === 'audio')
  const fmt = p.format.format_name ?? ''
  const dur = p.format.duration ? Number(p.format.duration) : NaN
  const base = { duration: Number.isFinite(dur) ? dur : null, video: v?.codec_name ?? null, audio: a?.codec_name ?? null }

  const isMp4   = /(^|,)(mp4|mov)(,|$)/.test(fmt)
  const isWebm  = /(^|,)webm(,|$)/.test(fmt)
  const h264Ok  = v?.codec_name === 'h264' && (!v.pix_fmt || BROWSER_PIX_FMTS.includes(v.pix_fmt))
  const audioOk = !a || a.codec_name === 'aac' || a.codec_name === 'mp3'

  if (!v) return { ...base, mode: 'direct', reason: 'no video stream' }
  if (isMp4 && h264Ok && audioOk) return { ...base, mode: 'direct', reason: 'mp4/h264/aac' }
  if (isWebm && caps.webm && ['vp8', 'vp9'].includes(v.codec_name ?? '')
      && (!a || ['opus', 'vorbis'].includes(a.codec_name ?? ''))) {
    return { ...base, mode: 'direct', reason: 'webm supported by the client' }
  }
  if (h264Ok) return { ...base, mode: 'remux', reason: `h264 in ${fmt.split(',')[0]} with ${a?.codec_name ?? 'no'} audio` }
  return { ...base, mode: 'transcode', reason: `${v.codec_name}${v.pix_fmt ? ` (${v.pix_fmt})` : ''} needs re-encoding` }
}

/**
 * ffmpeg arguments producing an HLS (MPEG-TS) stream from `start` seconds.
 * `firstSegment` (on-demand conversion): the segments are numbered from it and their
 * timestamps start at `start`, so they fit the full-length playlist the player has.
 */
export function ffmpegArgs(input: string, mode: Exclude<PlayMode, 'direct'>, start: number, outDir: string, firstSegment?: number): string[] {
  const video = mode === 'remux'
    ? ['-c:v', 'copy']
    : [
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-maxrate', '8M', '-bufsize', '16M',
        '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
        // Never upscale; cap at 1080p (old CPU)
        '-vf', "scale='min(1920,iw)':-2",
        // Keyframe at every segment boundary so HLS segments are exactly SEGMENT_SECONDS
        '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`, '-sc_threshold', '0',
      ]
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    ...video,
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    ...(firstSegment != null ? ['-output_ts_offset', start.toFixed(3), '-start_number', String(firstSegment)] : []),
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    path.join(outDir, 'index.m3u8'),
  ]
}

// ─── Jobs ─────────────────────────────────────────────
export interface TranscodeJob {
  id:         string
  userId:     string
  filePath:   string
  mode:       Exclude<PlayMode, 'direct'>
  start:      number
  /**
   * On-demand conversion (re-encode with a known duration): the player gets the playlist
   * of the WHOLE film at once (iPhone full screen shows the real length) and ffmpeg is
   * restarted at the segment the player asks for when it is far from what is converted.
   */
  vod:        boolean
  /** Full duration in seconds (vod) */
  total:      number | null
  /** First segment of the running ffmpeg (vod) */
  segStart:   number
  restartedAt: number
  dir:        string
  proc:       ChildProcess | null
  done:       boolean
  failed:     string | null
  lastAccess: number
  createdAt:  number
}

const jobs = new Map<string, TranscodeJob>()

export function getJob(id: string): TranscodeJob | undefined {
  const job = jobs.get(id)
  if (job) job.lastAccess = Date.now()
  return job
}

export function listJobs(): TranscodeJob[] {
  return [...jobs.values()]
}

export function stopJob(id: string, reason = 'stopped'): void {
  const job = jobs.get(id)
  if (!job) return
  jobs.delete(id)
  if (job.proc && job.proc.exitCode === null) {
    job.proc.kill('SIGKILL')
    logger.info(`Transcode ${id} killed (${reason})`)
  }
  fs.promises.rm(job.dir, { recursive: true, force: true }).catch(() => {})
}

export async function startJob(
  userId: string, filePath: string, mode: Exclude<PlayMode, 'direct'>, start: number, total: number | null = null,
): Promise<TranscodeJob> {
  // One playback per user and file at a time, and a global cap for the CPU
  for (const j of jobs.values()) if (j.userId === userId && j.filePath === filePath) stopJob(j.id, 'replaced')
  const running = [...jobs.values()].filter((j) => !j.done).sort((a, b) => a.lastAccess - b.lastAccess)
  while (running.length >= MAX_JOBS) stopJob(running.shift()!.id, 'too many transcodes')

  const id  = crypto.randomBytes(12).toString('hex')
  const dir = path.join(ROOT, id)
  await fs.promises.mkdir(dir, { recursive: true })

  // Re-encoding: whole-film playlist, converted on demand. Remux (copy, fast): the whole
  // file is converted before playback starts (its segments follow the source keyframes,
  // so a full playlist cannot be written in advance).
  const vod = mode === 'transcode' && !!total && total > 0
  const job: TranscodeJob = {
    id, userId, filePath, mode, start: vod || mode === 'remux' ? 0 : start, vod, total, segStart: 0, restartedAt: 0, dir,
    proc: null, done: false, failed: null, lastAccess: Date.now(), createdAt: Date.now(),
  }
  jobs.set(id, job)
  launch(job, vod ? Math.floor(start / SEGMENT_SECONDS) : 0)
  logger.info(`Transcode ${id}: ${mode}${vod ? ' (on demand)' : ''} from ${start}s — ${filePath}`)
  return job
}

/** (Re)starts ffmpeg; on demand, from segment `segment`. */
function launch(job: TranscodeJob, segment: number) {
  if (job.proc && job.proc.exitCode === null) job.proc.kill('SIGKILL')
  job.segStart = segment
  job.restartedAt = Date.now()
  job.done = false
  job.failed = null
  const from = job.vod ? segment * SEGMENT_SECONDS : job.start
  const proc = spawn(FFMPEG, ffmpegArgs(job.filePath, job.mode, from, job.dir, job.vod ? segment : undefined), { stdio: ['ignore', 'ignore', 'pipe'] })
  job.proc = proc
  let stderr = ''
  proc.stderr?.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000) })
  // A replaced ffmpeg (restart at another segment) no longer speaks for the job
  proc.on('error', (err) => { if (job.proc !== proc) return; job.failed = err.message; job.done = true })
  proc.on('exit', (code, signal) => {
    if (job.proc !== proc) return
    job.done = true
    if (code !== 0 && signal !== 'SIGKILL') {
      job.failed = stderr.trim() || `ffmpeg exited with code ${code}`
      logger.error(`Transcode ${job.id} failed: ${job.failed}`)
    }
  })
}

const segName = (n: number) => `seg${String(n).padStart(5, '0')}.ts`
const segmentCount = (job: TranscodeJob) => Math.max(1, Math.ceil((job.total ?? 0) / SEGMENT_SECONDS))

/** Playlist of the whole film (on-demand conversion), segments carry the stream token. */
export function vodPlaylist(job: TranscodeJob, token: string): string {
  const q = `?token=${encodeURIComponent(token)}`
  const n = segmentCount(job)
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS + 1}`, '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS']
  for (let i = 0; i < n; i++) {
    const d = Math.min(SEGMENT_SECONDS, (job.total ?? 0) - i * SEGMENT_SECONDS)
    lines.push(`#EXTINF:${Math.max(0.1, d).toFixed(3)},`, segName(i) + q)
  }
  lines.push('#EXT-X-ENDLIST', '')
  return lines.join('\n')
}

/** Segments ffmpeg already wrote from its current start (contiguous). */
function nextSegment(job: TranscodeJob): number {
  let n = job.segStart
  while (fs.existsSync(path.join(job.dir, segName(n)))) n++
  return n
}

/**
 * Path of a segment, waiting for ffmpeg to write it. On demand, a segment far from
 * what is being converted (a seek) restarts ffmpeg there. Null when it never comes.
 */
export async function segmentFile(job: TranscodeJob, index: number, timeoutMs = 90_000): Promise<string | null> {
  const file = path.join(job.dir, segName(index))
  if (fs.existsSync(file)) return file
  if (!job.vod) return null
  if (index < 0 || index >= segmentCount(job)) return null
  const next = nextSegment(job)
  const coming = !job.done && index >= job.segStart && index <= next + 4
  // Several requests right after a restart: wait for that ffmpeg rather than restarting again
  const justRestarted = Date.now() - job.restartedAt < 3000 && index >= job.segStart && index <= job.segStart + 4
  if (!coming && !justRestarted) {
    logger.info(`Transcode ${job.id}: seek to segment ${index} (was converting ${job.segStart}…${next})`)
    launch(job, index)
  }
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (!jobs.has(job.id)) return null
    job.lastAccess = Date.now()
    if (fs.existsSync(file)) return file
    if (job.done && !fs.existsSync(file)) {
      // ffmpeg finished or failed without this segment (a restart elsewhere does not end up here)
      if (job.failed) return null
      if (index < job.segStart || index >= nextSegment(job)) return null
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

/** Conversion state for the player: a remux is played once it is complete. */
export async function jobStatus(job: TranscodeJob): Promise<{ ready: boolean; done: boolean; failed: string | null; percent: number | null }> {
  if (job.vod) return { ready: true, done: job.done, failed: job.failed, percent: null }
  let percent: number | null = null
  if (job.total) {
    const text = await fs.promises.readFile(path.join(job.dir, 'index.m3u8'), 'utf8').catch(() => '')
    const converted = [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0)
    percent = Math.min(100, Math.round((converted / Math.max(1, job.total - job.start)) * 100))
  }
  const ready = job.mode === 'remux' ? job.done && !job.failed : true
  return { ready, done: job.done, failed: job.failed, percent: job.done && !job.failed ? 100 : percent }
}

/**
 * Wait until the playlist exists with at least one segment (ffmpeg needs a
 * few seconds to produce the first one). Returns null when the job failed.
 */
export async function waitForPlaylist(job: TranscodeJob, timeoutMs = 30_000): Promise<string | null> {
  const file = path.join(job.dir, 'index.m3u8')
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (!jobs.has(job.id)) return null
    try {
      const text = await fs.promises.readFile(file, 'utf8')
      if (/#EXTINF/.test(text)) return text
    } catch { /* not written yet */ }
    if (job.done) return job.failed ? null : await fs.promises.readFile(file, 'utf8').catch(() => null)
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

/**
 * Playlist served to the player: segment URIs carry the stream token (media
 * elements cannot send headers) and playback starts at the beginning of this
 * job (EVENT playlists would otherwise start near the "live" edge).
 */
export function rewritePlaylist(text: string, token: string): string {
  const q = `?token=${encodeURIComponent(token)}`
  return text
    .replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES')
    .replace(/^(seg\d+\.ts)$/gm, `$1${q}`)
}

// ─── Housekeeping ─────────────────────────────────────
function reap() {
  const now = Date.now()
  for (const job of jobs.values()) {
    // Running: the player stopped fetching (closed tab, app in background…)
    // Finished: keep segments a little while for seeking back, then clean up
    const ttl = job.done ? IDLE_MS * 10 : IDLE_MS
    if (now - job.lastAccess <= ttl) continue
    // On demand (paused film): stop ffmpeg but keep the job a while, it restarts where asked
    if (job.vod && !job.done && now - job.lastAccess < IDLE_MS * 60) {
      job.proc?.kill('SIGKILL')
      job.done = true
      logger.info(`Transcode ${job.id} paused (client idle)`)
      continue
    }
    stopJob(job.id, job.done ? 'expired' : 'client gone')
  }
}
const reaper = setInterval(reap, Math.min(10_000, Math.max(1000, IDLE_MS / 3)))
reaper.unref()

// Leftovers of backend processes that are gone (synchronous: runs before any job starts)
try {
  for (const name of fs.readdirSync(BASE)) {
    const pid = Number(name)
    let alive = false
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true } catch { /* not running */ } }
    if (!alive || pid === process.pid) fs.rmSync(path.join(BASE, name), { recursive: true, force: true })
  }
} catch { /* BASE does not exist yet */ }
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => { for (const id of [...jobs.keys()]) stopJob(id, 'shutdown'); process.exit(0) })
}
process.once('exit', () => { for (const j of jobs.values()) j.proc?.kill('SIGKILL') })
