-- Reversible front-page date window. Keep every article payload and publication receipt.
ALTER TABLE console_engine_settings ADD COLUMN public_visibility_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE console_cleanup_plans ADD COLUMN gate_behavior TEXT NOT NULL DEFAULT 'purge' CHECK(gate_behavior IN('purge','visibility'));
ALTER TABLE console_cleanup_items ADD COLUMN gate_action TEXT NOT NULL DEFAULT 'hide' CHECK(gate_action IN('hide','restore'));

-- Prevent an old browser/Worker from executing the former destructive date-gate batch.
CREATE TRIGGER console_date_gate_no_purge BEFORE INSERT ON console_cleanup_guards
WHEN EXISTS(SELECT 1 FROM console_cleanup_plans WHERE id=NEW.plan_id AND mode='date_gate')
BEGIN
 SELECT RAISE(ABORT,'CONSOLE_DATE_GATE_VISIBILITY_ONLY');
END;

DROP VIEW console_public_documents;
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
  AND ((d.radar_category IS NULL)<>(d.knowledge_category IS NULL))
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
  AND d.content_revision>0 AND ((d.radar_category IS NULL)<>(d.knowledge_category IS NULL))
  AND d.valid_until IS NULL
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL));


CREATE VIEW console_public_documents AS
 SELECT d.* FROM console_date_unrestricted_documents d
 CROSS JOIN console_engine_settings e
 WHERE e.id='console-v2-settings' AND (
  e.earliest_import_day IS NULL OR d.published_at IS NULL
  OR (CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)>=e.earliest_import_day
  OR EXISTS(SELECT 1 FROM console_protections p
    WHERE p.active=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
    AND ((p.target_type='document' AND p.target_id=d.id)
      OR (p.target_type='source' AND (p.target_id=d.source_id
        OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=p.target_id)))))
 );
