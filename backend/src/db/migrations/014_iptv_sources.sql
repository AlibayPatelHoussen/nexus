-- IPTV: a second source (Free-TV/IPTV, a hand-picked playlist) merged into the catalogue.
-- curated     = the channel's place in the Free-TV playlist (NULL: not in it) — the channels
--               people expect, in the order they expect, come first;
-- best_stream = index (in streams) of the first stream the last check found working: the
--               player starts there instead of trying dead streams first.
ALTER TABLE iptv_channels ADD COLUMN IF NOT EXISTS curated INTEGER;
ALTER TABLE iptv_channels ADD COLUMN IF NOT EXISTS best_stream SMALLINT;
CREATE INDEX IF NOT EXISTS idx_iptv_channels_curated ON iptv_channels(curated) WHERE curated IS NOT NULL;
