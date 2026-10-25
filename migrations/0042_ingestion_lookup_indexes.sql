-- One covering fetch index serves deduplication, provenance and document FKs.
-- List pages / rejected candidates have no document_id and add no index row.
CREATE INDEX IF NOT EXISTS fetch_document_body_version
  ON document_fetches(document_id,body_hash,snapshot_version,status,outcome)
  WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_duplicate_title
  ON knowledge_documents(title,published_at,publisher,id)
  WHERE owner_user_id IS NULL AND data_domain<>'user_private';

-- SQLite checks incoming foreign keys when a new document is inserted too.
-- Index those references so each article does not scan the accumulated history.
CREATE INDEX IF NOT EXISTS documents_superseded_by ON knowledge_documents(superseded_by)
  WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS chunks_document ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS facts_document ON knowledge_facts(document_id);
CREATE INDEX IF NOT EXISTS event_sources_document ON event_sources(document_id);
CREATE INDEX IF NOT EXISTS reviews_document ON console_content_reviews(document_id);
CREATE INDEX IF NOT EXISTS invalidations_document ON content_index_invalidations(document_id);
CREATE INDEX IF NOT EXISTS job_steps_document ON ingestion_job_steps(document_id)
  WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS origin_duplicate_document ON document_origins(duplicate_of)
  WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS manual_import_document ON manual_import_items(document_id);
CREATE INDEX IF NOT EXISTS auto_publications_document ON console_auto_publications(document_id);
CREATE INDEX IF NOT EXISTS cleanup_guards_document ON console_cleanup_guards(document_id);
CREATE INDEX IF NOT EXISTS manual_links_document ON console_manual_links(document_id);
CREATE INDEX IF NOT EXISTS intake_skips_document ON console_intake_skips(document_id)
  WHERE document_id IS NOT NULL;
