-- Preserve all content; only tighten current public eligibility.
DROP VIEW console_public_documents;
CREATE VIEW console_public_documents AS SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'
 AND (s.enabled=1 OR (s.retain_history=1 AND s.affiliation_status='confirmed')) AND s.archived_at IS NULL AND s.verification_status='verified' AND s.permission_status='approved'
 AND s.authorization_status='approved'
 AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
 AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
 AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
 AND ((d.candidate_kind='knowledge' AND d.knowledge_category IS NOT NULL) OR (d.candidate_kind='event' AND d.radar_category IS NOT NULL))
 AND (d.data_domain<>'official_policy' OR s.official_status='verified_official')
 AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))
 AND (d.candidate_kind<>'event' OR (COALESCE(json_extract(d.extracted_fields_json,'$.timeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.placeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.deadlineVerified'),0)=1 AND julianday(json_extract(d.extracted_fields_json,'$.endAt'))>julianday('now'))) AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR (x.last_publication_mode='auto' AND NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=d.source_id AND p.enabled=1 AND p.version=x.auto_policy_version AND EXISTS(SELECT 1 FROM console_content_checks proof WHERE proof.document_id=d.id AND proof.content_revision=d.content_revision AND proof.input_hash=d.input_hash AND proof.policy_version=p.version AND proof.outcome='pass' AND proof.rule_version='console-completeness-v1') AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))
 AND (s.governance_checked_at IS NULL OR (s.affiliation_status='confirmed' AND (s.operating_status='active' OR s.retain_history=1))) AND NOT EXISTS(SELECT 1 FROM source_collection_policies use_policy WHERE use_policy.source_id=d.source_id AND s.manual_policy_version=0 AND use_policy.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 AND (s.manual_policy_version=0 OR s.manual_policy_expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));

CREATE TRIGGER console_blocked_source_job_guard BEFORE INSERT ON console_commands WHEN NEW.action='job.create' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND sync_state='blocked') THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
