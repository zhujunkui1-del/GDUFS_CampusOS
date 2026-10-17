-- Additive guard only; preserve all existing content, snapshots and policies.
-- API edit/restore checks current usage scope, then binds source/policy versions
-- to the same atomic D1 batch, so revocation cannot race a late content write.
CREATE TRIGGER content_edit_intake_guard BEFORE INSERT ON console_commands
WHEN NEW.action IN('document.edit','document.restore') AND json_type(NEW.details_json,'$.sourceVersion') IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.version=json_extract(NEW.details_json,'$.sourceVersion') AND s.console_managed=1 AND s.source_type<>'user_private' AND s.enabled=1 AND s.verification_status='verified' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN (SELECT CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_version ELSE COALESCE(p.version,0) END FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id)<>json_extract(NEW.details_json,'$.policyVersion') OR EXISTS(SELECT 1 FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id AND CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_expires_at_ms ELSE COALESCE(p.expires_at_ms,9223372036854775807) END<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
