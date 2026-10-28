import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dateGateFixture } from "../fixtures/date-gate";
import {
  retrievalCorpus,
  retrievalQuestions,
} from "../fixtures/retrieval-evaluation";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";

it("measures independently labelled cross-topic recall and precision (isolated data, no cloud claims)", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, title, body] of retrievalCorpus) {
      f.sqlite
        .prepare(
          `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,radar_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements','2026-10-10',1,?,'licensed_full_text','notice','competition')`,
        )
        .run(
          id,
          f.source.id,
          title,
          "https://example.invalid/" + id,
          body,
          id,
          "c".repeat(64),
        );
      await f.store.publishCollectedWebArticle(id);
      f.sqlite
        .prepare("DELETE FROM knowledge_chunks WHERE document_id=?")
        .run(id);
      f.sqlite
        .prepare("DELETE FROM article_search_documents WHERE document_id=?")
        .run(id);
      await ensureRetrievalIndex(f.db, id);
    }
    const rows = [];
    for (const [query, expected, purpose] of retrievalQuestions) {
      const start = performance.now(),
        r = await searchContent(
          f.db,
          purpose,
          { query, limit: 4 },
          "2026-10-28T06:00:00Z",
        );
      const relevant = r.hits.filter((h) =>
        (expected as readonly string[]).includes(h.documentId),
      );
      rows.push({
        query,
        purpose,
        gold: expected,
        returned: r.hits.map((h) => h.documentId),
        recall: relevant.length / expected.length,
        precisionAt4: relevant.length / 4,
        precisionReturned: r.hits.length ? relevant.length / r.hits.length : 0,
        knownPositiveMiss: Number(!relevant.length),
        supportedEvidence: relevant.filter((h) => h.bodyAvailable).length,
        returnedEvidence: r.hits.length,
        latencyMs: performance.now() - start,
        metrics: r.metrics,
      });
    }
    const avg = (
      key:
        | "recall"
        | "precisionAt4"
        | "precisionReturned"
        | "knownPositiveMiss"
        | "latencyMs",
    ) => rows.reduce((n, r) => n + r[key], 0) / rows.length;
    const summary = {
      kind: "isolated_labelled_fixture",
      queries: rows.length,
      recallAt4: avg("recall"),
      precisionAt4: avg("precisionAt4"),
      precisionReturned: avg("precisionReturned"),
      knownPositiveMissRate: avg("knownPositiveMiss"),
      supportedEvidenceRate:
        rows.reduce((n, r) => n + r.supportedEvidence, 0) /
        rows.reduce((n, r) => n + r.returnedEvidence, 0),
      meanLatencyMs: avg("latencyMs"),
      maxCandidateChunks: Math.max(
        ...rows.map((r) => r.metrics.candidateChunks),
      ),
      cloudMeteringAvailable: false,
    };
    if (process.env.RETRIEVAL_EVAL_OUT) {
      mkdirSync(dirname(process.env.RETRIEVAL_EVAL_OUT), { recursive: true });
      writeFileSync(
        process.env.RETRIEVAL_EVAL_OUT,
        JSON.stringify({ summary, rows }, null, 2),
      );
    }
    expect(rows).toHaveLength(22);
    // The baseline measurement intentionally may fail quality gates. Current
    // release must recall a labelled positive for every positive case.
    if (process.env.RETRIEVAL_EVAL_BASELINE !== "1")
      expect(summary.knownPositiveMissRate).toBe(0);
  } finally {
    f.close();
  }
}, 20000);
