import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'
import { AppError } from '../utils/errors'
import { FFMPEG, FFPROBE, TRANSCODE_ROOT, hasFfmpeg } from './transcode'

/*
 * The picture of an IPTV stream that plays with sound only.
 *
 * Some channels give sound but no picture in a browser: their video is MPEG-2 (old broadcast
 * encoders), HEVC on a browser without it, 10-bit H.264… The player notices (sound running, no
 * picture) and asks here:
 * - what the stream holds (ffprobe): no video at all is a radio, there is nothing to convert;
 * - otherwise ffmpeg converts it live to H.264 + AAC, a short sliding HLS window the player reads.
 * ffmpeg never fetches a catalogue address itself: it reads the stream through the Nexus relay
 * (same checks and headers as the player), on the loopback address.
 * One conversion per stream, shared by its viewers, stopped when nobody reads it any more.
 */

const execFileAsync = promisify(execFile)

/** Seconds per segment: short, the picture comes sooner */
const SEGMENT = 2
/** Segments kept in the playlist */
const WINDOW = 10
const IDLE_MS = parseInt(process.env.IPTV_CONVERT_IDLE_MS || '30000', 10)
/** A live re-encode takes most of a CPU core for as long as it is watched */
const MAX_JOBS = parseInt(process.env.IPTV_CONVERT_MAX_JOBS || '2', 10)
const READY_MS = 45_000
const PROBE_TTL = 10 * 60_000

/** Why a stream is left with its sound only */
export type PictureReason = 'audio' | 'ffmpeg' | 'busy' | 'unreadable' | 'failed'
export interface PictureAnswer {
  /** Codecs found in the stream (null: none, or not read) */
  video: string | null
  audio: string | null
  /** The converted stream is ready at …/converted/index.m3u8 */
  convert: boolean
  reason: PictureReason | null
}

const self = () => (process.env.NEXUS_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || '3001'}`).replace(/\/+$/, '')
const inputUrl = (id: string, s: number, token: string) =>
  `${self()}/api/iptv/play/${encodeURIComponent(id)}/${s}/index.m3u8?token=${encodeURIComponent(token)}`

// ─── What the stream holds ────────────────────────────────────────────────────
interface Content { video: string | null; audio: string | null; copy: boolean; flags: string[] }
const probes = new Map<string, { at: number; content: Content }>()

let picky: Promise<boolean> | null = null
/** Recent ffmpeg refuses HLS segments whose address has no known extension (the relay's have
 *  none) unless told not to be picky; older ones do not know the option. */
function knowsPicky(): Promise<boolean> {
  picky ??= execFileAsync(FFMPEG, ['-hide_banner', '-h', 'demuxer=hls'], { timeout: 5000 })
    .then(({ stdout }) => stdout.includes('extension_picky'), () => false)
  return picky
}

interface ProbeOut { streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; disposition?: { attached_pic?: number } }[] }

async function probe(id: string, s: number, token: string): Promise<Content> {
  const key = `${id}|${s}`
  const hit = probes.get(key)
  if (hit && Date.now() - hit.at < PROBE_TTL) return hit.content
  const run = async (flags: string[]) => {
    const { stdout } = await execFileAsync(FFPROBE, [
      '-v', 'error', ...flags, '-rw_timeout', '15000000',
      '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height:stream_disposition=attached_pic', '-of', 'json',
      inputUrl(id, s, token),
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
    return (JSON.parse(stdout) as ProbeOut).streams ?? []
  }
  // The option is for HLS only: a stream that is not a playlist refuses it
  let flags = (await knowsPicky()) ? ['-extension_picky', '0'] : []
  let streams: Awaited<ReturnType<typeof run>>
  try {
    streams = await run(flags)
  } catch (err) {
    if (!flags.length) throw err
    flags = []
    streams = await run(flags)
  }
  // The largest picture (a playlist lists every quality); a cover image is not a picture
  const videos = streams.filter((st) => st.codec_type === 'video' && !st.disposition?.attached_pic)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
  const v = videos[0]
  const a = streams.find((st) => st.codec_type === 'audio')
  if (!v && !a) throw new Error('nothing readable in the stream')
  const content: Content = {
    video: v?.codec_name ?? null, audio: a?.codec_name ?? null, flags,
    // H.264 in the usual 8-bit 4:2:0 is what browsers read: only repackaged (next to no CPU)
    copy: v?.codec_name === 'h264' && (!v.pix_fmt || v.pix_fmt === 'yuv420p' || v.pix_fmt === 'yuvj420p'),
  }
  if (probes.size > 300) probes.delete(probes.keys().next().value as string)
  probes.set(key, { at: Date.now(), content })
  return content
}

// ─── Live conversion ──────────────────────────────────────────────────────────
interface LiveJob {
  key: string
  dir: string
  proc: ChildProcess | null
  /** ffmpeg ended by itself (the source stopped) */
  done: boolean
  failed: string | null
  stopped: boolean
  lastAccess: number
}
const jobs = new Map<string, LiveJob>()
const index = (job: { dir: string }) => path.join(job.dir, 'index.m3u8')

export function convertArgs(input: string, dir: string, copy: boolean, flags: string[] = []): string[] {
  const video = copy ? ['-c:v', 'copy'] : [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    // Broadcast video is often interlaced; never upscale, 720p at most (live: it must keep up)
    '-vf', "yadif=0:-1:1,scale='min(1280,iw)':-2",
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT})`, '-sc_threshold', '0',
  ]
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...flags, '-rw_timeout', '20000000', '-fflags', '+genpts+discardcorrupt',
    '-i', input,
    '-sn', '-dn', ...video,
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000', '-af', 'aresample=async=1',
    '-f', 'hls', '-hls_time', String(SEGMENT), '-hls_list_size', String(WINDOW), '-hls_delete_threshold', '6',
    '-hls_flags', 'delete_segments+independent_segments+temp_file+omit_endlist',
    '-hls_segment_filename', path.join(dir, 'seg%06d.ts'), index({ dir }),
  ]
}

function stop(job: LiveJob, reason: string) {
  if (jobs.get(job.key) === job) jobs.delete(job.key)
  job.stopped = true
  if (job.proc && job.proc.exitCode === null) {
    job.proc.kill('SIGKILL')
    logger.info(`IPTV conversion ${job.key} stopped (${reason})`)
  }
  fs.promises.rm(job.dir, { recursive: true, force: true }).catch(() => {})
}

/** Nothing is awaited before the job is registered: two viewers asking together share it. */
function start(key: string, input: string, content: Content): LiveJob {
  const dir = path.join(TRANSCODE_ROOT, `iptv-${crypto.randomBytes(8).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  const job: LiveJob = { key, dir, proc: null, done: false, failed: null, stopped: false, lastAccess: Date.now() }
  jobs.set(key, job)
  const proc = spawn(FFMPEG, convertArgs(input, dir, content.copy, content.flags), { stdio: ['ignore', 'ignore', 'pipe'] })
  job.proc = proc
  let stderr = ''
  proc.stderr?.on('data', (d) => { stderr = (stderr + String(d)).slice(-1500) })
  proc.on('error', (err) => { job.done = true; job.failed = err.message })
  proc.on('exit', (code) => {
    if (job.stopped) return
    job.done = true
    if (code !== 0) {
      job.failed = stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`
      logger.warn(`IPTV conversion ${key} failed: ${job.failed}`)
    }
  })
  logger.info(`IPTV conversion ${key}: ${content.video} → ${content.copy ? 'repackaged' : 'H.264'}`)
  return job
}

/** The playlist once it lists enough to start (two segments; one when the source already ended). */
async function ready(job: LiveJob, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until && !job.stopped) {
    job.lastAccess = Date.now()
    const text = await fs.promises.readFile(index(job), 'utf8').catch(() => '')
    const segments = (text.match(/#EXTINF/g) ?? []).length
    if (segments >= 2 || (job.done && !job.failed && segments >= 1)) return true
    if (job.failed || job.done) return false
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/**
 * What stream `s` of channel `id` holds, and its conversion started when ffmpeg can give it a
 * picture the browser reads. Answers once the converted stream is ready to play.
 * `token`: a stream token, for ffmpeg to read the stream through the relay.
 * `launch` false: only what the stream holds (a player that reads this format loads it again
 * rather than have it converted).
 */
export async function convertStream(id: string, s: number, token: string, launch = true): Promise<PictureAnswer> {
  if (!(await hasFfmpeg())) return { video: null, audio: null, convert: false, reason: 'ffmpeg' }
  let content: Content
  try {
    content = await probe(id, s, token)
  } catch (err) {
    logger.debug(`IPTV conversion ${id}|${s}: stream not read (${(err as Error).message.split('\n')[0]})`)
    return { video: null, audio: null, convert: false, reason: 'unreadable' }
  }
  const found = { video: content.video, audio: content.audio }
  if (!content.video) return { ...found, convert: false, reason: 'audio' }
  if (!launch) return { ...found, convert: false, reason: null }
  const key = `${id}|${s}`
  let job = jobs.get(key)
  if (job && (job.done || job.failed)) { stop(job, 'restarted'); job = undefined }
  if (!job) {
    if ([...jobs.values()].filter((j) => !j.done).length >= MAX_JOBS) return { ...found, convert: false, reason: 'busy' }
    job = start(key, inputUrl(id, s, token), content)
  }
  if (await ready(job, READY_MS)) return { ...found, convert: true, reason: null }
  stop(job, 'never started')
  probes.delete(key)
  return { ...found, convert: false, reason: 'failed' }
}

function jobOf(id: string, s: number): LiveJob {
  const job = jobs.get(`${id}|${s}`)
  // Stopped meanwhile (nobody was reading): the player asks for the conversion again
  if (!job) throw new AppError('Conversion arrêtée', 410)
  job.lastAccess = Date.now()
  return job
}

/** The converted playlist, its segments addressed with the viewer's stream token. */
export async function convertedPlaylist(id: string, s: number, token: string): Promise<string> {
  const job = jobOf(id, s)
  if (job.failed) throw new AppError('La conversion s’est arrêtée', 502)
  let text = await fs.promises.readFile(index(job), 'utf8').catch(() => '')
  if (!text) throw new AppError('Conversion pas encore prête', 503)
  // The source ended: the player must not wait for more
  if (job.done && !text.includes('#EXT-X-ENDLIST')) text = `${text.trimEnd()}\n#EXT-X-ENDLIST\n`
  return text.replace(/^(seg\d+\.ts)$/gm, `$1?token=${encodeURIComponent(token)}`)
}

/** A converted segment (null: unknown, or already dropped from the window). */
export function convertedSegment(id: string, s: number, name: string): string | null {
  if (!/^seg\d{6,}\.ts$/.test(name)) return null
  const file = path.join(jobOf(id, s).dir, name)
  return fs.existsSync(file) ? file : null
}

export const convertJobs = () => [...jobs.keys()]
/** Stops every conversion (tests, shutdown). */
export function stopConversions() {
  for (const job of [...jobs.values()]) stop(job, 'shutdown')
}

const reaper = setInterval(() => {
  const now = Date.now()
  for (const job of [...jobs.values()]) if (now - job.lastAccess > IDLE_MS) stop(job, 'nobody watching')
}, Math.min(5000, Math.max(500, IDLE_MS / 3)))
reaper.unref()
process.once('exit', () => { for (const job of jobs.values()) job.proc?.kill('SIGKILL') })
