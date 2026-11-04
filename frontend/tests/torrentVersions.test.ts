import { describe, expect, it } from 'vitest'
import type { TorrentVersion } from '@/services/downloadsService'
import { filterOptions, pick, recommended, sortVersions, versionLabel } from '@/pages/downloads/torrent'

const GB = 1024 ** 3
const v = (id: string, resolution: string | null, language: string, seeders: number, gb: number): TorrentVersion => ({
  id, release: id, resolution, source: 'WEB-DL', codec: 'x264', language,
  language_family: language === 'MULTI' ? 'MULTI' : language === 'VOSTFR' ? 'VOSTFR' : 'VF',
  size: `${gb} GB`, size_bytes: gb * GB, seeders, leechers: 0,
})

// Dune (2021) as OxTorrent lists it
const dune = [
  v('4k', '2160p', 'MULTI', 53, 20.8), v('bdrip', null, 'VF', 100, 1.37), v('1080', '1080p', 'MULTI', 112, 12.26),
  v('720', '720p', 'VF', 28, 5.41), v('vost', '1080p', 'VOSTFR', 14, 4.39), v('dead', '1080p', 'MULTI', 0, 12.26),
]

describe('OxTorrent versions', () => {
  it('sorts by quality then seeders, versions nobody shares last', () => {
    expect(sortVersions(dune).map((x) => x.id)).toEqual(['4k', '1080', 'vost', '720', 'bdrip', 'dead'])
  })

  it('recommends a well-shared 1080p of a reasonable size', () => {
    expect(recommended(dune)?.id).toBe('1080')
    // Too big for an episode: the lighter 1080p wins
    expect(recommended([v('big', '1080p', 'MULTI', 40, 9), v('ok', '1080p', 'VF', 30, 1.4)], true)?.id).toBe('ok')
    expect(recommended([v('x', '1080p', 'VF', 0, 1)])).toBeNull()
  })

  it('applies the preferred quality to an episode, else takes the best one', () => {
    const ep = [v('fr', null, 'VF', 67, 0.33), v('multi', '1080p', 'MULTI', 39, 1.48), v('vo', null, 'VOSTFR', 6, 0.33)]
    expect(pick(ep, { resolution: '1080p', language: 'MULTI' })?.id).toBe('multi')
    expect(pick(ep, { resolution: 'SD', language: 'VOSTFR' })?.id).toBe('vo')
    expect(pick(ep, { resolution: '2160p', language: 'MULTI' })?.id).toBe('multi')    // not there: best available
  })

  it('labels and filters', () => {
    expect(versionLabel(dune[0])).toBe('2160p MULTI')
    expect(versionLabel(dune[1])).toBe('SD VF')
    expect(filterOptions(dune)).toEqual({ res: ['2160p', '1080p', '720p', 'SD'], langs: ['MULTI', 'VF', 'VOSTFR'] })
  })
})
