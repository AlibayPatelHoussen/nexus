-- Animes were linked to the first animated TMDB result of their year, which could be a
-- spin-off (Attack on Titan → « Attack on Titan: Chibi Theater »). Unlink them: the
-- background enrichment links them again right away (the best-known series of that
-- year) and fetches their poster, logo, key art and IMDb rating again.
UPDATE media_items
   SET tmdb_id = NULL, imdb_id = NULL, imdb_rating = NULL, imdb_votes = NULL,
       imdb_checked_at = NULL, key_art_path = NULL, logo_path = NULL, hero_backdrop_path = NULL, artwork_checked_at = NULL
 WHERE type = 'anime';
