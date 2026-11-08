import { query } from '../config/database'
import { proxied } from './images'

export interface MediaFilters {
  type?:    string
  genre?:   string
  year?:    number
  search?:  string
  page?:    number
  limit?:   number
  sortBy?:  'title' | 'year' | 'rating' | 'created_at'
  sortDir?: 'asc' | 'desc'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMedia(row: Record<string, any>) {
  return {
    id:            row['id'],
    type:          row['type'],
    title:         row['title'],
    originalTitle: row['original_title'],
    filePath:      row['file_path'],
    tmdbId:        row['tmdb_id'],
    anilistId:     row['anilist_id'],
    mangadexId:    row['mangadex_id'],
    overview:      row['overview'],
    // Remote artwork goes through the backend image proxy / cache
    posterPath:    proxied('media', row['id'], 'poster', row['poster_path']),
    backdropPath:  proxied('media', row['id'], 'backdrop', row['backdrop_path']),
    // Apple TV-style artwork (TMDB /images): textless key art, title logo, full-res backdrop
    keyArtPath:       proxied('media', row['id'], 'keyart', row['key_art_path']),
    logoPath:         proxied('media', row['id'], 'logo', row['logo_path']),
    heroBackdropPath: proxied('media', row['id'], 'herobackdrop', row['hero_backdrop_path']),
    genres:        row['genres'],
    year:          row['year'],
    rating:        row['rating'] != null ? Number(row['rating']) : null,
    voteCount:     row['vote_count'],
    imdbId:        row['imdb_id'] ?? null,
    imdbRating:    row['imdb_rating'] != null ? Number(row['imdb_rating']) : null,
    imdbVotes:     row['imdb_votes'] ?? null,
    status:        row['status'],
    language:      row['language'],
    // bigint comes back as a string (« 0 » is truthy): always a number, null when unknown
    fileSize:      row['file_size'] != null && Number(row['file_size']) > 0 ? Number(row['file_size']) : null,
    duration:      row['duration'],
    channel:       row['channel'] ?? null,
    createdAt:     row['created_at'],
    updatedAt:     row['updated_at'],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEpisode(row: Record<string, any>) {
  return {
    id:            row['id'],
    mediaItemId:   row['media_item_id'],
    season:        row['season'],
    episodeNumber: row['episode_number'],
    title:         row['title'],
    overview:      row['overview'],
    filePath:      row['file_path'],
    fileSize:      row['file_size'] != null ? Number(row['file_size']) : null,
    duration:      row['duration'],
    thumbnailPath: proxied('episode', row['id'], 'thumb', row['thumbnail_path']),
    airDate:       row['air_date'],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapChapter(row: Record<string, any>) {
  return {
    id:            row['id'],
    mediaItemId:   row['media_item_id'],
    chapterNumber: parseFloat(row['chapter_number']),
    title:         row['title'],
    folderPath:    row['folder_path'],
    pageCount:     row['page_count'],
    language:      row['language'] as string | null,
  }
}

export class MediaService {

  static async getAll(filters: MediaFilters = {}) {
    const {
      type, genre, year, search,
      page = 1, limit = 24,
      sortBy = 'title', sortDir = 'asc',
    } = filters

    const conditions: string[] = []
    const params: unknown[]    = []
    let   i = 1

    if (type)   { conditions.push(`type = $${i++}`);  params.push(type)   }
    if (year)   { conditions.push(`year = $${i++}`);   params.push(year)   }
    if (genre)  { conditions.push(`$${i++} = ANY(genres)`); params.push(genre) }
    if (search) {
      conditions.push(`(title ILIKE $${i} OR original_title ILIKE $${i})`)
      params.push(`%${search}%`)
      i++
    }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (page - 1) * limit

    const validSort = ['title', 'year', 'rating', 'created_at'].includes(sortBy) ? sortBy : 'title'
    const validDir  = sortDir === 'desc' ? 'DESC' : 'ASC'

    const [items, countResult] = await Promise.all([
      query(
        `SELECT id, type, title, original_title, poster_path, backdrop_path,
                genres, year, rating, vote_count, status, overview, duration,
                file_path, file_size, created_at, channel, imdb_id, imdb_rating, imdb_votes,
                key_art_path, logo_path, hero_backdrop_path
               FROM media_items
         ${where}
         ORDER BY ${validSort} ${validDir} NULLS LAST
         LIMIT $${i} OFFSET $${i + 1}`,
        [...params, limit, offset],
      ),
      query(`SELECT COUNT(*) FROM media_items ${where}`, params),
    ])

    const total = parseInt(countResult.rows[0].count as string)
    return {
      items: items.rows.map(mapMedia),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  static async getById(id: string) {
    const item = await query(
      `SELECT * FROM media_items WHERE id = $1`,
      [id],
    )
    if (!item.rows[0]) return null

    const type = item.rows[0].type
    const mapped = mapMedia(item.rows[0])

    if (type === 'serie' || type === 'anime') {
      const episodes = await query(
        `SELECT * FROM episodes WHERE media_item_id = $1 ORDER BY season, episode_number`,
        [id],
      )
      const eps = episodes.rows.map(mapEpisode)
      // A series' size is that of its episodes (media_items.file_size is only a film's file)
      const total = eps.reduce((sum, e) => sum + (e.fileSize ?? 0), 0)
      return { ...mapped, fileSize: mapped.fileSize ?? (total > 0 ? total : null), episodes: eps }
    }

    if (type === 'manga' || type === 'webtoon') {
      const chapters = await query(
        `SELECT * FROM chapters WHERE media_item_id = $1 ORDER BY chapter_number`,
        [id],
      )
      return { ...mapped, chapters: chapters.rows.map(mapChapter) }
    }

    return mapped
  }

  static async getRecentlyAdded(type?: string, limit = 12) {
    const where = type ? 'WHERE type = $2' : ''
    const params = type ? [limit, type] : [limit]
    const result = await query(
      `SELECT id, type, title, poster_path, backdrop_path, overview, genres, year, rating, duration
       FROM media_items
       ${where}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    )
    return result.rows.map(mapMedia)
  }

  static async getContinueWatching(userId: string, limit = 20) {
    // One entry per title (latest episode in progress for a series)
    const result = await query(
      `SELECT * FROM (
         SELECT DISTINCT ON (m.id)
                m.id, m.type, m.title, m.poster_path, m.backdrop_path, m.year, m.rating,
                w.progress, w.duration, w.episode_id, w.updated_at,
                e.season, e.episode_number, e.title as episode_title
         FROM watch_history w
         JOIN media_items m ON m.id = w.media_item_id
         LEFT JOIN episodes e ON e.id = w.episode_id
         WHERE w.user_id = $1 AND w.completed = false AND w.progress > 30 AND NOT w.dismissed
         ORDER BY m.id, w.updated_at DESC
       ) t
       ORDER BY updated_at DESC
       LIMIT $2`,
      [userId, limit],
    )
    return result.rows.map((row) => ({
      ...mapMedia(row),
      progress:     row['progress'],
      duration:     row['duration'],
      episodeId:    row['episode_id'],
      updatedAt:    row['updated_at'],
      season:       row['season'],
      episodeNumber: row['episode_number'],
      episodeTitle:  row['episode_title'],
    }))
  }

  /** « Retirer de Reprendre »: progress is kept, watching again brings the title back */
  static async dismissContinue(userId: string, mediaId: string): Promise<void> {
    await query('UPDATE watch_history SET dismissed = TRUE WHERE user_id = $1 AND media_item_id = $2', [userId, mediaId])
  }

  static async getFavorites(userId: string) {
    const result = await query(
      `SELECT m.id, m.type, m.title, m.poster_path, m.year, m.rating
       FROM favorites f
       JOIN media_items m ON m.id = f.media_item_id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC`,
      [userId],
    )
    return result.rows.map(mapMedia)
  }

  static async toggleFavorite(userId: string, mediaId: string): Promise<boolean> {
    const existing = await query(
      'SELECT id FROM favorites WHERE user_id = $1 AND media_item_id = $2',
      [userId, mediaId],
    )

    if (existing.rows.length > 0) {
      await query('DELETE FROM favorites WHERE user_id = $1 AND media_item_id = $2', [userId, mediaId])
      return false
    } else {
      await query('INSERT INTO favorites (user_id, media_item_id) VALUES ($1, $2)', [userId, mediaId])
      return true
    }
  }

  static async saveProgress(
    userId: string,
    mediaId: string,
    progress: number,
    duration: number,
    episodeId?: string,
  ): Promise<void> {
    const completed = duration > 0 && (progress / duration) > 0.9

    // Update-then-insert (works whatever the unique index flavour; IS NOT DISTINCT
    // FROM matches films, whose episode_id is NULL)
    const params = [userId, mediaId, episodeId || null, progress, duration, completed]
    const updated = await query(
      `UPDATE watch_history SET progress = $4, duration = $5, completed = $6, dismissed = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND media_item_id = $2 AND episode_id IS NOT DISTINCT FROM $3`,
      params,
    )
    if (updated.rowCount) return
    try {
      await query(
        `INSERT INTO watch_history (user_id, media_item_id, episode_id, progress, duration, completed, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        params,
      )
    } catch (err) {
      // Concurrent save inserted the row first: update it instead
      if ((err as { code?: string }).code !== '23505') throw err
      await query(
        `UPDATE watch_history SET progress = $4, duration = $5, completed = $6, dismissed = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND media_item_id = $2 AND episode_id IS NOT DISTINCT FROM $3`,
        params,
      )
    }
  }

  static async getProgress(userId: string, mediaId: string, episodeId?: string) {
    const result = await query(
      `SELECT progress, duration, completed, episode_id FROM watch_history
       WHERE user_id = $1 AND media_item_id = $2 AND episode_id IS NOT DISTINCT FROM $3`,
      [userId, mediaId, episodeId || null],
    )
    if (!result.rows[0]) return null
    const r = result.rows[0]
    return {
      progress:  r['progress'],
      duration:  r['duration'],
      completed: r['completed'],
      episodeId: r['episode_id'],
    }
  }

  /** Progress of every episode of a show for a user (for "watched" marks and resume). */
  static async getEpisodesProgress(userId: string, mediaId: string) {
    const result = await query(
      `SELECT episode_id, progress, duration, completed, updated_at FROM watch_history
       WHERE user_id = $1 AND media_item_id = $2 AND episode_id IS NOT NULL
       ORDER BY updated_at DESC`,
      [userId, mediaId],
    )
    return result.rows.map((r) => ({
      episodeId: r['episode_id'] as string,
      progress:  r['progress'] as number,
      duration:  r['duration'] as number | null,
      completed: r['completed'] as boolean,
      updatedAt: r['updated_at'] as string,
    }))
  }

  static async getGenres(type?: string) {
    const result = type
      ? await query(`SELECT DISTINCT unnest(genres) as genre FROM media_items WHERE type = $1 ORDER BY genre`, [type])
      : await query(`SELECT DISTINCT unnest(genres) as genre FROM media_items ORDER BY genre`)
    return result.rows.map((r) => r['genre'] as string)
  }

}
