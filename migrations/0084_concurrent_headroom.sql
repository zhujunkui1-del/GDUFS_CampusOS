-- 现场并发：把全站同时进行的助手运行上限抬高，避免上百人同时提问时被拦。
-- 原值：验证环境 16、普通环境 4。活动场景下 16 个槽位在平均 5 秒的回复时长
-- 下只能吞吐约 3 次/秒，突发人流会大量收到「当前同时使用人数较多」。
-- 同一会话仍然只允许一条运行，这条正确性约束不变。
DROP TRIGGER assistant_run_limits;
CREATE TRIGGER assistant_run_limits BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_runs WHERE conversation_id=NEW.conversation_id AND execution_lane=NEW.execution_lane AND status='running' AND lease_until_ms>NEW.started_at_ms) THEN RAISE(ABORT,'AGENT_BUSY') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE status='running' AND lease_until_ms>NEW.started_at_ms)>=CASE WHEN NEW.validation_unlimited=1 THEN 64 ELSE 24 END THEN RAISE(ABORT,'AGENT_SITE_BUSY') END;
END;
