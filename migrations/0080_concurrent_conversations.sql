-- 单个账户可在多个会话/多台设备上并行提问。
-- 原触发器按 owner_key 限制同一时间只能有一条 running 记录，导致同账号
-- 第二个会话直接收到“上一条回复仍在进行”。现改为按会话限制：同一会话
-- 仍不允许两条并行回复（前端停止/流式追踪以会话为单位），跨会话放开。
DROP TRIGGER assistant_run_limits;
CREATE TRIGGER assistant_run_limits BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_runs WHERE conversation_id=NEW.conversation_id AND execution_lane=NEW.execution_lane AND status='running' AND lease_until_ms>NEW.started_at_ms) THEN RAISE(ABORT,'AGENT_BUSY') END;
  SELECT CASE WHEN (SELECT count(*) FROM agent_runs WHERE status='running' AND lease_until_ms>NEW.started_at_ms)>=CASE WHEN NEW.validation_unlimited=1 THEN 16 ELSE 4 END THEN RAISE(ABORT,'AGENT_SITE_BUSY') END;
END;
CREATE INDEX IF NOT EXISTS agent_runs_lane_conversation_status ON agent_runs(conversation_id,execution_lane,status);
