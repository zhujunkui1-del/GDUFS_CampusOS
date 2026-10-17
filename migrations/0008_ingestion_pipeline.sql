-- Bounded local-runner pipeline; no background cloud scheduler or user data changes.
CREATE TABLE source_collection_policies (
 source_id TEXT PRIMARY KEY REFERENCES knowledge_sources(id), rule_version TEXT NOT NULL,
 rights_scope TEXT NOT NULL CHECK(rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text')),
 evidence_urls_json TEXT NOT NULL CHECK(json_valid(evidence_urls_json)), note TEXT NOT NULL,
 robots_status INTEGER NOT NULL CHECK(robots_status IN(200,404)), robots_hash TEXT,
 expires_at_ms INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 approved_by TEXT NOT NULL REFERENCES console_admins(id), updated_at TEXT NOT NULL
);
ALTER TABLE ingestion_jobs ADD COLUMN control_state TEXT NOT NULL DEFAULT 'active' CHECK(control_state IN('active','paused','cancelled'));
ALTER TABLE ingestion_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'discover' CHECK(phase IN('discover','fetch','complete'));
ALTER TABLE ingestion_jobs ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json) AND length(checkpoint_json)<=16384);
ALTER TABLE ingestion_jobs ADD COLUMN run_key TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN rule_version TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN source_version INTEGER;
ALTER TABLE ingestion_jobs ADD COLUMN policy_version INTEGER;
ALTER TABLE ingestion_jobs ADD COLUMN lease_hash TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN lease_fence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN lease_until_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN next_run_after_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN byte_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN updated_at TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN max_articles INTEGER NOT NULL DEFAULT 1 CHECK(max_articles BETWEEN 1 AND 2);
CREATE UNIQUE INDEX ingestion_run_key ON ingestion_jobs(run_key) WHERE run_key IS NOT NULL;
CREATE TABLE ingestion_job_steps (
 job_id TEXT NOT NULL REFERENCES ingestion_jobs(id), step_key TEXT NOT NULL, url TEXT NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN('discover','fetch')), outcome TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
 bytes INTEGER NOT NULL, document_id TEXT REFERENCES knowledge_documents(id) DEFERRABLE INITIALLY DEFERRED, expected_document_version INTEGER, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,step_key)
);
CREATE TABLE document_origins (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id), document_id TEXT NOT NULL REFERENCES knowledge_documents(id),
 canonical_url TEXT NOT NULL, entry_url TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 etag TEXT, last_modified TEXT, input_fingerprint TEXT, duplicate_of TEXT REFERENCES knowledge_documents(id),
 UNIQUE(source_id,canonical_url)
);
CREATE TABLE document_fetches (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ingestion_jobs(id), source_id TEXT NOT NULL REFERENCES knowledge_sources(id),
 document_id TEXT REFERENCES knowledge_documents(id), snapshot_version INTEGER,
 url TEXT NOT NULL, checked_at TEXT NOT NULL, status INTEGER, outcome TEXT NOT NULL,
 bytes INTEGER NOT NULL, etag TEXT, last_modified TEXT, body_hash TEXT, published_raw TEXT,
 FOREIGN KEY(document_id,snapshot_version) REFERENCES console_content_versions(document_id,version)
);
CREATE TABLE document_attachments (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL, snapshot_version INTEGER NOT NULL,
 url TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT, rights_status TEXT NOT NULL DEFAULT 'unknown',
 FOREIGN KEY(document_id,snapshot_version) REFERENCES console_content_versions(document_id,version)
);
CREATE TABLE event_candidates (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL, snapshot_version INTEGER NOT NULL, content_revision INTEGER NOT NULL,
 input_hash TEXT NOT NULL, extractor_version TEXT NOT NULL, ordinal INTEGER NOT NULL,
 title TEXT NOT NULL, organizer TEXT, starts_at TEXT, ends_at TEXT, registration_deadline TEXT,
 registration_url TEXT, raw_place_name TEXT, campus_scope TEXT NOT NULL DEFAULT 'unknown',
 audience TEXT, change_status TEXT NOT NULL DEFAULT 'unknown', verification_status TEXT NOT NULL DEFAULT 'pending',
 UNIQUE(document_id,content_revision,extractor_version,ordinal),
 FOREIGN KEY(document_id,snapshot_version) REFERENCES console_content_versions(document_id,version)
);
CREATE TABLE extraction_evidence (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL, snapshot_version INTEGER NOT NULL,
 candidate_id TEXT REFERENCES event_candidates(id), field_name TEXT NOT NULL, raw_span TEXT NOT NULL,
 confidence REAL NOT NULL CHECK(confidence>=0 AND confidence<=1), extractor_version TEXT NOT NULL,
 verification_status TEXT NOT NULL DEFAULT 'pending',
 FOREIGN KEY(document_id,snapshot_version) REFERENCES console_content_versions(document_id,version)
);
CREATE INDEX ingestion_source_time ON ingestion_jobs(source_id,created_at);
CREATE INDEX document_origin_document ON document_origins(document_id);
CREATE INDEX fetch_job_time ON document_fetches(job_id,checked_at);
CREATE INDEX event_candidates_document ON event_candidates(document_id,content_revision);
ALTER TABLE knowledge_chunks ADD COLUMN snapshot_version INTEGER;
ALTER TABLE knowledge_chunks ADD COLUMN content_revision INTEGER;
ALTER TABLE knowledge_chunks ADD COLUMN input_hash TEXT;
CREATE TRIGGER ingestion_chunk_version BEFORE INSERT ON knowledge_chunks WHEN NEW.snapshot_version IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_content_versions WHERE document_id=NEW.document_id AND version=NEW.snapshot_version AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TRIGGER ingestion_document_guard BEFORE INSERT ON ingestion_job_steps WHEN NEW.expected_document_version IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.expected_document_version=0 AND EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.expected_document_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN ingestion_jobs j ON j.source_id=d.source_id WHERE d.id=NEW.document_id AND d.version=NEW.expected_document_version AND j.id=NEW.job_id AND d.owner_user_id IS NULL AND d.data_domain<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TRIGGER ingestion_command_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s JOIN source_collection_policies p ON p.source_id=s.id
 WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.channel_type='official_web' AND s.source_type='official_web'
 AND s.enabled=1 AND s.verification_status='verified' AND s.official_status='verified_official' AND s.permission_status='approved' AND s.authorization_status='approved'
 AND s.archived_at IS NULL AND p.expires_at_ms>CAST(strftime('%s','now') AS INTEGER)*1000)
 THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='job.create' AND (NEW.expected_version<>0 OR EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.create' AND (SELECT count(*) FROM ingestion_jobs WHERE created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=10 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action IN('job.claim','job.commit') AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id JOIN source_collection_policies p ON p.source_id=s.id
 WHERE j.id=NEW.target_id AND j.control_state='active' AND j.status IN('queued','running') AND s.version=j.source_version AND p.version=j.policy_version AND p.rule_version=j.rule_version)
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms<=CAST(strftime('%s','now') AS INTEGER)*1000 AND next_run_after_ms<=CAST(strftime('%s','now') AS INTEGER)*1000)
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND ((SELECT request_count FROM ingestion_jobs WHERE id=NEW.target_id)>18 OR (SELECT COALESCE(sum(request_count),0) FROM ingestion_jobs WHERE created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>18) THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST(strftime('%s','now') AS INTEGER)*1000) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST(strftime('%s','now') AS INTEGER)*1000 AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
-- Existing command guard is replaced only to admit audited job creation and running cancellation.
DROP TRIGGER console_command_guard;
CREATE TRIGGER console_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.session_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM console_sessions WHERE token_hash=NEW.session_hash AND admin_id=NEW.admin_id AND revoked_at_ms IS NULL AND expires_at_ms>CAST(strftime('%s','now') AS INTEGER)*1000) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action NOT IN('document.review') AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)='reviewer' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action IN('document.publish','document.withdraw','admin.revoke') AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)<>'admin' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.target_type='source' AND NEW.expected_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id AND version=NEW.expected_version AND console_managed=1 AND source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.expected_version=0 AND NEW.target_type='source' AND EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.target_type='document' AND NEW.expected_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=NEW.target_id AND d.version=NEW.expected_version AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND console_managed=1 AND source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.target_type='job' AND NEW.action<>'job.create' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=NEW.target_id AND j.version=NEW.expected_version AND s.console_managed=1 AND s.source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.cancel' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND status IN('queued','running','failed') AND phase<>'complete') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.target_type='admin' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
