import { decide, ffmpegArgs, rewritePlaylist, type ProbeResult } from '../../src/services/transcode'

const probe = (format: string, video?: [string, string?], audio?: string): ProbeResult => ({
  format: { format_name: format, duration: '120.5' },
  streams: [
    ...(video ? [{ index: 0, codec_type: 'video', codec_name: video[0], pix_fmt: video[1] ?? 'yuv420p' }] : []),
    ...(audio ? [{ index: 1, codec_type: 'audio', codec_name: audio }] : []),
  ],
})
const MP4 = 'mov,mp4,m4a,3gp,3g2,mj2'

describe('decide', () => {
  it.each([
    ['mp4 h264 aac',             probe(MP4, ['h264'], 'aac'),                 'direct'],
    ['mp4 h264 mp3',             probe(MP4, ['h264'], 'mp3'),                 'direct'],
    ['mp4 h264 no audio',        probe(MP4, ['h264']),                        'direct'],
    ['mp4 h264 ac3',             probe(MP4, ['h264'], 'ac3'),                 'remux'],
    ['mkv h264 aac',             probe('matroska,webm', ['h264'], 'aac'),     'remux'],
    ['mkv h264 eac3',            probe('matroska,webm', ['h264'], 'eac3'),    'remux'],
    ['avi h264 mp3',             probe('avi', ['h264'], 'mp3'),               'remux'],
    ['mkv hevc aac',             probe('matroska,webm', ['hevc'], 'aac'),     'transcode'],
    ['mp4 hevc aac',             probe(MP4, ['hevc'], 'aac'),                 'transcode'],
    ['avi mpeg4 mp3',            probe('avi', ['mpeg4'], 'mp3'),              'transcode'],
    ['mp4 h264 10-bit',          probe(MP4, ['h264', 'yuv420p10le'], 'aac'),  'transcode'],
    ['webm vp9 opus (no caps)',  probe('matroska,webm', ['vp9'], 'opus'),     'transcode'],
  ] as const)('%s → %s', (_, p, mode) => {
    expect(decide(p).mode).toBe(mode)
  })

  it('plays WebM directly when the browser supports it', () => {
    expect(decide(probe('matroska,webm', ['vp9'], 'opus'), { webm: true }).mode).toBe('direct')
    expect(decide(probe('matroska,webm', ['hevc'], 'opus'), { webm: true }).mode).toBe('transcode')
  })

  it('reports duration and codecs', () => {
    expect(decide(probe('matroska,webm', ['hevc'], 'ac3'))).toMatchObject({ duration: 120.5, video: 'hevc', audio: 'ac3' })
  })
})

describe('ffmpegArgs', () => {
  it('remux copies the video and converts audio to AAC', () => {
    const a = ffmpegArgs('/in.mkv', 'remux', 0, '/tmp/x').join(' ')
    expect(a).toContain('-c:v copy')
    expect(a).toContain('-c:a aac')
    expect(a).not.toContain('libx264')
    expect(a).not.toContain('-ss')
  })
  it('transcode re-encodes with libx264 veryfast and seeks to the start', () => {
    const a = ffmpegArgs('/in.mkv', 'transcode', 42.5, '/tmp/x').join(' ')
    expect(a).toContain('-ss 42.500 -i /in.mkv')
    expect(a).toContain('-c:v libx264 -preset veryfast')
    expect(a).toContain('-f hls')
  })
})

describe('rewritePlaylist', () => {
  it('adds the token to segments and starts at the beginning', () => {
    const out = rewritePlaylist('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nseg00000.ts\n#EXTINF:6.0,\nseg00001.ts\n', 'a b')
    expect(out).toContain('#EXT-X-START:TIME-OFFSET=0')
    expect(out).toContain('seg00000.ts?token=a%20b')
    expect(out).toContain('seg00001.ts?token=a%20b')
  })
})
