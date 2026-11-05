-- Apple TV-style artwork from TMDB /images: textless key art, title logo, full-resolution backdrop
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS key_art_path       VARCHAR(500);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS logo_path          VARCHAR(500);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS hero_backdrop_path VARCHAR(500);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS artwork_checked_at TIMESTAMPTZ;
