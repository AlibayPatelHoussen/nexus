-- Animes: better AniList / TMDB matching.
-- « Your Name » (anisama.py) was matched to a 2016 Suntory advert on AniList (its first search
-- result), then to an unrelated animated series on TMDB (« In Your Name, Allah »): only series
-- were searched. AniList now picks the result named like the folder (best known first), and an
-- anime film is looked up among TMDB films (tmdb_kind = 'movie').
--
-- meta_checked_at NULL = matched by the old look-up: the next scan (opening the Animes page is
-- enough) looks each anime up again, once, and its new title / year / pictures replace the old
-- ones. Their TMDB link is dropped so that it is chosen again from the new match (the background
-- enrichment waits for that scan: it only links animes with meta_checked_at set).
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS tmdb_kind VARCHAR(5);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS meta_checked_at TIMESTAMPTZ;

UPDATE media_items
   SET tmdb_id = NULL, tmdb_kind = NULL, imdb_id = NULL, imdb_rating = NULL, imdb_votes = NULL,
       imdb_checked_at = NULL, key_art_path = NULL, logo_path = NULL, hero_backdrop_path = NULL,
       artwork_checked_at = NULL, meta_checked_at = NULL
 WHERE type = 'anime';
