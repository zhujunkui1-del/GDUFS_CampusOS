-- Preserve existing challenges while extending them for pre-registration and unlink codes.
ALTER TABLE user_auth_tokens RENAME TO user_auth_tokens_v1;
CREATE TABLE user_auth_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN('register_email','verify_email','reset_password','unbind_email')),
 username_norm TEXT,
 code_hash TEXT NOT NULL CHECK(length(code_hash)=64),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 email TEXT NOT NULL CHECK(email=lower(trim(email))),
 auth_version INTEGER NOT NULL,
 email_epoch INTEGER NOT NULL,
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 used_at_ms INTEGER,
 consumption_id TEXT,
 CHECK((used_at_ms IS NULL)=(consumption_id IS NULL)),
 CHECK(expires_at_ms>created_at_ms),
 CHECK((purpose='register_email' AND user_id IS NULL AND username_norm IS NOT NULL) OR (purpose<>'register_email' AND user_id IS NOT NULL AND username_norm IS NULL))
);
INSERT INTO user_auth_tokens(token_hash,user_id,purpose,code_hash,attempts,email,auth_version,email_epoch,created_at_ms,expires_at_ms,used_at_ms,consumption_id)
 SELECT token_hash,user_id,purpose,code_hash,attempts,email,auth_version,email_epoch,created_at_ms,expires_at_ms,used_at_ms,consumption_id FROM user_auth_tokens_v1;
DROP TABLE user_auth_tokens_v1;
CREATE INDEX user_auth_token_owner ON user_auth_tokens(user_id,purpose,expires_at_ms);
CREATE INDEX user_auth_token_expiry ON user_auth_tokens(expires_at_ms);
