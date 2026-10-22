import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { tokenHash } from "@/lib/server/assistant/crypto";
import { sanitizeReadingHtml } from "@/lib/server/console/reading-html";

const cloudflare = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: cloudflare.context,
}));
import { collectorApi } from "@/lib/server/console/collector-api";

const token = "isolated-test-collector-" + "x".repeat(40);
const sourceId = "collector-test-source";
const adminId = "collector-test-admin";
let fixture: ReturnType<typeof sqliteD1>;

beforeEach(async () => {
  fixture = sqliteD1();
  fixture.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(adminId, "collector@example.invalid");
  fixture.sqlite
    .prepare(
      "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,enabled,console_managed,channel_type) VALUES(?,'隔离公众号','official_account','[]','[]','{}',1,1,'wechat_subscription')",
    )
    .run(sourceId);
  fixture.sqlite
    .prepare(
      "INSERT INTO campus_collector_sources(source_id,account_id,approved_by,permission_basis,updated_at) VALUES(?,'MP_WXS_1234567890',?,'owner_instruction',?)",
    )
    .run(sourceId, adminId, new Date().toISOString());
  fixture.sqlite
    .prepare(
      "INSERT INTO campus_collector_tokens(id,token_hash,label,source_ids_json,admin_id,created_at,expires_at_ms) VALUES('collector-test-token',?,'隔离凭据',?,?,?,0)",
    )
    .run(
      await tokenHash(token),
      JSON.stringify([sourceId]),
      adminId,
      new Date().toISOString(),
    );
  cloudflare.context.mockReturnValue({
    env: {
      DB: fixture.db,
      APP_ENV: "local",
      CONSOLE_ADMIN_EMAILS: "collector@example.invalid",
      CONSOLE_SESSION_SECRET: "isolated-console-secret-" + "x".repeat(40),
    },
  });
  cloudflare.context.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
});

function article() {
  return {
    requestId: crypto.randomUUID(),
    sourceId,
    accountId: "MP_WXS_1234567890",
    title: "隔离校园通知",
    url: "https://mp.weixin.qq.com/s/abcdefghijklmnop",
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
    sourceUpdatedAt: null,
    observedAt: new Date(Date.now() - 60000).toISOString(),
    readingHtml: "<article><p>隔离文章正文。</p></article>",
    renderingVersion: 2,
    mediaOmitted: false,
    provenance: "local_export",
  };
}

function submit(value: unknown, path = "articles", method = "POST") {
  return collectorApi(
    new Request("https://campusos.invalid/api/collector/" + path, {
      method,
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(value),
    }),
  );
}

function snapshot() {
  return {
    documents: fixture.sqlite
      .prepare("SELECT * FROM knowledge_documents")
      .all(),
    articles: fixture.sqlite
      .prepare("SELECT * FROM campus_collector_articles")
      .all(),
    receipts: fixture.sqlite
      .prepare("SELECT * FROM campus_collector_receipts")
      .all(),
    changes: fixture.sqlite.prepare("SELECT total_changes() AS n").get(),
  };
}

async function staleHashArticle(mediaOmitted: boolean) {
  const input = {
    ...article(),
    mediaOmitted,
    readingHtml:
      '<article><p>保留原排版的正文。</p><img data-src="https://mmbiz.qpic.cn/isolated-image" data-w="100" data-ratio="0.5"></article>',
  };
  const created = await submit(input);
  expect(created.status).toBe(200);
  const id = (await created.json()).data.documentId;
  const firstBody = sanitizeReadingHtml(input.readingHtml).html;
  expect(snapshot().documents[0].body).toBe(firstBody);
  // Synthesized dimensions move before src on a second sanitization. An old
  // stored hash therefore cannot be repaired by normalizing the body again.
  expect(sanitizeReadingHtml(firstBody).html).not.toBe(firstBody);
  fixture.sqlite
    .prepare(
      "UPDATE campus_collector_articles SET current_hash=? WHERE document_id=?",
    )
    .run("f".repeat(64), id);
  return { input, id, firstBody };
}

describe("collector only adds or updates cloud articles", () => {
  it.each([
    ["POST", "observations"],
    ["POST", "observations/"],
    ["DELETE", "articles"],
    ["DELETE", "articles/any-id"],
    ["DELETE", "unknown"],
  ])("rejects %s %s before body, credentials or D1", async (method, path) => {
    cloudflare.context.mockImplementationOnce(() => {
      throw new Error("D1 is unavailable");
    });
    const request = new Request(
      "https://campusos.invalid/api/collector/" + path,
      { method, body: "malformed JSON" },
    );
    const response = await collectorApi(request);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(request.bodyUsed).toBe(false);
    expect(cloudflare.context).not.toHaveBeenCalled();
    cloudflare.context.mockReset();
  });

  it("keeps a published body intact for every legacy removal outcome", async () => {
    const input = article();
    const created = await submit(input);
    expect(created.status).toBe(200);
    const before = snapshot();
    for (const outcome of [
      "http404",
      "http410",
      "platform_deleted",
      "access_failed",
    ]) {
      // Repeat observations used to progress suspected-missing to withdrawn.
      for (const observedAt of [
        new Date(Date.now() - 1800001).toISOString(),
        new Date().toISOString(),
      ]) {
        const response = await submit(
          {
            requestId: crypto.randomUUID(),
            sourceId,
            url: input.url,
            observedAt,
            outcome,
          },
          "observations",
        );
        expect(response.status).toBe(403);
      }
    }
    expect(snapshot()).toEqual(before);
    expect(before.documents[0]).toMatchObject({
      publication_status: "published",
      lifecycle_status: "active",
    });
    expect(before.documents[0].body).toContain("隔离文章正文。");
  });

  it("creates, replays and updates one article without duplicates or unpublishing", async () => {
    const input = article();
    const first = await submit(input);
    expect(first.status).toBe(200);
    const initial = (await first.json()).data;
    const beforeReplay = snapshot();
    const replay = await submit(input);
    expect(replay.status).toBe(200);
    expect((await replay.json()).data).toEqual(initial);
    expect(snapshot()).toEqual(beforeReplay);
    const update = await submit({
      ...input,
      requestId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      title: "隔离校园通知更新",
      readingHtml: "<article><p>更新后的隔离正文。</p></article>",
    });
    expect(update.status).toBe(200);
    expect((await update.json()).data).toMatchObject({
      documentId: initial.documentId,
      state: "published",
      changed: 1,
    });
    const after = snapshot();
    expect(after.documents).toHaveLength(1);
    expect(after.articles).toHaveLength(1);
    expect(after.documents[0]).toMatchObject({
      title: "隔离校园通知更新",
      publication_status: "published",
      lifecycle_status: "active",
      content_revision: 2,
    });
    expect(after.documents[0].body).toContain("更新后的隔离正文。");
  });

  it("repairs a stale hash for the exact stored body without reformatting or losing the partial flag", async () => {
    const { input, firstBody } = await staleHashArticle(true);
    const response = await submit({ ...input, requestId: crypto.randomUUID() });
    expect(response.status).toBe(200);
    const after = snapshot();
    expect(after.documents).toHaveLength(1);
    expect(after.documents[0]).toMatchObject({
      body: firstBody,
      body_status: "partial",
      publication_status: "published",
    });
    expect(after.articles[0].current_hash).toBe(after.documents[0].input_hash);
    expect(after.articles[0].current_hash).not.toBe("f".repeat(64));
    expect(after.articles[0].media_omitted).toBe(1);
  });

  it("accepts the original export's omitted-media flag as a monotonic correction for identical content", async () => {
    const { input, firstBody } = await staleHashArticle(false);
    const response = await submit({
      ...input,
      requestId: crypto.randomUUID(),
      mediaOmitted: true,
    });
    expect(response.status).toBe(200);
    expect(snapshot().documents[0]).toMatchObject({
      body: firstBody,
      body_status: "partial",
      publication_status: "published",
    });
    expect(snapshot().articles[0].media_omitted).toBe(1);
  });

  it("preserves known omitted media when saved metadata lost it, including replay after a newer update", async () => {
    const { input, firstBody } = await staleHashArticle(true);
    const replayInput = {
      ...input,
      requestId: crypto.randomUUID(),
      mediaOmitted: false,
    };
    const response = await submit(replayInput);
    expect(response.status).toBe(200);
    const receipt = (await response.json()).data;
    expect(snapshot().documents[0]).toMatchObject({
      body: firstBody,
      body_status: "partial",
      publication_status: "published",
    });
    expect(snapshot().articles[0].media_omitted).toBe(1);
    const update = await submit({
      ...input,
      requestId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      readingHtml: "<article><p>后续真实更新的完整正文。</p></article>",
      mediaOmitted: false,
    });
    expect(update.status).toBe(200);
    expect(snapshot().articles[0].media_omitted).toBe(0);
    const beforeReplay = snapshot();
    const replay = await submit(replayInput);
    expect(replay.status).toBe(200);
    expect((await replay.json()).data).toEqual(receipt);
    expect(snapshot()).toEqual(beforeReplay);
  });

  it.each(["title", "publishedAt", "sourceUpdatedAt", "readingHtml"])(
    "rejects changed %s at the same observation even when an old hash is stale",
    async (field) => {
      const { input } = await staleHashArticle(true);
      const before = snapshot();
      const response = await submit({
        ...input,
        requestId: crypto.randomUUID(),
        [field]:
          field === "title"
            ? "改过标题的通知"
            : field === "readingHtml"
              ? "<article><p>不同的正文。</p></article>"
              : new Date(Date.parse(input.publishedAt) - 60000).toISOString(),
      });
      expect(response.status).toBe(409);
      expect(snapshot()).toEqual(before);
    },
  );

  it("rejects a same-observation omission downgrade when the body also changes", async () => {
    const { input } = await staleHashArticle(true);
    const before = snapshot();
    const response = await submit({
      ...input,
      requestId: crypto.randomUUID(),
      readingHtml: "<article><p>正文已变且遗漏标记被清除。</p></article>",
      mediaOmitted: false,
    });
    expect(response.status).toBe(409);
    expect(snapshot()).toEqual(before);
  });

  it("preserves administrator holds when a newer local article arrives", async () => {
    const input = article();
    const first = await submit(input);
    expect(first.status).toBe(200);
    const id = (await first.json()).data.documentId;
    fixture.sqlite
      .prepare(
        "UPDATE console_document_controls SET hold_reason='manual_withdrawal' WHERE document_id=?",
      )
      .run(id);
    fixture.sqlite
      .prepare(
        "UPDATE knowledge_documents SET publication_status='withdrawn',lifecycle_status='withdrawn' WHERE id=?",
      )
      .run(id);
    const response = await submit({
      ...input,
      requestId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      readingHtml: "<article><p>管理员撤回后收到的新正文。</p></article>",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.state).toBe("held");
    expect(snapshot().documents[0].publication_status).not.toBe("published");
    expect(
      fixture.sqlite
        .prepare(
          "SELECT hold_reason FROM console_document_controls WHERE document_id=?",
        )
        .get(id),
    ).toMatchObject({ hold_reason: "manual_withdrawal" });
  });

  it("still rejects account mismatches, date-gate violations and revoked credentials", async () => {
    const input = article();
    const wrongAccount = await submit({
      ...input,
      accountId: "MP_WXS_9999999999",
    });
    expect(wrongAccount.status).toBe(403);
    fixture.sqlite
      .prepare("UPDATE console_engine_settings SET earliest_import_day=?")
      .run(new Date().toISOString().slice(0, 10));
    const beforeGate = await submit(input);
    expect(beforeGate.status).toBe(400);
    fixture.sqlite
      .prepare("UPDATE campus_collector_tokens SET revoked_at=?")
      .run(new Date().toISOString());
    const revoked = await submit(input);
    expect(revoked.status).toBe(401);
    expect(snapshot().documents).toHaveLength(0);
    expect(snapshot().receipts).toHaveLength(0);
  });
});
