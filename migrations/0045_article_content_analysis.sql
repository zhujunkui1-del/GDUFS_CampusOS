-- Derived content understanding never modifies source bodies, revisions or publication receipts.
CREATE TABLE document_article_analysis (
 document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
 content_revision INTEGER NOT NULL,input_hash TEXT NOT NULL,classifier_version TEXT NOT NULL,
 input_digest TEXT NOT NULL,projection_hash TEXT NOT NULL,processed_at TEXT NOT NULL,
 primary_destination TEXT NOT NULL CHECK(primary_destination IN('radar','knowledge','unknown')),
 radar_category TEXT,knowledge_category TEXT,has_registration INTEGER NOT NULL CHECK(has_registration IN(0,1)),
 analysis_json TEXT NOT NULL CHECK(json_valid(analysis_json)),
 CHECK((primary_destination='unknown' AND radar_category IS NULL AND knowledge_category IS NULL)
  OR (primary_destination='radar' AND radar_category IS NOT NULL AND knowledge_category IS NULL)
  OR (primary_destination='knowledge' AND knowledge_category IS NOT NULL AND radar_category IS NULL))
);
CREATE INDEX article_analysis_destination ON document_article_analysis(primary_destination,radar_category,knowledge_category,document_id);
CREATE TABLE document_classification_overrides (
 document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
 radar_category TEXT,knowledge_category TEXT,updated_by TEXT NOT NULL REFERENCES console_admins(id),updated_at TEXT NOT NULL,
 CHECK((radar_category IS NULL)<>(knowledge_category IS NULL))
);
-- Preserve previously explicit human category edits.
INSERT INTO document_classification_overrides
 SELECT d.id,d.radar_category,d.knowledge_category,c.admin_id,c.created_at
 FROM knowledge_documents d JOIN console_commands c ON c.target_id=d.id AND c.action='document.classify'
 JOIN console_admins a ON a.id=c.admin_id AND a.principal_type='human'
 WHERE ((d.radar_category IS NULL)<>(d.knowledge_category IS NULL))
 AND c.id=(SELECT id FROM console_commands x WHERE x.target_id=d.id AND x.action='document.classify' ORDER BY x.created_at DESC,x.id DESC LIMIT 1);

CREATE TABLE article_activity_index (
 document_id TEXT NOT NULL REFERENCES document_article_analysis(document_id) ON DELETE CASCADE,
 activity_key TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,category TEXT,
 starts_day TEXT,starts_at TEXT,ends_day TEXT,ends_at TEXT,place_raw TEXT,
 registration_requirement TEXT NOT NULL,group_key TEXT,
 PRIMARY KEY(document_id,activity_key)
);
CREATE INDEX article_activity_date ON article_activity_index(category,starts_day,document_id);
CREATE INDEX article_activity_group ON article_activity_index(group_key) WHERE group_key IS NOT NULL;
CREATE TABLE article_registration_windows (
 document_id TEXT NOT NULL,activity_key TEXT NOT NULL,ordinal INTEGER NOT NULL,
 starts_day TEXT,starts_at TEXT,ends_day TEXT,ends_at TEXT,
 PRIMARY KEY(document_id,activity_key,ordinal),
 FOREIGN KEY(document_id,activity_key) REFERENCES article_activity_index(document_id,activity_key) ON DELETE CASCADE
);
CREATE INDEX article_registration_deadline ON article_registration_windows(ends_day,document_id);

CREATE VIEW console_article_classifications AS
 SELECT d.id AS document_id,
  CASE WHEN m.document_id IS NOT NULL THEN CASE WHEN m.radar_category IS NOT NULL THEN 'radar' ELSE 'knowledge' END
       WHEN a.document_id IS NOT NULL THEN a.primary_destination
       WHEN d.radar_category IS NOT NULL THEN 'radar' WHEN d.knowledge_category IS NOT NULL THEN 'knowledge' ELSE 'unknown' END AS primary_destination,
  CASE WHEN m.document_id IS NOT NULL THEN m.radar_category WHEN a.document_id IS NOT NULL THEN a.radar_category ELSE d.radar_category END AS radar_category,
  CASE WHEN m.document_id IS NOT NULL THEN m.knowledge_category WHEN a.document_id IS NOT NULL THEN a.knowledge_category ELSE d.knowledge_category END AS knowledge_category,
  COALESCE(a.has_registration,0) AS has_registration,a.analysis_json,a.classifier_version,
  CASE WHEN m.document_id IS NOT NULL THEN 'manual' WHEN a.document_id IS NOT NULL THEN 'automatic' ELSE 'legacy' END AS classification_origin
 FROM knowledge_documents d
 LEFT JOIN document_article_analysis a ON a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash
 LEFT JOIN document_classification_overrides m ON m.document_id=d.id
 WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private';

CREATE TRIGGER article_analysis_insert AFTER INSERT ON document_article_analysis BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_analysis_update AFTER UPDATE ON document_article_analysis BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_override_insert AFTER INSERT ON document_classification_overrides BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_override_update AFTER UPDATE ON document_classification_overrides BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;

-- Unknown classification is compatible with already-authorized automatic article publication.
-- Permission/withdrawal/date-gate/source guards stay in their existing views and triggers.
DROP TRIGGER console_contract_publish_update;
CREATE TRIGGER console_contract_publish_update BEFORE UPDATE ON knowledge_documents
WHEN NEW.publication_status='published' AND NEW.owner_user_id IS NULL AND NEW.data_domain<>'user_private' BEGIN
 SELECT CASE WHEN NEW.content_revision<=0 OR NEW.input_hash IS NULL OR NEW.approved_content_revision IS NOT NEW.content_revision OR NEW.approved_input_hash IS NOT NEW.input_hash
 OR NEW.rights_scope NOT IN('metadata_only','excerpt_and_link','licensed_full_text') OR NEW.content_type='unknown'
 OR ((NEW.radar_category IS NULL AND NEW.knowledge_category IS NULL) AND NOT EXISTS(SELECT 1 FROM document_article_analysis a WHERE a.document_id=NEW.id AND a.content_revision=NEW.content_revision AND a.input_hash=NEW.input_hash AND a.primary_destination='unknown'))
 OR (NEW.radar_category IS NOT NULL AND NEW.knowledge_category IS NOT NULL AND (NEW.radar_category IS NOT OLD.radar_category OR NEW.knowledge_category IS NOT OLD.knowledge_category OR OLD.publication_status<>'published'))
 OR (NEW.candidate_kind='event' AND NEW.radar_category IS NULL)
 THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;

DROP VIEW console_date_unrestricted_documents;
CREATE VIEW console_date_unrestricted_documents AS
 SELECT d.* FROM console_legacy_public_documents d
 WHERE NOT EXISTS(SELECT 1 FROM campus_collector_articles c WHERE c.document_id=d.id)
 UNION ALL
 SELECT d.* FROM knowledge_documents d
 JOIN knowledge_sources s ON s.id=d.source_id
 JOIN console_owner_publications p ON p.document_id=d.id AND p.content_revision=d.content_revision AND p.input_hash=d.input_hash
 JOIN console_document_controls x ON x.document_id=d.id AND x.last_publication_mode='auto'
 CROSS JOIN console_engine_settings e
 WHERE e.id='console-v2-settings' AND e.official_web_auto_publish=1
  AND s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web'
  AND s.enabled=1 AND s.archived_at IS NULL
  AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND d.publication_status='published' AND d.review_status='approved' AND d.workflow_status='approved' AND d.lifecycle_status='active'
  AND d.content_revision>0 AND d.input_hash IS NOT NULL AND d.approved_content_revision=d.content_revision AND d.approved_input_hash=d.input_hash
  AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND d.content_type<>'unknown'
  AND (((d.radar_category IS NULL)<>(d.knowledge_category IS NULL)) OR EXISTS(SELECT 1 FROM document_article_analysis a WHERE a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash AND a.primary_destination='unknown'))
  AND NOT EXISTS(SELECT 1 FROM console_document_controls h WHERE h.document_id=d.id AND (h.hold_reason IS NOT NULL OR h.review_hold IS NOT NULL))
  AND NOT EXISTS(SELECT 1 FROM campus_collector_articles c WHERE c.document_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM console_legacy_public_documents l WHERE l.id=d.id)
 UNION ALL
 SELECT d.* FROM knowledge_documents d
 JOIN campus_collector_articles c ON c.document_id=d.id
 JOIN campus_collector_sources p ON p.source_id=c.source_id
 JOIN knowledge_sources s ON s.id=d.source_id
 JOIN console_admins a ON a.id=p.approved_by
 WHERE d.source_id=c.source_id AND p.enabled=1 AND s.enabled=1 AND s.console_managed=1
  AND s.archived_at IS NULL AND s.permission_status<>'denied'
  AND s.channel_type IN('wechat_subscription','wechat_service')
  AND a.principal_type='human' AND a.role='admin' AND a.status='active'
  AND d.owner_user_id IS NULL AND d.data_domain='approved_life_experience'
  AND d.publication_status='published' AND d.lifecycle_status='active'
  AND d.workflow_status='approved' AND d.review_status='approved'
  AND d.body_format='reading_html' AND length(d.body)>0
  AND d.rights_scope='licensed_full_text' AND d.candidate_kind='knowledge'
  AND d.content_type<>'unknown'
  AND c.state IN('available','suspected_missing') AND c.current_hash=d.input_hash
  AND d.approved_input_hash=d.input_hash AND d.approved_content_revision=d.content_revision
  AND d.content_revision>0 AND (((d.radar_category IS NULL)<>(d.knowledge_category IS NULL)) OR EXISTS(SELECT 1 FROM document_article_analysis a WHERE a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash AND a.primary_destination='unknown'))
  AND d.valid_until IS NULL
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL));
