import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { importCatalog, validateCatalog } from "@/lib/server/console/catalog";
import { ConsoleStore } from "@/lib/server/console/store";
const manifest = JSON.parse(
  readFileSync("data/console/source-catalog-2026-10-17.json", "utf8"),
);
it("imports the 220 real candidate records idempotently without trusting activity claims", async () => {
  const f = sqliteD1();
  try {
    const first = await importCatalog(f.db, manifest, "Isolated import test");
    expect(first).toMatchObject({
      inserted: 220,
      enabled: 0,
      verified: 0,
      candidates: 220,
      failed: 0,
    });
    expect(
      (await importCatalog(f.db, manifest, "Isolated import test")).inserted,
    ).toBe(0);
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) AS n FROM console_audit_logs WHERE action='source.import'",
        )
        .get(),
    ).toMatchObject({ n: 220 });
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) AS n FROM knowledge_sources WHERE last_checked_at IS NOT NULL OR last_success_at IS NOT NULL",
        )
        .get(),
    ).toMatchObject({ n: 0 });
    expect(
      f.sqlite.prepare("SELECT count(*) AS n FROM knowledge_documents").get(),
    ).toMatchObject({ n: 0 });
    const row = f.sqlite
      .prepare("SELECT id FROM knowledge_sources ORDER BY id LIMIT 1")
      .get()!;
    f.sqlite
      .prepare(
        "UPDATE knowledge_sources SET verification_status='verified',permission_status='approved',enabled=1 WHERE id=?",
      )
      .run(String(row.id));
    const repeated = await importCatalog(
      f.db,
      manifest,
      "Isolated import test",
    );
    expect(repeated).toMatchObject({
      inserted: 0,
      enabled: 1,
      verified: 1,
      candidates: 219,
    });
  } finally {
    f.close();
  }
});
it("does not merge equal names on different carriers and retains exact file/row provenance", async () => {
  const f = sqliteD1();
  try {
    await importCatalog(f.db, manifest, "Isolated import test");
    const rows = f.sqlite
      .prepare(
        "SELECT display_name,count(DISTINCT channel_type) AS n FROM knowledge_sources GROUP BY display_name HAVING count(DISTINCT channel_type)>1",
      )
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const ref = f.sqlite
      .prepare(
        "SELECT original_catalog_refs_json FROM knowledge_sources WHERE id='GDUFS-SRC-0001'",
      )
      .get()!;
    expect(JSON.parse(String(ref.original_catalog_refs_json))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: "全渠道去重总表", row: 2 }),
      ]),
    );
  } finally {
    f.close();
  }
});
it("rejects tampered catalog facts or changes conflicting with existing IDs", async () => {
  const f = sqliteD1();
  try {
    const changed = structuredClone(manifest);
    changed.records[0].input.displayName = "altered";
    await expect(validateCatalog(changed)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await importCatalog(f.db, manifest, "Isolated import test");
    f.sqlite
      .prepare(
        "UPDATE knowledge_sources SET catalog_hash='conflict' WHERE id='GDUFS-SRC-0001'",
      )
      .run();
    await expect(
      importCatalog(f.db, manifest, "Isolated import test"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    f.close();
  }
});
it("keeps student private sources/documents and legacy audit data out of Console", async () => {
  const f = sqliteD1();
  try {
    f.sqlite.exec(
      `INSERT INTO users(id,display_name) VALUES('student','private student');INSERT INTO console_admins(id,email,role) VALUES('operator','operator@example.invalid','admin');INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json) VALUES('private-source','private','user_private','[]','[]','{}');INSERT INTO knowledge_documents(id,source_id,owner_user_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain) VALUES('private-document','private-source','student','private','https://example.invalid/private','private student material','private-hash','2026-10-17T00:00:00Z','unknown','user_private');`,
    );
    const store = new ConsoleStore(f.db, {
      id: "operator",
      email: "operator@example.invalid",
      role: "admin",
    });
    await expect(store.document("private-document")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(store.source("private-source")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await store.content({})).total).toBe(0);
    expect((await store.sources({})).total).toBe(0);
  } finally {
    f.close();
  }
});
