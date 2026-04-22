import { query } from '../config/database'

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
                file_path, file_size, created_at
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
      items: items.rows,
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

    // Get episodes or chapters
    const type = item.rows[0].type

    if (type === 'serie' || type === 'anime') {
      const episodes = await query(
        `SELECT * FROM episodes WHERE media_item_id = $1 ORDER BY season, episode_number`,
        [id],
      )
      return { ...item.rows[0], episodes: episodes.rows }
    }

    if (type === 'manga' || type === 'webtoon') {
      const chapters = await query(
        `SELECT * FROM chapters WHERE media_item_id = $1 ORDER BY chapter_number`,
        [id],
      )
      return { ...item.rows[0], chapters: chapters.rows }
    }

    return item.rows[0]
  }

  static async getRecentlyAdded(type?: string, limit = 12) {
    const where = type ? 'WHERE type = $2' : ''
    const params = type ? [limit, type] : [limit]
    const result = await query(
      `SELECT id, type, title, poster_path, year, rating, duration
       FROM media_items
       ${where}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    )
    return result.rows
  }

  static async getContinueWatching(userId: string, limit = 10) {
    const result = await query(
      `SELECT m.id, m.type, m.title, m.poster_path, m.year,
              w.progress, w.duration, w.episode_id, w.updated_at,
              e.season, e.episode_number, e.title as episode_title
       FROM watch_history w
       JOIN media_items m ON m.id = w.media_item_id
       LEFT JOIN episodes e ON e.id = w.episode_id
       WHERE w.user_id = $1 AND w.completed = false AND w.progress > 30
       ORDER BY w.updated_at DESC
       LIMIT $2`,
      [userId, limit],
    )
    return result.rows
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
    return result.rows
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

    await query(
      `INSERT INTO watch_history (user_id, media_item_id, episode_id, progress, duration, completed, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, media_item_id, episode_id)
       DO UPDATE SET progress = $4, duration = $5, completed = $6, updated_at = NOW()`,
      [userId, mediaId, episodeId || null, progress, duration, completed],
    )
  }

  static async getProgress(userId: string, mediaId: string, episodeId?: string) {
    const result = await query(
      `SELECT progress, duration, completed FROM watch_history
       WHERE user_id = $1 AND media_item_id = $2 AND episode_id IS NOT DISTINCT FROM $3`,
      [userId, mediaId, episodeId || null],
    )
    return result.rows[0] || null
  }

  static async getGenres(type?: string) {
    const where = type ? `WHERE type = '${type}'` : ''
    const result = await query(
      `SELECT DISTINCT unnest(genres) as genre FROM media_items ${where} ORDER BY genre`,
    )
    return result.rows.map((r) => r['genre'] as string)
  }
}
