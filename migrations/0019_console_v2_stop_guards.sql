-- Forward-only guard repair; no source/content/job data updates.
DROP TRIGGER console_blocked_source_job_guard;
CREATE TRIGGER console_blocked_source_job_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND sync_state='blocked') THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
CREATE TRIGGER console_scheduled_pause_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.claim','job.commit') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM ingestion_jobs j CROSS JOIN console_engine_settings e WHERE j.id=NEW.target_id AND j.run_key LIKE 'scheduled:%' AND e.auto_sync_enabled=0) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
