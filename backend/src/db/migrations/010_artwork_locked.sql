-- Key art / logo chosen by the owner (« Image et logo… »): never replaced automatically.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS artwork_locked BOOLEAN NOT NULL DEFAULT FALSE;
-- The automatic choice changed again (previous key art rule back, no foreign-language
-- logos, transparent logos only): look every title up again.
UPDATE media_items SET artwork_checked_at = NULL WHERE NOT artwork_locked;
