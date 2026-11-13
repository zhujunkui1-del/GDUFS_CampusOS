-- Two budgets were reintroduced by 0065/0066 while copying the old guard body:
-- a cap of ten created jobs per day and a cap of nine claims per day (each
-- step is a claim, so that is a couple of minutes of crawling). Both had been
-- removed on purpose; a full sweep of ninety sites needs thousands of claims.
-- The expiry of a policy still stops a scheduled run, because that is the
-- statement the operator actually made, but review labels never do.
DROP TRIGGER IF EXISTS ingestion_command_guard;
CREATE TRIGGER ingestion_command_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id
 WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.channel_type='official_web' AND s.source_type='official_web'
 AND s.enabled=1 AND s.archived_at IS NULL AND s.operating_status<>'closed' AND s.sync_state<>'blocked'
 AND (p.source_id IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
   OR EXISTS(SELECT 1 FROM ingestion_jobs j WHERE j.id=NEW.target_id AND j.run_key LIKE 'manual:%')))
 THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='job.create' AND (NEW.expected_version<>0 OR EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action IN('job.claim','job.commit') AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id
 WHERE j.id=NEW.target_id AND j.control_state='active' AND j.status IN('queued','running') AND s.version=j.source_version
 AND (j.policy_version=0 OR (p.version=j.policy_version AND p.rule_version=j.rule_version)))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND next_run_after_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
