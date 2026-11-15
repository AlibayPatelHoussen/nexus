-- Accounts, connected devices and the sign-in journal.
--
-- users.session_version: part of every token. Changing the password (or « Déconnecter tous
--   les appareils ») increases it: every other session of the account stops at once.
-- users.expires_at: an account opened for a limited time (« 1 an »); NULL = no limit.
-- refresh_tokens = the account's sessions, one per device that signed in: which device
--   (« iPhone · Safari »), where from (IP, approximate place given by Cloudflare), last use.
-- login_events: every sign-in, successful or refused (wrong password, unknown name,
--   expired account), kept 180 days.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent   VARCHAR(400);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device       VARCHAR(80);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip           VARCHAR(64);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS location     VARCHAR(160);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS login_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(255) NOT NULL,
  success     BOOLEAN NOT NULL,
  reason      VARCHAR(10) NOT NULL CHECK (reason IN ('ok', 'password', 'unknown', 'expired')),
  new_device  BOOLEAN NOT NULL DEFAULT FALSE,
  device      VARCHAR(80),
  user_agent  VARCHAR(400),
  ip          VARCHAR(64),
  location    VARCHAR(160),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_user    ON login_events(user_id, created_at DESC);

-- A device's notifications belong to the account signed in on it: they end with its session
-- (sign-out, « Déconnecter », password change) and never reach the next account on that device.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES refresh_tokens(id) ON DELETE CASCADE;
