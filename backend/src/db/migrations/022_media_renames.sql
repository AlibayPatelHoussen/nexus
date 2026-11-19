-- Renaming the library to Jellyfin's names (services/renamer.ts): every file / folder moved, by
-- batch (« Annuler » puts a batch back), and the settings of the app (« auto » renaming).
CREATE TABLE IF NOT EXISTS media_renames (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id      UUID NOT NULL,
  media_item_id UUID,
  title         TEXT,
  from_path     TEXT NOT NULL,
  to_path       TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  auto          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_media_renames_batch ON media_renames(batch_id, seq);
CREATE INDEX IF NOT EXISTS idx_media_renames_created ON media_renames(created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
