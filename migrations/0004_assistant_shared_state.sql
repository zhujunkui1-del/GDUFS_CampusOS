-- Shared assistant state; geographical source data remains in the fixed local snapshot.
CREATE TABLE assistant_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX assistant_sessions_expiry ON assistant_sessions(expires_at_ms);
ALTER TABLE conversations ADD COLUMN owner_key TEXT;
ALTER TABLE conversations ADD COLUMN expires_at_ms INTEGER;
ALTER TABLE conversations ADD COLUMN updated_at_ms INTEGER;
ALTER TABLE conversations ADD COLUMN selected_place_id TEXT;
ALTER TABLE conversations ADD COLUMN active_route_id TEXT;
CREATE INDEX assistant_conversation_owner ON conversations(owner_key,updated_at_ms);
ALTER TABLE conversation_messages ADD COLUMN artifacts_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(artifacts_json));
ALTER TABLE agent_runs ADD COLUMN owner_key TEXT;
ALTER TABLE agent_runs ADD COLUMN request_id TEXT;
ALTER TABLE agent_runs ADD COLUMN ip_key TEXT;
ALTER TABLE agent_runs ADD COLUMN is_user INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN started_at_ms INTEGER;
ALTER TABLE agent_runs ADD COLUMN lease_until_ms INTEGER;
ALTER TABLE agent_runs ADD COLUMN finished_at_ms INTEGER;
ALTER TABLE agent_runs ADD COLUMN error_code TEXT;
ALTER TABLE agent_runs ADD COLUMN usage_json TEXT;
ALTER TABLE agent_runs ADD COLUMN charged_tokens INTEGER NOT NULL DEFAULT 250000;
CREATE UNIQUE INDEX assistant_request_once ON agent_runs(owner_key,request_id);
CREATE INDEX assistant_run_quota ON agent_runs(owner_key,started_at_ms);
CREATE INDEX assistant_run_global ON agent_runs(started_at_ms,status,lease_until_ms);
-- One atomic INSERT reserves identity, concurrency, request and token budgets together.
CREATE TRIGGER assistant_run_limits BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_runs WHERE owner_key=NEW.owner_key AND status='running' AND lease_until_ms>NEW.started_at_ms) THEN RAISE(ABORT,'AGENT_BUSY') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE status='running' AND lease_until_ms>NEW.started_at_ms)>=4 THEN RAISE(ABORT,'AGENT_SITE_BUSY') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE owner_key=NEW.owner_key AND started_at_ms>NEW.started_at_ms-3600000)>=CASE WHEN NEW.is_user=1 THEN 60 ELSE 20 END THEN RAISE(ABORT,'AGENT_QUOTA') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE owner_key=NEW.owner_key AND started_at_ms>NEW.started_at_ms-86400000)>=CASE WHEN NEW.is_user=1 THEN 120 ELSE 30 END THEN RAISE(ABORT,'AGENT_QUOTA') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE started_at_ms>NEW.started_at_ms-86400000)>=200 THEN RAISE(ABORT,'AGENT_SITE_QUOTA') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE ip_key=NEW.ip_key AND started_at_ms>NEW.started_at_ms-3600000)>=120 THEN RAISE(ABORT,'AGENT_IP_QUOTA') END;
  SELECT CASE WHEN COALESCE((SELECT sum(charged_tokens) FROM agent_runs WHERE owner_key=NEW.owner_key AND started_at_ms>NEW.started_at_ms-86400000),0)+NEW.charged_tokens>CASE WHEN NEW.is_user=1 THEN 2000000 ELSE 600000 END THEN RAISE(ABORT,'AGENT_TOKEN_QUOTA') END;
  SELECT CASE WHEN COALESCE((SELECT sum(charged_tokens) FROM agent_runs WHERE started_at_ms>NEW.started_at_ms-86400000),0)+NEW.charged_tokens>5000000 THEN RAISE(ABORT,'AGENT_SITE_TOKEN_QUOTA') END;
END;
CREATE TABLE assistant_route_refs (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, expires_at_ms INTEGER NOT NULL,
  map_version TEXT NOT NULL, network_version TEXT NOT NULL,
  payload_json TEXT CHECK(payload_json IS NULL OR json_valid(payload_json))
);
CREATE INDEX assistant_route_owner ON assistant_route_refs(owner_key,expires_at_ms);
CREATE TABLE assistant_actions (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actions_json TEXT NOT NULL CHECK(json_valid(actions_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','applied','failed','revoked')),
  receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
  expires_at_ms INTEGER NOT NULL
);
CREATE TABLE assistant_location_challenges (
  nonce_hash TEXT PRIMARY KEY,owner_key TEXT NOT NULL,expires_at_ms INTEGER NOT NULL
);
CREATE TRIGGER assistant_session_capacity BEFORE INSERT ON assistant_sessions BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM assistant_sessions)>=10000 THEN RAISE(ABORT,'AGENT_SESSION_CAPACITY') END;
END;
CREATE TRIGGER assistant_conversation_capacity BEFORE INSERT ON conversations WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM conversations WHERE owner_key=NEW.owner_key)>=5 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END;
  SELECT CASE WHEN (SELECT count(*) FROM conversations WHERE owner_key IS NOT NULL)>=5000 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END;
END;
CREATE TRIGGER assistant_route_capacity BEFORE INSERT ON assistant_route_refs BEGIN
  DELETE FROM assistant_route_refs WHERE id IN (SELECT id FROM assistant_route_refs WHERE owner_key=NEW.owner_key ORDER BY expires_at_ms DESC LIMIT -1 OFFSET 99);
  SELECT CASE WHEN (SELECT count(*) FROM assistant_route_refs)>=10000 THEN RAISE(ABORT,'AGENT_ROUTE_CAPACITY') END;
END;
