-- IMDb ratings (official non-commercial dataset title.ratings.tsv.gz) for the Top 10
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS imdb_id         VARCHAR(16);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS imdb_rating     DECIMAL(3,1);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS imdb_votes      INTEGER;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS imdb_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_media_imdb ON media_items(imdb_id);
