import { describe, expect, it } from 'vitest'
import { rank, torrentCount } from '@/pages/downloads/SearchView'

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

  it('says how many versions / episodes an OxTorrent card holds', () => {
    const v = { id: 'oxtorrent:film:1', release: '', resolution: '1080p', source: null, codec: null, language: 'MULTI', language_family: 'MULTI', size: '1 GB', size_bytes: 1, seeders: 1, leechers: 0 } as const
    expect(torrentCount({ id: 'g', source: 'oxtorrent', kind: 'film', title: 'Dune', versions: [v, v, v] })).toBe('3 versions')
    expect(torrentCount({ id: 'g', source: 'oxtorrent', kind: 'serie', title: 'G', seasons: [
      { number: 1, episodes: [{ number: 1, title: null, versions: [v] }], packs: [{ label: 'Saison complète', episodes: null, versions: [v] }] },
      { number: 2, episodes: [{ number: 1, title: null, versions: [v] }, { number: 2, title: null, versions: [v] }], packs: [] },
    ] } as unknown as Parameters<typeof torrentCount>[0])).toBe('3 épisodes · 1 pack · 2 saisons')
  })
})
