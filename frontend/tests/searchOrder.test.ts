import { describe, expect, it } from 'vitest'
import { rank } from '@/pages/downloads/SearchView'

describe('download search results order', () => {
  it('anime, manga, films.py films, movix films, movix series, YouTube', () => {
    const arrived = [
      { source: 'youtube', kind: 'youtube' }, { source: 'movix', kind: 'serie' }, { source: 'movix', kind: 'film' },
      { source: 'films', kind: 'film' }, { source: 'anisama', kind: 'manga' }, { source: 'anisama', kind: 'anime' },
    ] as const
    expect([...arrived].sort((a, b) => rank(a) - rank(b)).map((r) => `${r.source}:${r.kind}`)).toEqual([
      'anisama:anime', 'anisama:manga', 'films:film', 'movix:film', 'movix:serie', 'youtube:youtube',
    ])
  })
})
