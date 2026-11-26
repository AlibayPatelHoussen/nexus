import { describe, expect, it } from 'vitest'
import type { Episode } from '@/types'
import type { EpisodeProgress } from '@/services/mediaService'
import { episodesUpTo, watchState } from './watchState'

const ep = (season: number, n: number): Episode => ({
  id: `${season}-${n}`, mediaItemId: 'm', season, episodeNumber: n, title: null, filePath: `/s/S${season}E${n}.mkv`,
} as unknown as Episode)
// API order: season 0 (specials) first
const episodes = [ep(0, 1), ...[1, 2].flatMap((s) => [1, 2, 3].map((n) => ep(s, n)))]
const row = (episodeId: string, progress: number, completed: boolean): EpisodeProgress => ({ episodeId, progress, duration: 1500, completed, updatedAt: '' })

describe('watchState', () => {
  it('nothing watched: the first episode of season 1 (not the specials)', () => {
    const s = watchState(episodes, [])
    expect(s.next).toEqual({ episode: ep(1, 1), resume: false })
    expect(s).toMatchObject({ started: false, finished: false, watchedCount: 0, total: 6 })
  })

  it('an episode in progress: resumed', () => {
    const s = watchState(episodes, [row('1-3', 600, false), row('1-2', 1500, true), row('1-1', 1500, true)])
    expect(s.next).toEqual({ episode: ep(1, 3), resume: true })
    expect(s.watchedCount).toBe(2)
  })

  it('the last one watched is finished: the next one, into the next season', () => {
    const s = watchState(episodes, [row('1-3', 1500, true), row('1-2', 1500, true), row('1-1', 1500, true)])
    expect(s.next).toEqual({ episode: ep(2, 1), resume: false })
  })

  it('marked out of order: after the furthest watched, then a gap left behind', () => {
    // season 2 marked as watched, then 1×1 watched again
    const rows = [row('1-1', 1500, true), row('2-1', 0, true), row('2-2', 0, true), row('2-3', 0, true)]
    expect(watchState(episodes, rows).next?.episode).toEqual(ep(1, 2))
  })

  it('everything watched: finished, nothing to go on with (specials aside)', () => {
    const s = watchState(episodes, [1, 2].flatMap((x) => [1, 2, 3].map((n) => row(`${x}-${n}`, 1500, true))))
    expect(s.next).toBeNull()
    expect(s.finished).toBe(true)
    expect(s.watchedCount).toBe(6)
  })

  it('episodes gone (deleted) are left aside', () => {
    const s = watchState(episodes, [row('gone', 300, false), row('1-1', 1500, true)])
    expect(s.next?.episode).toEqual(ep(1, 2))
  })
})

describe('episodesUpTo', () => {
  it('every episode before it, previous seasons included, specials aside', () => {
    expect(episodesUpTo(episodes, ep(2, 2)).map((e) => e.id)).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2'])
  })
  it('a special: the specials up to it', () => {
    expect(episodesUpTo(episodes, ep(0, 1)).map((e) => e.id)).toEqual(['0-1'])
  })
})
