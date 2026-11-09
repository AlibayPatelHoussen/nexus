import { beforeEach, describe, expect, it } from 'vitest'
import { describeStream, framesReported, needsConversion, rememberConverted, rememberFramesReported, variantsToDrop, wasConverted } from './picture'

describe('variantsToDrop (sound-only variants of a stream)', () => {
  const none = new Set<string>()

  it('keeps everything when nothing is known about the variants', () => {
    expect(variantsToDrop([{ uri: 'a' }, { uri: 'b' }], none)).toEqual([])
  })

  it('drops the variants announced without a picture when others announce one', () => {
    // The usual case: a 64 kb/s sound-only variant first, no CODECS, RESOLUTION on the others
    expect(variantsToDrop([{ uri: 'audio' }, { uri: 'sd', width: 640 }, { uri: 'hd', width: 1280 }], none)).toEqual([0])
    expect(variantsToDrop([{ uri: 'sd', videoCodec: 'avc1.42c01e' }, { uri: 'audio', width: 0 }], none)).toEqual([1])
    expect(variantsToDrop([{ uri: 'audio', bitrate: 64_000 }, { uri: 'sd', width: 640, bitrate: 800_000 }], none)).toEqual([0])
  })

  it('keeps a variant that says nothing but is as large as those with a picture', () => {
    expect(variantsToDrop([{ uri: 'sd', width: 640, bitrate: 800_000 }, { uri: 'x', bitrate: 900_000 }], none)).toEqual([])
  })

  it('drops the variants found to carry sound only, highest index first', () => {
    expect(variantsToDrop([{ uri: 'a' }, { uri: 'b' }, { uri: 'c' }], new Set(['a', 'c']))).toEqual([2, 0])
  })

  it('always leaves one variant (a radio with several bitrates keeps its best)', () => {
    expect(variantsToDrop([{ uri: 'a' }, { uri: 'b' }], new Set(['a', 'b']))).toEqual([0])
    expect(variantsToDrop([{ uri: 'a' }], new Set(['a']))).toEqual([])
  })
})

describe('needsConversion (what the server says a stream holds, against what this browser plays)', () => {
  const chrome = { native: false, hevc: false, ac3: false, eac3: false }
  const safari = { native: true, hevc: true, ac3: true, eac3: true }
  const held = (o: Partial<Parameters<typeof needsConversion>[0]>) => ({ video: 'h264', audio: 'aac', interlaced: false, plain: true, ...o })

  it('plays the usual streams as they are', () => {
    expect(needsConversion(held({}), chrome)).toBeNull()
    expect(needsConversion(held({ audio: 'mp3' }), safari)).toBeNull()
    expect(needsConversion(held({ video: 'hevc' }), safari)).toBeNull()
    expect(needsConversion(held({ video: 'hevc' }), { ...chrome, hevc: true })).toBeNull()
    // Nothing to decide from: a radio, a stream the server could not read
    expect(needsConversion(held({ video: null }), chrome)).toBeNull()
    expect(needsConversion({ video: null, audio: null, interlaced: false, plain: true }, safari)).toBeNull()
  })

  it('asks for the conversion of what the browser cannot decode', () => {
    expect(needsConversion(held({ video: 'mpeg2video', audio: 'mp2' }), chrome)).toMatchObject({ unsure: false })
    expect(needsConversion(held({ video: 'mpeg2video' }), safari)).toMatchObject({ unsure: false })
    expect(needsConversion(held({ video: 'hevc' }), chrome)).toMatchObject({ unsure: false })
    expect(needsConversion(held({ plain: false }), safari)?.why).toMatch(/10 bits/)
  })

  it('Dolby sound: read by Safari, converted where the browser has no decoder for it', () => {
    expect(needsConversion(held({ audio: 'eac3' }), safari)).toBeNull()
    expect(needsConversion(held({ audio: 'eac3' }), chrome)?.why).toMatch(/son eac3/)
    expect(needsConversion(held({ audio: 'ac3' }), { ...chrome, ac3: true })).toBeNull()
  })

  it('interlaced broadcast video: Safari gets its chance first, the others play it', () => {
    expect(needsConversion(held({ interlaced: true }), safari)).toMatchObject({ unsure: true })
    expect(needsConversion(held({ interlaced: true }), chrome)).toBeNull()
  })

  it('describes a stream for the playback details', () => {
    expect(describeStream({ ...held({ interlaced: true, audio: 'eac3' }), reason: null })).toBe('h264 entrelacé · son eac3')
    expect(describeStream({ ...held({ video: null }), reason: 'audio' })).toBe('pas d’image · son aac')
    expect(describeStream({ video: null, audio: null, interlaced: false, plain: true, reason: 'unreadable' })).toBe('non lu par le serveur')
  })
})

describe('streams this browser needed the conversion for', () => {
  beforeEach(() => localStorage.clear())

  it('remembers and forgets per stream', () => {
    expect(wasConverted('TF1.fr', 0)).toBe(false)
    rememberConverted('TF1.fr', 0, true)
    expect(wasConverted('TF1.fr', 0)).toBe(true)
    expect(wasConverted('TF1.fr', 1)).toBe(false)
    rememberConverted('TF1.fr', 0, false)
    expect(wasConverted('TF1.fr', 0)).toBe(false)
  })

  it('remembers that this browser tells which frames it shows', () => {
    expect(framesReported()).toBe(false)
    rememberFramesReported()
    expect(framesReported()).toBe(true)
  })

  it('forgets after a week, survives unreadable storage', () => {
    localStorage.setItem('nexus-iptv-converted', JSON.stringify({ 'Old.it#0': Date.now() - 8 * 24 * 3600_000, 'New.it#0': Date.now() }))
    expect(wasConverted('Old.it', 0)).toBe(false)
    expect(wasConverted('New.it', 0)).toBe(true)
    rememberConverted('X.fr', 2, true)
    expect(Object.keys(JSON.parse(localStorage.getItem('nexus-iptv-converted')!)).sort()).toEqual(['New.it#0', 'X.fr#2'])
    localStorage.setItem('nexus-iptv-converted', 'not json')
    expect(wasConverted('New.it', 0)).toBe(false)
    rememberConverted('New.it', 0, true)
    expect(wasConverted('New.it', 0)).toBe(true)
  })
})
