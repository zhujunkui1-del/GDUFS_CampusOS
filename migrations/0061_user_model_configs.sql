-- Multiple personal model configurations per account. The active choice is
-- stored separately so deleting a config never silently falls back to platform.
CREATE TABLE IF NOT EXISTS user_model_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  secret_cipher TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'untested'
    CHECK (status IN ('untested', 'connected', 'failed', 'disabled')),
  last_error TEXT,
  tested_at_ms INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_model_configs_user_idx
  ON user_model_configs(user_id, updated_at_ms);

CREATE TABLE IF NOT EXISTS user_model_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'platform' CHECK (mode IN ('platform', 'personal')),
  active_config_id TEXT REFERENCES user_model_configs(id) ON DELETE SET NULL,
  updated_at_ms INTEGER NOT NULL
);
