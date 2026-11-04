-- Downloads section: queue of jobs run by the download scripts (downloaders/)
CREATE TABLE IF NOT EXISTS downloads (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('anime', 'manga', 'film', 'serie', 'youtube')),
  source_script  VARCHAR(10) NOT NULL CHECK (source_script IN ('anisama', 'films', 'movix', 'youtube')),
  source_id      TEXT NOT NULL,
  title          TEXT NOT NULL,
  poster_url     TEXT,
  options        JSONB NOT NULL DEFAULT '{}',   -- {"lang": "VOSTFR", "season": "saison1"}
  selection      JSONB NOT NULL DEFAULT '{}',   -- {"episodes": [1, 2]} | {"chapters": [..]} | {}
  status         VARCHAR(10) NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
  progress       JSONB NOT NULL DEFAULT '{}',
  dest_path      TEXT,
  error          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_source ON downloads(source_id);
