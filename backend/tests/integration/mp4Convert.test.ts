import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { query } from '../../src/config/database'
import { convertToMp4 } from '../../src/services/mp4Convert'

let hasFfmpeg = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { hasFfmpeg = false }
const d = hasFfmpeg ? describe : describe.skip

const DIR = path.join(process.env.MEDIA_ROOT!, 'mp4convert')
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args])
const probe = (f: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration:stream=codec_type,codec_name', '-of', 'json', f]).toString())
const old = (f: string) => { const t = new Date(Date.now() - 5 * 60_000); fs.utimesSync(f, t, t) }

d('MKV → MP4 (read directly, like the MP4 films)', () => {
  beforeAll(() => { fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true }) })

  it('copies the picture, makes the first audio AAC, keeps the other tracks and text subtitles; the library follows', async () => {
    const mkv = path.join(DIR, 'Film Multi (2020).mkv')
    const srt = path.join(DIR, 'subs.srt')
    fs.writeFileSync(srt, '1\n00:00:01,000 --> 00:00:03,000\nBonjour\n')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-f', 'lavfi', '-i', 'sine=frequency=660',
      '-i', srt, '-t', '10', '-map', '0', '-map', '1', '-map', '2', '-map', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a:0', 'ac3', '-c:a:1', 'aac', '-c:s', 'srt', mkv])
    old(mkv)
    const { rows } = await query<{ id: string }>(
      `INSERT INTO media_items (type, title, file_path) VALUES ('film', 'Film Multi', $1) RETURNING id`, [mkv])
    const hint = path.join(DIR, '.Film Multi (2020).mkv.nexus.json')
    fs.writeFileSync(hint, '{"tmdb_id": 1}')

    const mp4 = await convertToMp4(mkv)
    expect(mp4).toBe(path.join(DIR, 'Film Multi (2020).mp4'))
    expect(fs.existsSync(mkv)).toBe(false)
    expect(fs.existsSync(path.join(DIR, '.Film Multi (2020).mp4.nexus.json'))).toBe(true)
    const out = probe(mp4!)
    expect(out.streams.map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}:${s.codec_name}`))
      .toEqual(['video:h264', 'audio:aac', 'audio:aac', 'subtitle:mov_text'])
    expect(Number(out.format.duration)).toBeCloseTo(10, 0)
    const row = await query<{ file_path: string }>('SELECT file_path FROM media_items WHERE id = $1', [rows[0].id])
    expect(row.rows[0].file_path).toBe(mp4)
    await query('DELETE FROM media_items WHERE id = $1', [rows[0].id])
  }, 60_000)

  it('leaves alone what it should not convert: HEVC, a file still being written', async () => {
    const hevc = path.join(DIR, 'Hevc (2020).mkv')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-t', '3', '-c:v', 'libx265', '-x265-params', 'log-level=error', hevc])
    old(hevc)
    expect(await convertToMp4(hevc)).toBeNull()
    expect(fs.existsSync(hevc)).toBe(true)

    const fresh = path.join(DIR, 'Fresh (2020).mkv')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fresh])
    expect(await convertToMp4(fresh)).toBeNull()             // written just now: next time
    expect(fs.existsSync(fresh)).toBe(true)
  }, 60_000)
})
