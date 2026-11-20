-- Platform model controls: the owner can switch the platform model chain off,
-- choose which tiers may serve traffic, and reorder them from the console.
-- Credentials stay in Worker secrets; this table only records policy.
ALTER TABLE console_engine_settings ADD COLUMN platform_model_enabled INTEGER NOT NULL DEFAULT 1 CHECK (platform_model_enabled IN (0,1));
ALTER TABLE console_engine_settings ADD COLUMN platform_models_json TEXT NOT NULL DEFAULT '{"order":["deepseek","stepfun"],"tiers":{"deepseek":true,"stepfun":true,"gdufs":false}}' CHECK (json_valid(platform_models_json));
-- One row per routing decision so the console can show which provider actually
-- served traffic, not only what the configuration says.
CREATE TABLE agent_model_events (
 id TEXT PRIMARY KEY,
 run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
 conversation_id TEXT,
 owner_key TEXT,
 event TEXT NOT NULL CHECK(event IN ('resolved','fallback','failed')),
 provider TEXT NOT NULL,
 model TEXT,
 from_provider TEXT,
 reason_code TEXT,
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX agent_model_events_created ON agent_model_events(created_at_ms,provider);
CREATE INDEX agent_model_events_run ON agent_model_events(run_id);
-- Console admins manage the platform model chain; the owner also named two
-- accounts. Enforcing the rule here keeps an audit insert from bypassing it.
CREATE TRIGGER console_platform_models_insert BEFORE INSERT ON console_commands
WHEN NEW.action='platform.models' BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM console_admins a WHERE a.id=NEW.admin_id AND a.status='active' AND (
   a.role='admin'
   OR lower(a.email)='3287390083@qq.com'
   OR lower(substr(a.email,1,instr(a.email,'@')-1))='3287390083'
  )
 ) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
