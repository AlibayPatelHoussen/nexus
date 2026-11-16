-- Transferts (Aperçu, admins): files sent from one device, shown at once on the account's other
-- devices; the file itself sits in TRANSFERS_DIR under its id, kept a few days.
CREATE TABLE IF NOT EXISTS transfers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  size        BIGINT NOT NULL,
  mime        TEXT,
  device      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfers_user ON transfers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_expires ON transfers(expires_at);
