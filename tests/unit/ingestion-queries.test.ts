import { it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import {
  crossUrlDuplicateSql,
  contentProvenanceSql,
} from "@/lib/server/console/ingestion-queries";

it("matches cross-URL duplicates within a source and binds provenance to the exact revision", () => {
  const f = sqliteD1();
  try {
    const db = f.sqlite,
      hash = "b".repeat(64);
    db.exec(`INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json) VALUES('s','fixture','official_web','[]','[]','{}'),('other','other','official_web','[]','[]','{}');
      INSERT INTO ingestion_jobs(id,source_id,status) VALUES('j','s','completed');`);
    db.prepare(
      "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash) VALUES('d','s','Title','https://example.invalid/1','Body','body','2026-10-25','all','campus_announcements',NULL,2,?)",
    ).run(hash);
    db.prepare(
      "INSERT INTO console_content_versions(document_id,version,snapshot_json,content_revision,input_hash,created_at) VALUES('d',1,'{}',2,?,'2026-10-25')",
    ).run(hash);
    db.exec(`INSERT INTO document_origins(id,source_id,document_id,canonical_url,entry_url,first_seen_at,last_seen_at) VALUES('o','s','d','https://example.invalid/1','https://example.invalid/','2026-10-25','2026-10-25');
      INSERT INTO console_document_controls(document_id,last_change_origin) VALUES('d','source_author');
      INSERT INTO document_fetches(id,job_id,source_id,document_id,snapshot_version,url,checked_at,status,outcome,bytes,body_hash) VALUES('f','j','s','d',1,'https://example.invalid/1','2026-10-25',200,'ok',10,'same-body');`);
    const duplicate = db.prepare(crossUrlDuplicateSql);
    expect(duplicate.get("s", "Title", null, null, "same-body")).toMatchObject({
      id: "d",
    });
    expect(
      duplicate.get("other", "Title", null, null, "same-body"),
    ).toBeUndefined();
    expect(
      duplicate.get("s", "Title", null, null, "different-body"),
    ).toBeUndefined();
    expect(
      duplicate.get("s", "Title", "2026-10-25", null, "same-body"),
    ).toBeUndefined();
    expect(
      duplicate.get("s", "Title", null, "Other publisher", "same-body"),
    ).toBeUndefined();
    const provenance = (revision: number, input: string) =>
      db
        .prepare(contentProvenanceSql)
        .get("d", revision, input, "d", revision, input);
    expect(provenance(2, hash)).toMatchObject({ ok: 1 });
    expect(provenance(1, hash)).toBeUndefined();
    expect(provenance(2, "c".repeat(64))).toBeUndefined();
    db.exec(
      "UPDATE document_fetches SET status=500; UPDATE console_document_controls SET last_change_origin='human_edit'",
    );
    expect(provenance(2, hash)).toBeUndefined();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const plans = [
      db
        .prepare("EXPLAIN QUERY PLAN " + crossUrlDuplicateSql)
        .all("s", "Title", null, null, "same-body"),
      db
        .prepare("EXPLAIN QUERY PLAN " + contentProvenanceSql)
        .all("d", 2, hash, "d", 2, hash),
    ];
    for (const plan of plans) {
      expect(
        plan.some((row) =>
          String(row.detail).includes("fetch_document_body_version"),
        ),
      ).toBe(true);
      expect(plan.some((row) => /SCAN f\b/.test(String(row.detail)))).toBe(
        false,
      );
    }
  } finally {
    f.close();
  }
});
