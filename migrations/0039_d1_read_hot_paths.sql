-- Add indexes for repeated D1 read hot paths observed in SQL Insights:
-- source/origin aggregation, login cleanup, URL intake checks, and collector stats.
CREATE INDEX IF NOT EXISTS document_origin_source_document
  ON document_origins(source_id,document_id);

CREATE INDEX IF NOT EXISTS console_sessions_expiry
  ON console_sessions(expires_at_ms);
CREATE INDEX IF NOT EXISTS console_revoked_tokens_expiry
  ON console_revoked_tokens(expires_at_ms);
CREATE INDEX IF NOT EXISTS console_limits_bucket
  ON console_limits(bucket);

CREATE INDEX IF NOT EXISTS console_documents_url_source
  ON knowledge_documents(url,source_id,id);
CREATE INDEX IF NOT EXISTS console_documents_source_published_day
  ON knowledge_documents(source_id,date(published_at,'+8 hours'),updated_at DESC,id)
  WHERE owner_user_id IS NULL AND data_domain<>'user_private';
CREATE INDEX IF NOT EXISTS console_cleanup_items_document_stage
  ON console_cleanup_items(document_id,stage);

CREATE INDEX IF NOT EXISTS campus_collector_article_source_stats
  ON campus_collector_articles(source_id,state,document_id,observed_at);
CREATE INDEX IF NOT EXISTS campus_collector_receipt_created_document
  ON campus_collector_receipts(date(created_at,'+8 hours'),document_id);
CREATE INDEX IF NOT EXISTS console_content_version_first_day
  ON console_content_versions(date(created_at,'+8 hours'),document_id) WHERE version=1;
