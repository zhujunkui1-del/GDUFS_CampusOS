-- A failed or previously paused run may leave sync_state='blocked'. An
-- explicitly requested manual official-web run must remain runnable; scheduled
-- runs keep the blocked-source guard.
DROP TRIGGER console_blocked_source_job_guard;
CREATE TRIGGER console_blocked_source_job_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND sync_state='blocked')
  AND NOT (
   (NEW.action='job.create' AND COALESCE(json_extract(NEW.details_json,'$.manualOverride'),0)=1 AND EXISTS(
    SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
   ))
   OR (NEW.action IN('job.claim','job.commit') AND EXISTS(
    SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=NEW.target_id AND j.run_key LIKE 'manual:%'
      AND j.source_id=NEW.source_id AND s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
   ))
  ) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
