ALTER TABLE console_engine_settings ADD COLUMN scheduler_lease_token TEXT;
CREATE TABLE console_runner_tokens (
 id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,source_ids_json TEXT NOT NULL CHECK(json_valid(source_ids_json)),
 expires_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER,admin_id TEXT NOT NULL REFERENCES console_admins(id),created_at TEXT NOT NULL,last_seen_at TEXT
);
CREATE TRIGGER console_runner_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN NEW.action LIKE 'runner.%' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='admin' AND principal_type='human' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.admin_id='sys-console-runner' AND NOT EXISTS(SELECT 1 FROM console_runner_tokens t,json_each(t.source_ids_json) scope WHERE t.id=json_extract(NEW.details_json,'$.runnerId') AND t.revoked_at_ms IS NULL AND t.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND scope.value=NEW.source_id) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='job.claim' AND 2*(SELECT count(*)+1 FROM console_commands WHERE action='job.claim' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>(SELECT network_budget FROM console_engine_settings WHERE id='console-v2-settings') THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.admin_id='sys-console-scheduler' AND (json_extract(NEW.details_json,'$.schedulerLease') IS NULL OR NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE scheduler_lease_token=json_extract(NEW.details_json,'$.schedulerLease') AND scheduler_lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
DROP TRIGGER ingestion_command_guard;
CREATE TRIGGER ingestion_command_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s JOIN source_collection_policies p ON p.source_id=s.id
 WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.channel_type='official_web' AND s.source_type='official_web'
 AND s.enabled=1 AND s.verification_status='verified' AND s.official_status='verified_official' AND s.permission_status='approved' AND s.authorization_status='approved'
 AND s.archived_at IS NULL AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='job.create' AND (NEW.expected_version<>0 OR EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.create' AND (SELECT count(*) FROM ingestion_jobs WHERE job_kind='web' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=10 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action IN('job.claim','job.commit') AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id JOIN source_collection_policies p ON p.source_id=s.id
 WHERE j.id=NEW.target_id AND j.control_state='active' AND j.status IN('queued','running') AND s.version=j.source_version AND p.version=j.policy_version AND p.rule_version=j.rule_version)
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND next_run_after_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND ((SELECT request_count FROM ingestion_jobs WHERE id=NEW.target_id)>18 OR (SELECT COALESCE(sum(request_count),0) FROM ingestion_jobs WHERE created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>18) THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

CREATE TABLE console_source_scopes (admin_id TEXT NOT NULL REFERENCES console_admins(id),source_id TEXT NOT NULL REFERENCES knowledge_sources(id),granted_by TEXT NOT NULL REFERENCES console_admins(id),created_at TEXT NOT NULL,PRIMARY KEY(admin_id,source_id));
CREATE TRIGGER console_operator_scope_guard BEFORE INSERT ON console_commands WHEN json_extract(NEW.details_json,'$.v2')=1 BEGIN
 SELECT CASE WHEN (NEW.action='source.operator-scope') AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='admin' AND principal_type='human') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='operator' AND principal_type='human') AND NOT EXISTS(SELECT 1 FROM console_source_scopes WHERE admin_id=NEW.admin_id AND source_id=COALESCE(NEW.source_id,CASE WHEN NEW.target_type='source' THEN NEW.target_id END,(SELECT source_id FROM knowledge_documents WHERE id=NEW.target_id))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
CREATE TRIGGER console_auto_usage_fresh_guard BEFORE INSERT ON console_commands WHEN NEW.action='document.auto_publish' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE d.id=NEW.target_id AND ((s.manual_policy_version>0 AND s.manual_policy_expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) OR (s.manual_policy_version=0 AND p.source_id IS NOT NULL AND p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;

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
 AND (d.candidate_kind<>'event' OR (COALESCE(json_extract(d.extracted_fields_json,'$.timeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.placeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.deadlineVerified'),0)=1 AND julianday(json_extract(d.extracted_fields_json,'$.endAt'))>julianday('now'))) AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR (x.last_publication_mode='auto' AND NOT EXISTS(SELECT 1 FROM console_publication_policies p WHERE p.source_id=d.source_id AND p.enabled=1 AND p.version=x.auto_policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))
 AND (s.governance_checked_at IS NULL OR (s.affiliation_status='confirmed' AND (s.operating_status='active' OR s.retain_history=1)));

DROP TRIGGER console_v2_system_command_guard;
CREATE TRIGGER console_v2_system_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='system' AND NOT((system_capability='publisher' AND NEW.action='document.auto_publish') OR (system_capability='scheduler' AND NEW.action IN('job.create','job.pause')) OR (system_capability='ingestion' AND NEW.action IN('job.create','job.claim','job.commit','job.pause','job.resume','job.cancel')))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
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
CREATE TRIGGER console_scheduler_pause_guard BEFORE INSERT ON console_commands WHEN NEW.admin_id='sys-console-scheduler' AND NEW.action='job.pause' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE j.id=NEW.target_id AND (j.source_version<>s.version OR j.policy_version<>p.version OR p.source_id IS NULL OR p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR s.enabled=0 OR s.affiliation_status<>'confirmed' OR s.operating_status<>'active' OR s.permission_status<>'approved')) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
