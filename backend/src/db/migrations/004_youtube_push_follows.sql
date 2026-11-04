-- 1. YouTube videos in the library (/media/youtube), with their channel
ALTER TABLE media_items DROP CONSTRAINT IF EXISTS media_items_type_check;
ALTER TABLE media_items ADD CONSTRAINT media_items_type_check
  CHECK (type IN ('film', 'serie', 'anime', 'manga', 'webtoon', 'youtube'));
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS channel VARCHAR(300);

-- 2. Web Push subscriptions (one per device that allowed notifications)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- 3. Titles followed for new episodes / chapters (off unless switched on)
CREATE TABLE IF NOT EXISTS follows (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id        TEXT NOT NULL UNIQUE,
  source_script    VARCHAR(10) NOT NULL CHECK (source_script IN ('anisama', 'movix')),
  kind             VARCHAR(10) NOT NULL CHECK (kind IN ('anime', 'manga', 'serie')),
  title            TEXT NOT NULL,
  poster_url       TEXT,
  options          JSONB NOT NULL DEFAULT '{}',   -- {"lang": "VOSTFR", "season": "saison1"}
  known            JSONB NOT NULL DEFAULT '[]',   -- episode / chapter numbers already seen
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  last_checked_at  TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
