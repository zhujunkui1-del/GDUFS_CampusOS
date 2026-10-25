// Select matching article metadata first, then check its source and fetches.
// Fetch history grows on every crawl; never join the whole history to dedupe.
export const crossUrlDuplicateSql = `SELECT d.id FROM knowledge_documents d
WHERE EXISTS(SELECT 1 FROM document_origins o WHERE o.source_id=? AND o.document_id=d.id)
  AND d.title=? AND d.published_at IS ? AND d.publisher IS ?
  AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND EXISTS(SELECT 1 FROM document_fetches f WHERE f.document_id=d.id AND f.body_hash=?)
LIMIT 1`;

export const contentProvenanceSql = `SELECT 1 AS ok WHERE EXISTS(
  SELECT 1 FROM document_fetches f
  JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version
  WHERE f.document_id=? AND f.status IN(200,304) AND f.outcome IN('ok','not_modified')
    AND v.content_revision=? AND v.input_hash=?
    AND EXISTS(SELECT 1 FROM console_document_controls dc
      WHERE dc.document_id=f.document_id AND dc.last_change_origin='source_author')
) OR EXISTS(SELECT 1 FROM console_content_attestations
  WHERE document_id=? AND content_revision=? AND input_hash=?)`;
