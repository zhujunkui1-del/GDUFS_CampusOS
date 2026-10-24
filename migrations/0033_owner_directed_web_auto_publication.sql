-- Owner instruction: every successful official-web capture publishes directly.
-- Manual withdrawal remains the per-document override; WeChat remains separate.
ALTER TABLE console_engine_settings ADD COLUMN official_web_auto_publish INTEGER NOT NULL DEFAULT 1 CHECK(official_web_auto_publish IN(0,1));

CREATE TABLE console_owner_publications (
 command_id TEXT PRIMARY KEY REFERENCES console_commands(id),
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id),
 publication_version INTEGER NOT NULL,
 content_revision INTEGER NOT NULL,
 input_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(document_id,content_revision,input_hash)
);
CREATE INDEX console_owner_publications_document ON console_owner_publications(document_id,content_revision,input_hash);

DROP TRIGGER console_v2_system_command_guard;
CREATE TRIGGER console_v2_system_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='system' AND NOT((system_capability='publisher' AND NEW.action IN('document.auto_publish','document.owner_auto_publish')) OR (system_capability='scheduler' AND NEW.action='job.create') OR (system_capability='ingestion' AND NEW.action IN('job.create','job.claim','job.commit','job.pause','job.resume','job.cancel')))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='source.auto-policy' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='human' AND role='admin' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='document.auto_publish' AND NOT EXISTS(
  SELECT 1 FROM console_admins a JOIN knowledge_documents d ON d.id=NEW.target_id JOIN knowledge_sources s ON s.id=d.source_id JOIN console_publication_policies p ON p.source_id=s.id JOIN console_content_checks c ON c.id=json_extract(NEW.details_json,'$.checkId')
  WHERE a.id=NEW.admin_id AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND s.enabled=1 AND s.affiliation_status='confirmed' AND s.operating_status='active' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL
  AND p.enabled=1 AND p.version=c.policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  AND c.outcome='pass' AND c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.document_version=d.version AND c.source_version=s.version
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.hold_reason IS NOT NULL)
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
 SELECT CASE WHEN NEW.action='document.owner_auto_publish' AND NOT EXISTS(
  SELECT 1 FROM console_admins a JOIN knowledge_documents d ON d.id=NEW.target_id JOIN knowledge_sources s ON s.id=d.source_id CROSS JOIN console_engine_settings e
  WHERE a.id=NEW.admin_id AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active'
    AND NEW.target_type='document' AND NEW.source_id=s.id AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
    AND s.source_type='official_web' AND s.channel_type='official_web' AND s.console_managed=1 AND s.enabled=1 AND s.archived_at IS NULL
    AND e.id='console-v2-settings' AND e.official_web_auto_publish=1 AND d.version=NEW.expected_version AND d.input_hash IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.hold_reason IS NOT NULL)
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;

CREATE TRIGGER console_owner_publication_guard BEFORE INSERT ON console_owner_publications BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM console_commands c JOIN console_admins a ON a.id=c.admin_id JOIN knowledge_documents d ON d.id=NEW.document_id JOIN knowledge_sources s ON s.id=d.source_id CROSS JOIN console_engine_settings e
  WHERE c.id=NEW.command_id AND c.action='document.owner_auto_publish' AND c.target_type='document' AND c.target_id=d.id AND c.source_id=s.id
    AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active'
    AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
    AND e.id='console-v2-settings' AND e.official_web_auto_publish=1 AND d.version+1=NEW.publication_version
    AND d.content_revision=NEW.content_revision AND d.input_hash=NEW.input_hash
    AND json_extract(c.details_json,'$.ownerPublicationRevision')=NEW.content_revision
    AND json_extract(c.details_json,'$.ownerPublicationHash')=NEW.input_hash
    AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.hold_reason IS NOT NULL)
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;

DROP VIEW console_public_documents;
CREATE VIEW console_public_documents AS
 SELECT d.* FROM console_legacy_public_documents d
 WHERE NOT EXISTS(SELECT 1 FROM campus_collector_articles c WHERE c.document_id=d.id)
 UNION ALL
 SELECT d.* FROM knowledge_documents d
 JOIN knowledge_sources s ON s.id=d.source_id
 JOIN console_owner_publications p ON p.document_id=d.id AND p.content_revision=d.content_revision AND p.input_hash=d.input_hash
 JOIN console_document_controls x ON x.document_id=d.id AND x.last_publication_mode='auto'
 CROSS JOIN console_engine_settings e
 WHERE e.id='console-v2-settings' AND e.official_web_auto_publish=1
  AND s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
  AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
  AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
  AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
  AND ((d.radar_category IS NULL)<>(d.knowledge_category IS NULL))
  AND NOT EXISTS(SELECT 1 FROM console_document_controls h WHERE h.document_id=d.id AND (h.hold_reason IS NOT NULL OR h.review_hold IS NOT NULL))
  AND NOT EXISTS(SELECT 1 FROM campus_collector_articles c WHERE c.document_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM console_legacy_public_documents l WHERE l.id=d.id)
 UNION ALL
 SELECT d.* FROM knowledge_documents d JOIN campus_collector_articles c ON c.document_id=d.id JOIN campus_collector_sources p ON p.source_id=c.source_id JOIN knowledge_sources s ON s.id=d.source_id JOIN console_admins a ON a.id=p.approved_by
 WHERE d.source_id=c.source_id AND p.enabled=1 AND s.enabled=1 AND s.console_managed=1 AND s.archived_at IS NULL AND s.permission_status<>'denied' AND s.channel_type IN('wechat_subscription','wechat_service')
 AND a.principal_type='human' AND a.role='admin' AND a.status='active'
 AND d.owner_user_id IS NULL AND d.data_domain='approved_life_experience' AND d.publication_status='published' AND d.lifecycle_status='active' AND d.workflow_status='approved' AND d.review_status='approved'
 AND d.body_format='reading_html' AND length(d.body)>0 AND d.rights_scope='licensed_full_text' AND d.candidate_kind='knowledge' AND d.content_type<>'unknown'
 AND c.state IN('available','suspected_missing') AND c.current_hash=d.input_hash AND d.approved_input_hash=d.input_hash AND d.approved_content_revision=d.content_revision AND d.content_revision>0
 AND ((d.radar_category IS NULL)<>(d.knowledge_category IS NULL)) AND d.valid_until IS NULL
 AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL));

DROP TRIGGER console_document_publish_guard;
CREATE TRIGGER console_document_publish_guard BEFORE UPDATE ON knowledge_documents
WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private'
 AND NOT EXISTS(SELECT 1 FROM campus_collector_articles c JOIN campus_collector_sources p ON p.source_id=c.source_id JOIN knowledge_sources s ON s.id=p.source_id JOIN console_admins a ON a.id=p.approved_by WHERE c.document_id=NEW.id AND c.source_id=NEW.source_id AND c.current_hash=NEW.input_hash AND c.state IN('available','suspected_missing') AND p.enabled=1 AND s.enabled=1 AND s.console_managed=1 AND s.archived_at IS NULL AND s.permission_status<>'denied' AND s.channel_type IN('wechat_subscription','wechat_service') AND a.principal_type='human' AND a.role='admin' AND a.status='active' AND NEW.body_format='reading_html' AND NEW.rights_scope='licensed_full_text' AND NEW.candidate_kind='knowledge' AND NEW.data_domain='approved_life_experience' AND NEW.lifecycle_status='active' AND NEW.review_status='approved' AND NEW.workflow_status='approved' AND NEW.valid_until IS NULL)
 AND NOT EXISTS(SELECT 1 FROM console_owner_publications p WHERE p.document_id=NEW.id AND p.content_revision=NEW.content_revision AND p.input_hash=NEW.input_hash)
BEGIN
 SELECT CASE WHEN NEW.review_status<>'approved' OR NEW.workflow_status<>'approved' OR NEW.lifecycle_status<>'active' OR (NEW.valid_until IS NOT NULL AND NEW.valid_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (NEW.rights_scope='metadata_only' AND NEW.candidate_kind='knowledge' AND EXISTS(SELECT 1 FROM console_commands m JOIN console_admins a ON a.id=m.admin_id WHERE m.target_id=NEW.id AND m.target_type='document' AND m.action IN('document.publish','document.classify') AND a.principal_type='human' AND json_extract(m.details_json,'$.manualRevision')=NEW.content_revision AND json_extract(m.details_json,'$.manualInputHash')=NEW.input_hash AND m.expected_version=OLD.version)))
 OR NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND console_managed=1 AND enabled=1 AND ((verification_status='verified' AND permission_status='approved') OR (permission_status<>'denied' AND (NEW.rights_scope='metadata_only' AND NEW.candidate_kind='knowledge' AND EXISTS(SELECT 1 FROM console_commands m JOIN console_admins a ON a.id=m.admin_id WHERE m.target_id=NEW.id AND m.target_type='document' AND m.action IN('document.publish','document.classify') AND a.principal_type='human' AND json_extract(m.details_json,'$.manualRevision')=NEW.content_revision AND json_extract(m.details_json,'$.manualInputHash')=NEW.input_hash AND m.expected_version=OLD.version))) OR (NEW.rights_scope='metadata_only' AND NEW.candidate_kind='knowledge' AND permission_status<>'denied' AND (EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=NEW.id AND x.last_publication_mode='auto' AND x.auto_policy_version=0) OR EXISTS(SELECT 1 FROM console_commands c WHERE c.target_id=NEW.id AND c.expected_version=OLD.version AND c.action='document.metadata_publish')))) AND archived_at IS NULL AND (NEW.data_domain<>'official_policy' OR official_status='verified_official'))
 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
 SELECT CASE WHEN NEW.candidate_kind='event' AND NOT EXISTS(SELECT 1 FROM console_owner_publications p WHERE p.document_id=NEW.id AND p.content_revision=NEW.content_revision AND p.input_hash=NEW.input_hash)
  AND (COALESCE(json_extract(NEW.extracted_fields_json,'$.timeVerified'),0)<>1 OR COALESCE(json_extract(NEW.extracted_fields_json,'$.placeVerified'),0)<>1 OR json_extract(NEW.extracted_fields_json,'$.startAt') IS NULL OR NEW.campus_scope='unknown' OR COALESCE(json_extract(NEW.extracted_fields_json,'$.deadlineVerified'),0)<>1)
  THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
