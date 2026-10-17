-- Additive compatibility with s3-freeze-2026-10-17.1. Preserve all rows and snapshots.
-- Revision 0 / unknown rights quarantine legacy content without inventing approval.
ALTER TABLE knowledge_documents ADD COLUMN source_updated_at TEXT;
ALTER TABLE knowledge_documents ADD COLUMN updated_at TEXT;
ALTER TABLE knowledge_documents ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision>=0);
ALTER TABLE knowledge_documents ADD COLUMN input_hash TEXT CHECK(input_hash IS NULL OR length(input_hash)=64);
ALTER TABLE knowledge_documents ADD COLUMN approved_content_revision INTEGER;
ALTER TABLE knowledge_documents ADD COLUMN approved_input_hash TEXT;
ALTER TABLE knowledge_documents ADD COLUMN content_type TEXT NOT NULL DEFAULT 'unknown' CHECK(content_type IN('event','notice','policy','guide','news','unknown'));
ALTER TABLE knowledge_documents ADD COLUMN rights_scope TEXT NOT NULL DEFAULT 'unknown' CHECK(rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text','no_collection','unknown'));
ALTER TABLE knowledge_documents ADD COLUMN publisher TEXT;
ALTER TABLE knowledge_documents ADD COLUMN summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=500);
ALTER TABLE knowledge_documents ADD COLUMN radar_category TEXT CHECK(radar_category IS NULL OR radar_category IN('lecture','culture_sports','competition','education_career','academic_research','scholarship_opportunity','campus_notice'));
ALTER TABLE knowledge_documents ADD COLUMN knowledge_category TEXT CHECK(knowledge_category IS NULL OR knowledge_category IN('academic_affairs','campus_life','administrative_services','scholarship_policy','education_career','research_innovation'));
ALTER TABLE console_content_versions ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE console_content_versions ADD COLUMN input_hash TEXT;

CREATE TRIGGER console_contract_publish_update BEFORE UPDATE ON knowledge_documents
WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT CASE WHEN NEW.content_revision<=0 OR NEW.input_hash IS NULL OR NEW.approved_content_revision IS NOT NEW.content_revision OR NEW.approved_input_hash IS NOT NEW.input_hash
 OR NEW.rights_scope NOT IN('metadata_only','excerpt_and_link','licensed_full_text') OR NEW.content_type='unknown'
 OR (NEW.candidate_kind='knowledge' AND NEW.knowledge_category IS NULL) OR (NEW.candidate_kind='event' AND NEW.radar_category IS NULL)
 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
-- Public creation must use draft -> authenticated review -> publish, never INSERT published.
CREATE TRIGGER console_contract_publish_insert BEFORE INSERT ON knowledge_documents
WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY');
END;
CREATE TRIGGER console_contract_invalidate AFTER UPDATE OF rights_scope,content_revision,input_hash,approved_content_revision,approved_input_hash,workflow_status ON knowledge_documents
WHEN NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' AND NEW.version=OLD.version BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) VALUES(NEW.id,NEW.version,'content_contract_changed');
END;
-- This replaces only a derived view; no table/data is dropped or rebuilt.
DROP VIEW console_public_documents;
CREATE VIEW console_public_documents AS SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'
 AND s.enabled=1 AND s.archived_at IS NULL AND s.verification_status='verified' AND s.permission_status='approved'
 AND s.authorization_status='approved'
 AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
 AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
 AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
 AND ((d.candidate_kind='knowledge' AND d.knowledge_category IS NOT NULL) OR (d.candidate_kind='event' AND d.radar_category IS NOT NULL))
 AND (d.data_domain<>'official_policy' OR s.official_status='verified_official')
 AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))
 AND (d.candidate_kind<>'event' OR (COALESCE(json_extract(d.extracted_fields_json,'$.timeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.placeVerified'),0)=1 AND COALESCE(json_extract(d.extracted_fields_json,'$.deadlineVerified'),0)=1 AND julianday(json_extract(d.extracted_fields_json,'$.endAt'))>julianday('now')));
