-- Add username/password identities to the existing stable user and session entities.
-- Legacy phone identities, Console identities, conversations and content remain intact.
CREATE TABLE user_password_identities (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 username TEXT NOT NULL CHECK(length(username) BETWEEN 3 AND 24 AND username NOT GLOB '*[^A-Za-z0-9_]*'),
 username_norm TEXT NOT NULL UNIQUE CHECK(username_norm=lower(username) AND username_norm NOT IN('admin','administrator','system','root','support','moderator','campusos','api','console','null','undefined')),
 password_hash TEXT NOT NULL,
 verified_email TEXT UNIQUE CHECK(verified_email IS NULL OR verified_email=lower(trim(verified_email))),
 email_verified_at_ms INTEGER,
 pending_email TEXT CHECK(pending_email IS NULL OR pending_email=lower(trim(pending_email))),
 auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>0),
 email_epoch INTEGER NOT NULL DEFAULT 0 CHECK(email_epoch>=0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 mutation_id TEXT NOT NULL,
 username_changed_at_ms INTEGER NOT NULL DEFAULT 0,
 updated_at_ms INTEGER NOT NULL,
 CHECK((verified_email IS NULL)=(email_verified_at_ms IS NULL))
);
ALTER TABLE login_sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE login_sessions ADD COLUMN last_seen_at_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX user_session_expiry ON login_sessions(expires_at);
CREATE TABLE user_auth_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN('verify_email','reset_password')),
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
 CHECK(expires_at_ms>created_at_ms)
);
CREATE INDEX user_auth_token_owner ON user_auth_tokens(user_id,purpose,expires_at_ms);
CREATE INDEX user_auth_token_expiry ON user_auth_tokens(expires_at_ms);
CREATE TABLE user_auth_rate_windows (
 key TEXT PRIMARY KEY,
 hits INTEGER NOT NULL CHECK(hits>0),
 expires_at_ms INTEGER NOT NULL
);
CREATE INDEX user_auth_rate_expiry ON user_auth_rate_windows(expires_at_ms);
CREATE TABLE user_auth_events (
 id TEXT PRIMARY KEY,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN('register','login','login_failed','logout','username_changed','password_changed','password_reset','email_requested','email_verified','email_unbound')),
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX user_auth_event_owner ON user_auth_events(user_id,created_at_ms);
CREATE INDEX user_auth_event_expiry ON user_auth_events(created_at_ms);
CREATE TRIGGER user_password_identity_role BEFORE INSERT ON user_password_identities BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='user' AND status='active') THEN RAISE(ABORT,'USER_ACCOUNT_ROLE') END;
END;
CREATE TRIGGER user_account_disabled AFTER UPDATE OF status,role ON users WHEN NEW.status<>'active' OR NEW.role<>OLD.role BEGIN
 UPDATE login_sessions SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id=NEW.id;
 UPDATE user_password_identities SET auth_version=auth_version+1,email_epoch=email_epoch+1 WHERE user_id=NEW.id;
END;
