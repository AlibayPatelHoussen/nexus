import type { Episode } from '@/types'
import type { EpisodeProgress } from '@/services/mediaService'

export interface WatchState {
  /** Episodes watched (to the end, or « Marquer comme vu ») */
  watched: Set<string>
  /** Where the play button goes: the episode being watched (resume), else the one after the furthest watched */
  next: { episode: Episode; resume: boolean } | null
  /** Something was watched or opened */
  started: boolean
  /** Every episode (specials aside) is watched */
  finished: boolean
  /** Episodes watched, specials aside — and how many there are */
  watchedCount: number
  total: number
}

const seasonOf = (e: Episode) => e.season ?? 1
const inOrder = (a: Episode, b: Episode) => seasonOf(a) - seasonOf(b) || a.episodeNumber - b.episodeNumber

/** The episodes in watching order, the specials (« Saison 0 ») aside */
export function regularEpisodes(episodes: Episode[]): Episode[] {
  const regular = episodes.filter((e) => seasonOf(e) !== 0).sort(inOrder)
  return regular.length ? regular : [...episodes].sort(inOrder)
}

/** « Marquer comme vus jusqu’ici »: every episode before this one in watching order (specials: those of its season) */
export function episodesUpTo(episodes: Episode[], ep: Episode): Episode[] {
  const list = seasonOf(ep) === 0 ? episodes.filter((e) => seasonOf(e) === 0).sort(inOrder) : regularEpisodes(episodes)
  const i = list.findIndex((e) => e.id === ep.id)
  return i === -1 ? [ep] : list.slice(0, i + 1)
}

/**
 * What this account watched of a series, from its progress (most recent first): the episodes watched and
 * where to go on — like streaming services: the episode in progress, else the next one after the furthest
 * watched (a gap left behind comes after), nothing once everything is watched.
 */
export function watchState(episodes: Episode[], rows: EpisodeProgress[]): WatchState {
  const byId = new Map(episodes.map((e) => [e.id, e]))
  const watched = new Set(rows.filter((r) => r.completed && byId.has(r.episodeId)).map((r) => r.episodeId))
  const list = regularEpisodes(episodes)
  const latest = rows.find((r) => byId.has(r.episodeId))
  let next: WatchState['next'] = null
  if (latest && !latest.completed) {
    next = { episode: byId.get(latest.episodeId)!, resume: latest.progress > 30 }
  } else {
    const furthest = list.reduce((last, e, i) => (watched.has(e.id) ? i : last), -1)
    const after = list.slice(furthest + 1).find((e) => !watched.has(e.id)) ?? list.find((e) => !watched.has(e.id))
    if (after) {
      const p = rows.find((r) => r.episodeId === after.id)
      next = { episode: after, resume: !!p && !p.completed && p.progress > 30 }
    }
  }
  const watchedCount = list.filter((e) => watched.has(e.id)).length
  return {
    watched, next,
    started: rows.some((r) => byId.has(r.episodeId)),
    finished: list.length > 0 && watchedCount === list.length,
    watchedCount,
    total: list.length,
  }
}
