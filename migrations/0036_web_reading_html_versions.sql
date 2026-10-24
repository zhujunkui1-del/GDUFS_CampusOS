-- Preserve sanitized website reading HTML when a stored source revision is restored.
DROP TRIGGER console_version_payload;
CREATE TRIGGER console_version_payload BEFORE INSERT ON console_content_versions WHEN json_extract(NEW.snapshot_json,'$.inputRef') IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id AND owner_user_id IS NULL AND data_domain<>'user_private' AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 INSERT OR IGNORE INTO console_revision_payloads(document_id,content_revision,input_hash,input_json,created_at)
 SELECT id,content_revision,input_hash,json_object('sourceId',source_id,'title',title,'url',url,'body',body,'bodyFormat',body_format,'bodyStatus',body_status,'kind',candidate_kind,'campusScope',campus_scope,'validUntil',valid_until,'publishedAt',published_at,'sourceUpdatedAt',source_updated_at,'contentType',content_type,'rightsScope',rights_scope,'radarCategory',radar_category,'knowledgeCategory',knowledge_category,'publisher',publisher,'summary',summary,'tags',json((SELECT json_group_array(tag) FROM document_tags WHERE document_id=knowledge_documents.id AND content_revision=knowledge_documents.content_revision)),'extractedFields',json(extracted_fields_json)),NEW.created_at FROM knowledge_documents WHERE id=NEW.document_id;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_revision_payloads WHERE document_id=NEW.document_id AND content_revision=NEW.content_revision AND input_hash=NEW.input_hash) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;
