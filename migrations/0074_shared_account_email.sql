-- Keep usernames unique and retain each account's verified address and state.
CREATE TABLE user_password_identities_shared_email (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 username TEXT NOT NULL CHECK(length(username) BETWEEN 3 AND 24 AND username NOT GLOB '*[^A-Za-z0-9_]*'),
 username_norm TEXT NOT NULL UNIQUE CHECK(username_norm=lower(username) AND username_norm NOT IN('admin','administrator','system','root','support','moderator','campusos','api','console','null','undefined')),
 password_hash TEXT NOT NULL,
 verified_email TEXT CHECK(verified_email IS NULL OR verified_email=lower(trim(verified_email))),
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
INSERT INTO user_password_identities_shared_email SELECT * FROM user_password_identities;

DROP TRIGGER user_account_disabled;
DROP TABLE user_password_identities;
ALTER TABLE user_password_identities_shared_email RENAME TO user_password_identities;
CREATE INDEX user_password_email ON user_password_identities(verified_email) WHERE verified_email IS NOT NULL;

CREATE TRIGGER user_password_identity_role BEFORE INSERT ON user_password_identities BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='user' AND status='active') THEN RAISE(ABORT,'USER_ACCOUNT_ROLE') END;
END;
CREATE TRIGGER user_account_disabled AFTER UPDATE OF status,role ON users WHEN NEW.status<>'active' OR NEW.role<>OLD.role BEGIN
 UPDATE login_sessions SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id=NEW.id;
 UPDATE user_password_identities SET auth_version=auth_version+1,email_epoch=email_epoch+1 WHERE user_id=NEW.id;
END;
