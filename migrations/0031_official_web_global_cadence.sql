-- All official websites inherit the global cadence managed in /admin/web-collection.
-- Preserve content and source permissions; clear only legacy per-source interval overrides.
UPDATE knowledge_sources
SET sync_hours_override=NULL,
    next_sync_at_ms=CASE
      WHEN last_success_at IS NULL THEN CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      ELSE CAST((julianday(last_success_at)-2440587.5)*86400000 AS INTEGER)+
        (SELECT sync_hours*3600000 FROM console_engine_settings WHERE id='console-v2-settings')
    END,
    sync_policy_version=(SELECT sync_revision FROM console_engine_settings WHERE id='console-v2-settings'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE console_managed=1 AND channel_type='official_web' AND source_type='official_web'
  AND archived_at IS NULL AND sync_hours_override IS NOT NULL;
