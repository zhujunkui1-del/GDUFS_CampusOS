-- Additive only. Preserve existing sources, documents, snapshots, quotas and jobs.
ALTER TABLE ingestion_jobs ADD COLUMN job_kind TEXT NOT NULL DEFAULT 'web' CHECK(job_kind IN('web','manual'));
ALTER TABLE knowledge_documents ADD COLUMN body_status TEXT NOT NULL DEFAULT 'unknown' CHECK(body_status IN('unknown','not_provided','partial','complete'));
-- Manual-use permission is separate from web robots observations; never invent a robots status.
ALTER TABLE knowledge_sources ADD COLUMN manual_rights_scope TEXT CHECK(manual_rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text'));
ALTER TABLE knowledge_sources ADD COLUMN manual_policy_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_sources ADD COLUMN manual_policy_expires_at_ms INTEGER;
ALTER TABLE knowledge_sources ADD COLUMN manual_policy_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(manual_policy_evidence_json));
ALTER TABLE knowledge_sources ADD COLUMN manual_policy_note TEXT;
ALTER TABLE knowledge_sources ADD COLUMN manual_policy_admin_id TEXT REFERENCES console_admins(id);
ALTER TABLE document_fetches ADD COLUMN intake_kind TEXT NOT NULL DEFAULT 'web' CHECK(intake_kind IN('web','manual'));
ALTER TABLE document_fetches ADD COLUMN body_status TEXT NOT NULL DEFAULT 'unknown' CHECK(body_status IN('unknown','not_provided','partial','complete'));
CREATE TABLE document_discoveries (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id),
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id), canonical_url TEXT NOT NULL,
 finder TEXT NOT NULL CHECK(finder IN('official_web','manual')), entry_url TEXT NOT NULL,
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 UNIQUE(source_id,canonical_url,finder,entry_url),
 FOREIGN KEY(source_id,canonical_url) REFERENCES document_origins(source_id,canonical_url)
);
CREATE INDEX discovery_document ON document_discoveries(document_id,id);
CREATE TRIGGER discovery_origin_guard BEFORE INSERT ON document_discoveries BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM document_origins o JOIN knowledge_documents d ON d.id=o.document_id WHERE o.source_id=NEW.source_id AND o.canonical_url=NEW.canonical_url AND o.document_id=NEW.document_id AND d.owner_user_id IS NULL AND d.data_domain<>'user_private') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
CREATE TABLE manual_import_items (
 job_id TEXT NOT NULL REFERENCES ingestion_jobs(id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 1),
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id) DEFERRABLE INITIALLY DEFERRED,
 expected_document_version INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN('created','updated','unchanged')),
 PRIMARY KEY(job_id,ordinal)
);
CREATE TRIGGER manual_item_guard BEFORE INSERT ON manual_import_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.job_id AND job_kind='manual' AND version=0) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.expected_document_version=0 AND EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.expected_document_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN ingestion_jobs j ON j.source_id=d.source_id WHERE j.id=NEW.job_id AND d.id=NEW.document_id AND d.version=NEW.expected_document_version AND d.owner_user_id IS NULL AND d.data_domain<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE INDEX manual_import_budget ON console_commands(created_at) WHERE action='manual.import';
CREATE TRIGGER manual_import_guard BEFORE INSERT ON console_commands WHEN NEW.action='manual.import' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.version=json_extract(NEW.details_json,'$.sourceVersion') AND s.console_managed=1 AND s.source_type<>'user_private' AND s.enabled=1 AND s.verification_status='verified' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN (SELECT CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_version ELSE COALESCE(p.version,0) END FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id)<>json_extract(NEW.details_json,'$.policyVersion') OR EXISTS(SELECT 1 FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id AND CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_expires_at_ms ELSE COALESCE(p.expires_at_ms,9223372036854775807) END<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN (SELECT count(*) FROM console_commands WHERE action='manual.import' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=20 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
END;
CREATE TRIGGER manual_policy_grant_guard BEFORE INSERT ON console_commands WHEN NEW.action='source.import-policy' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND status='active' AND role='admin') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id AND enabled=1 AND verification_status='verified' AND permission_status='approved' AND authorization_status='approved' AND archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
CREATE TRIGGER manual_policy_invalidate AFTER UPDATE OF manual_rights_scope,manual_policy_version,manual_policy_expires_at_ms ON knowledge_sources WHEN NEW.console_managed=1 BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) SELECT id,version,'manual_policy_changed' FROM knowledge_documents WHERE source_id=NEW.id AND owner_user_id IS NULL AND data_domain<>'user_private';
END;
CREATE TRIGGER source_identity_expires_intake AFTER UPDATE OF website_url,wechat_id,organization,channel_type ON knowledge_sources WHEN NEW.console_managed=1 BEGIN
 UPDATE knowledge_sources SET manual_policy_expires_at_ms=0,manual_policy_version=manual_policy_version+1 WHERE id=NEW.id AND manual_policy_version>0;
 UPDATE source_collection_policies SET expires_at_ms=0,version=version+1 WHERE source_id=NEW.id;
END;
ALTER TABLE extraction_evidence ADD COLUMN start_offset INTEGER CHECK(start_offset IS NULL OR start_offset>=0);
ALTER TABLE extraction_evidence ADD COLUMN end_offset INTEGER CHECK(end_offset IS NULL OR end_offset>start_offset);
ALTER TABLE extraction_evidence ADD COLUMN date_value TEXT;
ALTER TABLE extraction_evidence ADD COLUMN time_value TEXT;
ALTER TABLE extraction_evidence ADD COLUMN precision TEXT NOT NULL DEFAULT 'unknown' CHECK(precision IN('unknown','date','exact_time'));
ALTER TABLE extraction_evidence ADD COLUMN inferred INTEGER NOT NULL DEFAULT 0 CHECK(inferred IN(0,1));
ALTER TABLE extraction_evidence ADD COLUMN content_revision INTEGER;
ALTER TABLE extraction_evidence ADD COLUMN input_hash TEXT;
CREATE INDEX time_evidence_document ON extraction_evidence(document_id,content_revision,snapshot_version);
CREATE INDEX public_content_page ON knowledge_documents(publication_status,review_status,lifecycle_status,updated_at DESC,id) WHERE owner_user_id IS NULL AND data_domain<>'user_private';
CREATE TRIGGER time_evidence_revision_guard BEFORE INSERT ON extraction_evidence WHEN NEW.content_revision IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_content_versions WHERE document_id=NEW.document_id AND version=NEW.snapshot_version AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
