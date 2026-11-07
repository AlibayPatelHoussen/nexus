import axios from 'axios'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import sharp from 'sharp'
import { cachedImage } from './images'

/*
 * Apple TV-style artwork from TMDB's image catalogue (`/movie|tv/{id}/images`):
 *  - key art: the best-voted poster WITHOUT text (iso_639_1 = null), full
 *    resolution, for the billboard and the title page on iPhone;
 *  - logo: the title treatment, French first, then English, then textless; a PNG
 *    before an SVG (rasterised to PNG by the image cache, never served as SVG), and
 *    only one with a transparent background;
 *  - the owner can choose them by hand (« Image et logo… »): then they are locked;
 *  - hero backdrop: the best-voted textless backdrop, full resolution.
 * Full-resolution files are downscaled once by the image cache (images.ts).
 */
const TMDB_KEY  = process.env.TMDB_API_KEY
const TMDB_BASE = process.env.TMDB_BASE_URL     || 'https://api.themoviedb.org/3'
const TMDB_IMG  = process.env.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p'

const hasTmdbKey = () => !!TMDB_KEY && !/your_|_here|changeme|^x+$/i.test(TMDB_KEY)

interface TmdbImage { file_path: string; iso_639_1: string | null; vote_average?: number; vote_count?: number; width?: number; height?: number }

const best = (list: TmdbImage[]) =>
  [...list].sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.vote_count ?? 0) - (a.vote_count ?? 0) || (b.width ?? 0) - (a.width ?? 0))[0]
const ranked = (list: TmdbImage[]) => {
  const out: TmdbImage[] = []
  let rest = [...list]
  while (rest.length) { const b = best(rest)!; out.push(b); rest = rest.filter((i) => i !== b) }
  return out
}
const LOGO_LANGS = ['fr', 'en', null] as const

/** Every usable title logo, best first: French, English, then textless; a PNG before an
 *  SVG of the same language (an SVG is turned into a PNG by the image cache). Other
 *  languages are left out (a Japanese promo logo is worse than the title in text). */
export function logoCandidates(logos: TmdbImage[] = []): TmdbImage[] {
  const usable = logos.filter((l) => /\.(png|svg)$/i.test(l.file_path))
  return LOGO_LANGS.flatMap((lang) => {
    const same = usable.filter((l) => (l.iso_639_1 ?? null) === lang)
    return [...ranked(same.filter((l) => /\.png$/i.test(l.file_path))), ...ranked(same.filter((l) => /\.svg$/i.test(l.file_path)))]
  })
}

const original = (i: TmdbImage | undefined) => (i ? `${TMDB_IMG}/original${i.file_path}` : null)

/** Picks key art, logo and backdrop from a TMDB /images response. */
export function pickArtwork(data: { posters?: TmdbImage[]; logos?: TmdbImage[]; backdrops?: TmdbImage[] }) {
  const textless = (l?: TmdbImage[]) => (l ?? []).filter((i) => !i.iso_639_1)
  return {
    keyArt:   original(best(textless(data.posters))),
    logo:     original(logoCandidates(data.logos)[0]),
    backdrop: original(best(textless(data.backdrops))),
  }
}

/** A title logo has a transparent background: a picture with a plain box (Bleach) is not one. */
export async function isTransparentLogo(file: string | Buffer): Promise<boolean> {
  try {
    const { data, info } = await sharp(file).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let clear = 0
    for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] < 32) clear++
    return clear / (info.width * info.height) >= 0.12
  } catch { return false }
}

/** The first logo of the list that really is a transparent title treatment. */
async function firstTransparentLogo(logos: TmdbImage[]): Promise<string | null> {
  for (const l of logos.slice(0, 6)) {
    const url = original(l)!
    try {
      const { file } = await cachedImage(url)
      if (await isTransparentLogo(file)) return url
    } catch { /* unreachable: try the next one */ }
  }
  return null
}

/** TMDB /images of a title (French, English and textless pictures). */
export async function tmdbImages(kind: 'movie' | 'tv', tmdbId: number) {
  const { data } = await axios.get(`${TMDB_BASE}/${kind}/${tmdbId}/images`, {
    params: { api_key: TMDB_KEY, include_image_language: 'fr,en,null' }, timeout: 10_000,
  })
  return (data ?? {}) as { posters?: TmdbImage[]; logos?: TmdbImage[]; backdrops?: TmdbImage[] }
}

/** Choices for the owner (« Image et logo… »): textless key art and usable logos, best first. */
export async function artworkOptions(kind: 'movie' | 'tv', tmdbId: number) {
  const data = await tmdbImages(kind, tmdbId)
  const textless = (data.posters ?? []).filter((i) => !i.iso_639_1)
  return {
    keyArts: ranked(textless).slice(0, 30).map((i) => ({ url: original(i)!, thumb: `${TMDB_IMG}/w342${i.file_path}` })),
    logos:   logoCandidates(data.logos).slice(0, 20).map((i) => ({
      url: original(i)!, thumb: /\.svg$/i.test(i.file_path) ? original(i)! : `${TMDB_IMG}/w300${i.file_path}`, lang: i.iso_639_1 ?? null,
    })),
  }
}

/** A URL the owner may choose: an original TMDB image (never anything else). */
export const isTmdbOriginal = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith(`${TMDB_IMG}/original/`) && /^\/[A-Za-z0-9_-]+\.(jpe?g|png|svg)$/.test(url.slice(`${TMDB_IMG}/original`.length))

/** Fetches the artwork of titles not checked yet (or checked more than 30 days ago). */
export async function linkArtwork(limit = 300, onlyId?: string): Promise<number> {
  if (!hasTmdbKey()) return 0
  const { rows } = await query<{ id: string; type: string; tmdb_id: number }>(
    `SELECT id, type, tmdb_id FROM media_items
      WHERE tmdb_id IS NOT NULL AND type IN ('film', 'serie', 'anime')
        AND NOT artwork_locked
        AND (artwork_checked_at IS NULL OR artwork_checked_at < NOW() - INTERVAL '30 days')
        AND ($2::uuid IS NULL OR id = $2::uuid)
      ORDER BY created_at DESC LIMIT $1`, [limit, onlyId ?? null])
  let found = 0
  for (const r of rows) {
    const kind = r.type === 'film' ? 'movie' : 'tv'
    try {
      const data = await tmdbImages(kind, r.tmdb_id)
      const a = pickArtwork(data)
      const logo = await firstTransparentLogo(logoCandidates(data.logos))
      await query(
        `UPDATE media_items SET key_art_path = $2, logo_path = $3, hero_backdrop_path = $4, artwork_checked_at = NOW() WHERE id = $1 AND NOT artwork_locked`,
        [r.id, a.keyArt, logo, a.backdrop])
      if (a.keyArt || logo || a.backdrop) found++
    } catch (err) {
      logger.warn(`Artwork lookup failed for TMDB ${kind} ${r.tmdb_id}: ${err}`)
    }
  }
  return found
}
