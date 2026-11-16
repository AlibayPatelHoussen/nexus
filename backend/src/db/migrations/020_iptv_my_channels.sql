-- « Mes chaînes » (IPTV › Paramètres, admins) replace the playlists of 019: channels added one
-- by one with their stream address (m3u8), or several at once from an M3U list, shown like
-- the other channels (in their country, first). The address may hold the account's
-- credentials: it stays on the server, never sent to a browser.
DELETE FROM iptv_channels WHERE playlist IS NOT NULL;
DROP INDEX IF EXISTS idx_iptv_channels_playlist;
ALTER TABLE iptv_channels DROP COLUMN IF EXISTS playlist;
ALTER TABLE iptv_channels DROP COLUMN IF EXISTS playlist_rank;
DROP TABLE IF EXISTS iptv_playlists;

CREATE TABLE IF NOT EXISTS iptv_my_channels (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  country     TEXT,
  logo        TEXT,
  position    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iptv_my_channels_url ON iptv_my_channels(url);
-- Their place among « Mes chaînes » (NULL: a channel of the sources); kept by every refresh
ALTER TABLE iptv_channels ADD COLUMN IF NOT EXISTS mine_rank INTEGER;
