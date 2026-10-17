-- Additive source governance. Preserve legacy identity/permission/enabled values.
ALTER TABLE knowledge_sources ADD COLUMN affiliation_status TEXT NOT NULL DEFAULT 'unknown' CHECK(affiliation_status IN('unknown','confirmed','unrelated'));
ALTER TABLE knowledge_sources ADD COLUMN operating_status TEXT NOT NULL DEFAULT 'unknown' CHECK(operating_status IN('unknown','active','paused','closed','unreachable'));
ALTER TABLE knowledge_sources ADD COLUMN affiliation_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(affiliation_evidence_json));
ALTER TABLE knowledge_sources ADD COLUMN operating_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(operating_evidence_json));
ALTER TABLE knowledge_sources ADD COLUMN governance_note TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_sources ADD COLUMN governance_checked_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN mini_program_id TEXT;
ALTER TABLE knowledge_sources ADD COLUMN source_note TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_sources ADD COLUMN sync_hours_override INTEGER CHECK(sync_hours_override IN(1,3,6,12,24));
ALTER TABLE knowledge_sources ADD COLUMN next_sync_at_ms INTEGER;
ALTER TABLE knowledge_sources ADD COLUMN sync_policy_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_sources ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'not_configured' CHECK(sync_state IN('not_configured','ready','queued','running','completed','failed','blocked','offline'));
ALTER TABLE knowledge_sources ADD COLUMN retain_history INTEGER NOT NULL DEFAULT 1 CHECK(retain_history IN(0,1));
CREATE INDEX console_source_governance ON knowledge_sources(console_managed,affiliation_status,operating_status,enabled,id);
CREATE INDEX console_source_due ON knowledge_sources(next_sync_at_ms,id) WHERE console_managed=1 AND enabled=1;
CREATE UNIQUE INDEX console_source_program_identity ON knowledge_sources(channel_type,mini_program_id) WHERE mini_program_id IS NOT NULL AND length(mini_program_id)>0 AND archived_at IS NULL;
CREATE INDEX console_documents_source_time ON knowledge_documents(source_id,updated_at DESC,id);
CREATE TABLE console_engine_settings (
 id TEXT PRIMARY KEY CHECK(id='console-v2-settings'),version INTEGER NOT NULL DEFAULT 1,
 sync_hours INTEGER NOT NULL DEFAULT 24 CHECK(sync_hours IN(1,3,6,12,24)),auto_sync_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_sync_enabled IN(0,1)),
 network_budget INTEGER NOT NULL DEFAULT 20 CHECK(network_budget BETWEEN 2 AND 20),sync_revision INTEGER NOT NULL DEFAULT 1,
 earliest_import_day TEXT CHECK(earliest_import_day IS NULL OR earliest_import_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 scheduler_last_at TEXT,scheduler_result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scheduler_result_json)),scheduler_lease_until_ms INTEGER NOT NULL DEFAULT 0,
 runner_last_at TEXT,last_cleanup_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(last_cleanup_json)),updated_at TEXT
);
INSERT INTO console_engine_settings(id) VALUES('console-v2-settings');
CREATE TABLE console_storage_samples (
 id TEXT PRIMARY KEY,measured_at TEXT NOT NULL,provider TEXT NOT NULL CHECK(provider IN('cloudflare_api','local_sqlite')),
 bytes INTEGER NOT NULL CHECK(bytes>=0),rows_read INTEGER,rows_written INTEGER
);
CREATE INDEX console_storage_time ON console_storage_samples(measured_at DESC,id);
-- Legacy direct-DAO callers retain their existing contract. V2 HTTP writes
-- always carry v2=1 and cannot enable a source without the two confirmations.
DROP TRIGGER console_source_enable_guard;
CREATE TRIGGER console_source_enable_guard BEFORE UPDATE ON knowledge_sources WHEN NEW.console_managed=1 AND NEW.enabled=1 BEGIN
 SELECT CASE WHEN NEW.archived_at IS NOT NULL OR (NEW.governance_checked_at IS NULL AND (NEW.verification_status<>'verified' OR NEW.permission_status NOT IN('approved','entry_only'))) OR (NEW.governance_checked_at IS NOT NULL AND (NEW.affiliation_status<>'confirmed' OR NEW.operating_status<>'active')) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
CREATE TRIGGER console_v2_source_invalidate AFTER UPDATE OF affiliation_status,operating_status,retain_history ON knowledge_sources WHEN NEW.console_managed=1 BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) SELECT d.id,d.version,'source_governance_changed' FROM knowledge_documents d WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND (d.source_id=NEW.id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=NEW.id));
END;
CREATE TRIGGER console_v2_command_guard BEFORE INSERT ON console_commands WHEN json_extract(NEW.details_json,'$.v2')=1 BEGIN
 SELECT CASE WHEN NEW.action='engine.settings' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)<>'admin' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='engine.settings' AND NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='source.enable' AND json_extract(NEW.details_json,'$.enabled')=1 AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id AND affiliation_status='confirmed' AND operating_status='active' AND governance_checked_at IS NOT NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action IN('job.create','job.claim','job.commit','manual.import','document.publish') AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=COALESCE(NEW.source_id,(SELECT source_id FROM knowledge_documents WHERE id=NEW.target_id)) AND affiliation_status='confirmed' AND operating_status='active' AND governance_checked_at IS NOT NULL AND enabled=1 AND archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='document.review' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id) NOT IN('admin','reviewer') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;

-- Extend the existing command dispatcher for the singleton versioned engine control.
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
 SELECT CASE WHEN NEW.target_type='job' AND NEW.action<>'job.create' AND NEW.target_id<>'console-v2-settings' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=NEW.target_id AND j.version=NEW.expected_version AND s.console_managed=1 AND s.source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.cancel' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND status IN('queued','running','failed') AND phase<>'complete') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.target_type='admin' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
