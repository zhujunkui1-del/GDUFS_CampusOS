-- Additive metadata only. No existing messages, runs or route payloads removed.
ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL DEFAULT '新对话';
ALTER TABLE conversations ADD COLUMN deleted_at_ms INTEGER;
UPDATE conversations SET title=COALESCE((SELECT substr(replace(content,char(10),' '),1,48) FROM conversation_messages WHERE conversation_id=conversations.id AND role='user' ORDER BY rowid LIMIT 1),'新对话');
CREATE INDEX assistant_conversation_list ON conversations(owner_key,deleted_at_ms,updated_at_ms DESC,id DESC);
CREATE TABLE assistant_conversation_routes (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES assistant_route_refs(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  PRIMARY KEY(conversation_id,route_id)
);
CREATE INDEX assistant_route_conversations ON assistant_conversation_routes(route_id,owner_key);
INSERT OR IGNORE INTO assistant_conversation_routes SELECT c.id,r.id,c.owner_key FROM conversations c JOIN assistant_route_refs r ON r.id=c.active_route_id AND r.owner_key=c.owner_key;
INSERT OR IGNORE INTO assistant_conversation_routes SELECT c.id,r.id,c.owner_key FROM conversations c JOIN conversation_messages m ON m.conversation_id=c.id JOIN json_each(m.artifacts_json) a JOIN assistant_route_refs r ON r.id=json_extract(a.value,'$.routeId') AND r.owner_key=c.owner_key WHERE json_extract(a.value,'$.kind')='route';
DROP TRIGGER assistant_conversation_capacity;
CREATE TRIGGER assistant_conversation_capacity BEFORE INSERT ON conversations WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT (CASE WHEN (SELECT count(*) FROM conversations WHERE owner_key=NEW.owner_key AND deleted_at_ms IS NULL)>=50 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END);
  SELECT (CASE WHEN (SELECT count(*) FROM conversations WHERE owner_key=NEW.owner_key)>=100 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END);
  SELECT (CASE WHEN (SELECT count(*) FROM conversations WHERE owner_key IS NOT NULL AND deleted_at_ms IS NULL)>=5000 OR (SELECT count(*) FROM conversations WHERE owner_key IS NOT NULL)>=10000 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END);
END;
CREATE TRIGGER assistant_run_live_conversation BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND owner_key=NEW.owner_key AND deleted_at_ms IS NULL AND expires_at_ms>NEW.started_at_ms) THEN RAISE(ABORT,'AGENT_CONVERSATION_GONE') END);
END;
