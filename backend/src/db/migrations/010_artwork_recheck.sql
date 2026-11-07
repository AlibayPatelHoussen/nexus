-- Automatic artwork rules settled (as before #68, an SVG logo only for titles with no PNG
-- logo, sharp key art first): look every title up again at the next enrichment.
UPDATE media_items SET artwork_checked_at = NULL WHERE artwork_checked_at IS NOT NULL;
