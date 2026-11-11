-- Manga: where a title comes from and how it reads, for the « Manhwa » / « Manhua » / « Webtoon » pills.
-- origin  = 'manga' (Japan), 'manhwa' (Korea), 'manhua' (China…) — from MangaDex's original
--           language, else AniList's country of origin; NULL: not looked up yet;
-- webtoon = a long vertical strip (MangaDex tags « Long Strip » / « Web Comic »).
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS origin VARCHAR(10);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS webtoon BOOLEAN NOT NULL DEFAULT FALSE;
