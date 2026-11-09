import { beforeEach, describe, expect, it } from 'vitest'
import { rememberConverted, variantsToDrop, wasConverted } from './picture'

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
