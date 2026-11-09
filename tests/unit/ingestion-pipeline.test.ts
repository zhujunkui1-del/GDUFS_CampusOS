import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { IngestionStore } from "@/lib/server/console/ingestion-store";
import { ContentInputSchema } from "@/domain/console/contracts";
import {
  webProfiles,
  approvedUrl,
  profileFromSource,
} from "@/lib/ingestion/profiles";
import {
  OfficialWebConnector,
  originalDate,
  extractEvents,
} from "@/lib/ingestion/connector";
import { isPublicAddress, robotsAllow } from "@/lib/ingestion/safe-fetch";
const actor = {
    id: "ingest-fixture",
    email: "ingest@example.invalid",
    role: "admin" as const,
  },
  p = webProfiles[1];
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup(rights = "metadata_only", v2 = false, automatic = false) {
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
      "INSERT INTO source_collection_policies(source_id,rule_version,rights_scope,evidence_urls_json,note,robots_status,expires_at_ms,approved_by,updated_at) VALUES(?,?,?,'[]','isolated fixture',404,?,?,?)",
    )
    .run(
      p.sourceId,
      p.ruleVersion,
      rights,
      Date.now() + 86400000,
      actor.id,
      new Date().toISOString(),
    );
  if (v2)
    f.sqlite
      .prepare(
        "UPDATE knowledge_sources SET affiliation_status='confirmed',operating_status='active',governance_checked_at=?,affiliation_evidence_json='[\"https://example.invalid/relation\"]',operating_evidence_json='[\"https://example.invalid/current\"]' WHERE id=?",
      )
      .run(new Date().toISOString(), p.sourceId);
  const store = v2
    ? new ConsoleSyncStore(f.db, actor)
    : new IngestionStore(f.db, actor);
  if (automatic && store instanceof ConsoleSyncStore)
    await store.setAutoPolicy(p.sourceId, {
      ...cmd(1),
      enabled: true,
      rightsScope: "metadata_only",
      defaultCategory: "administrative_services",
      unknownDate: "review",
      allowUnofficial: false,
      validityDays: 1,
      evidenceUrls: [p.origin + "/"],
      note: "隔离来源级预先自动发布授权",
    });
  const job = await store.createJob({
    commandId: crypto.randomUUID(),
    sourceId: p.sourceId,
    maxArticles: 1,
  });
  const url = p.origin + "/info/1056/999001.htm";
  const article = ContentInputSchema.parse({
    sourceId: p.sourceId,
    title: "隔离通知",
    url,
    body: "仅登记公开元数据，未保存第三方正文。",
    kind: "knowledge",
    campusScope: "unknown",
    validUntil: null,
    publishedAt: "2020-01-01",
    extractedFields: {},
    contentType: "notice",
    rightsScope: rights,
    knowledgeCategory: "administrative_services",
  });
  const claim = async (id = job.id) => {
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
      bodyHash: null,
      publishedRaw: null,
      ...extra,
    });
  const discover = async (id = job.id) => {
    const lease = await claim(id);
    await commit(lease, { discovered: [url] });
  };
  return { ...f, store, job, url, article, claim, commit, discover };
}
describe("bounded ingestion, real SQLite, isolated fixtures only", () => {
  it("accepts multiple configured article columns while keeping them on the source host", () => {
    const profile = profileFromSource({
      sourceId: "GDUFS-SRC-1099",
      name: "隔离部门官网",
      websiteUrl: "https://dept.example.edu/",
      webProfileJson: JSON.stringify({
        ruleVersion: "official-web-isolated.1",
        entryUrls: [
          "https://dept.example.edu/news/",
          "https://dept.example.edu/notices/",
        ],
        articlePathPrefixes: ["/news/detail/", "/notices/article/"],
      }),
    });
    expect(profile?.entryUrls).toHaveLength(2);
    expect(
      approvedUrl(profile!, "https://dept.example.edu/news/", "list"),
    ).toBe("https://dept.example.edu/news/");
    expect(
      approvedUrl(profile!, "https://dept.example.edu/notices/article/42"),
    ).toBe("https://dept.example.edu/notices/article/42");
    expect(() =>
      approvedUrl(profile!, "https://elsewhere.example.edu/news/42"),
    ).toThrow("URL_NOT_ALLOWED");
    expect(() =>
      approvedUrl(profile!, "https://dept.example.edu/private/42"),
    ).toThrow("URL_NOT_ALLOWED");
  });
  it("V2 preserves human correction on unchanged fetch and lets real author changes supersede it with history", async () => {
    const f = await setup("metadata_only", true);
    try {
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      const origin = f.sqlite
        .prepare("SELECT document_id FROM document_origins")
        .get()!;
      const id = String(origin.document_id);
      let current = await f.store.document(id);
      const input = (await f.store.version(id, current.version)).input;
      await f.store.writeContent(id, {
        ...input,
        summary: "管理员修订的隔离说明",
        commandId: crypto.randomUUID(),
        expectedVersion: current.version,
      });
      current = await f.store.document(id);
      const correctedVersion = current.version;
      const job = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
        maxArticles: 1,
        mode: "revalidate",
      });
      await f.discover(job.id);
      await f.commit(await f.claim(job.id), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      expect((await f.store.document(id)).summary).toBe("管理员修订的隔离说明");
      const changed = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
        maxArticles: 1,
        mode: "revalidate",
      });
      await f.discover(changed.id);
      await f.commit(await f.claim(changed.id), {
        article: { ...f.article, title: "来源作者的新通知" },
        bodyHash: "b".repeat(64),
      });
      current = await f.store.document(id);
      expect(current.title).toBe("来源作者的新通知");
      expect(current.summary).not.toBe("管理员修订的隔离说明");
      expect((await f.store.version(id, correctedVersion)).input.summary).toBe(
        "管理员修订的隔离说明",
      );
      expect(
        f.sqlite
          .prepare(
            "SELECT last_overridden_fields_json FROM console_document_controls WHERE document_id=?",
          )
          .get(id)?.last_overridden_fields_json,
      ).toContain("summary");
      expect(current.publicationStatus).toBe("published");
    } finally {
      f.close();
    }
  });
  it("preserves verified fetch evidence and public visibility when an administrator changes only the article category", async () => {
    const f = await setup("metadata_only", true, true);
    try {
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      const row = f.sqlite.prepare("SELECT id FROM knowledge_documents").get()!;
      const store = new ConsoleSyncStore(f.db, actor),
        d = await store.document(String(row.id));
      expect(d.publicationStatus).toBe("published");
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_content_attestations")
          .get()?.n,
      ).toBe(0);
      await store.classifyArticlePlacement(d.id, {
        ...cmd(d.version),
        radarCategory: "lecture",
        knowledgeCategory: null,
      });
      const current = await store.document(d.id);
      expect(current.inputHash).toBe(d.inputHash);
      expect(current.contentRevision).toBe(d.contentRevision);
      expect(current).toMatchObject({
        publicationStatus: "published",
        radarCategory: "lecture",
        knowledgeCategory: null,
        title: d.title,
        url: d.url,
        publishedAt: d.publishedAt,
        body: d.body,
      });
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_public_documents WHERE id=?")
          .get(d.id)?.n,
      ).toBe(1);
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_content_attestations")
          .get()?.n,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
  it("publishes eight captured metadata cards without creating unverified structured events", async () => {
    let published = 0,
      review = 0;
    for (let i = 0; i < 8; i++) {
      const f = await setup("metadata_only", true, true);
      try {
        await f.discover();
        await f.commit(await f.claim(), {
          article: {
            ...f.article,
            title: i < 6 ? "正常校园通知 " + i : "讲座报名 " + i,
            contentType: i < 6 ? "notice" : "event",
          },
          bodyHash: "a".repeat(64),
          publishedRaw: "2020年1月1日",
        });
        const row = f.sqlite
          .prepare("SELECT publication_status FROM knowledge_documents")
          .get()!;
        if (row.publication_status === "published") published++;
        const check = f.sqlite
          .prepare(
            "SELECT outcome FROM console_content_checks ORDER BY rowid DESC LIMIT 1",
          )
          .get()!;
        if (check.outcome === "review") review++;
        expect(
          f.sqlite
            .prepare("SELECT count(*) n FROM console_public_documents")
            .get()?.n,
        ).toBe(1);
        expect(
          f.sqlite.prepare("SELECT count(*) n FROM campus_events").get()?.n,
        ).toBe(0);
      } finally {
        f.close();
      }
    }
    expect({ published, review, denominator: 8 }).toEqual({
      published: 8,
      review: 0,
      denominator: 8,
    });
    // Eight fresh SQLite fixtures: the default 5s is too close to the machine
    // cost when the suite runs in parallel.
  }, 20000);
  it("keeps metadata-only as default and limits explicitly licensed body extraction", () => {
    const c = new OfficialWebConnector(p),
      url = p.origin + "/info/1056/1.htm",
      parsed = c.parse(
        '<html><head><title>隔离通知</title></head><body><div id="vsb_content_501"><div class="v_news_content"><p>' +
          "隔离许可文本".repeat(120) +
          "</p></div></div></body></html>",
        url,
      );
    expect(c.normalize(parsed, url).bodyStatus).toBe("not_provided");
    expect(c.normalize(parsed, url, "excerpt_and_link")).toMatchObject({
      bodyStatus: "partial",
      rightsScope: "excerpt_and_link",
    });
    expect(c.normalize(parsed, url, "excerpt_and_link").body.length).toBe(500);
    expect(c.normalize(parsed, url, "licensed_full_text").body).toBe(
      parsed.bodyHtml,
    );
    expect(
      c.normalize(parsed, url, "licensed_full_text").bodyFormat,
    ).toBe("reading_html");
  });
  it("observes an old URL without creating an article and does not refetch its detail on the next run", async () => {
    const f = await setup("metadata_only", true);
    try {
      f.sqlite.exec(
        "UPDATE console_engine_settings SET earliest_import_day='2025-09-01'",
      );
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM knowledge_documents").get()?.n,
      ).toBe(0);
      expect(
        f.sqlite.prepare("SELECT reason FROM console_intake_skips").get()
          ?.reason,
      ).toBe("cutoff");
      const next = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
        maxArticles: 1,
      });
      await f.discover(next.id);
      expect((await f.store.job(next.id)).phase).toBe("complete");
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM knowledge_documents").get()?.n,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
  it("requires policy reapproval after a parser release and rejects old queued or in-flight rules", async () => {
    const f = await setup();
    try {
      const setRule = (rule: string) => {
        f.sqlite
          .prepare(
            "UPDATE source_collection_policies SET rule_version=? WHERE source_id=?",
          )
          .run(rule, p.sourceId);
        f.sqlite
          .prepare("UPDATE ingestion_jobs SET rule_version=? WHERE id=?")
          .run(rule, f.job.id);
      };
      setRule("superseded-fixture-rule");
      await expect(
        f.store.createJob({
          commandId: crypto.randomUUID(),
          sourceId: p.sourceId,
        }),
      ).rejects.toThrow();
      await expect(f.claim()).rejects.toMatchObject({ code: "CONFLICT" });
      setRule(p.ruleVersion);
      const lease = await f.claim();
      setRule("superseded-fixture-rule");
      await expect(
        f.commit(lease, { discovered: [f.url] }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await f.store.job(f.job.id)).found_count).toBe(0);
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("ends an entry at the page cap instead of rediscovering the same page forever", async () => {
    const f = await setup();
    try {
      const deep = p.origin + "/index/tzgg/37.htm";
      f.sqlite
        .prepare(
          "UPDATE ingestion_jobs SET checkpoint_json=? WHERE id=?",
        )
        .run(
          JSON.stringify({ entryIndex: 0, urls: [], pageCount: 20 }),
          f.job.id,
        );
      const lease = await f.claim();
      await f.commit(lease, {
        discovered: [f.url],
        nextPage: deep,
      });
      const job = await f.store.job(f.job.id);
      // The cap is terminal for this entry: the page pointer must not survive,
      // otherwise the next tick re-reads the same deep page and the entries
      // behind it are never reached.
      const checkpoint = String(job.checkpoint_json ?? "{}");
      expect(JSON.parse(checkpoint).page).toBeNull();
      expect(checkpoint).not.toContain("/37.htm");
    } finally {
      f.close();
    }
  });
  it("persists discovery -> draft -> checkpoint atomically, keeps four success stages separate", async () => {
    const f = await setup();
    try {
      await f.discover();
      const lease = await f.claim();
      await f.commit(lease, {
        article: f.article,
        bodyHash: "a".repeat(64),
        publishedRaw: "2020-01-01",
        bodyTextChars: 100,
      });
      expect(await f.store.job(f.job.id)).toMatchObject({
        status: "completed",
        found_count: 1,
        body_count: 1,
        duplicate_count: 0,
        phase: "complete",
      });
      const docs = f.sqlite
        .prepare(
          "SELECT id,review_status,publication_status,published_at,content_revision FROM knowledge_documents",
        )
        .all();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        review_status: "pending",
        publication_status: "draft",
        published_at: "2020-01-01",
        content_revision: 1,
      });
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS n FROM console_content_versions")
          .get(),
      ).toMatchObject({ n: 1 });
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS n FROM console_public_documents")
          .get(),
      ).toMatchObject({ n: 0 });
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("deduplicates unchanged articles/304 and keeps changed source as new revision of one document", async () => {
    const f = await setup();
    try {
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      const next = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
      });
      await f.discover(next.id);
      await f.commit(await f.claim(next.id), {
        outcome: "not_modified",
        status: 304,
      });
      expect((await f.store.job(next.id)).duplicate_count).toBe(1);
      const changed = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
      });
      await f.discover(changed.id);
      await f.commit(await f.claim(changed.id), {
        article: { ...f.article, title: "隔离通知修订" },
        bodyHash: "b".repeat(64),
      });
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM knowledge_documents").get(),
      ).toMatchObject({ n: 1 });
      expect(
        f.sqlite
          .prepare("SELECT content_revision FROM knowledge_documents")
          .get(),
      ).toMatchObject({ content_revision: 2 });
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS n FROM console_content_versions")
          .get(),
      ).toMatchObject({ n: 2 });
    } finally {
      f.close();
    }
  });
  it("rejects stale fences, concurrent claims, pause/cancel late results and source revocation", async () => {
    const f = await setup();
    try {
      const lease = await f.claim();
      await expect(
        f.store.claim(f.job.id, cmd(lease.version)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await f.store.control(f.job.id, cmd(lease.version), "pause");
      await expect(
        f.commit(lease, { discovered: [f.url] }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await f.store.control(
        f.job.id,
        cmd(Number((await f.store.job(f.job.id)).version)),
        "resume",
      );
      const next = await f.claim();
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET enabled=0,version=version+1 WHERE id=?",
        )
        .run(p.sourceId);
      await expect(
        f.commit(next, { discovered: [f.url] }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM ingestion_job_steps").get(),
      ).toMatchObject({ n: 0 });
    } finally {
      f.close();
    }
  });
  it("commit retries are idempotent, cannot share command IDs across admins, and do not duplicate counts", async () => {
    const f = await setup();
    try {
      const lease = await f.claim();
      const payload = {
        ...cmd(lease.version),
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        url: lease.url,
        status: 200,
        bytes: 1,
        requests: 1,
        outcome: "ok",
        etag: null,
        lastModified: null,
        bodyHash: null,
        publishedRaw: null,
        discovered: [f.url],
      };
      await f.store.commit(lease.id, payload);
      expect(await f.store.commit(lease.id, payload)).toMatchObject({
        idempotent: true,
      });
      f.sqlite
        .prepare(
          "INSERT INTO console_admins(id,email,role) VALUES('other','other@example.invalid','admin')",
        )
        .run();
      await expect(
        new IngestionStore(f.db, {
          id: "other",
          email: "other@example.invalid",
          role: "admin",
        }).commit(lease.id, payload),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await f.store.job(lease.id)).found_count).toBe(1);
    } finally {
      f.close();
    }
  });
  it("metadata policies reject full body/events and expired policy commits, no partial document survives", async () => {
    const f = await setup();
    try {
      await f.discover();
      const lease = await f.claim();
      await expect(
        f.commit(lease, {
          article: { ...f.article, body: "第三方全文不得提交" },
          bodyHash: "b".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM knowledge_documents").get(),
      ).toMatchObject({ n: 0 });
      f.sqlite
        .prepare("UPDATE source_collection_policies SET expires_at_ms=0")
        .run();
      await expect(
        f.commit(lease, { article: f.article, bodyHash: "b".repeat(64) }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    } finally {
      f.close();
    }
  });
  it("retains typed multi-event extraction only under an explicit licensed fixture policy", async () => {
    const f = await setup("licensed_full_text");
    try {
      await f.discover();
      const body =
        "活动名称：隔离活动甲\n活动时间：2026-12-01 10:00\n地点：测试楼\n活动名称：隔离活动乙\n活动时间：未知\n地点：待核";
      await f.commit(await f.claim(), {
        article: { ...f.article, body },
        bodyHash: "c".repeat(64),
        events: extractEvents(body),
        chunks: [{ text: body, startOffset: 0, endOffset: body.length }],
      });
      const candidates = f.sqlite
        .prepare(
          "SELECT title,starts_at,raw_place_name,verification_status FROM event_candidates ORDER BY ordinal",
        )
        .all();
      expect(candidates).toHaveLength(2);
      expect(candidates[1]).toMatchObject({
        starts_at: null,
        verification_status: "pending",
      });
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM campus_events").get(),
      ).toMatchObject({ n: 0 });
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM knowledge_chunks WHERE index_version IS NULL",
          )
          .get(),
      ).toMatchObject({ n: 1 });
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM knowledge_chunks WHERE index_version='campus-fts-v1'",
          )
          .get(),
      ).toMatchObject({ n: 1 });
    } finally {
      f.close();
    }
  });
  it("retains failure checkpoints and allows a job to pass the former daily request ceiling", async () => {
    const f = await setup();
    try {
      const lease = await f.claim();
      await f.commit(lease, { outcome: "parse_error" });
      expect(await f.store.job(f.job.id)).toMatchObject({
        phase: "discover",
        error_count: 1,
        error_code: "PARSE_ERROR",
        request_count: 2,
      });
      f.sqlite
        .prepare(
          "UPDATE ingestion_jobs SET request_count=20,next_run_after_ms=0",
        )
        .run();
      const resumed = await f.claim();
      expect(resumed.id).toBe(f.job.id);
      expect((await f.store.job(f.job.id)).request_count).toBe(22);
      expect((await f.store.audit({})).items.length).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });
});
describe("ingestion lease identity, clock and write races", () => {
  it("continues jobs created before midnight without a daily application request cap", async () => {
    const f = await setup();
    try {
      f.sqlite
        .prepare("UPDATE ingestion_jobs SET created_at='2020-01-01T00:00:00Z'")
        .run();
      for (let i = 0; i < 10; i++) {
        await f.claim();
        f.sqlite.prepare("UPDATE ingestion_jobs SET lease_until_ms=0").run();
      }
      const next = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
      });
      const lease = await f.claim(next.id);
      expect(lease.id).toBe(next.id);
    } finally {
      f.close();
    }
  });
  it("prioritizes unseen URLs beyond a pinned known article and explicitly revalidates known ones", async () => {
    const f = await setup();
    try {
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      const next = await f.store.createJob({
          commandId: crypto.randomUUID(),
          sourceId: p.sourceId,
        }),
        fresh = f.url.replace("999001", "999002");
      await f.commit(await f.claim(next.id), { discovered: [f.url, fresh] });
      expect((await f.claim(next.id)).url).toBe(fresh);
      await f.store.control(
        next.id,
        cmd(Number((await f.store.job(next.id)).version)),
        "pause",
      );
      const revalidate = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
        mode: "revalidate",
      });
      await f.commit(await f.claim(revalidate.id), {
        discovered: [f.url, fresh],
      });
      expect((await f.claim(revalidate.id)).url).toBe(f.url);
    } finally {
      f.close();
    }
  });
  it("links cross-URL equal fingerprints for review without inheriting an earlier publication", async () => {
    const f = await setup();
    try {
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      const original = f.sqlite
        .prepare("SELECT id FROM knowledge_documents")
        .get()!;
      await f.store.review(String(original.id), {
        ...cmd(1),
        decision: "approved",
        note: "隔离核验",
      });
      await f.store.publish(String(original.id), {
        ...cmd(2),
        note: "隔离发布",
      });
      const next = await f.store.createJob({
          commandId: crypto.randomUUID(),
          sourceId: p.sourceId,
        }),
        url = f.url.replace("999001", "999002");
      await f.commit(await f.claim(next.id), { discovered: [url] });
      await f.commit(await f.claim(next.id), {
        article: { ...f.article, url },
        bodyHash: "a".repeat(64),
      });
      const origin = f.sqlite
        .prepare(
          "SELECT document_id,duplicate_of FROM document_origins WHERE canonical_url=?",
        )
        .get(url)!;
      expect(origin.duplicate_of).toBe(original.id);
      expect(await f.store.document(String(origin.document_id))).toMatchObject({
        reviewStatus: "pending",
        publicationStatus: "draft",
        duplicateOf: original.id,
      });
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS n FROM console_public_documents")
          .get(),
      ).toMatchObject({ n: 1 });
    } finally {
      f.close();
    }
  });
  it("binds a captured lease to its real admin and rejects expired/cancelled results", async () => {
    const f = await setup();
    try {
      const lease = await f.claim();
      f.sqlite
        .prepare(
          "INSERT INTO console_admins(id,email,role) VALUES('lease-other','lease-other@example.invalid','admin')",
        )
        .run();
      const other = new IngestionStore(f.db, {
        id: "lease-other",
        email: "lease-other@example.invalid",
        role: "admin",
      });
      await expect(
        other.commit(lease.id, {
          ...cmd(lease.version),
          leaseToken: lease.leaseToken,
          fence: lease.fence,
          url: lease.url,
          status: 200,
          bytes: 1,
          requests: 1,
          outcome: "ok",
          etag: null,
          lastModified: null,
          bodyHash: null,
          publishedRaw: null,
          discovered: [f.url],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      f.sqlite
        .prepare("UPDATE ingestion_jobs SET lease_until_ms=? WHERE id=?")
        .run(Date.now() - 10, lease.id);
      await expect(
        f.commit(lease, { discovered: [f.url] }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const next = await f.claim();
      expect(next.fence).toBeGreaterThan(lease.fence);
      await f.store.control(next.id, cmd(next.version), "cancel");
      await expect(
        f.commit(next, { discovered: [f.url] }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM ingestion_job_steps").get(),
      ).toMatchObject({ n: 0 });
    } finally {
      f.close();
    }
  });
  it("does not overwrite a human edit racing the commit or partially advance the checkpoint", async () => {
    const f = await setup();
    try {
      await f.discover();
      await f.commit(await f.claim(), {
        article: f.article,
        bodyHash: "a".repeat(64),
      });
      const next = await f.store.createJob({
        commandId: crypto.randomUUID(),
        sourceId: p.sourceId,
      });
      await f.discover(next.id);
      const lease = await f.claim(next.id);
      const original = f.db.batch.bind(f.db);
      f.db.batch = async (statements) => {
        f.db.batch = original;
        f.sqlite.exec(
          "UPDATE knowledge_documents SET title='human edit fixture',version=version+1",
        );
        return original(statements);
      };
      await expect(
        f.commit(lease, {
          article: { ...f.article, title: "remote update" },
          bodyHash: "b".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        f.sqlite.prepare("SELECT title FROM knowledge_documents").get(),
      ).toMatchObject({ title: "human edit fixture" });
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS n FROM console_content_versions")
          .get(),
      ).toMatchObject({ n: 1 });
      expect((await f.store.job(next.id)).phase).toBe("fetch");
    } finally {
      f.close();
    }
  });
});

describe("independent site parsing and safety", () => {
  it("cleans nested table paragraphs once and keeps loose visible text", () => {
    const c = new OfficialWebConnector(p),
      url = p.origin + "/info/1056/1.htm";
    const article = c.parse(
      '<html><head><title>夹具-广东外语外贸大学学生工作部</title></head><body><div id="vsb_content_501"><div class="v_news_content">开头<span>说明</span><table><tr><td><p>只出现一次</p></td></tr></table>结尾</div></div></body></html>',
      url,
    );
    expect(article.bodyText).toBe("开头说明\n只出现一次\n结尾");
  });
  it("keeps article text inside inert VSB forms while removing active controls", () => {
    const c = new OfficialWebConnector(p);
    const parsed = c.parse(
      '<html><head><title>夹具-广东外语外贸大学学生工作部</title></head><body><form><div class="contenthead"><p>发布时间：2020-01-01</p></div><div id="vsb_content_501"><div class="v_news_content"><p>正文</p><input value="secret"><button>提交</button></div></div></form></body></html>',
      p.origin + "/info/1056/1.htm",
    );
    expect(parsed.bodyText).toBe("正文");
    expect(parsed.publishedAt).toBe("2020-01-01");
  });
  it("has five separate exact-host profiles and rejects SSRF/redirect path and external attachment URLs", () => {
    expect(webProfiles).toHaveLength(5);
    for (const profile of webProfiles) {
      expect(() =>
        approvedUrl(profile, "https://127.0.0.1/info/1005/1.htm"),
      ).toThrow();
      expect(() =>
        approvedUrl(
          profile,
          "https://gdufs.edu.cn.evil.invalid/info/1005/1.htm",
        ),
      ).toThrow();
      expect(() =>
        approvedUrl(profile, profile.origin + "/info/1005/1.htm?token=x"),
      ).toThrow();
    }
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254",
      "10.0.0.1",
      "172.16.1.1",
      "192.168.1.1",
      "100.64.1.2",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
  });
  it("obeys robots longest path rules and explicit named-agent blocks", () => {
    expect(
      robotsAllow("User-agent: *\nDisallow: /\nAllow: /public", "/info/a"),
    ).toBe(false);
    expect(
      robotsAllow("User-agent: *\nDisallow: /\nAllow: /public", "/public/a"),
    ).toBe(true);
    expect(
      robotsAllow("User-agent: CampusOS-Research\nDisallow: /", "/info/a"),
    ).toBe(false);
  });
  it("parses local date precision, avoids recommended dates, scripts and navigation attachments", () => {
    expect(originalDate("2020年2月3日")).toBe("2020-02-03");
    expect(originalDate("2020-02-30")).toBeNull();
    const c = new OfficialWebConnector(p),
      html =
        '<html><head><title>隔离通知-广东外语外贸大学学生工作部</title></head><body><aside>2026-10-17</aside><div class="contenthead"><p>发布时间：2020-02-03 10:12:13</p></div><div id="vsb_content_501"><div class="v_news_content"><script>alert(1)</script><p>第一段</p><p hidden>隐藏</p><a href="/file/a.pdf">附件</a></div></div><a href="/navigation.pdf">非正文附件</a></body></html>';
    const parsed = c.parse(html, p.origin + "/info/1056/1.htm");
    expect(parsed.title).toBe("隔离通知");
    expect(parsed.publishedAt).toBe("2020-02-03T02:12:13.000Z");
    expect(parsed.bodyText).toBe("第一段\n附件");
    expect(parsed.attachments).toHaveLength(1);
    expect(
      c.normalize(parsed, p.origin + "/info/1056/1.htm").body,
    ).not.toContain("第一段");
    expect(() =>
      c.parse("<h1>structure changed</h1>", p.origin + "/info/1056/1.htm"),
    ).toThrow("PARSE_ERROR");
  });
  it("discovers same-column URLs, real next-page links, and leaves ambiguous dates unknown", () => {
    const c = new OfficialWebConnector(p);
    expect(
      c.discover(
        '<a href="../info/1056/1.htm">甲</a><a href="../info/1056/1.htm">重复</a><a href="../info/1051/2.htm">其他栏</a><a href="tzgg/37.htm">下一页</a>',
      ),
    ).toEqual({
      urls: [p.origin + "/info/1056/1.htm"],
      nextPage: p.origin + "/index/tzgg/37.htm",
      dates: [{ url: p.origin + "/info/1056/1.htm", publishedAt: null }],
      undatedUrls: [p.origin + "/info/1056/1.htm"],
      allDatedBeforeCutoff: false,
    });
  });
});
