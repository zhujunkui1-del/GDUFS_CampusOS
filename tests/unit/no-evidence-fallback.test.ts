import { it, expect, vi } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { MockModelProvider } from "../fixtures/mock-model";
import { ApiError } from "@/lib/server/errors";
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

const DORM_TITLE = "宿舍熄灯时间";
const DORM_BODY =
  "<p>宿舍熄灯时间为每日23时30分，节假日顺延，请同学们按时作息。</p>";
const QUESTION = "宿舍熄灯时间是几点？";

async function ask(
  client: MockModelProvider,
  question = QUESTION,
  body = DORM_BODY,
) {
  const f = await dateGateFixture();
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
        `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES('dorm-fixture',?,?,?,'${body}','reading_html','complete','dorm','2026-10-25','all','campus_announcements','2026-10-24',1,?,'licensed_full_text','notice','campus_life')`,
      )
      .run(
        f.source.id,
        DORM_TITLE,
        "https://example.invalid/dorm",
        "d".repeat(64),
      );
    await f.store.publishCollectedWebArticle("dorm-fixture");
    await ensureRetrievalIndex(f.db, "dorm-fixture");
    const response = await chatResponse(
      new Request("https://campus.invalid/api/agent/chat", {
        method: "POST",
        headers: {
          Origin: "https://campus.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
          clientRequestId: crypto.randomUUID(),
        }),
      }),
    );
    const events = (await response.text()).split("\n\n").flatMap((frame) => {
      const raw = frame.split("\n").find((line) => line.startsWith("data:"));
      return raw ? [JSON.parse(raw.slice(5))] : [];
    });
    return {
      requests: client.requests.length,
      text: events
        .filter((event) => event.type === "message.delta")
        .map((event) => String(event.payload.text))
        .join(""),
      metrics: events.find((event) => event.type === "run.completed")?.payload
        .metrics,
      failed: events.filter((event) => event.type === "run.failed"),
    };
  } finally {
    f.close();
  }
}

it("answers a data gap with no-evidence instead of an outage when the model fails", async () => {
  // Nine of fifty real questions ended as “回复生成异常” because the model
  // burned its repair rounds and then the whole run failed. A data gap must
  // look like a data gap, not like an outage.
  const { requests, failed, metrics, text } = await ask(
    new MockModelProvider([
      new ApiError(
        "MODEL_SERVICE_UNAVAILABLE",
        "回复生成异常，请重新提问。",
        true,
      ),
    ]),
  );
  expect(requests).toBeGreaterThan(0);
  expect(failed).toHaveLength(0);
  // The model died, but the run still has a real answer: either the retained
  // excerpt or the fixed no-evidence sentence. It must never be “回复生成异常”.
  expect(metrics?.modelFailureCode).toBe("MODEL_SERVICE_UNAVAILABLE");
  expect(["no_evidence", "evidence_excerpt"]).toContain(metrics?.answerMode);
  expect(text).not.toContain("回复生成异常");
  expect(text.length).toBeGreaterThan(10);
});

it("does not demand a citation for a refusal", async () => {
  // The refusal quotes nothing, so it cannot cite [n]. Requiring one made
  // every no-evidence answer fail validation twice.
  const reply = {
    content:
      "本鱼目前没有检索到能回答这个问题的正文信息，建议通过学校官网核实。",
    toolCalls: [],
    finishReason: "stop" as const,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
  const { requests, failed, text } = await ask(new MockModelProvider([reply]));
  expect(requests).toBeGreaterThan(0);
  expect(failed).toHaveLength(0);
  expect(text).toContain("没有检索到能回答这个问题的正文信息");
});
