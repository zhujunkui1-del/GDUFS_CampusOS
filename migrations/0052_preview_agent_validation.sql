-- Server-owned Preview validation flag. Old/Production writers default to normal limits.
ALTER TABLE agent_runs ADD COLUMN validation_unlimited INTEGER NOT NULL DEFAULT 0 CHECK(validation_unlimited IN (0,1));
DROP TRIGGER assistant_run_limits;
CREATE TRIGGER assistant_run_limits BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_runs WHERE owner_key=NEW.owner_key AND status='running' AND lease_until_ms>NEW.started_at_ms) THEN RAISE(ABORT,'AGENT_BUSY') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE status='running' AND lease_until_ms>NEW.started_at_ms)>=CASE WHEN NEW.validation_unlimited=1 THEN 16 ELSE 4 END THEN RAISE(ABORT,'AGENT_SITE_BUSY') END;
END;
CREATE TRIGGER assistant_run_usage_limits BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL AND NEW.validation_unlimited=0 BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE owner_key=NEW.owner_key AND started_at_ms>NEW.started_at_ms-3600000)>=CASE WHEN NEW.is_user=1 THEN 60 ELSE 20 END THEN RAISE(ABORT,'AGENT_QUOTA') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE owner_key=NEW.owner_key AND started_at_ms>NEW.started_at_ms-86400000)>=CASE WHEN NEW.is_user=1 THEN 120 ELSE 30 END THEN RAISE(ABORT,'AGENT_QUOTA') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE started_at_ms>NEW.started_at_ms-86400000)>=200 THEN RAISE(ABORT,'AGENT_SITE_QUOTA') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE ip_key=NEW.ip_key AND started_at_ms>NEW.started_at_ms-3600000)>=120 THEN RAISE(ABORT,'AGENT_IP_QUOTA') END;
  SELECT CASE WHEN COALESCE((SELECT sum(charged_tokens) FROM agent_runs WHERE owner_key=NEW.owner_key AND started_at_ms>NEW.started_at_ms-86400000),0)+NEW.charged_tokens>CASE WHEN NEW.is_user=1 THEN 2000000 ELSE 600000 END THEN RAISE(ABORT,'AGENT_TOKEN_QUOTA') END;
  SELECT CASE WHEN COALESCE((SELECT sum(charged_tokens) FROM agent_runs WHERE started_at_ms>NEW.started_at_ms-86400000),0)+NEW.charged_tokens>5000000 THEN RAISE(ABORT,'AGENT_SITE_TOKEN_QUOTA') END;
END;
