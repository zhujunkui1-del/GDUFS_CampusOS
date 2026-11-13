-- A source configured from the console before saveWebProfile wrote policies has
-- an entry profile and no policy row, so permit() and the detail fetch had
-- nothing to read. Backfill one row per enabled official website that already
-- has a saved entry, using the rule version the profile itself carries.
INSERT INTO source_collection_policies (source_id,rule_version,rights_scope,evidence_urls_json,note,robots_status,robots_hash,expires_at_ms,version,approved_by,updated_at)
SELECT s.id,json_extract(s.web_profile_json,'$.ruleVersion'),'licensed_full_text','[]',
 '控制台保存采集入口时登记；入口与文章路径已通过官网域名校验。',404,NULL,
 CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+3153600000000,1,'sys-console-cloud',
 strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM knowledge_sources s
WHERE s.console_managed=1 AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL
 AND s.web_profile_json IS NOT NULL AND s.web_profile_json<>'{}'
 AND json_type(s.web_profile_json,'$.ruleVersion')='text'
 AND NOT EXISTS(SELECT 1 FROM source_collection_policies p WHERE p.source_id=s.id);
