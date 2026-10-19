-- Owner decision D-053: one article destination; captured, verified metadata
-- is public by default. This grants no third-party body, RAG, or event rights.
DROP TRIGGER console_contract_publish_update;
CREATE TRIGGER console_contract_publish_update BEFORE UPDATE ON knowledge_documents
WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT CASE WHEN NEW.content_revision<=0 OR NEW.input_hash IS NULL OR NEW.approved_content_revision IS NOT NEW.content_revision OR NEW.approved_input_hash IS NOT NEW.input_hash
 OR NEW.rights_scope NOT IN('metadata_only','excerpt_and_link','licensed_full_text') OR NEW.content_type='unknown'
 OR (NEW.radar_category IS NULL AND NEW.knowledge_category IS NULL)
 OR (NEW.radar_category IS NOT NULL AND NEW.knowledge_category IS NOT NULL AND (NEW.radar_category IS NOT OLD.radar_category OR NEW.knowledge_category IS NOT OLD.knowledge_category OR OLD.publication_status<>'published'))
 OR (NEW.candidate_kind='event' AND NEW.radar_category IS NULL)
 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
DROP TRIGGER console_v2_system_command_guard;
CREATE TRIGGER console_v2_system_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='system' AND NOT((system_capability='publisher' AND NEW.action IN('document.auto_publish','document.metadata_publish')) OR (system_capability='scheduler' AND NEW.action IN('job.create','job.pause')) OR (system_capability='ingestion' AND NEW.action IN('job.create','job.claim','job.commit','job.pause','job.resume','job.cancel')))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='source.auto-policy' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='human' AND role='admin' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='document.auto_publish' AND NOT EXISTS(
  SELECT 1 FROM console_admins a JOIN knowledge_documents d ON d.id=NEW.target_id JOIN knowledge_sources s ON s.id=d.source_id JOIN console_publication_policies p ON p.source_id=s.id JOIN console_content_checks c ON c.id=json_extract(NEW.details_json,'$.checkId')
  WHERE a.id=NEW.admin_id AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND s.enabled=1 AND s.operating_status='active' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL
  AND p.enabled=1 AND p.version=c.policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  AND c.outcome='pass' AND c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.document_version=d.version AND c.source_version=s.version
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.hold_reason IS NOT NULL)
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;

CREATE TRIGGER console_metadata_publication_guard BEFORE INSERT ON console_commands WHEN NEW.action='document.metadata_publish' BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM console_admins a JOIN knowledge_documents d ON d.id=NEW.target_id JOIN knowledge_sources s ON s.id=d.source_id JOIN console_content_checks c ON c.id=json_extract(NEW.details_json,'$.checkId')
  WHERE a.id=NEW.admin_id AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active'
  AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND d.candidate_kind='knowledge' AND d.rights_scope='metadata_only' AND d.content_type<>'unknown'
  AND ((d.radar_category IS NULL)<>(d.knowledge_category IS NULL))
  AND s.console_managed=1 AND s.source_type<>'user_private' AND s.enabled=1 AND s.archived_at IS NULL AND s.permission_status<>'denied'
  AND NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=s.id AND p.enabled=0)
  AND d.lifecycle_status='active' AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))
  AND c.document_id=d.id AND c.document_version=d.version AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.source_version=s.version AND c.policy_version=0 AND c.rule_version='console-metadata-v1' AND c.outcome='pass'
  AND c.control_generation=COALESCE((SELECT generation FROM console_document_controls WHERE document_id=d.id),0)
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL))
  AND (EXISTS(SELECT 1 FROM console_content_attestations p WHERE p.document_id=d.id AND p.content_revision=d.content_revision AND p.input_hash=d.input_hash)
   OR EXISTS(SELECT 1 FROM document_fetches f JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version WHERE f.document_id=d.id AND v.content_revision=d.content_revision AND v.input_hash=d.input_hash AND f.status IN(200,304) AND f.outcome IN('ok','not_modified') AND EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.last_change_origin='source_author')))
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
DROP VIEW console_public_documents;
CREATE VIEW console_public_documents AS SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private' AND s.archived_at IS NULL
 AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
 AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
 AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
 AND (d.radar_category IS NOT NULL OR d.knowledge_category IS NOT NULL)
 AND (d.candidate_kind<>'event' OR (d.radar_category IS NOT NULL AND COALESCE(json_extract(d.extracted_fields_json,'$.timeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.placeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.deadlineVerified'),0)=1 AND julianday(json_extract(d.extracted_fields_json,'$.endAt'))>julianday('now')))
 AND (d.data_domain<>'official_policy' OR s.official_status='verified_official')
 AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))
 AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL))
 AND (
  (NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=s.id AND p.enabled=0) AND s.enabled=1 AND s.permission_status<>'denied' AND d.rights_scope='metadata_only' AND d.candidate_kind='knowledge'
   AND EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.last_publication_mode='auto' AND x.auto_policy_version=0)
   AND EXISTS(SELECT 1 FROM console_content_checks c WHERE c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.policy_version=0 AND c.rule_version='console-metadata-v1' AND c.outcome='pass'))
  OR (
   (s.enabled=1 OR (s.retain_history=1 AND s.affiliation_status='confirmed')) AND s.verification_status='verified' AND s.permission_status='approved' AND s.authorization_status='approved'
   AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.last_publication_mode='auto' AND NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=d.source_id AND p.enabled=1 AND p.version=x.auto_policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND EXISTS(SELECT 1 FROM console_content_checks c WHERE c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.policy_version=p.version AND c.rule_version='console-completeness-v1' AND c.outcome='pass')))
   AND (s.governance_checked_at IS NULL OR (s.affiliation_status='confirmed' AND (s.operating_status='active' OR s.retain_history=1)))
   AND NOT EXISTS(SELECT 1 FROM source_collection_policies p WHERE p.source_id=d.source_id AND s.manual_policy_version=0 AND p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
   AND (s.manual_policy_version=0 OR s.manual_policy_expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  )
 );

DROP TRIGGER console_document_publish_guard;
CREATE TRIGGER console_document_publish_guard BEFORE UPDATE ON knowledge_documents WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT CASE WHEN NEW.review_status<>'approved' OR NEW.workflow_status<>'approved' OR NEW.lifecycle_status<>'active' OR (NEW.valid_until IS NOT NULL AND NEW.valid_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 OR NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND console_managed=1 AND enabled=1 AND ((verification_status='verified' AND permission_status='approved') OR (NEW.rights_scope='metadata_only' AND NEW.candidate_kind='knowledge' AND permission_status<>'denied' AND (EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=NEW.id AND x.last_publication_mode='auto' AND x.auto_policy_version=0) OR EXISTS(SELECT 1 FROM console_commands c WHERE c.target_id=NEW.id AND c.expected_version=OLD.version AND c.action='document.metadata_publish')))) AND archived_at IS NULL AND (NEW.data_domain<>'official_policy' OR official_status='verified_official'))
 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
 SELECT CASE WHEN NEW.candidate_kind='event' AND (COALESCE(json_extract(NEW.extracted_fields_json,'$.timeVerified'),0)<>1 OR COALESCE(json_extract(NEW.extracted_fields_json,'$.placeVerified'),0)<>1 OR json_extract(NEW.extracted_fields_json,'$.startAt') IS NULL OR NEW.campus_scope='unknown'
 OR COALESCE(json_extract(NEW.extracted_fields_json,'$.deadlineVerified'),0)<>1) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
