-- Chapters: the version a chapter belongs to is its folder inside the manga
-- (« VF », « VOSTFR », « VF Noir et blanc »…), longer than the old 10 characters.
ALTER TABLE chapters ALTER COLUMN language TYPE VARCHAR(40);
