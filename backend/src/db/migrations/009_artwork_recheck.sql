-- Artwork is picked differently now (SVG logos accepted, votes weighted by their
-- number): look every title up again at the next enrichment instead of in 30 days.
UPDATE media_items SET artwork_checked_at = NULL WHERE artwork_checked_at IS NOT NULL;
