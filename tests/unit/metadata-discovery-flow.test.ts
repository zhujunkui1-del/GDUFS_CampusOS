import { it, expect, vi } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { MockModelProvider } from "../fixtures/mock-model";
const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  resolve: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: runtime.env }),
}));
vi.mock("@/lib/server/models/runtime", () => ({
  defaultModelRuntime: () => ({ resolve: runtime.resolve }),
}));
import { chatResponse } from "@/lib/server/assistant/chat";
it("treats a title-only hit as no body evidence instead of answering with it", async () => {
  const f = await dateGateFixture(),
    client = new MockModelProvider([]);
  runtime.env = {
    DB: f.db,
    APP_ENV: "preview",
    AGENT_VALIDATION_UNLIMITED: "true",
    AGENT_SIGNING_SECRET: "isolated-signing-key-at-least-thirty-two-characters",
  };
  runtime.resolve.mockResolvedValue({
    client,
    snapshot: {
      source: "platform",
      provider: "stepfun",
      model: "fixture",
      policyVersion: "fixture",
      testedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    },
  });
  try {
    f.sqlite
      .prepare(
        `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES('metadata-fixture',?,'图书馆借阅规则','https://example.invalid/borrow','仅元数据','plain','not_provided','meta','2026-10-28','all','campus_announcements','2026-10-28',1,?,'metadata_only','guide','campus_life')`,
      )
      .run(f.source.id, "c".repeat(64));
    await f.store.publishCollectedWebArticle("metadata-fixture");
    await ensureRetrievalIndex(f.db, "metadata-fixture");
    const r = await chatResponse(
      new Request("https://campus.invalid/api/agent/chat", {
        method: "POST",
        headers: {
          Origin: "https://campus.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "只查内部图书馆借阅规则",
          clientRequestId: crypto.randomUUID(),
        }),
      }),
    );
    const events = (await r.text()).split("\n\n").flatMap((frame) => {
      const d = frame.split("\n").find((l) => l.startsWith("data:"));
      return d ? [JSON.parse(d.slice(5))] : [];
    });
    expect(
      events.find((e) => e.type === "run.completed")?.payload.metrics
        .answerMode,
    ).toBe("no_evidence");
    const cards = events
      .filter((e) => e.type === "artifact.ready")
      .flatMap((e) => e.payload.cards || []);
    expect(cards).toHaveLength(0);
    const text = events
      .filter((e) => e.type === "message.delta")
      .map((e) => e.payload.text)
      .join("");
    expect(text).toContain("没有检索到能回答这个问题的正文信息");
    expect(text).toContain("（查过：");
    expect(text).toContain("图书馆借阅规则");
    expect(client.requests).toHaveLength(0);
  } finally {
    f.close();
  }
});
