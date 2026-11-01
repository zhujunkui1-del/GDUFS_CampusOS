-- Personal model credentials are scoped to one account and never exposed back
-- to the client. Exactly one active configuration is kept per user.
CREATE TABLE IF NOT EXISTS user_model_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  secret_cipher TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('connected', 'failed')),
  last_error TEXT,
  tested_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_model_settings_updated_idx
  ON user_model_settings(updated_at_ms);
