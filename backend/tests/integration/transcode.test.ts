import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import request from 'supertest'
import { app } from '../../src/index'
import { listJobs } from '../../src/services/transcode'
import { makeToken } from '../helpers'

// Real ffmpeg is required: skip (with a notice) on machines without it
let hasFfmpeg = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { hasFfmpeg = false }
const d = hasFfmpeg ? describe : describe.skip
if (!hasFfmpeg) console.warn('ffmpeg not installed: transcode integration tests skipped')

const DIR = path.join(process.env.MEDIA_ROOT!, 'transcode')
const files = {
  direct:    path.join(DIR, 'direct.mp4'),     // h264 + aac in mp4
  remux:     path.join(DIR, 'remux.mkv'),      // h264 + ac3 in mkv
  remuxAac:  path.join(DIR, 'remux-aac.mkv'),  // h264 + aac stereo in mkv (audio copied)
  transcode: path.join(DIR, 'hevc.mkv'),       // hevc + aac
  irregular: path.join(DIR, 'irregular.mkv'),  // h264 + aac, 60 s, keyframes at irregular times
  long:      path.join(DIR, 'long.avi'),       // mpeg4 + mp3, 10 min (conversion keeps running)
}
const auth = { Authorization: `Bearer ${makeToken('user')}` }
const stream = () => makeToken('user', 'stream')

function ffmpeg(args: string[]) { execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]) }

beforeAll(() => {
  if (!hasFfmpeg) return
  fs.mkdirSync(DIR, { recursive: true })
  const src = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '20']
  if (!fs.existsSync(files.direct))    ffmpeg([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', files.direct])
  if (!fs.existsSync(files.remux))     ffmpeg([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'ac3', files.remux])
  if (!fs.existsSync(files.remuxAac))  ffmpeg([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-ac', '2', files.remuxAac])
  if (!fs.existsSync(files.transcode)) ffmpeg([...src, '-c:v', 'libx265', '-x265-params', 'log-level=error', '-c:a', 'aac', files.transcode])
  if (!fs.existsSync(files.irregular)) {
    // Keyframes like a real film: irregular gaps (2-9 s), never on the 6 s grid
    const kf = [0, 2.5, 9.1, 11, 17.4, 21, 29.9, 31.2, 38.8, 44, 46.3, 55.7].join(',')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '60',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1000', '-sc_threshold', '0', '-force_key_frames', kf,
      '-c:a', 'aac', '-ac', '2', files.irregular])
  }
  if (!fs.existsSync(files.long)) {
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '600', '-c:v', 'mpeg4', '-q:v', '10', '-c:a', 'libmp3lame', files.long])
  }
}, 120_000)

const q = (p: string) => `path=${encodeURIComponent(p)}`

d('play-info', () => {
  it.each([['direct', 'direct'], ['remux', 'remux'], ['transcode', 'transcode']] as const)('%s file → %s', async (k, mode) => {
    const res = await request(app).get(`/api/files/play-info?${q(files[k])}`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.data.mode).toBe(mode)
    expect(res.body.data.duration).toBeGreaterThan(19)
  })

  it('refuses files outside the media library for regular users', async () => {
    const res = await request(app).get('/api/files/play-info?path=%2Fetc%2Fpasswd').set(auth)
    expect(res.status).toBe(403)
  })
})

async function startAndFetch(file: string, start = 0) {
  const res = await request(app).post(`/api/files/transcode?${q(file)}&start=${start}`).set(auth)
  expect(res.status).toBe(201)
  const token = stream()
  const pl = await request(app).get(`${res.body.data.playlist}?token=${token}`)
  expect(pl.status).toBe(200)
  expect(pl.headers['content-type']).toContain('mpegurl')
  const seg = pl.text.split('\n').find((l) => l.startsWith('seg'))!
  expect(seg).toMatch(/^seg00000\.ts\?token=/)
  const base = res.body.data.playlist.replace('index.m3u8', '')
  const ts = await request(app).get(base + seg).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []
    r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
  })
  expect(ts.status).toBe(200)
  return { job: res.body.data, segment: ts.body as Buffer }
}

function probeSegment(buf: Buffer) {
  const f = path.join(DIR, `probe-${Date.now()}.ts`)
  fs.writeFileSync(f, buf)
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', f]).toString())
  fs.unlinkSync(f)
  return Object.fromEntries(out.streams.map((s: { codec_type: string; codec_name: string }) => [s.codec_type, s.codec_name]))
}

d('HLS conversion', () => {
  it('remux: copies h264 and converts AC3 audio to AAC', async () => {
    const { job, segment } = await startAndFetch(files.remux)
    expect(job.mode).toBe('remux')
    expect(probeSegment(segment)).toEqual({ video: 'h264', audio: 'aac' })
  }, 60_000)

  it('remux: AAC stereo audio is copied, not re-encoded (what made films slow to prepare)', async () => {
    const { job, segment } = await startAndFetch(files.remuxAac)
    expect(job.mode).toBe('remux')
    expect(listJobs().find((j) => j.id === job.id)?.audioCopy).toBe(true)
    expect(probeSegment(segment)).toEqual({ video: 'h264', audio: 'aac' })
  }, 60_000)

  it('transcode: HEVC is re-encoded to h264 + aac', async () => {
    const { job, segment } = await startAndFetch(files.transcode)
    expect(job.mode).toBe('transcode')
    expect(probeSegment(segment)).toEqual({ video: 'h264', audio: 'aac' })
  }, 60_000)

  it('re-encoding: the player gets the WHOLE film at once (iPhone full screen shows its real length)', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.transcode)}&start=12`).set(auth)
    expect(res.body.data).toMatchObject({ vod: true, start: 0, at: 12 })
    const pl = await request(app).get(`${res.body.data.playlist}?token=${stream()}`)
    expect(pl.text).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(pl.text).toContain('#EXT-X-ENDLIST')
    const total = [...pl.text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0)
    expect(total).toBeGreaterThan(19)
    expect(total).toBeLessThan(21)
  }, 60_000)

  it('re-encoding: a segment is converted where it is asked (seek), with its real timestamps', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.long)}`).set(auth)
    const base = res.body.data.playlist.replace('index.m3u8', '')
    // 10 min file: segment 60 (6 min) is far from the start → ffmpeg restarts there
    const ts = await request(app).get(`${base}seg00060.ts?token=${stream()}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(ts.status).toBe(200)
    const f = path.join(DIR, `seek-${Date.now()}.ts`)
    fs.writeFileSync(f, ts.body as Buffer)
    const start = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', f]).toString())
    fs.unlinkSync(f)
    expect(start).toBeGreaterThan(359)
    expect(start).toBeLessThan(363)
    const job = listJobs().find((j) => j.id === res.body.data.id)!
    expect(job.segStart).toBe(60)
    await request(app).delete(`/api/files/transcode/${job.id}`).set(auth)
  }, 90_000)

  it('remux: the player waits for the keyframe index, then gets the whole film', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.remux)}&start=8`).set(auth)
    expect(res.body.data).toMatchObject({ vod: true, start: 0, at: 8 })
    let status = { ready: false, percent: 0 as number | null }
    for (let i = 0; i < 50 && !status.ready; i++) {
      await new Promise((r) => setTimeout(r, 200))
      status = (await request(app).get(`/api/files/transcode/${res.body.data.id}/status?token=${stream()}`)).body.data
    }
    expect(status).toMatchObject({ ready: true })
    const pl = await request(app).get(`${res.body.data.playlist}?token=${stream()}`)
    expect(pl.text).toContain('#EXT-X-ENDLIST')
    const total = [...pl.text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0)
    expect(total).toBeGreaterThan(19)
  }, 60_000)

  it('DELETE kills ffmpeg immediately', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.transcode)}`).set(auth)
    const job = listJobs().find((j) => j.id === res.body.data.id)!
    expect(job).toBeDefined()
    const proc = job.proc!
    await request(app).delete(`/api/files/transcode/${job.id}`).set(auth).expect(200)
    await new Promise((r) => setTimeout(r, 300))
    expect(proc.killed || proc.exitCode !== null).toBe(true)
    expect(listJobs().some((j) => j.id === job.id)).toBe(false)
  }, 30_000)

  it('another user cannot read someone else\'s conversion', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.remux)}`).set(auth)
    const other = await request(app).get(`${res.body.data.playlist}?token=${makeToken('admin', 'stream', 'another-user')}`)
    expect(other.status).toBe(404)
  }, 30_000)

  it('the player stopping requests kills ffmpeg (idle timeout)', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.long)}`).set(auth)
    const job = listJobs().find((j) => j.id === res.body.data.id)!
    const proc = job.proc!
    expect(proc.exitCode).toBeNull() // still converting the 10 min file
    // TRANSCODE_IDLE_MS is 1500 in tests (setupEnv)
    await new Promise((r) => setTimeout(r, 4000))
    expect(proc.killed || proc.exitCode !== null).toBe(true)
    // A film converted on demand keeps its place (paused): it restarts where the player asks
    const kept = listJobs().find((j) => j.id === job.id)
    expect(kept?.vod).toBe(true)
    expect(kept?.done).toBe(true)
  }, 30_000)
})

d('Remux on demand (keyframe index)', () => {
  const get = (url: string) => request(app).get(url).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []
    r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
  })
  const ffprobeJson = (f: string, entries: string, extra: string[] = []) =>
    JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...extra, '-show_entries', entries, '-of', 'json', f]).toString())

  it('the whole film is in the playlist at once, cut at the keyframes; far segments are copied when asked', async () => {
    fs.rmSync(path.resolve(__dirname, '../../cache/keyframes'), { recursive: true, force: true })
    const res = await request(app).post(`/api/files/transcode?${q(files.irregular)}&start=40`).set(auth)
    expect(res.body.data).toMatchObject({ mode: 'remux', vod: true, start: 0, at: 40 })
    const id = res.body.data.id
    let status = { ready: false }
    for (let i = 0; i < 100 && !status.ready; i++) {
      status = (await request(app).get(`/api/files/transcode/${id}/status?token=${stream()}`)).body.data
      if (!status.ready) await new Promise((r) => setTimeout(r, 100))
    }
    expect(status.ready).toBe(true)

    const pl = await request(app).get(`${res.body.data.playlist}?token=${stream()}`)
    expect(pl.text).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(pl.text).toContain('#EXT-X-ENDLIST')
    const durations = [...pl.text.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]))
    // Cuts at the first keyframe 6 s or more after the previous cut: 0, 9.1, 17.4, 29.9, 38.8, 46.3, 55.7
    expect(durations.map((x) => Number(x.toFixed(1)))).toEqual([9.1, 8.3, 12.5, 8.9, 7.5, 9.4, 4.3])

    // Segments asked out of order (a seek to the end, then the start) are each the right part
    const base = res.body.data.playlist.replace('index.m3u8', '')
    const bodies: Buffer[] = []
    for (const i of [5, 6, 0, 1, 2, 3, 4]) {
      const seg = await get(`${base}seg0000${i}.ts?token=${stream()}`)
      expect(seg.status).toBe(200)
      bodies[i] = seg.body as Buffer
    }
    // Exact cuts (the keyframes fall on 24 fps frames: 38.8 s is the frame at 38.833 s)
    const cuts = durations.reduce((c, d) => [...c, c[c.length - 1] + d], [0])
    let totalFrames = 0
    for (let i = 0; i < 7; i++) {
      const f = path.join(DIR, `remux-seg-${i}.ts`)
      fs.writeFileSync(f, bodies[i])
      const frames = ffprobeJson(f, 'stream=nb_read_packets', ['-select_streams', 'v:0', '-count_packets']).streams[0].nb_read_packets
      // 24 fps: the frames between the two cuts (± the B-frames stored just after a keyframe)
      expect(Math.abs(Number(frames) - Math.round((cuts[i + 1] - cuts[i]) * 24))).toBeLessThanOrEqual(2)
      totalFrames += Number(frames)
      // Each segment starts on its cut, on the same timeline as the source (restarts included)
      const first = Number(ffprobeJson(f, 'packet=pts_time', ['-select_streams', 'v:0', '-read_intervals', '%+#1']).packets[0].pts_time)
      const first0 = Number(ffprobeJson(path.join(DIR, 'remux-seg-0.ts'), 'packet=pts_time', ['-select_streams', 'v:0', '-read_intervals', '%+#1']).packets[0].pts_time)
      const source0 = Number(ffprobeJson(files.irregular, 'packet=pts_time', ['-select_streams', 'v:0', '-read_intervals', '%+#1']).packets[0].pts_time)
      if (i > 0) expect(first - first0).toBeCloseTo(cuts[i] - source0, 2)
    }
    // Not a frame lost or repeated over the whole film
    expect(totalFrames).toBe(60 * 24)
    for (let i = 0; i < 7; i++) fs.rmSync(path.join(DIR, `remux-seg-${i}.ts`), { force: true })
    await request(app).delete(`/api/files/transcode/${id}`).set(auth)
  }, 90_000)

  it('the index is kept: the next playback is ready at once', async () => {
    const res = await request(app).post(`/api/files/transcode?${q(files.irregular)}`).set(auth)
    const status = (await request(app).get(`/api/files/transcode/${res.body.data.id}/status?token=${stream()}`)).body.data
    expect(status.ready).toBe(true)
    await request(app).delete(`/api/files/transcode/${res.body.data.id}`).set(auth)
  }, 30_000)
})

afterAll(() => { for (const j of listJobs()) j.proc?.kill('SIGKILL') })
