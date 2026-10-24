-- Extend the explicit owner-directed manual web run to configured sources whose
-- governance fields have not been maintained in CampusOS. Scheduled runs keep
-- the existing readiness checks.
DROP TRIGGER console_v2_command_guard;
CREATE TRIGGER console_v2_command_guard BEFORE INSERT ON console_commands WHEN json_extract(NEW.details_json,'$.v2')=1 BEGIN
 SELECT CASE WHEN NEW.action='engine.settings' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)<>'admin' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='engine.settings' AND NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='source.enable' AND json_extract(NEW.details_json,'$.enabled')=1 AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id AND affiliation_status='confirmed' AND operating_status='active' AND governance_checked_at IS NOT NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action IN('job.create','job.claim','job.commit','manual.import','document.publish')
  AND NOT (
   (NEW.action='job.create' AND COALESCE(json_extract(NEW.details_json,'$.manualOverride'),0)=1 AND EXISTS(
    SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
      AND json_valid(s.web_profile_json) AND json_array_length(s.web_profile_json,'$.entryUrls')>0 AND json_array_length(s.web_profile_json,'$.articlePathPrefixes')>0
   ))
   OR (NEW.action IN('job.claim','job.commit') AND EXISTS(
    SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=NEW.target_id AND j.run_key LIKE 'manual:%'
      AND j.source_id=NEW.source_id AND s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
   ))
  )
  AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=COALESCE(NEW.source_id,(SELECT source_id FROM knowledge_documents WHERE id=NEW.target_id)) AND affiliation_status='confirmed' AND operating_status='active' AND governance_checked_at IS NOT NULL AND enabled=1 AND archived_at IS NULL)
  THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='document.review' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id) NOT IN('admin','reviewer') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
