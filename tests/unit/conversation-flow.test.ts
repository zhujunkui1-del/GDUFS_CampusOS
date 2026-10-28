import { expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
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

type Event = {
  type: string;
  payload: Record<string, unknown>;
};

async function runTurn(message: string, replies: string[]) {
  const f = sqliteD1();
  fixtureEnv(f);
  const client = new MockModelProvider(
    replies.map((content) => ({
      content,
      finishReason: "stop" as const,
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    })),
  );
  runtime.resolve.mockResolvedValue({ client, snapshot });
  const response = await chatResponse(
    new Request("https://campus.invalid/api/agent/chat", {
      method: "POST",
      headers: {
        Origin: "https://campus.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, clientRequestId: crypto.randomUUID() }),
    }),
  );
  const events = (await response.text()).split("\n\n").flatMap((frame) => {
    const raw = frame.split("\n").find((line) => line.startsWith("data:"));
    return raw ? [JSON.parse(raw.slice(5)) as Event] : [];
  });
  return { f, client, events };
}

const snapshot = {
  source: "platform" as const,
  provider: "stepfun" as const,
  model: "isolated",
  policyVersion: "isolated",
  testedAt: "2026-10-28T00:00:00Z",
  capabilities: {
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  },
};

function fixtureEnv(f: ReturnType<typeof sqliteD1>) {
  runtime.env = {
    DB: f.db,
    APP_ENV: "preview",
    AGENT_VALIDATION_UNLIMITED: "true",
    AGENT_SIGNING_SECRET:
      "isolated-test-signing-key-at-least-thirty-two-characters",
    EXTERNAL_SEARCH_TRANSPORT: "cloud",
    CLOUD_SEARCH: {
      fetch: async () =>
        Response.json({
          provider: "isolated",
          status: "empty",
          durationMs: 1,
          items: [],
        }),
    },
    CLOUD_SEARCH_TOKEN: "isolated-only",
    EXTERNAL_WEB_SEARCH_ENABLED: "false",
  };
}

function answered(events: Event[]) {
  return events
    .filter((event) => event.type === "message.delta")
    .map((event) => String(event.payload.text))
    .join("");
}

// The reported regression: a roleplay sentence was sent to the internet and the
// model was never asked to reply. Assert the actual HTTP run, not one function.
it("answers a roleplay turn directly with no tools and no evidence gate", async () => {
  const { f, client, events } = await runTurn("你是一只大肥鱼", [
    "本鱼才不是随便被定义的鱼，不过你说是，那就先当一会儿吧。🐋",
  ]);
  try {
    const terminal = events.find((event) => event.type === "run.completed");
    expect(terminal?.payload.metrics).toMatchObject({
      answerMode: "model",
      conversationAct: "chitchat",
      evidenceGateUsed: false,
      requests: 1,
    });
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0].tools).toHaveLength(0);
    expect(JSON.stringify(client.requests[0].messages)).toContain("通用知识");
    expect(answered(events)).toContain("本鱼");
  } finally {
    f.close();
  }
});

// The reported refusal: advice with no campus article was turned into
// "本次没有取得足以回答问题的正文证据". It must now answer and keep the gap.
it("answers general housing advice instead of refusing for missing campus text", async () => {
  const { f, client, events } = await runTurn(
    "住广外宿舍有什么要注意的事情吗",
    [
      "宿舍生活可以先按几条通用建议来：防潮通风、用电安全、和室友沟通作息、把物品分区收纳。广外各栋的具体门禁、收费和设备配置我这轮还没取得资料，以学校公布为准。",
    ],
  );
  try {
    const terminal = events.find((event) => event.type === "run.completed");
    expect(terminal?.payload.metrics).toMatchObject({
      answerMode: "model",
      conversationAct: "campus",
      answerRequirement: "advisory",
      evidenceGateUsed: false,
    });
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" &&
          event.payload.name === "search_campus_knowledge",
      ),
    ).toBe(true);
    expect(answered(events)).toContain("通用建议");
    expect(answered(events)).not.toContain("没有取得足以回答问题的正文证据");
    expect(JSON.stringify(client.requests[0].messages)).toContain("通用常识");
  } finally {
    f.close();
  }
});

it("keeps a specific campus fact on the evidence gate when no body exists", async () => {
  const { f, events } = await runTurn("只查内部图书馆借阅规则", []);
  try {
    const terminal = events.find((event) => event.type === "run.completed");
    expect(terminal?.payload.metrics).toMatchObject({
      answerMode: "no_evidence",
      answerRequirement: "strict",
      evidenceGateUsed: true,
      requests: 0,
    });
  } finally {
    f.close();
  }
});
