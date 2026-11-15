-- What a « user » account may open: the media (films, series, animes, manga, downloads) and/or
-- the IPTV. « Médias + IPTV » (both), « Médias » (no IPTV), « IPTV seulement ». Admins: everything.
-- Existing accounts keep what they had: both.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_media BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_iptv  BOOLEAN NOT NULL DEFAULT TRUE;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_some_access CHECK (can_media OR can_iptv);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
