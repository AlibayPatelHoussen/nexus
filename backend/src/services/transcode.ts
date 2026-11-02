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
const ROOT = process.env.TRANSCODE_DIR || path.join(os.tmpdir(), 'nexus-hls')

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

/** ffmpeg arguments producing an HLS (MPEG-TS) stream from `start` seconds. */
export function ffmpegArgs(input: string, mode: Exclude<PlayMode, 'direct'>, start: number, outDir: string): string[] {
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
  userId: string, filePath: string, mode: Exclude<PlayMode, 'direct'>, start: number,
): Promise<TranscodeJob> {
  // One playback per user and file at a time, and a global cap for the CPU
  for (const j of jobs.values()) if (j.userId === userId && j.filePath === filePath) stopJob(j.id, 'replaced')
  const running = [...jobs.values()].filter((j) => !j.done).sort((a, b) => a.lastAccess - b.lastAccess)
  while (running.length >= MAX_JOBS) stopJob(running.shift()!.id, 'too many transcodes')

  const id  = crypto.randomBytes(12).toString('hex')
  const dir = path.join(ROOT, id)
  await fs.promises.mkdir(dir, { recursive: true })

  const job: TranscodeJob = {
    id, userId, filePath, mode, start, dir,
    proc: null, done: false, failed: null, lastAccess: Date.now(), createdAt: Date.now(),
  }
  const proc = spawn(FFMPEG, ffmpegArgs(filePath, mode, start, dir), { stdio: ['ignore', 'ignore', 'pipe'] })
  job.proc = proc
  let stderr = ''
  proc.stderr?.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000) })
  proc.on('error', (err) => { job.failed = err.message; job.done = true })
  proc.on('exit', (code, signal) => {
    job.done = true
    if (code !== 0 && signal !== 'SIGKILL') {
      job.failed = stderr.trim() || `ffmpeg exited with code ${code}`
      logger.error(`Transcode ${id} failed: ${job.failed}`)
    }
  })
  jobs.set(id, job)
  logger.info(`Transcode ${id}: ${mode} from ${start}s — ${filePath}`)
  return job
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
    if (now - job.lastAccess > ttl) stopJob(job.id, job.done ? 'expired' : 'client gone')
  }
}
const reaper = setInterval(reap, Math.min(10_000, Math.max(1000, IDLE_MS / 3)))
reaper.unref()

// Leftovers from a previous run, and never leave ffmpeg orphans behind
fs.promises.rm(ROOT, { recursive: true, force: true }).catch(() => {})
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => { for (const id of [...jobs.keys()]) stopJob(id, 'shutdown'); process.exit(0) })
}
process.once('exit', () => { for (const j of jobs.values()) j.proc?.kill('SIGKILL') })
