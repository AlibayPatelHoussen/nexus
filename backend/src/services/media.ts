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
    posterPath:    row['poster_path'],
    backdropPath:  row['backdrop_path'],
    genres:        row['genres'],
    year:          row['year'],
    rating:        row['rating'] != null ? Number(row['rating']) : null,
    voteCount:     row['vote_count'],
    status:        row['status'],
    language:      row['language'],
    fileSize:      row['file_size'],
    duration:      row['duration'],
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
    duration:      row['duration'],
    airDate:       row['air_date'],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapChapter(row: Record<string, any>) {
  return {
    id:            row['id'],
    mediaItemId:   row['media_item_id'],
    chapterNumber: row['chapter_number'],
    title:         row['title'],
    filePath:      row['file_path'],
    pageCount:     row['page_count'],
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
      return { ...mapped, episodes: episodes.rows.map(mapEpisode) }
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
      `SELECT id, type, title, poster_path, year, rating, duration
       FROM media_items
       ${where}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    )
    return result.rows.map(mapMedia)
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

  static async getGenres(type?: string) {
    const where = type ? `WHERE type = '${type}'` : ''
    const result = await query(
      `SELECT DISTINCT unnest(genres) as genre FROM media_items ${where} ORDER BY genre`,
    )
    return result.rows.map((r) => r['genre'] as string)
  }
}
