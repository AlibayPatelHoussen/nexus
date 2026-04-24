-- ═══════════════════════════════════════════════════════
-- NEXUS — Database Schema
-- ═══════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy search

-- ─── USERS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username    VARCHAR(50)  UNIQUE NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  role        VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  avatar_url  VARCHAR(500),
  theme       VARCHAR(10)  NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login  TIMESTAMPTZ
);

-- ─── REFRESH TOKENS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(500) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MEDIA ITEMS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            VARCHAR(20) NOT NULL CHECK (type IN ('film', 'serie', 'anime', 'manga', 'webtoon')),
  title           VARCHAR(500) NOT NULL,
  original_title  VARCHAR(500),
  file_path       VARCHAR(1000) NOT NULL UNIQUE,

  -- External API IDs
  tmdb_id         INTEGER,
  anilist_id      INTEGER,
  mangadex_id     VARCHAR(100),
  mal_id          INTEGER,

  -- Metadata
  overview        TEXT,
  poster_path     VARCHAR(500),
  backdrop_path   VARCHAR(500),
  genres          TEXT[],
  year            INTEGER,
  rating          DECIMAL(3,1),
  vote_count      INTEGER,
  status          VARCHAR(50),
  language        VARCHAR(10),

  -- File info
  file_size       BIGINT,
  duration        INTEGER, -- seconds
  mime_type       VARCHAR(100),

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scanned    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_type     ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_tmdb     ON media_items(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_media_anilist  ON media_items(anilist_id);
CREATE INDEX IF NOT EXISTS idx_media_title    ON media_items USING gin(title gin_trgm_ops);

-- ─── EPISODES (séries & animes) ──────────────────────
CREATE TABLE IF NOT EXISTS episodes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_item_id   UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  season          INTEGER,
  episode_number  INTEGER NOT NULL,
  title           VARCHAR(500),
  overview        TEXT,
  file_path       VARCHAR(1000) NOT NULL,
  file_size       BIGINT,
  duration        INTEGER,
  thumbnail_path  VARCHAR(500),
  air_date        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes(media_item_id);

-- ─── CHAPTERS (manga & webtoon) ──────────────────────
CREATE TABLE IF NOT EXISTS chapters (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_item_id   UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  chapter_number  DECIMAL(6,1) NOT NULL,
  title           VARCHAR(500),
  folder_path     VARCHAR(1000) NOT NULL UNIQUE,
  page_count      INTEGER,
  language        VARCHAR(10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chapters_media ON chapters(media_item_id);

-- ─── WATCH HISTORY ───────────────────────────────────
CREATE TABLE IF NOT EXISTS watch_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id   UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  episode_id      UUID REFERENCES episodes(id) ON DELETE CASCADE,
  progress        INTEGER NOT NULL DEFAULT 0, -- seconds watched
  duration        INTEGER, -- total duration
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  watched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, media_item_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_user      ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_media     ON watch_history(media_item_id);
CREATE INDEX IF NOT EXISTS idx_watch_updated   ON watch_history(updated_at DESC);

-- ─── READ HISTORY (manga) ────────────────────────────
CREATE TABLE IF NOT EXISTS read_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id   UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  chapter_id      UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  current_page    INTEGER NOT NULL DEFAULT 0,
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, chapter_id)
);

-- ─── FAVORITES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id   UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, media_item_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- ─── USER RATINGS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_ratings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id   UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, media_item_id)
);

-- ─── SYSTEM LOGS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level       VARCHAR(10) NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message     TEXT NOT NULL,
  context     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_level   ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs(created_at DESC);

-- ─── AUTO UPDATE updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_media_updated_at
    BEFORE UPDATE ON media_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_watch_updated_at
    BEFORE UPDATE ON watch_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;
