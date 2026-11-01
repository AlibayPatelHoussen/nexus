-- Chapters: language column + unique folder_path (needed for the scanner upsert).
-- Formerly an inline patch in scripts/deploy.sh. Idempotent.
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS language VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chapters_folder_path_key'
  ) THEN
    DELETE FROM chapters a USING chapters b
      WHERE a.id > b.id AND a.folder_path = b.folder_path;
    ALTER TABLE chapters ADD CONSTRAINT chapters_folder_path_key UNIQUE (folder_path);
  END IF;
END $$;
