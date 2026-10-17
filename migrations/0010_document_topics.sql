-- Auxiliary topics only; categories, campuses, sources and statuses remain separate.
CREATE TABLE document_tags (
 document_id TEXT NOT NULL REFERENCES knowledge_documents(id), content_revision INTEGER NOT NULL,
 tag TEXT NOT NULL CHECK(length(tag) BETWEEN 1 AND 40),
 PRIMARY KEY(document_id,content_revision,tag)
);
CREATE TRIGGER document_tags_bound BEFORE INSERT ON document_tags WHEN NOT EXISTS(SELECT 1 FROM document_tags WHERE document_id=NEW.document_id AND content_revision=NEW.content_revision AND tag=NEW.tag) BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM document_tags WHERE document_id=NEW.document_id AND content_revision=NEW.content_revision)>=12 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
-- Old application versions do not maintain content hashes. Quarantine such
-- edits atomically rather than reusing approval for changed content on rollback.
CREATE TRIGGER console_legacy_content_write AFTER UPDATE OF title,body,url,source_id,published_at,source_updated_at,content_type,rights_scope,radar_category,knowledge_category,publisher,summary,campus_scope,candidate_kind,extracted_fields_json,valid_until ON knowledge_documents
WHEN NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' AND NEW.input_hash IS OLD.input_hash AND
(NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body OR NEW.url IS NOT OLD.url OR NEW.source_id IS NOT OLD.source_id OR NEW.published_at IS NOT OLD.published_at OR NEW.source_updated_at IS NOT OLD.source_updated_at OR NEW.content_type IS NOT OLD.content_type OR NEW.rights_scope IS NOT OLD.rights_scope OR NEW.radar_category IS NOT OLD.radar_category OR NEW.knowledge_category IS NOT OLD.knowledge_category OR NEW.publisher IS NOT OLD.publisher OR NEW.summary IS NOT OLD.summary OR NEW.campus_scope IS NOT OLD.campus_scope OR NEW.candidate_kind IS NOT OLD.candidate_kind OR NEW.extracted_fields_json IS NOT OLD.extracted_fields_json OR NEW.valid_until IS NOT OLD.valid_until)
BEGIN
 UPDATE knowledge_documents SET content_revision=OLD.content_revision+1,input_hash=NULL,approved_content_revision=NULL,approved_input_hash=NULL,review_status='pending',workflow_status='pending',publication_status='draft' WHERE id=NEW.id;
END;
