import axios from 'axios'
import { query } from '../config/database'
import { logger } from '../utils/logger'

/*
 * Apple TV-style artwork from TMDB's image catalogue (`/movie|tv/{id}/images`):
 *  - key art: the best-voted poster WITHOUT text (iso_639_1 = null), full
 *    resolution, for the billboard and the title page on iPhone;
 *  - logo: the title treatment (transparent PNG), French first, then English;
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

/** Picks key art, logo and backdrop from a TMDB /images response. */
export function pickArtwork(data: { posters?: TmdbImage[]; logos?: TmdbImage[]; backdrops?: TmdbImage[] }) {
  const textless = (l?: TmdbImage[]) => (l ?? []).filter((i) => !i.iso_639_1)
  // PNG only: an SVG served from our origin could carry scripts
  const logos = (data.logos ?? []).filter((l) => /\.png$/i.test(l.file_path))
  const logo = best(logos.filter((l) => l.iso_639_1 === 'fr')) ?? best(logos.filter((l) => l.iso_639_1 === 'en')) ?? best(logos.filter((l) => !l.iso_639_1))
  const keyArt = best(textless(data.posters))
  const backdrop = best(textless(data.backdrops))
  return {
    keyArt:   keyArt   ? `${TMDB_IMG}/original${keyArt.file_path}`   : null,
    logo:     logo     ? `${TMDB_IMG}/original${logo.file_path}`     : null,
    backdrop: backdrop ? `${TMDB_IMG}/original${backdrop.file_path}` : null,
  }
}

/** Fetches the artwork of titles not checked yet (or checked more than 30 days ago). */
export async function linkArtwork(limit = 300): Promise<number> {
  if (!hasTmdbKey()) return 0
  const { rows } = await query<{ id: string; type: string; tmdb_id: number }>(
    `SELECT id, type, tmdb_id FROM media_items
      WHERE tmdb_id IS NOT NULL AND type IN ('film', 'serie', 'anime')
        AND (artwork_checked_at IS NULL OR artwork_checked_at < NOW() - INTERVAL '30 days')
      ORDER BY created_at DESC LIMIT $1`, [limit])
  let found = 0
  for (const r of rows) {
    const kind = r.type === 'film' ? 'movie' : 'tv'
    try {
      const { data } = await axios.get(`${TMDB_BASE}/${kind}/${r.tmdb_id}/images`, {
        params: { api_key: TMDB_KEY, include_image_language: 'fr,en,null' }, timeout: 10_000,
      })
      const a = pickArtwork(data ?? {})
      await query(
        `UPDATE media_items SET key_art_path = $2, logo_path = $3, hero_backdrop_path = $4, artwork_checked_at = NOW() WHERE id = $1`,
        [r.id, a.keyArt, a.logo, a.backdrop])
      if (a.keyArt || a.logo || a.backdrop) found++
    } catch (err) {
      logger.warn(`Artwork lookup failed for TMDB ${kind} ${r.tmdb_id}: ${err}`)
    }
  }
  return found
}
