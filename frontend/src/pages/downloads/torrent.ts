import type { TorrentVersion } from '@/services/downloadsService'

/**
 * OxTorrent versions: ordering, the « Recommandé » pick and the preferred
 * quality applied to the episodes of a series. Only used for OxTorrent cards.
 */

const RES_RANK: Record<string, number> = { '2160p': 4, '1080p': 3, '720p': 2, '576p': 1, '480p': 1 }
export const resRank = (r: string | null) => (r ? RES_RANK[r] ?? 0 : 0)
export const resLabel = (r: string | null) => r ?? 'SD'

/** « 1080p MULTI » */
export function versionLabel(v: Pick<TorrentVersion, 'resolution' | 'language'>) {
  return [resLabel(v.resolution), v.language].filter(Boolean).join(' ')
}

/** « WEB-DL · x264 · 1.48 GB · 39 seeds » */
export function versionDetails(v: TorrentVersion) {
  return [v.source, v.codec, v.size, `${v.seeders} seed${v.seeders > 1 ? 's' : ''}`].filter(Boolean).join(' · ')
}

/** Quality then seeders; versions nobody shares go last. */
export function sortVersions(list: TorrentVersion[]): TorrentVersion[] {
  return [...list].sort((a, b) =>
    Number(b.seeders > 0) - Number(a.seeders > 0) || resRank(b.resolution) - resRank(a.resolution) || b.seeders - a.seeders)
}

const GB = 1024 ** 3
/**
 * Best version: 1080p first, many seeders, a reasonable size
 * (film ≤ 15 GB, episode ≤ 3 GB). null when nobody shares any.
 */
export function recommended(list: TorrentVersion[], episode = false): TorrentVersion | null {
  const max = (episode ? 3 : 15) * GB
  const score = (v: TorrentVersion) => {
    const res = { 3: 30, 4: 20, 2: 15, 1: 5, 0: 3 }[resRank(v.resolution)] ?? 0
    const big = v.size_bytes && v.size_bytes > max ? 15 : 0
    return res + Math.log10(v.seeders + 1) * 10 - big
  }
  const live = list.filter((v) => v.seeders > 0)
  return live.length ? live.reduce((a, b) => (score(b) > score(a) ? b : a)) : null
}

export interface Preference { resolution: string; language: string }   // 'all' = no preference

/** The version matching the preferred quality, else the best one available. */
export function pick(list: TorrentVersion[], pref: Preference, episode = true): TorrentVersion | null {
  const match = list.filter((v) => (pref.resolution === 'all' || resLabel(v.resolution) === pref.resolution)
    && (pref.language === 'all' || v.language_family === pref.language))
  return recommended(match, episode) ?? recommended(list, episode) ?? sortVersions(list)[0] ?? null
}

/** Filter options present in these versions (resolutions high first). */
export function filterOptions(list: TorrentVersion[]) {
  const res = [...new Set(list.map((v) => resLabel(v.resolution)))].sort((a, b) => resRank(b === 'SD' ? null : b) - resRank(a === 'SD' ? null : a))
  const langs = (['MULTI', 'VF', 'VOSTFR'] as const).filter((l) => list.some((v) => v.language_family === l))
  return { res, langs }
}

export function matches(v: TorrentVersion, f: Preference) {
  return (f.resolution === 'all' || resLabel(v.resolution) === f.resolution) && (f.language === 'all' || v.language_family === f.language)
}
