import { query } from '../config/database'
import { NotFoundError, ValidationError } from '../utils/errors'

/*
 * Reading progress of the mangas, per account (read_history): the page reached in each chapter, and
 * whether it is read — reaching its last page, or « Marquer comme lu » (one chapter, a selection, or
 * every chapter up to one). The title page continues from it, the chapters show what is read.
 */

export interface ChapterReading {
  chapterId:   string
  /** 0-based page reached */
  currentPage: number
  completed:   boolean
  updatedAt:   string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every chapter of a title this account opened or marked, the most recent first */
export async function readingOf(userId: string, mediaId: string): Promise<ChapterReading[]> {
  if (!UUID.test(mediaId)) throw new NotFoundError('Media')
  const { rows } = await query<{ chapter_id: string; current_page: number; completed: boolean; updated_at: Date }>(
    `SELECT chapter_id, current_page, completed, updated_at FROM read_history
      WHERE user_id = $1 AND media_item_id = $2 ORDER BY updated_at DESC, chapter_id`,
    [userId, mediaId])
  return rows.map((r) => ({ chapterId: r.chapter_id, currentPage: r.current_page, completed: r.completed, updatedAt: r.updated_at.toISOString() }))
}

/**
 * The reader: page `page` (0-based) of `total` reached. The last page makes the chapter read; going
 * back into a read chapter keeps it read.
 */
export async function saveReading(userId: string, chapterId: string, page: unknown, total: unknown): Promise<ChapterReading> {
  if (!UUID.test(chapterId)) throw new NotFoundError('Chapter')
  if (!Number.isInteger(page) || !Number.isInteger(total) || (total as number) < 1 || (total as number) > 10_000
      || (page as number) < 0 || (page as number) >= (total as number)) {
    throw new ValidationError('Page invalide')
  }
  const { rows: ch } = await query<{ media_item_id: string }>('SELECT media_item_id FROM chapters WHERE id = $1', [chapterId])
  if (!ch.length) throw new NotFoundError('Chapter')
  const done = (page as number) >= (total as number) - 1
  const { rows } = await query<{ current_page: number; completed: boolean; updated_at: Date }>(
    `INSERT INTO read_history (user_id, media_item_id, chapter_id, current_page, completed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, chapter_id) DO UPDATE SET
       current_page = EXCLUDED.current_page,
       completed    = read_history.completed OR EXCLUDED.completed,
       read_at      = CASE WHEN EXCLUDED.completed AND NOT read_history.completed THEN NOW() ELSE read_history.read_at END,
       updated_at   = NOW()
     RETURNING current_page, completed, updated_at`,
    [userId, ch[0].media_item_id, chapterId, page, done])
  return { chapterId, currentPage: rows[0].current_page, completed: rows[0].completed, updatedAt: rows[0].updated_at.toISOString() }
}

/**
 * « Marquer comme lu / non lu » for chapters of a title (a selection, or every chapter up to one).
 * Unread: the same chapter numbers in the title's other versions (colour / black & white…) too,
 * since a chapter read in one version shows as read in all of them.
 */
export async function markChapters(userId: string, mediaId: string, chapterIds: unknown, read: unknown): Promise<ChapterReading[]> {
  if (!UUID.test(mediaId)) throw new NotFoundError('Media')
  if (typeof read !== 'boolean') throw new ValidationError('« read » doit être vrai ou faux')
  if (!Array.isArray(chapterIds) || !chapterIds.length || chapterIds.length > 10_000 || !chapterIds.every((c) => typeof c === 'string' && UUID.test(c))) {
    throw new ValidationError('Chapitres invalides')
  }
  const { rows: chapters } = await query<{ id: string }>(
    'SELECT id FROM chapters WHERE media_item_id = $1 AND id = ANY($2::uuid[])', [mediaId, chapterIds])
  if (chapters.length !== new Set(chapterIds).size) throw new NotFoundError('Chapter')
  if (read) {
    // (a chapter started keeps its page)
    await query(
      `INSERT INTO read_history (user_id, media_item_id, chapter_id, completed)
       SELECT $1, $2, id, TRUE FROM chapters WHERE media_item_id = $2 AND id = ANY($3::uuid[])
       ON CONFLICT (user_id, chapter_id) DO UPDATE SET
         completed = TRUE,
         read_at = CASE WHEN read_history.completed THEN read_history.read_at ELSE NOW() END,
         updated_at = NOW()`,
      [userId, mediaId, chapterIds])
  } else {
    await query(
      `DELETE FROM read_history WHERE user_id = $1 AND chapter_id IN (
         SELECT id FROM chapters WHERE media_item_id = $2 AND chapter_number IN (
           SELECT chapter_number FROM chapters WHERE media_item_id = $2 AND id = ANY($3::uuid[])))`,
      [userId, mediaId, chapterIds])
  }
  return readingOf(userId, mediaId)
}
