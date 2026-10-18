export const protectedDocumentSql = (alias = "d") =>
  `EXISTS(SELECT 1 FROM console_protections p WHERE p.active=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND ((p.target_type='document' AND p.target_id=${alias}.id) OR (p.target_type='source' AND (p.target_id=${alias}.source_id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=${alias}.id AND o.source_id=p.target_id)))))`;
export const protectedSourceSql =
  "EXISTS(SELECT 1 FROM console_protections sp WHERE sp.target_type='source' AND sp.target_id=s.id AND sp.active=1 AND (sp.expires_at_ms IS NULL OR sp.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))";
