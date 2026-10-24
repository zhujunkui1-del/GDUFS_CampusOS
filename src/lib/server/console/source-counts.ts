import type { SqlDatabase } from "../assistant/database";

// `selected(source_id)` is supplied by the caller. Start with those sources so
// both branches can use source indexes; UNION deduplicates primary/origin pairs.
export const sourceDocumentPairs = `pairs AS MATERIALIZED(
  SELECT d.source_id,d.id AS document_id
  FROM selected x CROSS JOIN knowledge_documents d ON d.source_id=x.source_id
  WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  UNION
  SELECT o.source_id,d.id
  FROM selected x CROSS JOIN document_origins o ON o.source_id=x.source_id
    JOIN knowledge_documents d ON d.id=o.document_id
  WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
)`;

type SourceCounts = { article_count: number; published_count: number };

export async function readSourceCounts(db: SqlDatabase, sourceIds: string[]) {
  if (!sourceIds.length) return new Map<string, SourceCounts>();
  const rows = await db
    .prepare(
      `WITH selected(source_id) AS(VALUES ${sourceIds.map(() => "(?)").join(",")}),
      ${sourceDocumentPairs}
      SELECT pairs.source_id,
        sum(NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=pairs.document_id AND t.released_at IS NULL)) AS article_count,
        sum(EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=pairs.document_id)) AS published_count
      FROM pairs GROUP BY pairs.source_id`,
    )
    .bind(...sourceIds)
    .all<SourceCounts & { source_id: string }>();
  return new Map(rows.results.map((row) => [row.source_id, row]));
}
