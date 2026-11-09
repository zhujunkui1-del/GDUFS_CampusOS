import type { SqlDatabase } from "@/lib/server/assistant/database";

export type Placement = {
  radarCategory: string | null;
  knowledgeCategory: string | null;
};

/**
 * The public view only shows a document that has exactly one of the two
 * category columns filled, so a document that publishes without a placement
 * disappears from the site even though the console says it is published.
 * The analyser usually decides later than the classifier, so when the
 * classifier abstains, reuse whatever the analyser already stored for the same
 * revision.
 */
export async function storedPlacement(
  db: SqlDatabase,
  id: string,
  contentRevision: number,
  inputHash: string,
): Promise<Placement | null> {
  const row = await db
    .prepare(
      "SELECT radar_category, knowledge_category FROM document_article_analysis WHERE document_id=? AND content_revision=? AND input_hash=?",
    )
    .bind(id, contentRevision, inputHash)
    .first<{
      radar_category: string | null;
      knowledge_category: string | null;
    }>();
  if (!row) return null;
  if (!row.radar_category && !row.knowledge_category) return null;
  return {
    radarCategory: row.radar_category,
    knowledgeCategory: row.knowledge_category,
  };
}
