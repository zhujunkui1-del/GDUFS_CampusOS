-- Owner-authorized five-source run: up to 10 articles per source, at most 50 per UTC day.
-- Keep each authenticated import request at two items and preserve the cumulative ledger.
-- No quota reset, no collection/rights/ownership/CAS relaxation, no resource creation.
DROP TRIGGER manual_import_guard;
CREATE TRIGGER manual_import_guard BEFORE INSERT ON console_commands WHEN NEW.action='manual.import' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.version=json_extract(NEW.details_json,'$.sourceVersion') AND s.console_managed=1 AND s.source_type<>'user_private' AND s.enabled=1 AND ((s.verification_status='verified' AND s.permission_status='approved' AND s.authorization_status='approved') OR (COALESCE(json_extract(NEW.details_json,'$.registryMetadata'),0)=1 AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)='admin')) AND s.archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NOT (COALESCE(json_extract(NEW.details_json,'$.registryMetadata'),0)=1 AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)='admin') AND ((SELECT CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_version ELSE COALESCE(p.version,0) END FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id)<>json_extract(NEW.details_json,'$.policyVersion') OR EXISTS(SELECT 1 FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id AND CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_expires_at_ms ELSE COALESCE(p.expires_at_ms,9223372036854775807) END<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) ) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN (SELECT count(*) FROM console_commands WHERE action='manual.import' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=25 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
END;

-- Original-date public feed ordering; retain the existing fresh eligibility view.
CREATE INDEX console_public_article_time ON knowledge_documents(published_at DESC,id)
 WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND publication_status='published' AND workflow_status='approved' AND review_status='approved';
