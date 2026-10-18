ALTER TABLE console_admins ADD COLUMN principal_type TEXT NOT NULL DEFAULT 'human' CHECK(principal_type IN('human','system'));
ALTER TABLE console_admins ADD COLUMN system_capability TEXT CHECK(system_capability IN('publisher','scheduler','ingestion'));
INSERT INTO console_admins(id,email,role,principal_type,system_capability) VALUES
 ('sys-console-publisher','publisher@system.invalid','operator','system','publisher'),
 ('sys-console-scheduler','scheduler@system.invalid','operator','system','scheduler'),
 ('sys-console-runner','ingestion@system.invalid','operator','system','ingestion');
CREATE TABLE console_publication_policies (
 source_id TEXT PRIMARY KEY REFERENCES knowledge_sources(id),version INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 rights_scope TEXT NOT NULL CHECK(rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text')),
 default_knowledge_category TEXT CHECK(default_knowledge_category IN('academic_affairs','campus_life','administrative_services','scholarship_policy','education_career','research_innovation')),
 unknown_date_strategy TEXT NOT NULL DEFAULT 'review' CHECK(unknown_date_strategy IN('review','metadata_unknown')),allow_unofficial INTEGER NOT NULL DEFAULT 0 CHECK(allow_unofficial IN(0,1)),
 expires_at_ms INTEGER NOT NULL,evidence_urls_json TEXT NOT NULL CHECK(json_valid(evidence_urls_json)),note TEXT NOT NULL,approved_by TEXT NOT NULL REFERENCES console_admins(id),updated_at TEXT NOT NULL
);
CREATE TABLE console_document_controls (
 document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id),generation INTEGER NOT NULL DEFAULT 1,
 hold_reason TEXT CHECK(hold_reason IN('manual_withdrawal','cancelled','retention')),hold_at TEXT,
 last_change_origin TEXT NOT NULL DEFAULT 'legacy',last_publication_mode TEXT NOT NULL DEFAULT 'manual' CHECK(last_publication_mode IN('manual','auto')),
 auto_policy_version INTEGER,auto_content_revision INTEGER,auto_input_hash TEXT,last_overridden_fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(last_overridden_fields_json))
);
-- Existing withdrawals remain withdrawals; do not auto-publish legacy articles.
INSERT INTO console_document_controls(document_id,hold_reason,hold_at) SELECT id,'manual_withdrawal',updated_at FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND (publication_status='withdrawn' OR lifecycle_status='withdrawn');
CREATE TABLE console_content_attestations (
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id),content_revision INTEGER NOT NULL,input_hash TEXT NOT NULL,admin_id TEXT NOT NULL REFERENCES console_admins(id),
 evidence_urls_json TEXT NOT NULL CHECK(json_valid(evidence_urls_json)),created_at TEXT NOT NULL,PRIMARY KEY(document_id,content_revision,input_hash)
);
CREATE TRIGGER console_attestation_guard BEFORE INSERT ON console_content_attestations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='admin' AND principal_type='human' AND status='active') OR NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id AND owner_user_id IS NULL AND data_domain<>'user_private' AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
CREATE TABLE console_content_checks (
 id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES knowledge_documents(id),document_version INTEGER NOT NULL,content_revision INTEGER NOT NULL,input_hash TEXT NOT NULL,
 source_version INTEGER NOT NULL,policy_version INTEGER NOT NULL,control_generation INTEGER NOT NULL DEFAULT 0,rule_version TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN('pass','review','blocked')),severity TEXT NOT NULL CHECK(severity IN('warning','error')),
 issues_json TEXT NOT NULL CHECK(json_valid(issues_json)),fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 created_at TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES console_admins(id),UNIQUE(document_id,content_revision,input_hash,source_version,policy_version,control_generation,rule_version)
);
CREATE INDEX console_checks_queue ON console_content_checks(outcome,created_at DESC,document_id);
CREATE INDEX console_checks_document ON console_content_checks(document_id,content_revision,created_at DESC);
CREATE TRIGGER console_check_guard BEFORE INSERT ON console_content_checks BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.created_by AND principal_type='system' AND system_capability='publisher' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=NEW.document_id AND d.version=NEW.document_version AND d.content_revision=NEW.content_revision AND d.input_hash=NEW.input_hash AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.version=NEW.source_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TABLE console_auto_publications (
 command_id TEXT PRIMARY KEY REFERENCES console_commands(id),document_id TEXT NOT NULL REFERENCES knowledge_documents(id),publication_version INTEGER NOT NULL,
 check_id TEXT NOT NULL REFERENCES console_content_checks(id),policy_version INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX console_auto_publication_time ON console_auto_publications(created_at,document_id);
CREATE TABLE console_revision_payloads (
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id),content_revision INTEGER NOT NULL,input_hash TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),created_at TEXT NOT NULL,PRIMARY KEY(document_id,content_revision)
);
CREATE TRIGGER console_version_payload BEFORE INSERT ON console_content_versions WHEN json_extract(NEW.snapshot_json,'$.inputRef') IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id AND owner_user_id IS NULL AND data_domain<>'user_private' AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 INSERT OR IGNORE INTO console_revision_payloads(document_id,content_revision,input_hash,input_json,created_at)
 SELECT id,content_revision,input_hash,json_object('sourceId',source_id,'title',title,'url',url,'body',body,'bodyStatus',body_status,'kind',candidate_kind,'campusScope',campus_scope,'validUntil',valid_until,'publishedAt',published_at,'sourceUpdatedAt',source_updated_at,'contentType',content_type,'rightsScope',rights_scope,'radarCategory',radar_category,'knowledgeCategory',knowledge_category,'publisher',publisher,'summary',summary,'tags',json((SELECT json_group_array(tag) FROM document_tags WHERE document_id=knowledge_documents.id AND content_revision=knowledge_documents.content_revision)),'extractedFields',json(extracted_fields_json)),NEW.created_at FROM knowledge_documents WHERE id=NEW.document_id;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_revision_payloads WHERE document_id=NEW.document_id AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TRIGGER console_v2_system_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='system' AND NOT((system_capability='publisher' AND NEW.action='document.auto_publish') OR (system_capability='scheduler' AND NEW.action='job.create') OR (system_capability='ingestion' AND NEW.action IN('job.create','job.claim','job.commit','job.pause','job.resume','job.cancel')))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='source.auto-policy' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='human' AND role='admin' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='document.auto_publish' AND NOT EXISTS(
  SELECT 1 FROM console_admins a JOIN knowledge_documents d ON d.id=NEW.target_id JOIN knowledge_sources s ON s.id=d.source_id JOIN console_publication_policies p ON p.source_id=s.id JOIN console_content_checks c ON c.id=json_extract(NEW.details_json,'$.checkId')
  WHERE a.id=NEW.admin_id AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND s.enabled=1 AND s.affiliation_status='confirmed' AND s.operating_status='active' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL
  AND p.enabled=1 AND p.version=c.policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  AND c.outcome='pass' AND c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.document_version=d.version AND c.source_version=s.version
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.hold_reason IS NOT NULL)
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
CREATE TRIGGER console_system_no_human_session BEFORE INSERT ON console_sessions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='system') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
CREATE TRIGGER console_auto_policy_invalidate AFTER UPDATE ON console_publication_policies BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) SELECT id,version,'auto_policy_changed' FROM knowledge_documents WHERE source_id=NEW.source_id AND owner_user_id IS NULL AND data_domain<>'user_private';
END;
CREATE TRIGGER console_hold_invalidate AFTER UPDATE OF hold_reason,generation ON console_document_controls BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) SELECT id,version,'document_control_changed' FROM knowledge_documents WHERE id=NEW.document_id;
END;

DROP VIEW console_public_documents;
CREATE VIEW console_public_documents AS SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'
 AND s.enabled=1 AND s.archived_at IS NULL AND s.verification_status='verified' AND s.permission_status='approved'
 AND s.authorization_status='approved'
 AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
 AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
 AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
 AND ((d.candidate_kind='knowledge' AND d.knowledge_category IS NOT NULL) OR (d.candidate_kind='event' AND d.radar_category IS NOT NULL))
 AND (d.data_domain<>'official_policy' OR s.official_status='verified_official')
 AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))
 AND (d.candidate_kind<>'event' OR (COALESCE(json_extract(d.extracted_fields_json,'$.timeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.placeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.deadlineVerified'),0)=1 AND julianday(json_extract(d.extracted_fields_json,'$.endAt'))>julianday('now'))) AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR (x.last_publication_mode='auto' AND NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=d.source_id AND p.enabled=1 AND p.version=x.auto_policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))
 AND (s.governance_checked_at IS NULL OR (s.affiliation_status='confirmed' AND s.operating_status='active'));
