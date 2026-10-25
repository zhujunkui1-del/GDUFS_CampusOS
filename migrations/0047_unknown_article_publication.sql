-- Classification uncertainty does not revoke an otherwise valid publication.
-- Every existing permission, withdrawal, expiry and source predicate is retained.
DROP VIEW console_legacy_public_documents;
CREATE VIEW console_legacy_public_documents AS SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private' AND s.archived_at IS NULL
 AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
 AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
 AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
 AND (d.radar_category IS NOT NULL OR d.knowledge_category IS NOT NULL OR EXISTS(SELECT 1 FROM document_article_analysis a WHERE a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash AND a.primary_destination='unknown'))
 AND (d.candidate_kind<>'event' OR (d.radar_category IS NOT NULL AND COALESCE(json_extract(d.extracted_fields_json,'$.timeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.placeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.deadlineVerified'),0)=1 AND julianday(json_extract(d.extracted_fields_json,'$.endAt'))>julianday('now')))
 AND (d.data_domain<>'official_policy' OR s.official_status='verified_official')
 AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now') OR (d.rights_scope='metadata_only' AND d.candidate_kind='knowledge' AND EXISTS(SELECT 1 FROM console_commands m JOIN console_admins a ON a.id=m.admin_id WHERE m.target_id=d.id AND m.target_type='document' AND m.action IN('document.publish','document.classify') AND a.principal_type='human' AND json_extract(m.details_json,'$.manualRevision')=d.content_revision AND json_extract(m.details_json,'$.manualInputHash')=d.input_hash)))
 AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL))
 AND (
  (s.enabled=1 AND s.permission_status<>'denied' AND (d.rights_scope='metadata_only' AND d.candidate_kind='knowledge' AND EXISTS(SELECT 1 FROM console_commands m JOIN console_admins a ON a.id=m.admin_id WHERE m.target_id=d.id AND m.target_type='document' AND m.action IN('document.publish','document.classify') AND a.principal_type='human' AND json_extract(m.details_json,'$.manualRevision')=d.content_revision AND json_extract(m.details_json,'$.manualInputHash')=d.input_hash)) AND EXISTS(SELECT 1 FROM console_document_controls c WHERE c.document_id=d.id AND c.last_publication_mode='manual'))
  OR (NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=s.id AND p.enabled=0) AND s.enabled=1 AND s.permission_status<>'denied' AND d.rights_scope='metadata_only' AND d.candidate_kind='knowledge'
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
