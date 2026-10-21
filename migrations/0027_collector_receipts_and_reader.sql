-- D-056: cursor pagination and compact receipt lookups; no content rewrites.
CREATE INDEX campus_reader_order ON knowledge_documents(publication_status,published_at DESC,id);
CREATE INDEX campus_collector_receipt_document ON campus_collector_receipts(document_id,created_at);
DROP TRIGGER campus_collector_receipt_guard;
CREATE TRIGGER campus_collector_receipt_guard BEFORE INSERT ON campus_collector_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM campus_collector_tokens t JOIN console_admins a ON a.id=t.admin_id
  JOIN campus_collector_sources p ON p.source_id=NEW.source_id JOIN console_admins owner ON owner.id=p.approved_by
  JOIN knowledge_sources s ON s.id=p.source_id,json_each(t.source_ids_json) scope
  WHERE t.id=NEW.token_id AND t.revoked_at IS NULL AND t.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  AND a.principal_type='human' AND a.role='admin' AND a.status='active' AND scope.value=NEW.source_id AND p.enabled=1
  AND owner.principal_type='human' AND owner.role='admin' AND owner.status='active'
  AND s.console_managed=1 AND s.enabled=1 AND s.archived_at IS NULL AND s.permission_status<>'denied'
  AND s.channel_type IN('wechat_subscription','wechat_service')
 ) THEN RAISE(ABORT,'COLLECTOR_CREDENTIAL_OR_SOURCE_REVOKED') END;
END;
