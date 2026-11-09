/** French names of the iptv-org codes: countries and languages through the system (Intl),
 * categories from iptv-org's own list (their ids). */

const regions = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['fr'], { type: 'region' }) : null
const languages = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['fr'], { type: 'language' }) : null

export function countryName(code: string | null | undefined, fallback?: string): string {
  if (!code) return ''
  try { return regions?.of(code.toUpperCase()) ?? fallback ?? code } catch { return fallback ?? code }
}

export function languageName(code: string, fallback?: string): string {
  try {
    const n = languages?.of(code)
    // Intl gives the code back when it does not know it
    if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1)
  } catch { /* unknown code */ }
  return fallback ?? code
}

/** Flag emoji of an ISO 3166 code (regional indicators) */
export function flag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** iptv-org categories (https://iptv-org.github.io/api/categories.json) */
const CATEGORIES: Record<string, string> = {
  auto: 'Auto', animation: 'Animation', business: 'Économie', classic: 'Classiques', comedy: 'Comédie',
  cooking: 'Cuisine', culture: 'Culture', documentary: 'Documentaires', education: 'Éducation',
  entertainment: 'Divertissement', family: 'Famille', general: 'Généraliste', interactive: 'Interactif',
  kids: 'Enfants', legislative: 'Parlement', lifestyle: 'Art de vivre', movies: 'Films', music: 'Musique',
  news: 'Actualités', outdoor: 'Plein air', public: 'Service public', relax: 'Détente', religious: 'Religion',
  series: 'Séries', science: 'Sciences', shop: 'Téléachat', sports: 'Sport', travel: 'Voyage', weather: 'Météo',
}
export const categoryName = (id: string, fallback?: string) => CATEGORIES[id] ?? fallback ?? id

/** The categories put first on the home page (when the catalogue has them) */
export const MAIN_CATEGORIES = ['sports', 'news', 'entertainment', 'music', 'documentary', 'movies', 'kids', 'general']
