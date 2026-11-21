import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { AssistantStore } from "@/lib/server/assistant/store";
import { meteredClient } from "@/lib/server/assistant/model-run";
import { MockModelProvider } from "../fixtures/mock-model";
import type { ModelReply } from "@/domain/models/contracts";

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

const reply: ModelReply = {
  content: "1+8*9-7 等于 66。",
  toolCalls: [],
  finishReason: "stop",
  usage: { promptTokens: 1, completionTokens: 5, totalTokens: 6 },
};

async function run(options: { streamFinal?: boolean }) {
  const fixture = sqliteD1();
  try {
    const store = new AssistantStore(fixture.db);
    const identity = await store.identity(new Request("https://test.invalid"));
    const conversation = await store.conversation(identity);
    const id = await store.reserve(
      identity,
      conversation,
      crypto.randomUUID(),
      "isolated",
    );
    const provider = new MockModelProvider([reply]);
    const validateFinal = vi.fn(() => undefined);
    const meter = meteredClient(
      provider,
      snapshot,
      store,
      identity.owner,
      id,
      () => true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1024,
      undefined,
      { validateFinal, streamFinal: options.streamFinal },
    );
    const chunks: string[] = [];
    await meter.client.generateWithTools({
      messages: [{ role: "user", content: "1+8*9-7" }],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
      onText: (text) => chunks.push(text),
    });
    return { chunks, validateFinal };
  } finally {
    fixture.close();
  }
}

describe("streamed final answers", () => {
  it("forwards a direct answer while it is generated and skips retracting validation", async () => {
    const result = await run({ streamFinal: true });
    expect(result.chunks.join("")).toBe(reply.content);
    expect(result.validateFinal).not.toHaveBeenCalled();
  });

  it("keeps the buffered validation path when streaming is off", async () => {
    const result = await run({});
    expect(result.chunks.join("")).toBe(reply.content);
    expect(result.validateFinal).toHaveBeenCalledWith(reply.content);
  });
});
