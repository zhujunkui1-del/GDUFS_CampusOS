-- Additive derived index, no article body/publication changes and no daily copies.
ALTER TABLE document_article_analysis ADD COLUMN calendar_version TEXT NOT NULL DEFAULT '';
ALTER TABLE document_article_analysis ADD COLUMN calendar_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE document_article_analysis ADD COLUMN calendar_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE document_article_analysis ADD COLUMN calendar_lease_until_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX calendar_processing ON document_article_analysis(calendar_status,calendar_attempts,calendar_lease_until_ms,document_id)
 WHERE calendar_status IN ('pending','needs_enrichment');
ALTER TABLE article_activity_index ADD COLUMN calendar_eligible INTEGER NOT NULL DEFAULT 0 CHECK(calendar_eligible IN(0,1));
ALTER TABLE article_activity_index ADD COLUMN calendar_version TEXT NOT NULL DEFAULT '';
ALTER TABLE article_activity_index ADD COLUMN campus_scope TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE article_activity_index ADD COLUMN activity_json TEXT CHECK(activity_json IS NULL OR json_valid(activity_json));
CREATE INDEX calendar_interval ON article_activity_index(starts_day,ends_day,document_id) WHERE calendar_eligible=1;
CREATE INDEX calendar_identity ON article_activity_index(group_key) WHERE calendar_eligible=1;
ALTER TABLE console_engine_settings ADD COLUMN calendar_ai_day TEXT;
ALTER TABLE console_engine_settings ADD COLUMN calendar_ai_calls INTEGER NOT NULL DEFAULT 0;
