-- IPTV (iptv-org catalogue): channels, per-user favourites / history, guide, settings.
-- channel ids are iptv-org ids (« TF1.fr ») or « stream-<hash> » for streams without channel.
CREATE TABLE IF NOT EXISTS iptv_channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  alt_names   TEXT[] NOT NULL DEFAULT '{}',
  country     TEXT,
  categories  TEXT[] NOT NULL DEFAULT '{}',
  languages   TEXT[] NOT NULL DEFAULT '{}',
  logo        TEXT,
  website     TEXT,
  network     TEXT,
  streams     JSONB NOT NULL DEFAULT '[]',
  labels      TEXT[] NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'online', 'offline')),
  status_reason TEXT,
  checked_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_iptv_channels_country    ON iptv_channels(country);
CREATE INDEX IF NOT EXISTS idx_iptv_channels_categories ON iptv_channels USING GIN (categories);
CREATE INDEX IF NOT EXISTS idx_iptv_channels_languages  ON iptv_channels USING GIN (languages);
CREATE INDEX IF NOT EXISTS idx_iptv_channels_name       ON iptv_channels (lower(name));

-- No foreign key to iptv_channels: a channel can leave the catalogue for a while (stream
-- down) and come back; the user's favourites and history are kept meanwhile.
CREATE TABLE IF NOT EXISTS iptv_favorites (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS iptv_history (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL,
  watched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  plays       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_iptv_history_recent ON iptv_history(user_id, watched_at DESC);

CREATE TABLE IF NOT EXISTS iptv_epg (
  channel_id  TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (channel_id, starts_at)
);

-- Facets (countries, categories, languages with their counts), last refresh, settings
CREATE TABLE IF NOT EXISTS iptv_meta (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
