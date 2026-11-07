import type { Chapter } from '@/types'

/**
 * Versions of a manga in the library: the folders its chapters are in
 * (« VF », « VOSTFR », « VF Noir et blanc »…, see chapterVersion() in the backend).
 */
export function chapterVersions(chapters: Pick<Chapter, 'language'>[]): string[] {
  const all = [...new Set(chapters.map((c) => c.language).filter(Boolean))] as string[]
  // Black & white first (the weekly release, the default), then VF before VOSTFR
  const bw = (v: string) => (versionName(v, all).startsWith('Noir et blanc') ? 0 : 1)
  return all.sort((a, b) => bw(a) - bw(b) || a.split(' ')[0].localeCompare(b.split(' ')[0]) || a.length - b.length)
}

/**
 * Name shown for a version: « Couleur » / « Noir et blanc » when the manga has two
 * editions (One Piece on anime-sama: the main scans are in colour), with the
 * language when there are several (« Noir et blanc · VF »).
 */
export function versionName(version: string, all: string[]): string {
  const split = (v: string) => { const i = v.indexOf(' '); return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i + 1)] }
  const [lang, edition] = split(version)
  const editions = all.map((v) => split(v)[1]).filter(Boolean)
  const name = edition || (editions.length ? (editions.includes('Noir et blanc') ? 'Couleur' : 'Noir et blanc') : '')
  if (!name) return lang
  return new Set(all.map((v) => split(v)[0])).size > 1 ? `${name} · ${lang}` : name
}
