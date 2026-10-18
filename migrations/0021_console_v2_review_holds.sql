-- Human moderation belongs to a particular input revision. An actual author
-- revision can be analysed again; replaying the rejected input cannot publish it.
ALTER TABLE console_document_controls ADD COLUMN review_hold TEXT CHECK(review_hold IN('returned','rejected'));
ALTER TABLE console_document_controls ADD COLUMN review_hold_revision INTEGER;
ALTER TABLE console_document_controls ADD COLUMN review_hold_input_hash TEXT;
INSERT INTO console_document_controls(document_id,review_hold,review_hold_revision,review_hold_input_hash)
 SELECT id,workflow_status,content_revision,input_hash FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND workflow_status IN('returned','rejected')
 ON CONFLICT(document_id) DO UPDATE SET review_hold=excluded.review_hold,review_hold_revision=excluded.review_hold_revision,review_hold_input_hash=excluded.review_hold_input_hash;
CREATE TRIGGER console_auto_review_hold_guard BEFORE INSERT ON console_commands WHEN NEW.action='document.auto_publish' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_document_controls c JOIN knowledge_documents d ON d.id=c.document_id WHERE d.id=NEW.target_id AND c.review_hold IS NOT NULL ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
