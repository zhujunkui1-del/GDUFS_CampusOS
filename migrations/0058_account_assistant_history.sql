-- Preserve account-owned history; visitor cookies and their 48h retention remain independent.
ALTER TABLE conversations ADD COLUMN retention TEXT NOT NULL DEFAULT 'guest' CHECK(retention IN('guest','account'));
UPDATE conversations SET retention='account',expires_at_ms=NULL WHERE user_id IS NOT NULL AND owner_key='u:'||user_id AND deleted_at_ms IS NULL;
CREATE INDEX assistant_run_retention ON agent_runs(is_user,started_at_ms);
CREATE INDEX assistant_conversation_retention ON conversations(retention,expires_at_ms);
CREATE INDEX assistant_conversation_recent ON conversations(owner_key,updated_at_ms DESC,id DESC);
ALTER TABLE conversation_messages ADD COLUMN sequence INTEGER;
UPDATE conversation_messages SET sequence=rowid;
CREATE UNIQUE INDEX assistant_message_sequence ON conversation_messages(conversation_id,sequence);
CREATE TRIGGER assistant_message_sequence_insert AFTER INSERT ON conversation_messages WHEN NEW.sequence IS NULL BEGIN
 UPDATE conversation_messages SET sequence=COALESCE((SELECT max(sequence) FROM conversation_messages WHERE conversation_id=NEW.conversation_id),0)+1 WHERE id=NEW.id;
END;
DROP TRIGGER assistant_run_live_conversation;
CREATE TRIGGER assistant_run_live_conversation BEFORE INSERT ON agent_runs WHEN NEW.owner_key IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND owner_key=NEW.owner_key AND deleted_at_ms IS NULL AND (retention='account' OR expires_at_ms>NEW.started_at_ms)) THEN RAISE(ABORT,'AGENT_CONVERSATION_GONE') END;
END;
DROP TRIGGER assistant_conversation_capacity;
CREATE TRIGGER assistant_conversation_capacity BEFORE INSERT ON conversations WHEN NEW.owner_key IS NOT NULL AND NEW.retention='guest' BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM conversations WHERE owner_key=NEW.owner_key AND deleted_at_ms IS NULL)>=50 OR (SELECT count(*) FROM conversations WHERE owner_key=NEW.owner_key)>=100 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END;
 SELECT CASE WHEN (SELECT count(*) FROM conversations WHERE retention='guest' AND owner_key IS NOT NULL AND deleted_at_ms IS NULL)>=5000 OR (SELECT count(*) FROM conversations WHERE retention='guest' AND owner_key IS NOT NULL)>=10000 THEN RAISE(ABORT,'AGENT_CONVERSATION_CAPACITY') END;
END;
