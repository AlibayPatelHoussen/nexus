-- « Retirer de Reprendre »: the title leaves the Reprendre row but keeps its progress;
-- watching it again brings it back (saveProgress clears the flag).
ALTER TABLE watch_history ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT FALSE;
