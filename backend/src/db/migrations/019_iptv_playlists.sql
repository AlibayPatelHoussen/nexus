-- IPTV playlists added in Nexus (IPTV › Paramètres, admins): the owner's own M3U lists, by
-- address (often with the account's credentials: never sent to a browser) or as a file.
-- Their live channels join the catalogue at each refresh (iptv_channels.playlist / playlist_rank).
CREATE TABLE IF NOT EXISTS iptv_playlists (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  url          TEXT,
  content      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ,
  channels     INTEGER,
  error        TEXT,
  CONSTRAINT iptv_playlists_one_source CHECK ((url IS NULL) <> (content IS NULL))
);
ALTER TABLE iptv_channels ADD COLUMN IF NOT EXISTS playlist      UUID;
ALTER TABLE iptv_channels ADD COLUMN IF NOT EXISTS playlist_rank INTEGER;
CREATE INDEX IF NOT EXISTS idx_iptv_channels_playlist ON iptv_channels(playlist, playlist_rank) WHERE playlist IS NOT NULL;
