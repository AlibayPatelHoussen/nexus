-- 1. episodes: one row per video file, so rescans upsert instead of duplicating
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episodes_file_path_key') THEN
    DELETE FROM episodes a USING episodes b
      WHERE a.file_path = b.file_path AND a.id <> b.id
        AND (a.created_at, a.id::text) > (b.created_at, b.id::text);
    ALTER TABLE episodes ADD CONSTRAINT episodes_file_path_key UNIQUE (file_path);
  END IF;
END $$;

-- 2. watch_history: the old UNIQUE(user_id, media_item_id, episode_id) never
--    matched for films (episode_id IS NULL), so a new row was inserted on every
--    progress save. Keep the latest row per (user, media, episode) and enforce
--    uniqueness with two partial indexes (works on every PostgreSQL version).
DO $$
DECLARE c text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'watch_history_uniq_episode')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_history_user_media_episode_key') THEN
    DELETE FROM watch_history a USING watch_history b
      WHERE a.user_id = b.user_id AND a.media_item_id = b.media_item_id
        AND a.episode_id IS NOT DISTINCT FROM b.episode_id AND a.id <> b.id
        AND (a.updated_at, a.id::text) < (b.updated_at, b.id::text);
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'watch_history'::regclass AND contype = 'u'
    LOOP
      EXECUTE format('ALTER TABLE watch_history DROP CONSTRAINT %I', c);
    END LOOP;
    CREATE UNIQUE INDEX watch_history_uniq_episode ON watch_history (user_id, media_item_id, episode_id)
      WHERE episode_id IS NOT NULL;
    CREATE UNIQUE INDEX watch_history_uniq_film ON watch_history (user_id, media_item_id)
      WHERE episode_id IS NULL;
  END IF;
END $$;
