-- Observation/proof children of existing jobs/documents, not another article store.
CREATE TABLE console_manual_links (
 job_id TEXT NOT NULL,ordinal INTEGER NOT NULL,document_id TEXT NOT NULL REFERENCES knowledge_documents(id),document_version INTEGER NOT NULL,canonical_url TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,ordinal),FOREIGN KEY(job_id,ordinal) REFERENCES manual_import_items(job_id,ordinal) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE console_intake_skips (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ingestion_jobs(id),source_id TEXT NOT NULL REFERENCES knowledge_sources(id),document_id TEXT REFERENCES knowledge_documents(id),canonical_url TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN('cutoff','tombstone')),published_at TEXT,observed_at TEXT NOT NULL
);
CREATE INDEX console_skip_job ON console_intake_skips(job_id,reason);
CREATE INDEX console_skip_source_url ON console_intake_skips(source_id,canonical_url);
DROP TRIGGER manual_item_guard;
CREATE TRIGGER manual_item_guard BEFORE INSERT ON manual_import_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.job_id AND job_kind='manual' AND version=0) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.expected_document_version=0 AND EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.expected_document_version>0 AND NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN ingestion_jobs j ON j.id=NEW.job_id WHERE d.id=NEW.document_id AND d.version=NEW.expected_document_version AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND (j.source_id=d.source_id OR EXISTS(SELECT 1 FROM console_manual_links l WHERE l.job_id=NEW.job_id AND l.ordinal=NEW.ordinal AND l.document_id=d.id AND l.document_version=d.version AND l.canonical_url=d.url))) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.outcome='unchanged' AND EXISTS(SELECT 1 FROM knowledge_documents d JOIN ingestion_jobs j ON j.id=NEW.job_id CROSS JOIN console_engine_settings e WHERE d.id=NEW.document_id AND e.earliest_import_day IS NOT NULL AND (d.published_at IS NULL OR (CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)<e.earliest_import_day)
 AND NOT(j.source_id=d.source_id AND d.lifecycle_status='active' AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))) AND NOT EXISTS(SELECT 1 FROM console_history_exempt WHERE id=d.id) AND NOT EXISTS(SELECT 1 FROM console_protections p WHERE p.target_type='source' AND p.target_id=j.source_id AND p.active=1 AND p.history_exempt=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))) THEN RAISE(ABORT,'CONSOLE_RETENTION_CUTOFF') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_cleanup_tombstones WHERE document_id=NEW.document_id AND released_at IS NULL) OR EXISTS(SELECT 1 FROM console_document_controls WHERE document_id=NEW.document_id AND hold_reason='retention') OR EXISTS(SELECT 1 FROM console_cleanup_items WHERE document_id=NEW.document_id AND stage IN('marked','versions','payloads','chunks')) THEN RAISE(ABORT,'CONSOLE_RETENTION_TOMBSTONE') END;
END;
CREATE TRIGGER console_manual_link_guard BEFORE INSERT ON console_manual_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN ingestion_jobs j ON j.id=NEW.job_id WHERE d.id=NEW.document_id AND d.version=NEW.document_version AND d.url=NEW.canonical_url AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND j.version=0 AND j.job_kind='manual') THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
CREATE TRIGGER console_operator_document_scope BEFORE INSERT ON console_commands WHEN NEW.target_type='document' AND json_extract(NEW.details_json,'$.v2')=1 AND EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='human' AND role='operator') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN console_source_scopes p ON p.source_id=d.source_id WHERE d.id=NEW.target_id AND p.admin_id=NEW.admin_id) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
-- Continuing maintenance of an existing valid same-source URL is not a new import.
-- Restored/withdrawn/expired/tombstoned documents still require explicit exemption.
DROP TRIGGER console_v2_import_cutoff_update;
CREATE TRIGGER console_v2_import_cutoff_update BEFORE UPDATE ON knowledge_documents WHEN NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' AND (NEW.input_hash IS NOT OLD.input_hash OR NEW.published_at IS NOT OLD.published_at OR NEW.url IS NOT OLD.url) AND NOT(NEW.input_hash IS NULL AND NEW.body='内容已清理' AND NEW.summary='' AND EXISTS(SELECT 1 FROM console_cleanup_guards g JOIN console_commands c ON c.id=g.command_id WHERE g.document_id=NEW.id AND g.document_version=OLD.version AND c.action='retention.purge')) BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_cleanup_items WHERE document_id=NEW.id AND stage IN('marked','versions','payloads','chunks')) OR EXISTS(SELECT 1 FROM console_document_controls WHERE document_id=NEW.id AND hold_reason='retention') OR EXISTS(SELECT 1 FROM console_cleanup_tombstones WHERE (document_id=NEW.id OR canonical_url=NEW.url) AND released_at IS NULL) THEN RAISE(ABORT,'CONSOLE_RETENTION_TOMBSTONE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_engine_settings WHERE earliest_import_day IS NOT NULL AND (NEW.published_at IS NULL OR (CASE WHEN length(NEW.published_at)=10 THEN NEW.published_at ELSE date(NEW.published_at,'+8 hours') END)<earliest_import_day)) AND NOT EXISTS(SELECT 1 FROM console_history_exempt WHERE id=NEW.id) AND NOT(NEW.source_id=OLD.source_id AND NEW.url=OLD.url AND OLD.lifecycle_status='active' AND (OLD.valid_until IS NULL OR julianday(OLD.valid_until)>julianday('now'))) THEN RAISE(ABORT,'CONSOLE_RETENTION_CUTOFF') END;
END;
