import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { AssistantStore } from "@/lib/server/assistant/store";
import { meteredClient } from "@/lib/server/assistant/model-run";
import { createMapSkillRegistry } from "@/lib/server/maps/skills";
import { MockModelProvider } from "../fixtures/mock-model";
const snapshot = {
  source: "platform" as const,
  provider: "deepseek" as const,
  model: "deepseek-flash",
  policyVersion: "test-only",
  testedAt: new Date().toISOString(),
  capabilities: {
    toolCalling: true as const,
    jsonObject: true as const,
    strictJsonSchema: false as const,
  },
};
describe("metered orchestration policy and truthful browser receipts", () => {
  it("corrects one skipped tool within the same metered run", async () => {
    const fixture = sqliteD1();
    try {
      const store = new AssistantStore(fixture.db);
      const identity = await store.identity(
        new Request("https://test.invalid"),
      );
      const conversation = await store.conversation(identity);
      const id = await store.reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated",
      );
      const provider = new MockModelProvider([
        {
          content: "unsupported claim",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        },
        {
          content: "",
          toolCalls: [
            {
              id: "actual-query",
              type: "function",
              function: {
                name: "search_places",
                arguments: '{"query":"南苑7栋"}',
              },
            },
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 20, completionTokens: 4, totalTokens: 24 },
        },
      ]);
      const output = vi.fn();
      const meter = meteredClient(
        provider,
        snapshot,
        store,
        identity.owner,
        id,
        () => false,
        undefined,
        "search_places",
      );
      const result = await meter.client.generateWithTools({
        messages: [{ role: "user", content: "找南苑7栋" }],
        tools: createMapSkillRegistry().tools({
          requestId: id,
          sessionId: identity.owner,
          user: null,
          campusId: "gdufs_university_town",
          permissions: [],
        }),
        signal: new AbortController().signal,
        maxTokens: 100,
        onText: output,
      });
      expect(result.toolCalls[0].function.name).toBe("search_places");
      expect(output).not.toHaveBeenCalled();
      expect(meter.metrics()).toMatchObject({
        requests: 2,
        correctionRetries: 1,
        totalTokens: 36,
      });
    } finally {
      fixture.close();
    }
  });
  it("rejects a required tool skipped by a model without exposing its ungrounded text", async () => {
    const fixture = sqliteD1();
    try {
      const store = new AssistantStore(fixture.db),
        identity = await store.identity(new Request("https://test.invalid"));
      const conversation = await store.conversation(identity);
      const id = await store.reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated",
      );
      const provider = new MockModelProvider([
        {
          content: "already moved without tools",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        },
        {
          content: "still no tools",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        },
      ]);
      const output = vi.fn();
      const meter = meteredClient(
        provider,
        snapshot,
        store,
        identity.owner,
        id,
        () => false,
        undefined,
        "search_places",
      );
      await expect(
        meter.client.generateWithTools({
          messages: [{ role: "user", content: "find place" }],
          tools: createMapSkillRegistry().tools({
            requestId: id,
            sessionId: identity.owner,
            user: null,
            campusId: "gdufs_university_town",
            permissions: [],
          }),
          signal: new AbortController().signal,
          maxTokens: 100,
          onText: output,
        }),
      ).rejects.toMatchObject({ code: "MODEL_TOOLS_UNSUPPORTED" });
      expect(output).not.toHaveBeenCalled();
      expect(provider.requests[0].tools.map((t) => t.function.name)).toEqual([
        "search_places",
      ]);
      expect(meter.metrics().totalTokens).toBe(24);
      expect(provider.requests).toHaveLength(2);
      expect(meter.metrics().correctionRetries).toBe(1);
    } finally {
      fixture.close();
    }
  });
  it("does not invent a browser execution receipt for a text-only answer", async () => {
    const fixture = sqliteD1();
    try {
      const store = new AssistantStore(fixture.db),
        identity = await store.identity(new Request("https://test.invalid"));
      const conversation = await store.conversation(identity);
      const id = await store.reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated",
      );
      const provider = new MockModelProvider([
        { content: "请提供起点", toolCalls: [], finishReason: "stop" },
      ]);
      await meteredClient(
        provider,
        snapshot,
        store,
        identity.owner,
        id,
        () => true,
        async () => false,
      ).client.generateWithTools({
        messages: [{ role: "user", content: "from my location" }],
        tools: [],
        signal: new AbortController().signal,
        maxTokens: 100,
      });
      expect(JSON.stringify(provider.requests[0].messages)).not.toContain(
        "浏览器已回执",
      );
    } finally {
      fixture.close();
    }
  });
});
