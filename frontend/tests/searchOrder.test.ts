import { describe, expect, it } from 'vitest'
import { rank, torrentLine } from '@/pages/downloads/SearchView'

describe('download search results order', () => {
  it('anime, manga, OxTorrent films and series, films.py films, movix films, movix series, YouTube', () => {
    const arrived = [
      { source: 'youtube', kind: 'youtube' }, { source: 'movix', kind: 'serie' }, { source: 'movix', kind: 'film' },
      { source: 'films', kind: 'film' }, { source: 'anisama', kind: 'manga' }, { source: 'anisama', kind: 'anime' },
      { source: 'oxtorrent', kind: 'serie' }, { source: 'oxtorrent', kind: 'film' },
    ] as const
    expect([...arrived].sort((a, b) => rank(a) - rank(b)).map((r) => `${r.source}:${r.kind}`)).toEqual([
      'anisama:anime', 'anisama:manga', 'oxtorrent:film', 'oxtorrent:serie', 'films:film', 'movix:film', 'movix:serie', 'youtube:youtube',
    ])
  })

  it('describes a torrent by its language, quality, size and seeds', () => {
    expect(torrentLine({ langs: ['MULTI'], quality: '2160p', size: '4.36 GB', seeds: 82, season: null })).toBe('MULTI · 2160p · 4.36 GB · 82 seeds')
    expect(torrentLine({ langs: ['VF'], quality: null, size: '12 GB', seeds: 1, season: 3 })).toBe('Saison 3 · VF · 12 GB · 1 seed')
  })
})
