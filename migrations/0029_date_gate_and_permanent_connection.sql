-- D-059: a reviewed date gate, metadata-only cleanup receipts and revocable connections.
ALTER TABLE console_cleanup_plans ADD COLUMN mode TEXT NOT NULL DEFAULT 'legacy' CHECK(mode IN('legacy','date_gate'));
ALTER TABLE console_cleanup_plans ADD COLUMN previous_cutoff TEXT;
ALTER TABLE console_cleanup_plans ADD COLUMN settings_version INTEGER;
ALTER TABLE console_cleanup_plans ADD COLUMN gate_cancelled_at TEXT;
ALTER TABLE console_cleanup_items ADD COLUMN saved_title TEXT;
ALTER TABLE console_cleanup_items ADD COLUMN saved_published_at TEXT;
ALTER TABLE console_cleanup_items ADD COLUMN saved_source_id TEXT;
ALTER TABLE console_cleanup_items ADD COLUMN saved_source_name TEXT;
ALTER TABLE console_cleanup_items ADD COLUMN saved_url TEXT;
UPDATE console_cleanup_items SET saved_title=(SELECT title FROM knowledge_documents WHERE id=document_id),saved_published_at=(SELECT published_at FROM knowledge_documents WHERE id=document_id),saved_source_id=(SELECT source_id FROM knowledge_documents WHERE id=document_id),saved_source_name=(SELECT s.display_name FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=document_id),saved_url=(SELECT url FROM knowledge_documents WHERE id=document_id);

DROP TRIGGER console_cleanup_atomic_guard;
CREATE TRIGGER console_cleanup_atomic_guard BEFORE INSERT ON console_cleanup_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_cleanup_plans plan ON plan.id=NEW.plan_id JOIN console_commands cmd ON cmd.id=NEW.command_id
 WHERE d.id=NEW.document_id AND d.version=NEW.document_version AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'
 AND (CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)<NEW.cutoff
 AND ((plan.mode='date_gate' AND plan.confirmed_at IS NOT NULL AND plan.gate_cancelled_at IS NULL AND plan.state='purging' AND json_extract(plan.filters_json,'$.cutoff')=NEW.cutoff AND cmd.action='retention.purge' AND cmd.target_id=plan.id AND EXISTS(SELECT 1 FROM console_cleanup_items i WHERE i.plan_id=plan.id AND i.document_id=d.id AND i.document_version=d.version AND i.classification='candidate' AND i.stage='preview'))
 OR (plan.mode='legacy' AND (d.lifecycle_status<>'active' OR julianday(d.valid_until)<=julianday('now')) AND NOT EXISTS(SELECT 1 FROM user_favorites WHERE target_type='document' AND target_id=d.id) AND NOT EXISTS(SELECT 1 FROM event_sources WHERE document_id=d.id) AND NOT EXISTS(SELECT 1 FROM knowledge_facts WHERE document_id=d.id) AND NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE superseded_by=d.id)))
 AND NOT EXISTS(SELECT 1 FROM console_protections p WHERE p.active=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND ((p.target_type='document' AND p.target_id=d.id) OR (p.target_type='source' AND (p.target_id=d.source_id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=p.target_id)))))) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

-- Zero means no scheduled expiry; revocation, administrator and source checks remain.
DROP TRIGGER campus_collector_receipt_guard;
CREATE TRIGGER campus_collector_receipt_guard BEFORE INSERT ON campus_collector_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM campus_collector_tokens t JOIN console_admins a ON a.id=t.admin_id
  JOIN campus_collector_sources p ON p.source_id=NEW.source_id JOIN console_admins owner ON owner.id=p.approved_by
  JOIN knowledge_sources s ON s.id=p.source_id,json_each(t.source_ids_json) scope
  WHERE t.id=NEW.token_id AND t.revoked_at IS NULL AND (t.expires_at_ms=0 OR t.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  AND a.principal_type='human' AND a.role='admin' AND a.status='active' AND scope.value=NEW.source_id AND p.enabled=1
  AND owner.principal_type='human' AND owner.role='admin' AND owner.status='active'
  AND s.console_managed=1 AND s.enabled=1 AND s.archived_at IS NULL AND s.permission_status<>'denied'
  AND s.channel_type IN('wechat_subscription','wechat_service')
 ) THEN RAISE(ABORT,'COLLECTOR_CREDENTIAL_OR_SOURCE_REVOKED') END;
END;
