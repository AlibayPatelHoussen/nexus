import { execFile, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import { listJobs, probe, type ProbeResult } from './transcode'
import { hintFor } from './scanner'

/*
 * MKV (or AVI…) films and episodes whose picture is H.264 are turned into MP4 files the
 * iPhone / browsers read directly, like the MP4 films that already work well: instant
 * start, instant jumps, native full screen. The picture is copied (no quality change, about
 * 30 s for a 2.5 GB film); the first audio track is made AAC if it is not (the browser plays
 * the first one); other audio tracks and text subtitles are kept. Done after each download
 * / library scan and for the films already there, in the background, one at a time.
 * The MP4 replaces the original only once checked (owner's choice: no extra disk space).
 */

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const execFileAsync = promisify(execFile)

const CONVERTIBLE_EXT = ['.mkv', '.avi', '.m2ts', '.ts', '.flv']
/** Audio that can stay as it is in an MP4 (the first track must also be playable by browsers) */
const MP4_AUDIO = ['aac', 'mp3', 'ac3', 'eac3']
const BROWSER_AUDIO = ['aac', 'mp3']
const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']

/** True when the file is worth converting: H.264 8-bit 4:2:0 in another container. */
export function shouldConvert(file: string, p: ProbeResult): boolean {
  if (!CONVERTIBLE_EXT.includes(path.extname(file).toLowerCase())) return false
  const v = p.streams.find((s) => s.codec_type === 'video')
  return !!v && v.codec_name === 'h264' && (!v.pix_fmt || ['yuv420p', 'yuvj420p'].includes(v.pix_fmt))
}

/** ffmpeg arguments: picture copied, audio kept when an MP4 can hold it, text subtitles kept. */
export function mp4Args(input: string, output: string, p: ProbeResult): string[] {
  const audio = p.streams.filter((s) => s.codec_type === 'audio')
  const subs = p.streams.filter((s) => s.codec_type === 'subtitle' && TEXT_SUBS.includes(s.codec_name ?? ''))
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-map', '0:v:0']
  audio.forEach((a) => args.push('-map', `0:${a.index}`))
  subs.forEach((s) => args.push('-map', `0:${s.index}`))
  args.push('-c:v', 'copy')
  audio.forEach((a, i) => {
    const keep = i === 0 ? BROWSER_AUDIO.includes(a.codec_name ?? '') : MP4_AUDIO.includes(a.codec_name ?? '')
    if (keep) args.push(`-c:a:${i}`, 'copy')
    else args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '192k', `-ac:a:${i}`, '2')
  })
  if (subs.length) args.push('-c:s', 'mov_text')
  // The first audio track is the default one; MP4 index at the start (playback starts at once)
  args.push('-disposition:a:0', 'default', '-movflags', '+faststart', '-f', 'mp4', output)
  return args
}

async function run(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('nice', ['-n', '15', FFMPEG, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-1500) })
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with code ${code}`))))
  })
}

async function freeBytes(dir: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', dir])
    return Number(stdout.trim().split('\n').pop()!.split(/\s+/)[3]) * 1024
  } catch { return Number.POSITIVE_INFINITY }
}

/**
 * Converts one file; returns the MP4's path, or null when it was not converted (kept as
 * it is). The original is removed only after the MP4 is checked (same length, picture,
 * as many audio tracks).
 */
export async function convertToMp4(file: string): Promise<string | null> {
  const p = await probe(file)
  if (!shouldConvert(file, p)) return null
  if (listJobs().some((j) => j.filePath === file)) return null          // being watched: next time
  const st = await fs.promises.stat(file)
  if (Date.now() - st.mtimeMs < 60_000) return null                       // still being written
  // Replacing the file needs the folder to be writable (a film copied as root: left as it is,
  // never a MP4 next to a MKV that could not be removed — the film would show twice)
  try { await fs.promises.access(path.dirname(file), fs.constants.W_OK) } catch {
    logger.warn(`MP4 conversion skipped (folder not writable by Nexus): ${file}`)
    return null
  }
  if (await freeBytes(path.dirname(file)) < st.size * 1.1) {
    logger.warn(`MP4 conversion skipped (not enough free space): ${file}`)
    return null
  }
  const target = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.mp4`)
  if (fs.existsSync(target)) return null
  const temp = path.join(path.dirname(file), `.${path.basename(target)}.part`)
  try {
    await run(mp4Args(file, temp, p))
    const out = await probe(temp)
    const dur = (r: ProbeResult) => Number(r.format.duration) || 0
    const count = (r: ProbeResult, t: string) => r.streams.filter((s) => s.codec_type === t).length
    if (Math.abs(dur(out) - dur(p)) > 2 || count(out, 'video') < 1 || count(out, 'audio') !== count(p, 'audio')) {
      throw new Error(`check failed (duration ${dur(out)} / ${dur(p)}, audio ${count(out, 'audio')} / ${count(p, 'audio')})`)
    }
    if (listJobs().some((j) => j.filePath === file)) throw new Error('started playing meanwhile')
    await fs.promises.rename(temp, target)
    // The library follows the file: same title, same progress, same « Reprendre »
    await query('UPDATE media_items SET file_path = $1 WHERE file_path = $2', [target, file])
    await query('UPDATE episodes SET file_path = $1 WHERE file_path = $2', [target, file])
    const hint = hintFor.film(file)
    if (fs.existsSync(hint)) await fs.promises.rename(hint, hintFor.film(target)).catch(() => {})
    await fs.promises.unlink(file)
    logger.info(`Converted to MP4: ${target}`)
    return target
  } catch (err) {
    await fs.promises.rm(temp, { force: true })
    logger.warn(`MP4 conversion failed for ${file}: ${(err as Error).message}`)
    return null
  }
}
