import { expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ApiError } from "@/lib/server/errors";
import { MockModelProvider } from "../fixtures/mock-model";
const fixtureRuntime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  resolve: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: fixtureRuntime.env }),
}));
vi.mock("@/lib/server/models/runtime", () => ({
  defaultModelRuntime: () => ({ resolve: fixtureRuntime.resolve }),
}));
import { chatResponse } from "@/lib/server/assistant/chat";

it("keeps actual retrieved food evidence usable after the generation provider times out", async () => {
  const f = sqliteD1();
  const relay = vi.fn(async () =>
    Response.json({
      provider: "isolated-food-provider",
      status: "ok",
      durationMs: 1,
      items: [
        {
          title: "南校一饭餐品分享",
          originalUrl: "https://example.invalid/food",
          sourceName: "隔离作者",
          platform: "xiaohongshu",
          authority: "student_experience",
          evidenceKind: "page_excerpt",
          snippet: "我喜欢一饭的自选咕噜肉。",
          publishedAt: "2026-09-17",
          retrievedAt: new Date().toISOString(),
          searchMode: "platform",
          canConfirmAdministrativeFacts: false,
        },
      ],
    }),
  );
  fixtureRuntime.env = {
    DB: f.db,
    APP_ENV: "preview",
    AGENT_VALIDATION_UNLIMITED: "true",
    AGENT_SIGNING_SECRET:
      "isolated-test-signing-key-at-least-thirty-two-characters",
    EXTERNAL_SEARCH_TRANSPORT: "cloud",
    CLOUD_SEARCH: { fetch: relay },
    CLOUD_SEARCH_TOKEN: "isolated-only",
    EXTERNAL_WEB_SEARCH_ENABLED: "false",
  };
  const client = new MockModelProvider([
    new ApiError("MODEL_TIMEOUT", "模型回复超时，请重试。", true),
  ]);
  fixtureRuntime.resolve.mockResolvedValue({
    client,
    snapshot: {
      source: "platform",
      provider: "stepfun",
      model: "isolated",
      policyVersion: "isolated",
      testedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    },
  });
  try {
    const response = await chatResponse(
      new Request("https://campus.invalid/api/agent/chat", {
        method: "POST",
        headers: {
          Origin: "https://campus.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "有什么好吃的吗",
          clientRequestId: crypto.randomUUID(),
        }),
      }),
    );
    expect(response.status).toBe(200);
    const stream = await response.text();
    const events = stream.split("\n\n").flatMap((frame) => {
      const raw = frame.split("\n").find((line) => line.startsWith("data:"));
      return raw ? [JSON.parse(raw.slice(5))] : [];
    });
    const terminal = events.find((e) => e.type === "run.completed");
    expect(terminal?.payload.metrics).toMatchObject({
      answerMode: "evidence_excerpt",
      modelFailureCode: "MODEL_TIMEOUT",
      requests: 1,
      usageComplete: false,
    });
    expect(
      events
        .filter((e) => e.type === "message.delta")
        .map((e) => e.payload.text)
        .join(""),
    ).toContain("自选咕噜肉");
    expect(
      events.some(
        (e) =>
          e.type === "tool.started" &&
          e.payload.name === "search_external_campus_info",
      ),
    ).toBe(true);
    expect(relay).toHaveBeenCalledOnce();
    expect(client.requests).toHaveLength(1);
    expect(
      JSON.stringify(
        client.requests[0].messages.filter(
          (message) => message.role === "system",
        ),
      ),
    ).not.toContain("必须实际检索");
  } finally {
    f.close();
  }
});
