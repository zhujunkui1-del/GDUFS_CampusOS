import { it, expect, vi } from "vitest";
import { meteredClient } from "@/lib/server/assistant/model-run";
import { MockModelProvider } from "../fixtures/mock-model";
import { AssistantStore } from "@/lib/server/assistant/store";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import type { ModelSnapshot } from "@/domain/models/contracts";

const snapshot: ModelSnapshot = {
  source: "platform",
  provider: "stepfun",
  model: "fixture",
  policyVersion: "fixture",
  testedAt: "2026-10-28",
  capabilities: {
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  },
};
const reply = (content: string) => ({
  content,
  toolCalls: [],
  finishReason: "stop" as const,
  usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
});

function bounded(
  f: ReturnType<typeof sqliteD1>,
  client: MockModelProvider,
  validateFinal: (text: string) => string | { message: string; hard?: boolean } | undefined,
) {
  const store = new AssistantStore(f.db);
  vi.spyOn(store, "running").mockResolvedValue();
  return meteredClient(
    client,
    snapshot,
    store,
    "fixture",
    "fixture",
    () => true,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    1024,
    undefined,
    { validateFinal },
  );
}

it("ships a usable answer when a style rule is still unmet after the repair", async () => {
  // The model keeps answering without the [n] marker. The rule is a style
  // defect, so the second attempt must reach the user instead of being
  // reported as “回复生成异常”.
  const f = sqliteD1();
  try {
    const client = new MockModelProvider([reply("校医院周末开放。"), reply("周六上午开放。")]);
    const metered = bounded(f, client, () => "每项事实必须标 [n]");
    const answer = await metered.client.generateWithTools({
      messages: [],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
    });
    expect(answer.content).toBe("周六上午开放。");
    expect(client.requests).toHaveLength(2);
    expect(metered.metrics().softAcceptances).toBe(1);
  } finally {
    f.close();
  }
});

it("still refuses a hard rule violation", async () => {
  const f = sqliteD1();
  try {
    const client = new MockModelProvider([reply("已在地图上标出。"), reply("已在地图上标出。")]);
    const metered = bounded(f, client, () => ({
      message: "本轮没有执行地图动作",
      hard: true,
    }));
    await expect(
      metered.client.generateWithTools({
        messages: [],
        tools: [],
        maxTokens: 1024,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(metered.metrics().softAcceptances).toBe(0);
  } finally {
    f.close();
  }
});

it("accepts the first answer when the validator passes", async () => {
  const f = sqliteD1();
  try {
    const client = new MockModelProvider([reply("校医院周末开放[1]。")]);
    const metered = bounded(f, client, () => undefined);
    const answer = await metered.client.generateWithTools({
      messages: [],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
    });
    expect(answer.content).toBe("校医院周末开放[1]。");
    expect(client.requests).toHaveLength(1);
  } finally {
    f.close();
  }
});
