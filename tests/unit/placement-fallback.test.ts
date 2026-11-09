import { describe, expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { storedPlacement } from "@/lib/server/console/placement";

const ANALYSIS =
  "INSERT INTO document_article_analysis(document_id,content_revision,input_hash,classifier_version,input_digest,projection_hash,processed_at,primary_destination,radar_category,knowledge_category,has_registration,analysis_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)";

/**
 * The public view only shows a document that has exactly one of the two
 * category columns filled. A document that publishes while the classifier
 * abstains therefore disappears from the site even though the console says it
 * is published, so the publish path reuses the analyser's decision.
 */
describe("storedPlacement", () => {
  it("returns the placement the analyser stored for the same revision", async () => {
    const f = await dateGateFixture();
    try {
      const doc = f.sqlite
        .prepare(
          "SELECT id,content_revision,content_hash,input_hash FROM knowledge_documents WHERE id='spring'",
        )
        .get() as {
        id: string;
        content_revision: number;
        content_hash: string;
        input_hash: string;
      };
      f.sqlite
        .prepare(ANALYSIS)
        .run(
          doc.id,
          doc.content_revision,
          doc.input_hash,
          "article-content-v6",
          "d",
          "p",
          "2026-10-25T00:00:00Z",
          "radar",
          "campus_notice",
          null,
          0,
          "{}",
        );
      expect(
        await storedPlacement(
          f.db,
          doc.id,
          doc.content_revision,
          doc.input_hash,
        ),
      ).toEqual({
        radarCategory: "campus_notice",
        knowledgeCategory: null,
      });
    } finally {
      f.close();
    }
  });

  it("ignores an analysis that belongs to another revision", async () => {
    const f = await dateGateFixture();
    try {
      const doc = f.sqlite
        .prepare(
          "SELECT id,content_revision,input_hash FROM knowledge_documents WHERE id='autumn'",
        )
        .get() as { id: string; content_revision: number; input_hash: string };
      f.sqlite
        .prepare(ANALYSIS)
        .run(
          doc.id,
          doc.content_revision,
          doc.input_hash,
          "article-content-v6",
          "d",
          "p",
          "2026-10-25T00:00:00Z",
          "knowledge",
          null,
          "campus_life",
          0,
          "{}",
        );
      expect(
        await storedPlacement(
          f.db,
          doc.id,
          doc.content_revision,
          "c".repeat(64),
        ),
      ).toBeNull();
    } finally {
      f.close();
    }
  });
});
