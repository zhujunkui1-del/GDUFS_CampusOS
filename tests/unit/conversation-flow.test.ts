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
import { createConsoleSession } from "@/lib/server/console/auth";
import type { ModelReply } from "@/domain/models/contracts";

type Event = {
  type: string;
  payload: Record<string, unknown>;
};

async function runTurn(
  message: string,
  replies: (string | ModelReply)[],
  setup?: (f: ReturnType<typeof sqliteD1>) => void,
  workflow = false,
) {
  const f = sqliteD1();
  setup?.(f);
  fixtureEnv(f);
  const session = workflow
    ? await createConsoleSession(
        new Request("https://campus.invalid/api/console-auth", {
          method: "POST",
        }),
        { key: consoleKey },
      )
    : null;
  const client = new MockModelProvider(
    replies.map((content) =>
      typeof content === "string"
        ? {
            content,
            finishReason: "stop" as const,
            toolCalls: [],
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          }
        : content,
    ),
  );
  runtime.resolve.mockResolvedValue({ client, snapshot });
  const response = await chatResponse(
    new Request("https://campus.invalid/api/agent/chat", {
      method: "POST",
      headers: {
        Origin: "https://campus.invalid",
        "Content-Type": "application/json",
        ...(session
          ? {
              "X-CampusOS-Workflow": "1",
              "X-Console-CSRF": session.csrf,
              Cookie: session.cookie.split(";")[0],
            }
          : {}),
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

const consoleKey = "isolated-test-console-key-for-workflow-access";
function fixtureEnv(f: ReturnType<typeof sqliteD1>) {
  runtime.env = {
    DB: f.db,
    APP_ENV: "preview",
    CONSOLE_AUTH_MODE: "admin_key",
    CONSOLE_ADMIN_ACCESS_KEY: consoleKey,
    CONSOLE_ORIGIN: "https://campus.invalid",
    CONSOLE_ADMIN_EMAILS: "admin@example.invalid",
    CONSOLE_SESSION_SECRET: "isolated-test-console-secret-for-workflow-access",
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

it("rejects a workflow run without a Console session before reading the chat", async () => {
  const f = sqliteD1();
  try {
    fixtureEnv(f);
    const response = await chatResponse(
      new Request("https://campus.invalid/api/agent/chat", {
        method: "POST",
        headers: { "X-CampusOS-Workflow": "1" },
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("workflow");
  } finally {
    f.close();
  }
});

function answered(events: Event[]) {
  return events
    .filter((event) => event.type === "message.delta")
    .map((event) => String(event.payload.text))
    .join("");
}

// A roleplay sentence is ordinary chat: answer in character, never search.
it("answers an in-character roleplay turn without searching", async () => {
  const { f, events } = await runTurn("你是一只大肥鱼", [
    "哼，本鱼当然是又大又肥的那条，不过校园问题还是得好好问。",
  ]);
  try {
    const terminal = events.find((event) => event.type === "run.completed");
    expect(terminal?.payload.metrics).toMatchObject({ requests: 1 });
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
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

it("keeps a building service-location question on live owner evidence rather than forcing map tools", async () => {
  const description = "收发室取挂号信要提供编码和日期。";
  const { f, client, events } = await runTurn(
    "我想取挂号信，去校行政办公楼需要准备哪些信息？",
    ["校园建筑资料记载，取挂号信需提供编码和日期。"],
    (fixture) => {
      fixture.sqlite
        .prepare(
          "INSERT INTO building_profiles(place_id,description,photos_json,updated_at) VALUES(?,?,'[]',?)",
        )
        .run("osm-way-307437432", description, new Date().toISOString());
    },
  );
  try {
    expect(
      events.find((event) => event.type === "run.completed")?.payload.metrics,
    ).toMatchObject({ answerMode: "building_profile" });
    expect(answered(events)).toContain("编码和日期");
    expect(JSON.stringify(client.requests)).toContain(description);
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
  } finally {
    f.close();
  }
});

it("streams opt-in workflow stages for the real chat path without exposing system prompts", async () => {
  const { f, events, client } = await runTurn(
    "图书馆有几层？",
    ["图书馆有五层。"],
    (fixture) => {
      fixture.sqlite
        .prepare(
          "INSERT INTO building_profiles(place_id,description,photos_json,updated_at) VALUES(?,?,'[]',?)",
        )
        .run(
          "osm-way-307250998",
          "图书馆五层，提供自习室。",
          new Date().toISOString(),
        );
    },
    true,
  );
  try {
    expect((await runtime.resolve.mock.results.at(-1)!.value).client).toBe(
      client,
    );
    const stages = events
      .filter((event) => event.payload.workflow)
      .map(
        (event) => event.payload.workflow as { node: string; state: string },
      );
    for (const node of [
      "input",
      "gate",
      "route",
      "building",
      "events",
      "model",
      "expression",
      "output",
    ])
      expect(
        stages.some(
          (stage) => stage.node === node && stage.state === "success",
        ),
        node,
      ).toBe(true);
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    expect(JSON.stringify(stages)).not.toContain("AGENT_SIGNING_SECRET");
  } finally {
    f.close();
  }
});

it("uses the same model requests and answer for a fresh conversation on both surfaces", async () => {
  const question = "你是一只大肥鱼吗？";
  const replies = ["是呀，本鱼就在这儿。"];
  const assistant = await runTurn(question, replies);
  try {
    const studio = await runTurn(question, replies, undefined, true);
    try {
      expect(answered(studio.events)).toBe(answered(assistant.events));
      expect(answered(studio.events)).toContain("本鱼就在这儿");
      expect(
        studio.client.requests.map(({ messages, tools }) => ({
          messages,
          tools,
        })),
      ).toEqual(
        assistant.client.requests.map(({ messages, tools }) => ({
          messages,
          tools,
        })),
      );
      expect(
        studio.events.filter((event) => event.payload.workflow),
      ).not.toHaveLength(0);
      expect(
        assistant.events.filter((event) => event.payload.workflow),
      ).toHaveLength(0);
    } finally {
      studio.f.close();
    }
  } finally {
    assistant.f.close();
  }
});

it("observes a map command in the studio without dispatching an action or claiming success", async () => {
  const { f, events } = await runTurn(
    "切换到2.5D",
    [
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "switch-mode",
            type: "function",
            function: {
              name: "control_map",
              arguments: JSON.stringify({
                actions: [{ type: "SET_VIEW_MODE", mode: "2.5d" }],
              }),
            },
          },
        ],
      },
      "已切换到2.5D。",
    ],
    undefined,
    true,
  );
  try {
    expect(answered(events)).toBe("请在校园地图执行此操作。");
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    expect(events.some((event) => event.payload.packet)).toBe(false);
    expect(events.map((event) => event.payload.workflow)).toContainEqual(
      expect.objectContaining({ node: "receipt", state: "skipped" }),
    );
  } finally {
    f.close();
  }
});
