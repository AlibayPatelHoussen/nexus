import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logger } from '../utils/logger'
import { buildIndex, indexProgress, readIndex, segmentCuts } from './keyframes'

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
  channels?:   number
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
    '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,pix_fmt,width,height,channels',
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
  /**
   * The audio can go into the stream as it is (AAC / MP3, stereo): re-encoding it was what
   * made a remux slow (one CPU core, ~30x real time: 3-4 min for a 1 h 30 film)
   */
  audioCopy?: boolean
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
  const audioCopy = !!a && (a.codec_name === 'aac' || a.codec_name === 'mp3') && (a.channels ?? 2) <= 2
  const base = { duration: Number.isFinite(dur) ? dur : null, video: v?.codec_name ?? null, audio: a?.codec_name ?? null, audioCopy }

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
export function ffmpegArgs(
  input: string, mode: Exclude<PlayMode, 'direct'>, start: number, outDir: string, firstSegment?: number, audioCopy = false,
): string[] {
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
    ...(audioCopy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']),
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

/** Fixed shift of every remux output: timestamps never go negative, so every run (from the
 *  start or from a seek) puts the same frame at the same time and the segments fit together. */
const TS_OFFSET = '10'

/**
 * ffmpeg arguments copying the film from segment `k`, cut exactly at the keyframes of the
 * index (`cuts`): the segments match the whole-film playlist the player already has.
 * In a copied MKV, a seek lands on a keyframe at or before the one asked (`landing`): the
 * piece between it and cut `k` is written as an extra first segment (`junk`), not served.
 * Timestamps are the source's (-copyts) shifted by TS_OFFSET, the same in every run.
 */
export function remuxSegmentArgs(
  input: string, cuts: number[], k: number, landing: number, outDir: string, listFile: string, audioCopy = false,
): { args: string[]; junk: number | null } {
  const hasJunk = k > 0 && landing < cuts[k] - 0.05
  const times = [...(hasJunk ? [cuts[k]] : []), ...cuts.slice(k + 1, -1)]
  return {
    junk: hasJunk ? k - 1 : null,
    args: [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      // Just after the keyframe: the seek goes back to the keyframe at or before it
      ...(k > 0 ? ['-ss', (cuts[k] + 0.001).toFixed(4)] : []),
      '-copyts', '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy',
      ...(audioCopy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']),
      '-output_ts_offset', TS_OFFSET,
      '-f', 'segment', '-segment_format', 'mpegts',
      // Times counted from where this run starts; a little before each keyframe so rounding
      // (or audio starting a few ms before the picture) never pushes a cut to the next one
      ...(times.length ? ['-segment_times', times.map((t) => Math.max(0.001, t - landing - 0.05).toFixed(4)).join(',')] : []),
      '-segment_start_number', String(hasJunk ? k - 1 : k),
      '-segment_list', listFile, '-segment_list_type', 'csv',
      path.join(outDir, 'seg%05d.ts'),
    ],
  }
}

/** Where ffmpeg really starts when asked to seek to `t` (first video packet), in seconds. */
async function landingTime(input: string, t: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', t.toFixed(4), '-copyts',
      '-i', input, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-f', 'framecrc', '-'], { timeout: 15_000 })
    const tb = /#tb 0: (\d+)\/(\d+)/.exec(stdout)
    const line = stdout.split('\n').find((l) => /^0,/.test(l))
    if (!tb || !line) return null
    const pts = Number(line.split(',')[2])
    return Number.isFinite(pts) ? pts * Number(tb[1]) / Number(tb[2]) : null
  } catch { return null }
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
  /** The audio is copied as it is (AAC / MP3 stereo) */
  audioCopy:  boolean
  /**
   * Remux on demand: segment boundaries from the file's keyframe index (null while the
   * index is being built). Segments are copied when asked, like the re-encode on demand.
   */
  cuts:       number[] | null
  /** Finished segments (remux on demand: the segment muxer writes in place) → their file */
  complete:   Map<number, string>
  /** Current copy run: its folder, its list of finished segments, its extra first piece */
  runDir:     string | null
  listFile:   string | null
  junk:       number | null
  gen:        number
  /** Last far jump asked (dragging the timeline asks for many in a row: only the last one starts ffmpeg) */
  wanted:     number | null
  wantedAt:   number
  indexing:   Promise<void> | null
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
  userId: string, filePath: string, mode: Exclude<PlayMode, 'direct'>, start: number, total: number | null = null, audioCopy = false,
): Promise<TranscodeJob> {
  // One playback per user and file at a time, and a global cap for the CPU
  for (const j of jobs.values()) if (j.userId === userId && j.filePath === filePath) stopJob(j.id, 'replaced')
  const running = [...jobs.values()].filter((j) => !j.done).sort((a, b) => a.lastAccess - b.lastAccess)
  while (running.length >= MAX_JOBS) stopJob(running.shift()!.id, 'too many transcodes')

  const id  = crypto.randomBytes(12).toString('hex')
  const dir = path.join(ROOT, id)
  await fs.promises.mkdir(dir, { recursive: true })

  // Whole-film playlist given at once, each segment converted when the player asks:
  // re-encoding (segments of exactly 6 s) and remux (cut at the keyframes of the file's
  // index; while the index is built the player waits, with progress)
  const known = !!total && total > 0
  const vod = known && (mode === 'transcode' || mode === 'remux')
  const job: TranscodeJob = {
    id, userId, filePath, mode, start: vod || mode === 'remux' ? 0 : start, vod, total, audioCopy,
    cuts: null, complete: new Map(), runDir: null, listFile: null, junk: null, gen: 0, wanted: null, wantedAt: 0, indexing: null, segStart: 0, restartedAt: 0, dir,
    proc: null, done: false, failed: null, lastAccess: Date.now(), createdAt: Date.now(),
  }
  jobs.set(id, job)
  if (vod && mode === 'remux') {
    const known = await readIndex(filePath)
    if (known) {
      job.cuts = segmentCuts(known, total!, SEGMENT_SECONDS)
      launch(job, segmentAt(job.cuts, start))
    } else {
      job.indexing = buildIndex(filePath, total).then((keyframes) => {
        job.cuts = segmentCuts(keyframes, total!, SEGMENT_SECONDS)
        if (jobs.has(job.id)) launch(job, segmentAt(job.cuts, start))
      }, (err: Error) => {
        // No index (odd file): convert the whole file first, as before
        logger.warn(`Keyframe index failed for ${filePath}: ${err.message}`)
        job.vod = false
        if (jobs.has(job.id)) launch(job, 0)
      }).finally(() => { job.indexing = null })
    }
  } else {
    launch(job, vod ? Math.floor(start / SEGMENT_SECONDS) : 0)
  }
  logger.info(`Transcode ${id}: ${mode}${vod ? ' (on demand)' : ''}${audioCopy ? ', audio copied' : ''} from ${start}s — ${filePath}`)
  return job
}

/** (Re)starts ffmpeg; on demand, from segment `segment`. */
function launch(job: TranscodeJob, segment: number) {
  if (job.proc && job.proc.exitCode === null) job.proc.kill('SIGKILL')
  job.segStart = segment
  job.restartedAt = Date.now()
  job.done = false
  job.failed = null
  if (job.vod && job.cuts) { void launchRemux(job, segment); return }
  const from = job.vod ? segment * SEGMENT_SECONDS : job.start
  spawnJob(job, ffmpegArgs(job.filePath, job.mode, from, job.dir, job.vod ? segment : undefined, job.audioCopy))
}

/** Remux on demand: a copy run from segment `k` (finished segments of earlier runs are kept). */
async function launchRemux(job: TranscodeJob, k: number) {
  refreshComplete(job)
  job.proc = null
  const gen = ++job.gen
  const cuts = job.cuts!
  const landing = k > 0 ? await landingTime(job.filePath, cuts[k] + 0.001) ?? cuts[k] : 0
  if (gen !== job.gen || !jobs.has(job.id)) return
  const runDir = path.join(job.dir, `run-${gen}`)
  await fs.promises.mkdir(runDir, { recursive: true })
  if (gen !== job.gen || !jobs.has(job.id)) return
  const listFile = path.join(runDir, 'segments.csv')
  const { args, junk } = remuxSegmentArgs(job.filePath, cuts, k, landing, runDir, listFile, job.audioCopy)
  job.runDir = runDir
  job.listFile = listFile
  job.junk = junk
  spawnJob(job, args)
}

function spawnJob(job: TranscodeJob, args: string[]) {
  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
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

/** Segment that contains `t` seconds (resume: the copy starts there). */
function segmentAt(cuts: number[], t: number): number {
  let i = 0
  while (i + 1 < cuts.length - 1 && cuts[i + 1] <= t) i++
  return i
}

/** How far ahead (segments) the running copy is waited for instead of starting a new one there. */
const remuxJumpAhead = () => Number(process.env.REMUX_JUMP_SEGMENTS ?? 20)

const segName = (n: number) => `seg${String(n).padStart(5, '0')}.ts`
const segmentCount = (job: TranscodeJob) => job.cuts ? job.cuts.length - 1 : Math.max(1, Math.ceil((job.total ?? 0) / SEGMENT_SECONDS))

/** Remux on demand: the segment muxer lists each segment once it is finished. */
function refreshComplete(job: TranscodeJob) {
  if (!job.listFile || !job.runDir) return
  let text = ''
  try { text = fs.readFileSync(job.listFile, 'utf8') } catch { return }
  for (const line of text.split('\n')) {
    const m = /^(seg(\d{5})\.ts),/.exec(line)
    if (!m) continue
    const index = Number(m[2])
    // The piece before the seek point is not a real segment
    if (index !== job.junk && !job.complete.has(index)) job.complete.set(index, path.join(job.runDir, m[1]))
  }
}

/** The segment can be sent: finished (remux on demand) / renamed into place (HLS muxer). */
function segmentReady(job: TranscodeJob, index: number): boolean {
  if (job.cuts) {
    if (!job.complete.has(index)) refreshComplete(job)
    return job.complete.has(index)
  }
  return fs.existsSync(path.join(job.dir, segName(index)))
}

/** Playlist of the whole film (on-demand conversion), segments carry the stream token. */
export function vodPlaylist(job: TranscodeJob, token: string): string {
  const q = `?token=${encodeURIComponent(token)}`
  const n = segmentCount(job)
  const longest = job.cuts ? Math.max(...job.cuts.slice(1).map((c, i) => c - job.cuts![i])) : SEGMENT_SECONDS
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${Math.ceil(longest) + 1}`, '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS']
  for (let i = 0; i < n; i++) {
    const d = job.cuts ? job.cuts[i + 1] - job.cuts[i] : Math.min(SEGMENT_SECONDS, (job.total ?? 0) - i * SEGMENT_SECONDS)
    lines.push(`#EXTINF:${Math.max(0.1, d).toFixed(3)},`, segName(i) + q)
  }
  lines.push('#EXT-X-ENDLIST', '')
  return lines.join('\n')
}

/** Segments ffmpeg already wrote from its current start (contiguous). */
function nextSegment(job: TranscodeJob): number {
  let n = job.segStart
  while (segmentReady(job, n)) n++
  return n
}

/**
 * Path of a segment, waiting for ffmpeg to write it. On demand, a segment far from
 * what is being converted (a seek) restarts ffmpeg there. Null when it never comes.
 */
export async function segmentFile(job: TranscodeJob, index: number, timeoutMs = 90_000): Promise<string | null> {
  const file = path.join(job.dir, segName(index))
  if (segmentReady(job, index)) return job.complete.get(index) ?? file
  if (!job.vod) return fs.existsSync(file) ? file : null
  if (job.indexing) await job.indexing
  if (!job.vod) return fs.existsSync(file) ? file : null
  if (index < 0 || index >= segmentCount(job)) return null
  const next = nextSegment(job)
  if (job.cuts) {
    // Copying is fast (~190x real time): wait when the run gets there within seconds,
    // start a run there for a jump further ahead (or back to a part not copied yet)
    const coming = index >= job.segStart && index <= next + remuxJumpAhead() && (!job.done || index < next)
    const justRestarted = Date.now() - job.restartedAt < 3000 && index >= job.segStart && index <= job.segStart + 4
    if (!coming && !justRestarted) {
      if (!(await settleJump(job, index))) return null
      logger.info(`Transcode ${job.id}: jump to segment ${index} (was copying ${job.segStart}…${next})`)
      launch(job, index)
    }
    return waitSegment(job, index, file, timeoutMs)
  }
  const coming = !job.done && index >= job.segStart && index <= next + 4
  // Several requests right after a restart: wait for that ffmpeg rather than restarting again
  const justRestarted = Date.now() - job.restartedAt < 3000 && index >= job.segStart && index <= job.segStart + 4
  if (!coming && !justRestarted) {
    if (!(await settleJump(job, index))) return null
    logger.info(`Transcode ${job.id}: seek to segment ${index} (was converting ${job.segStart}…${next})`)
    launch(job, index)
  }
  return waitSegment(job, index, file, timeoutMs)
}

/**
 * A far jump starts ffmpeg there only if no other far jump follows within 300 ms: dragging
 * the iPhone timeline asked for 22 positions in one second, each restarting the conversion.
 * False: a later jump replaced this one (the player no longer wants this segment).
 */
async function settleJump(job: TranscodeJob, index: number): Promise<boolean> {
  const at = Date.now() + Math.random()
  job.wanted = index
  job.wantedAt = at
  await new Promise((r) => setTimeout(r, JUMP_SETTLE_MS()))
  return job.wantedAt === at && jobs.has(job.id)
}
const JUMP_SETTLE_MS = () => Number(process.env.TRANSCODE_JUMP_SETTLE_MS ?? 300)

async function waitSegment(job: TranscodeJob, index: number, file: string, timeoutMs: number): Promise<string | null> {
  const started = Date.now()
  const until = started + timeoutMs
  while (Date.now() < until) {
    if (!jobs.has(job.id)) return null
    // The player jumped elsewhere since: stop holding this request for a part not being made
    if (job.wantedAt > started && job.wanted !== index && (index < job.segStart || index > nextSegment(job) + 4)) return null
    job.lastAccess = Date.now()
    if (segmentReady(job, index)) return job.complete.get(index) ?? file
    if (job.done && !segmentReady(job, index)) {
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
  if (job.vod) {
    // Remux on demand: ready once the keyframe index is known (built once per file)
    const ready = job.mode === 'transcode' || !!job.cuts
    return { ready, done: job.done, failed: job.failed, percent: ready ? null : indexProgress(job.filePath) }
  }
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
    // Remux on demand: the copy finishes by itself in about a minute, keep it for a pause
    if (job.cuts && (!job.done || now - job.lastAccess < IDLE_MS * 60)) continue
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
