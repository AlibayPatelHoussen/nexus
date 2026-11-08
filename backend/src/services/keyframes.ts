import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'

/*
 * Keyframe index of a video whose picture can be copied as it is (MKV H.264…):
 * the times where it can be cut. With it, the player gets the playlist of the WHOLE
 * film at once and each segment is copied when the player asks for it (start in
 * 2-3 s, full length in the iPhone full-screen player) instead of converting the whole
 * file first. Built once per file (it reads the whole file: ~30 s for 2.5 GB on the
 * owner's disk), in the background after a library scan, and kept in a few-KB file.
 */

const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'
const CACHE_DIR = process.env.KEYFRAME_CACHE_DIR || path.resolve(__dirname, '../../cache/keyframes')

async function cacheFile(file: string): Promise<string> {
  const st = await fs.promises.stat(file)
  const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex')
  return path.join(CACHE_DIR, key.slice(0, 2), `${key}.json`)
}

/** Keyframe times already known for this file (null: not indexed yet / file changed). */
export async function readIndex(file: string): Promise<number[] | null> {
  try {
    const data = JSON.parse(await fs.promises.readFile(await cacheFile(file), 'utf8')) as { keyframes?: unknown }
    return Array.isArray(data.keyframes) && data.keyframes.every((t) => typeof t === 'number') ? data.keyframes as number[] : null
  } catch { return null }
}

const building = new Map<string, { promise: Promise<number[]>; progress: number }>()

/** Progress (0-100) of an index being built, null when none is. */
export function indexProgress(file: string): number | null {
  const b = building.get(file)
  return b ? Math.round(b.progress) : null
}

/**
 * Reads the video packets (no decoding) and keeps the keyframe times. One build per
 * file at a time; `duration` only drives the progress. Runs with a low CPU priority.
 */
export function buildIndex(file: string, duration: number | null = null): Promise<number[]> {
  const running = building.get(file)
  if (running) return running.promise
  const entry = { progress: 0, promise: null as unknown as Promise<number[]> }
  entry.promise = new Promise<number[]>((resolve, reject) => {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file]
    const proc = spawn('nice', ['-n', '15', FFPROBE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const keyframes: number[] = []
    let rest = ''
    let err = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const [t, flags] = line.split(',')
        const time = Number(t)
        if (!Number.isFinite(time)) continue
        if (flags?.includes('K')) keyframes.push(time)
        if (duration) entry.progress = Math.min(99, (time / duration) * 100)
      }
    })
    proc.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-1000) })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0 || !keyframes.length) { reject(new Error(err.trim() || `ffprobe exited with code ${code}`)); return }
      const sorted = [...new Set(keyframes)].sort((a, b) => a - b)
      void (async () => {
        try {
          const out = await cacheFile(file)
          await fs.promises.mkdir(path.dirname(out), { recursive: true })
          await fs.promises.writeFile(out, JSON.stringify({ file, keyframes: sorted }))
        } catch (e) { logger.warn(`Keyframe index not saved for ${file}: ${(e as Error).message}`) }
        resolve(sorted)
      })()
    })
  })
  building.set(file, entry)
  entry.promise.finally(() => building.delete(file)).catch(() => {})
  return entry.promise
}

/**
 * Segment boundaries (start of each segment, then the end of the film): a cut at the
 * first keyframe at least `target` seconds after the previous cut, like ffmpeg's HLS.
 */
export function segmentCuts(keyframes: number[], duration: number, target: number): number[] {
  const cuts = [0]
  for (const k of keyframes) {
    if (k >= duration - 0.5) break
    if (k - cuts[cuts.length - 1] >= target) cuts.push(k)
  }
  cuts.push(duration)
  return cuts
}
