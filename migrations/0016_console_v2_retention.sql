CREATE TABLE console_protections (
 target_type TEXT NOT NULL CHECK(target_type IN('source','document')),target_id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN(0,1)),history_exempt INTEGER NOT NULL DEFAULT 0 CHECK(history_exempt IN(0,1)),
 reason TEXT NOT NULL,expires_at_ms INTEGER,admin_id TEXT NOT NULL REFERENCES console_admins(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(target_type,target_id)
);
CREATE INDEX console_protection_expiry ON console_protections(active,expires_at_ms,target_type,target_id);
CREATE TABLE console_cleanup_plans (
 id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,admin_id TEXT NOT NULL REFERENCES console_admins(id),
 filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),state TEXT NOT NULL CHECK(state IN('previewing','ready','marking','marked','purging','paused','complete')),
 resume_state TEXT,cursor TEXT NOT NULL DEFAULT '',scanned INTEGER NOT NULL DEFAULT 0,logical_bytes INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,confirmed_at TEXT,completed_at TEXT,last_error TEXT
);
CREATE TABLE console_cleanup_items (
 plan_id TEXT NOT NULL REFERENCES console_cleanup_plans(id),document_id TEXT NOT NULL REFERENCES knowledge_documents(id),document_version INTEGER NOT NULL,
 classification TEXT NOT NULL CHECK(classification IN('candidate','protected','valid','dependency','changed')),logical_bytes INTEGER NOT NULL DEFAULT 0,
 stage TEXT NOT NULL DEFAULT 'preview' CHECK(stage IN('preview','marked','versions','payloads','chunks','complete','blocked')),error TEXT,
 PRIMARY KEY(plan_id,document_id)
);
CREATE TABLE console_cleanup_tombstones (
 document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id),source_id TEXT NOT NULL REFERENCES knowledge_sources(id),canonical_url TEXT NOT NULL,
 content_hash TEXT NOT NULL,plan_id TEXT NOT NULL REFERENCES console_cleanup_plans(id),admin_id TEXT NOT NULL REFERENCES console_admins(id),deleted_at TEXT NOT NULL,released_at TEXT
);
CREATE INDEX console_cleanup_url ON console_cleanup_tombstones(canonical_url,released_at);
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
 SELECT CASE WHEN NEW.target_type='job' AND NEW.action<>'job.create' AND NEW.target_id<>'console-v2-settings' AND NEW.action NOT LIKE 'retention.%' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=NEW.target_id AND j.version=NEW.expected_version AND s.console_managed=1 AND s.source_type<>'user_private') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.cancel' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND status IN('queued','running','failed') AND phase<>'complete') THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.target_type='admin' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TRIGGER console_v2_cleanup_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN (NEW.action LIKE 'retention.%' OR NEW.action LIKE 'whitelist.%') AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='admin' AND principal_type='human' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action LIKE 'retention.%' AND NEW.expected_version>0 AND NOT EXISTS(SELECT 1 FROM console_cleanup_plans WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action LIKE 'retention.%' AND NEW.expected_version=0 AND EXISTS(SELECT 1 FROM console_cleanup_plans WHERE id=NEW.target_id) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE VIEW console_history_exempt AS SELECT d.id FROM knowledge_documents d WHERE EXISTS(
 SELECT 1 FROM console_protections p WHERE p.active=1 AND p.history_exempt=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 AND ((p.target_type='document' AND p.target_id=d.id) OR (p.target_type='source' AND (p.target_id=d.source_id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=p.target_id)))));
CREATE TRIGGER console_v2_import_cutoff_insert BEFORE INSERT ON knowledge_documents WHEN NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_documents d JOIN console_document_controls x ON x.document_id=d.id WHERE d.url=NEW.url AND x.hold_reason='retention') THEN RAISE(ABORT,'CONSOLE_RETENTION_PENDING') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_cleanup_tombstones WHERE canonical_url=NEW.url AND released_at IS NULL) THEN RAISE(ABORT,'CONSOLE_RETENTION_TOMBSTONE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_engine_settings WHERE earliest_import_day IS NOT NULL AND (NEW.published_at IS NULL OR (CASE WHEN length(NEW.published_at)=10 THEN NEW.published_at ELSE date(NEW.published_at,'+8 hours') END)<earliest_import_day)) AND NOT EXISTS(SELECT 1 FROM console_protections WHERE target_type='source' AND target_id=NEW.source_id AND active=1 AND history_exempt=1 AND (expires_at_ms IS NULL OR expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) THEN RAISE(ABORT,'CONSOLE_RETENTION_CUTOFF') END;
END;
CREATE TRIGGER console_v2_import_cutoff_update BEFORE UPDATE ON knowledge_documents WHEN NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' AND (NEW.input_hash IS NOT OLD.input_hash OR NEW.published_at IS NOT OLD.published_at OR NEW.url IS NOT OLD.url) AND NOT(NEW.input_hash IS NULL AND NEW.body='内容已清理' AND NEW.summary='' AND EXISTS(SELECT 1 FROM console_cleanup_guards g JOIN console_commands c ON c.id=g.command_id WHERE g.document_id=NEW.id AND g.document_version=OLD.version AND c.action='retention.purge')) BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_document_controls WHERE document_id=NEW.id AND hold_reason='retention') THEN RAISE(ABORT,'CONSOLE_RETENTION_PENDING') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_cleanup_tombstones WHERE (document_id=NEW.id OR canonical_url=NEW.url) AND released_at IS NULL) THEN RAISE(ABORT,'CONSOLE_RETENTION_TOMBSTONE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_engine_settings WHERE earliest_import_day IS NOT NULL AND (NEW.published_at IS NULL OR (CASE WHEN length(NEW.published_at)=10 THEN NEW.published_at ELSE date(NEW.published_at,'+8 hours') END)<earliest_import_day)) AND NOT EXISTS(SELECT 1 FROM console_history_exempt WHERE id=NEW.id) THEN RAISE(ABORT,'CONSOLE_RETENTION_CUTOFF') END;
END;
CREATE INDEX console_documents_retention_day ON knowledge_documents((CASE WHEN length(published_at)=10 THEN published_at ELSE date(published_at,'+8 hours') END),id) WHERE owner_user_id IS NULL AND data_domain<>'user_private';

CREATE TABLE console_cleanup_guards (plan_id TEXT NOT NULL REFERENCES console_cleanup_plans(id),document_id TEXT NOT NULL REFERENCES knowledge_documents(id),document_version INTEGER NOT NULL,cutoff TEXT NOT NULL,command_id TEXT NOT NULL,PRIMARY KEY(command_id,document_id));
CREATE TRIGGER console_cleanup_atomic_guard BEFORE INSERT ON console_cleanup_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents d WHERE d.id=NEW.document_id AND d.version=NEW.document_version AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND (CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)<NEW.cutoff AND (d.lifecycle_status<>'active' OR julianday(d.valid_until)<=julianday('now'))
 AND NOT EXISTS(SELECT 1 FROM user_favorites WHERE target_type='document' AND target_id=d.id) AND NOT EXISTS(SELECT 1 FROM event_sources WHERE document_id=d.id) AND NOT EXISTS(SELECT 1 FROM knowledge_facts WHERE document_id=d.id) AND NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE superseded_by=d.id)
 AND NOT EXISTS(SELECT 1 FROM console_protections p WHERE p.active=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND ((p.target_type='document' AND p.target_id=d.id) OR (p.target_type='source' AND (p.target_id=d.source_id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=p.target_id)))))) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
