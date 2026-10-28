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
it("checks claim-to-source support before streaming and repairs a real cross-turn citation mismatch", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db);
    vi.spyOn(store, "running").mockResolvedValue();
    const client = new MockModelProvider([
      reply("校运会11月20日举行[来源5]"),
      reply(
        '{"supported":false,"issues":["来源5只有羽毛球通知，不支持校运会日期"]}',
      ),
      reply("新生杯羽毛球赛10月31日举行，当前报名状态未知[来源5]"),
      reply('{"supported":true,"issues":[]}'),
    ]);
    const bounded = meteredClient(
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
      {
        groundingEvidence: () => ({
          question: "羽毛球还能报名吗",
          sources: [
            {
              citation: 5,
              title: "新生杯羽毛球通知",
              snippet: "比赛定于2026年10月31日在体育馆举行，报名方法见附件。",
            },
          ],
        }),
      },
    );
    const emit = vi.fn();
    const answer = await bounded.client.generateWithTools({
      messages: [{ role: "user", content: "那羽毛球还能报名吗" }],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
      onText: emit,
    });
    expect(answer.content).toContain("羽毛球");
    expect(emit.mock.calls.flat().join("")).not.toContain("校运会");
    expect(client.requests).toHaveLength(4);
    expect(bounded.metrics()).toMatchObject({
      requests: 4,
      groundingChecks: 2,
      groundingFailures: 1,
      promptTokens: 40,
      completionTokens: 40,
    });
    expect(client.requests[1].tools.map((t) => t.function.name)).toEqual([
      "report_evidence_verdict",
    ]);
  } finally {
    f.close();
  }
});
it("keeps an unsupported answer out after a bounded failed correction", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db);
    vi.spyOn(store, "running").mockResolvedValue();
    const client = new MockModelProvider([
      reply("南校自助机在四楼[来源1]"),
      reply('{"supported":false,"issues":["来源只说明三楼"]}'),
      reply("自助机在四楼[来源1]"),
      reply('{"supported":false,"issues":["仍未纠正楼层"]}'),
    ]);
    const bounded = meteredClient(
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
      {
        groundingEvidence: () => ({
          sources: [{ citation: 1, snippet: "南校区自助机在一楼、三楼。" }],
        }),
      },
    );
    const emit = vi.fn();
    await expect(
      bounded.client.generateWithTools({
        messages: [],
        tools: [],
        maxTokens: 1024,
        signal: new AbortController().signal,
        onText: emit,
      }),
    ).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
    expect(client.requests).toHaveLength(4);
  } finally {
    f.close();
  }
});
