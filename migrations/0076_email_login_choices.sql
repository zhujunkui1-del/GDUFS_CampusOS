CREATE TABLE user_email_login_choices (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 proof_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 proof_email_epoch INTEGER NOT NULL,
 options_json TEXT NOT NULL CHECK(json_valid(options_json)),
 expires_at_ms INTEGER NOT NULL
);
CREATE INDEX user_email_login_choices_expiry ON user_email_login_choices(expires_at_ms);
