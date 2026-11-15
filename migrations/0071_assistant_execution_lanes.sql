ALTER TABLE agent_runs ADD COLUMN execution_lane TEXT NOT NULL DEFAULT 'assistant' CHECK(execution_lane IN ('assistant','workflow'));
DROP TRIGGER assistant_run_limits;
CREATE TRIGGER assistant_run_limits BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_runs WHERE owner_key=NEW.owner_key AND execution_lane=NEW.execution_lane AND status='running' AND lease_until_ms>NEW.started_at_ms) THEN RAISE(ABORT,'AGENT_BUSY') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE status='running' AND lease_until_ms>NEW.started_at_ms)>=CASE WHEN NEW.validation_unlimited=1 THEN 16 ELSE 4 END THEN RAISE(ABORT,'AGENT_SITE_BUSY') END;
END;
CREATE INDEX agent_runs_lane_conversation ON agent_runs(conversation_id,execution_lane);
