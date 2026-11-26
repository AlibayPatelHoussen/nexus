import { query } from '../config/database'
import { NotFoundError, ValidationError } from '../utils/errors'
import { MediaService } from './media'

/*
 * « Marquer comme vu / non vu » for the episodes of a series or an anime (one, every episode up to one,
 * a season, a selection), per account, in watch_history — the same rows the player fills while watching.
 * Vu: completed (a position already reached is kept, the player starts such an episode from the beginning);
 * non vu: the row goes, like an episode never opened (out of « Reprendre » too).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function markEpisodes(userId: string, mediaId: string, episodeIds: unknown, watched: unknown) {
  if (!UUID.test(mediaId)) throw new NotFoundError('Media')
  if (typeof watched !== 'boolean') throw new ValidationError('« watched » doit être vrai ou faux')
  if (!Array.isArray(episodeIds) || !episodeIds.length || episodeIds.length > 10_000
      || !episodeIds.every((e) => typeof e === 'string' && UUID.test(e))) {
    throw new ValidationError('Épisodes invalides')
  }
  const ids = [...new Set(episodeIds as string[])]
  const { rows } = await query<{ id: string }>('SELECT id FROM episodes WHERE media_item_id = $1 AND id = ANY($2::uuid[])', [mediaId, ids])
  if (rows.length !== ids.length) throw new NotFoundError('Episode')

  if (watched) {
    // Update, then insert what is missing (whatever the unique index of an older installation)
    await query(
      `UPDATE watch_history SET completed = TRUE, dismissed = FALSE, updated_at = NOW()
        WHERE user_id = $1 AND media_item_id = $2 AND episode_id = ANY($3::uuid[]) AND NOT completed`,
      [userId, mediaId, ids])
    try {
      await query(
        `INSERT INTO watch_history (user_id, media_item_id, episode_id, progress, completed, updated_at)
         SELECT $1, $2, e.id, 0, TRUE, NOW() FROM episodes e
          WHERE e.media_item_id = $2 AND e.id = ANY($3::uuid[])
            AND NOT EXISTS (SELECT 1 FROM watch_history w WHERE w.user_id = $1 AND w.media_item_id = $2 AND w.episode_id = e.id)`,
        [userId, mediaId, ids])
    } catch (err) {
      // The player saved one of them at the same moment: it is there, mark it
      if ((err as { code?: string }).code !== '23505') throw err
      await query(
        `UPDATE watch_history SET completed = TRUE, dismissed = FALSE, updated_at = NOW()
          WHERE user_id = $1 AND media_item_id = $2 AND episode_id = ANY($3::uuid[]) AND NOT completed`,
        [userId, mediaId, ids])
    }
  } else {
    await query('DELETE FROM watch_history WHERE user_id = $1 AND media_item_id = $2 AND episode_id = ANY($3::uuid[])', [userId, mediaId, ids])
  }
  return MediaService.getEpisodesProgress(userId, mediaId)
}
