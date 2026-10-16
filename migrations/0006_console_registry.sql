-- Additive S3-A governance only. No private data copied, tables rebuilt or rows deleted.
CREATE TABLE console_admins (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('admin','operator','reviewer')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE console_sessions (
 token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES console_admins(id), access_hash TEXT NOT NULL,
 expires_at_ms INTEGER NOT NULL, revoked_at_ms INTEGER, created_at_ms INTEGER NOT NULL
);
CREATE INDEX console_sessions_admin ON console_sessions(admin_id,expires_at_ms);
CREATE TABLE console_revoked_tokens (token_hash TEXT PRIMARY KEY, expires_at_ms INTEGER NOT NULL);
CREATE TABLE console_limits (key_hash TEXT NOT NULL, bucket INTEGER NOT NULL, requests INTEGER NOT NULL, PRIMARY KEY(key_hash,bucket));

ALTER TABLE knowledge_sources ADD COLUMN console_managed INTEGER NOT NULL DEFAULT 0 CHECK(console_managed IN(0,1));
ALTER TABLE knowledge_sources ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'manual_import' CHECK(channel_type IN('official_web','wechat_subscription','wechat_service','mini_program','enterprise_wechat','third_party_web','student_media','manual_import','login_service','embedded_app'));
ALTER TABLE knowledge_sources ADD COLUMN subtype TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_sources ADD COLUMN source_aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_aliases_json));
ALTER TABLE knowledge_sources ADD COLUMN organization TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_sources ADD COLUMN official_status TEXT NOT NULL DEFAULT 'unverified' CHECK(official_status IN('unverified','claimed_official','verified_official','unofficial'));
ALTER TABLE knowledge_sources ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'candidate' CHECK(verification_status IN('candidate','pending','verified','rejected'));
ALTER TABLE knowledge_sources ADD COLUMN campus_scope TEXT NOT NULL DEFAULT 'unknown' CHECK(campus_scope IN('university_town','baiyun','all','online','unknown'));
ALTER TABLE knowledge_sources ADD COLUMN website_url TEXT;
ALTER TABLE knowledge_sources ADD COLUMN wechat_id TEXT;
ALTER TABLE knowledge_sources ADD COLUMN canonical_locator TEXT;
ALTER TABLE knowledge_sources ADD COLUMN evidence_urls_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_urls_json));
ALTER TABLE knowledge_sources ADD COLUMN original_catalog_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(original_catalog_refs_json));
ALTER TABLE knowledge_sources ADD COLUMN catalog_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(catalog_metadata_json));
ALTER TABLE knowledge_sources ADD COLUMN catalog_hash TEXT;
ALTER TABLE knowledge_sources ADD COLUMN connector_type TEXT NOT NULL DEFAULT 'disabled' CHECK(connector_type IN('disabled','manual','official_web','wechat_link_manual','entry_only'));
ALTER TABLE knowledge_sources ADD COLUMN connector_config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(connector_config_json));
ALTER TABLE knowledge_sources ADD COLUMN permission_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(permission_status IN('unreviewed','approved','denied','entry_only'));
ALTER TABLE knowledge_sources ADD COLUMN last_success_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN last_error TEXT;
ALTER TABLE knowledge_sources ADD COLUMN priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 3);
ALTER TABLE knowledge_sources ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE knowledge_sources ADD COLUMN archived_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN created_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN updated_at TEXT;
CREATE INDEX console_sources_list ON knowledge_sources(console_managed,archived_at,verification_status,priority,id);
CREATE UNIQUE INDEX console_source_locator ON knowledge_sources(channel_type,canonical_locator) WHERE console_managed=1 AND canonical_locator IS NOT NULL;

ALTER TABLE knowledge_documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE knowledge_documents ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'draft' CHECK(publication_status IN('draft','published','withdrawn'));
ALTER TABLE knowledge_documents ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'pending' CHECK(workflow_status IN('pending','approved','returned','rejected'));
ALTER TABLE knowledge_documents ADD COLUMN candidate_kind TEXT NOT NULL DEFAULT 'knowledge' CHECK(candidate_kind IN('knowledge','event'));
ALTER TABLE knowledge_documents ADD COLUMN extracted_fields_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extracted_fields_json));
CREATE TABLE console_content_versions (
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id), version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_by TEXT REFERENCES console_admins(id), created_at TEXT NOT NULL,
 PRIMARY KEY(document_id,version)
);
-- Only public records; never materialize private student documents in Console.
INSERT INTO console_content_versions(document_id,version,snapshot_json,created_at)
 SELECT id,1,json_object('input',json_object('sourceId',source_id,'title',title,'body',body,'url',url,'kind',candidate_kind,'campusScope',campus_scope,'validUntil',valid_until,'publishedAt',published_at,'extractedFields',json(extracted_fields_json)),'publicationStatus',publication_status,'reviewStatus',workflow_status),fetched_at
 FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private';
CREATE TABLE console_content_reviews (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES knowledge_documents(id), version INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN('approved','returned','rejected','withdrawn')), admin_id TEXT NOT NULL REFERENCES console_admins(id),
 note TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE ingestion_jobs ADD COLUMN found_count INTEGER NOT NULL DEFAULT 0 CHECK(found_count>=0);
ALTER TABLE ingestion_jobs ADD COLUMN body_count INTEGER NOT NULL DEFAULT 0 CHECK(body_count>=0);
ALTER TABLE ingestion_jobs ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_count>=0);
ALTER TABLE ingestion_jobs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE console_import_batches (
 id TEXT PRIMARY KEY, manifest_hash TEXT NOT NULL UNIQUE, report_json TEXT NOT NULL CHECK(json_valid(report_json)),
 actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE console_commands (
 id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES console_admins(id), action TEXT NOT NULL,
 target_type TEXT NOT NULL CHECK(target_type IN('source','document','job','admin')), target_id TEXT NOT NULL,
 source_id TEXT REFERENCES knowledge_sources(id), expected_version INTEGER NOT NULL, request_hash TEXT NOT NULL,
 session_hash TEXT REFERENCES console_sessions(token_hash) ON DELETE SET NULL,
 details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE console_audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT, actor_label TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
 target_id TEXT NOT NULL, version INTEGER, details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX console_audit_time ON console_audit_logs(created_at,id);
CREATE TRIGGER console_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.session_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM console_sessions WHERE token_hash=NEW.session_hash AND admin_id=NEW.admin_id AND revoked_at_ms IS NULL AND expires_at_ms>CAST(strftime('%s','now') AS INTEGER)*1000) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action NOT IN('document.review') AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)='reviewer' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action IN('document.publish','document.withdraw','admin.revoke') AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)<>'admin' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.target_type='source' AND NEW.expected_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id AND version=NEW.expected_version AND console_managed=1 AND source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.expected_version=0 AND NEW.target_type='source' AND EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.target_type='document' AND NEW.expected_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=NEW.target_id AND d.version=NEW.expected_version AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND console_managed=1 AND source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.target_type='job' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=NEW.target_id AND j.version=NEW.expected_version AND s.console_managed=1 AND s.source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.cancel' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND status='queued') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.target_type='admin' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TRIGGER console_command_audit AFTER INSERT ON console_commands BEGIN
 INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id,version,details_json)
 SELECT NEW.id,id,email,NEW.action,NEW.target_type,NEW.target_id,NEW.expected_version+1,NEW.details_json FROM console_admins WHERE id=NEW.admin_id;
END;

CREATE TABLE content_index_invalidations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES knowledge_documents(id), version INTEGER NOT NULL,
 reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processed')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX console_invalidations_pending ON content_index_invalidations(state,id);
CREATE TRIGGER console_document_invalidate AFTER UPDATE OF version,publication_status,review_status,lifecycle_status,valid_until ON knowledge_documents WHEN NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) VALUES(NEW.id,NEW.version,'document_changed');
END;
CREATE TRIGGER console_source_invalidate AFTER UPDATE OF enabled,permission_status,verification_status,official_status,archived_at ON knowledge_sources WHEN NEW.console_managed=1 BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) SELECT id,version,'source_policy_changed' FROM knowledge_documents WHERE source_id=NEW.id AND owner_user_id IS NULL AND data_domain<>'user_private';
END;
CREATE TRIGGER console_source_enable_guard BEFORE UPDATE ON knowledge_sources WHEN NEW.console_managed=1 AND NEW.enabled=1 BEGIN
 SELECT CASE WHEN NEW.verification_status<>'verified' OR NEW.permission_status NOT IN('approved','entry_only') OR NEW.archived_at IS NOT NULL THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
CREATE TRIGGER console_session_live_admin BEFORE INSERT ON console_sessions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
CREATE TRIGGER console_catalog_source_audit AFTER INSERT ON knowledge_sources WHEN NEW.console_managed=1 AND NEW.catalog_hash IS NOT NULL BEGIN
 INSERT INTO console_audit_logs(id,actor_label,action,target_type,target_id,version,details_json)
 VALUES('catalog:'||NEW.id||':'||NEW.catalog_hash,COALESCE(json_extract(NEW.catalog_metadata_json,'$._importActor'),'catalog-import'),'source.import','source',NEW.id,1,json_object('catalogHash',NEW.catalog_hash));
END;
CREATE TRIGGER console_catalog_batch_audit AFTER INSERT ON console_import_batches BEGIN
 INSERT INTO console_audit_logs(id,actor_label,action,target_type,target_id,details_json)
 VALUES('import:'||NEW.id,NEW.actor,'catalog.import','catalog',NEW.id,NEW.report_json);
END;
CREATE TRIGGER console_document_publish_guard BEFORE UPDATE ON knowledge_documents WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT CASE WHEN NEW.review_status<>'approved' OR NEW.workflow_status<>'approved' OR NEW.lifecycle_status<>'active' OR (NEW.valid_until IS NOT NULL AND NEW.valid_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 OR NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND console_managed=1 AND enabled=1 AND verification_status='verified' AND permission_status='approved' AND archived_at IS NULL AND (NEW.data_domain<>'official_policy' OR official_status='verified_official'))
 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
 SELECT CASE WHEN NEW.candidate_kind='event' AND (COALESCE(json_extract(NEW.extracted_fields_json,'$.timeVerified'),0)<>1 OR COALESCE(json_extract(NEW.extracted_fields_json,'$.placeVerified'),0)<>1 OR json_extract(NEW.extracted_fields_json,'$.startAt') IS NULL OR NEW.campus_scope='unknown'
 OR COALESCE(json_extract(NEW.extracted_fields_json,'$.deadlineVerified'),0)<>1) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
CREATE VIEW console_public_documents AS SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'
 AND s.enabled=1 AND s.archived_at IS NULL AND s.verification_status='verified' AND s.permission_status='approved'
 AND d.publication_status='published' AND d.review_status='approved' AND d.lifecycle_status='active'
 AND (d.data_domain<>'official_policy' OR s.official_status='verified_official')
 AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))
 AND (d.candidate_kind<>'event' OR julianday(COALESCE(json_extract(d.extracted_fields_json,'$.endAt'),json_extract(d.extracted_fields_json,'$.startAt')))>julianday('now'));
