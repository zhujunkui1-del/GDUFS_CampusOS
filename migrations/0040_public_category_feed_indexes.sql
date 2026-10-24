-- Support per-category top-N reads while the short-lived category count cache is warm.
CREATE INDEX IF NOT EXISTS console_public_radar_category_time
  ON knowledge_documents(radar_category,published_at DESC,id)
  WHERE owner_user_id IS NULL AND data_domain<>'user_private'
    AND publication_status='published' AND review_status='approved'
    AND workflow_status='approved' AND lifecycle_status='active'
    AND content_revision>0 AND input_hash IS NOT NULL
    AND rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text')
    AND content_type<>'unknown' AND radar_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS console_public_knowledge_category_time
  ON knowledge_documents(knowledge_category,published_at DESC,id)
  WHERE owner_user_id IS NULL AND data_domain<>'user_private'
    AND publication_status='published' AND review_status='approved'
    AND workflow_status='approved' AND lifecycle_status='active'
    AND content_revision>0 AND input_hash IS NOT NULL
    AND rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text')
    AND content_type<>'unknown' AND knowledge_category IS NOT NULL
    AND radar_category IS NULL;
