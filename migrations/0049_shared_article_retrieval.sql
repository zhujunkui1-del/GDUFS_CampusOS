-- Shared derived text index. Original article HTML and publication records are untouched.
ALTER TABLE knowledge_chunks ADD COLUMN index_version TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN text_basis TEXT NOT NULL DEFAULT 'source' CHECK(text_basis IN('source','normalized_text','title'));
ALTER TABLE knowledge_chunks ADD COLUMN ordinal INTEGER;
CREATE UNIQUE INDEX retrieval_chunk_ordinal ON knowledge_chunks(document_id,index_version,ordinal) WHERE index_version IS NOT NULL;
CREATE TABLE article_search_documents (
 document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
 content_revision INTEGER NOT NULL,input_hash TEXT NOT NULL,index_version TEXT NOT NULL,
 text_hash TEXT NOT NULL,text_length INTEGER NOT NULL,chunk_count INTEGER NOT NULL,
 evidence_type TEXT NOT NULL CHECK(evidence_type IN('full_text','excerpt','metadata')),
 status TEXT NOT NULL CHECK(status IN('ready','stale')),indexed_at TEXT NOT NULL,write_nonce TEXT NOT NULL
);
CREATE INDEX retrieval_document_state ON article_search_documents(status,index_version,document_id);
CREATE VIRTUAL TABLE article_chunk_fts USING fts5(title_terms,body_terms,facets,tokenize='unicode61',detail='column');
CREATE TRIGGER retrieval_chunk_delete AFTER DELETE ON knowledge_chunks WHEN OLD.index_version IS NOT NULL BEGIN
 DELETE FROM article_chunk_fts WHERE rowid=OLD.rowid;
END;
CREATE TRIGGER retrieval_chunk_binding BEFORE INSERT ON knowledge_chunks WHEN NEW.index_version IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
  WHERE d.id=NEW.document_id AND d.content_revision=NEW.content_revision AND d.input_hash=NEW.input_hash
  AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1
  AND (NEW.text_basis='title' OR (d.body_status<>'not_provided' AND d.rights_scope IN('licensed_full_text','excerpt_and_link'))))
 THEN RAISE(ABORT,'RETRIEVAL_STALE_OR_PRIVATE') END;
END;
CREATE TRIGGER retrieval_document_invalidate AFTER UPDATE ON knowledge_documents
WHEN NEW.input_hash IS NOT OLD.input_hash OR NEW.content_revision IS NOT OLD.content_revision
 OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.data_domain IS NOT OLD.data_domain
 OR NEW.rights_scope IS NOT OLD.rights_scope BEGIN
 UPDATE article_search_documents SET status='stale' WHERE document_id=NEW.id AND status<>'stale';
END;
-- Publication/lifecycle/source policies are checked live, never copied into an
-- eventually consistent index. A reversible date gate need not rewrite text.
