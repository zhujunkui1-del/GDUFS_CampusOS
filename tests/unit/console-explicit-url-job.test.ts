import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { IngestionStore } from "@/lib/server/console/ingestion-store";
import { ContentInputSchema } from "@/domain/console/contracts";
import { webProfiles } from "@/lib/ingestion/profiles";
const actor = {
    id: "explicit-url-fixture",
    email: "explicit-url@example.invalid",
    role: "admin" as const,
  },
  p = webProfiles[1];
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
const articleUrl = p.origin + "/info/1056/999301.htm";
async function setup() {
  const f = sqliteD1();
  f.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(actor.id, actor.email);
  f.sqlite
    .prepare(
      "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed,channel_type,website_url,enabled,verification_status,official_status,permission_status,authorization_status) VALUES(?,?,'official_web','[]','[]','{\"mode\":\"manual\",\"maxRequests\":2}',1,'official_web',?,1,'verified','verified_official','approved','approved')",
    )
    .run(p.sourceId, "隔离采集夹具", p.origin + "/");
  f.sqlite
    .prepare(
      "INSERT INTO source_collection_policies(source_id,rule_version,rights_scope,evidence_urls_json,note,robots_status,expires_at_ms,approved_by,updated_at) VALUES(?,?,'licensed_full_text','[]','isolated fixture',404,?,?,?)",
    )
    .run(
      p.sourceId,
      p.ruleVersion,
      Date.now() + 86400000,
      actor.id,
      new Date().toISOString(),
    );
  // The archive floor refuses anything older than the import day on its own.
  f.sqlite
    .prepare(
      "UPDATE console_engine_settings SET earliest_import_day='2026-01-01' WHERE id='console-v2-settings'",
    )
    .run();
  const store = new IngestionStore(f.db, actor);
  const article = ContentInputSchema.parse({
    sourceId: p.sourceId,
    title: "隔离归档通知",
    url: articleUrl,
    body: "隔离夹具正文，未引用任何真实站点内容。",
    kind: "knowledge",
    campusScope: "unknown",
    validUntil: null,
    publishedAt: "2021-03-15",
    extractedFields: {},
    contentType: "notice",
    rightsScope: "licensed_full_text",
    knowledgeCategory: "administrative_services",
  });
  const claim = async (id: string) => {
    f.sqlite
      .prepare("UPDATE ingestion_jobs SET next_run_after_ms=0 WHERE id=?")
      .run(id);
    return store.claim(id, cmd(Number((await store.job(id)).version)));
  };
  const commit = (
    lease: Awaited<ReturnType<typeof store.claim>>,
    extra: Record<string, unknown> = {},
  ) =>
    store.commit(lease.id, {
      ...cmd(lease.version),
      leaseToken: lease.leaseToken,
      fence: lease.fence,
      url: lease.url,
      status: 200,
      bytes: 200,
      requests: 1,
      outcome: "ok",
      etag: '"fixture"',
      lastModified: null,
      bodyHash: "a".repeat(64),
      publishedRaw: null,
      article,
      ...extra,
    });
  const createJob = (urls: string[]) =>
    store.createJob({
      commandId: crypto.randomUUID(),
      sourceId: p.sourceId,
      maxArticles: 1,
      urls,
    });
  const whitelist = (expiresAtMs: number) =>
    f.sqlite
      .prepare(
        "INSERT INTO console_protections(target_type,target_id,active,history_exempt,reason,expires_at_ms,admin_id,created_at,updated_at) VALUES('source',?,1,1,'隔离来源历史导入豁免',?,?,?,?)",
      )
      .run(
        p.sourceId,
        expiresAtMs,
        actor.id,
        ...Array(2).fill(new Date().toISOString()),
      );
  return { ...f, store, claim, commit, createJob, whitelist, article };
}
describe("collection job seeded with links the operator named", () => {
  it("starts at the fetch phase with the named page as its target", async () => {
    const f = await setup();
    try {
      const job = await f.createJob([articleUrl]),
        row = f.sqlite
          .prepare(
            "SELECT phase,checkpoint_json FROM ingestion_jobs WHERE id=?",
          )
          .get(job.id) as { phase: string; checkpoint_json: string };
      expect(row.phase).toBe("fetch");
      expect(JSON.parse(row.checkpoint_json)).toMatchObject({
        urls: [articleUrl],
      });
      const lease = await f.claim(job.id);
      expect(lease.url).toBe(articleUrl);
      expect(lease.phase).toBe("fetch");
    } finally {
      f.close();
    }
  });
  it("keeps an archive page only when the source is whitelisted", async () => {
    const refused = await setup();
    try {
      const job = await refused.createJob([articleUrl]);
      await refused.commit(await refused.claim(job.id));
      // The archive floor discards the page and records why, instead of
      // silently importing an article from before the import day.
      expect(
        refused.sqlite
          .prepare("SELECT reason FROM console_intake_skips WHERE job_id=?")
          .all(job.id)
          .map((r) => (r as { reason: string }).reason),
      ).toEqual(["cutoff"]);
      expect(
        refused.sqlite
          .prepare("SELECT count(*) n FROM knowledge_documents WHERE url=?")
          .get(articleUrl),
      ).toMatchObject({ n: 0 });
    } finally {
      refused.close();
    }
    const allowed = await setup();
    try {
      allowed.whitelist(Date.now() + 3600000);
      const job = await allowed.createJob([articleUrl]);
      await allowed.commit(await allowed.claim(job.id));
      const doc = allowed.sqlite
        .prepare(
          "SELECT published_at,live FROM (SELECT published_at,1 live FROM knowledge_documents WHERE url=?)",
        )
        .get(articleUrl) as { published_at: string };
      expect(doc.published_at).toBe("2021-03-15");
    } finally {
      allowed.close();
    }
  });
  it("writes a page again after the administrator deleted it", async () => {
    const f = await setup();
    try {
      f.whitelist(Date.now() + 3600000);
      const first = await f.createJob([articleUrl]);
      await f.commit(await f.claim(first.id));
      const doc = f.sqlite
        .prepare("SELECT id,version FROM knowledge_documents WHERE url=?")
        .get(articleUrl) as { id: string; version: number };
      await f.store.deleteContent(doc.id, {
        commandId: crypto.randomUUID(),
        expectedVersion: doc.version,
      });
      const second = await f.createJob([articleUrl]);
      await f.commit(await f.claim(second.id), {
        article: { ...f.article, body: "重新采集后的隔离正文。" },
      });
      const revived = f.sqlite
        .prepare("SELECT deleted_at FROM knowledge_documents WHERE url=?")
        .get(articleUrl) as { deleted_at: string | null };
      expect(revived.deleted_at).toBeNull();
      expect((await f.store.document(doc.id)).id).toBe(doc.id);
    } finally {
      f.close();
    }
  });
  it("refuses a page outside the columns configured for the source", async () => {
    const f = await setup();
    try {
      await expect(
        f.createJob([p.origin + "/private/999301.htm"]),
      ).rejects.toThrow("链接不在该来源允许的栏目范围内。");
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM ingestion_jobs").get(),
      ).toMatchObject({ n: 0 });
    } finally {
      f.close();
    }
  });
});
