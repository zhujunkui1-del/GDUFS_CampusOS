import { expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentOrchestrator } from "@/lib/server/agent/orchestrator";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
import { MockModelProvider } from "../fixtures/mock-model";
import type { ModelSnapshot } from "@/domain/models/contracts";
import type { AgentEvent } from "@/domain/agent/contracts";
const snapshot: ModelSnapshot = {
  source: "platform",
  provider: "stepfun",
  model: "isolated",
  policyVersion: "isolated",
  testedAt: "2026-10-27T00:00:00Z",
  capabilities: {
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  },
};
it("executes authorized planned reads even if model never selects tools, labels provenance honestly", async () => {
  const execute = vi.fn(async () => ({
    ok: true as const,
    data: { evidence: "隔离事实，2026-10-27" },
  }));
  const registry = new SkillRegistry().register("knowledge-domain", {
    name: "search_campus_knowledge",
    description: "fixture",
    version: "fixture",
    auth: "public",
    sideEffect: "none",
    requiresConfirmation: false,
    timeoutMs: 1000,
    inputSchema: z.object({ query: z.string() }).strict(),
    outputSchema: z.object({ evidence: z.string() }),
    execute,
  });
  const client = new MockModelProvider([
    {
      content: "证据回答",
      finishReason: "stop",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
  ]);
  const events: AgentEvent[] = [];
  const after = vi.fn();
  const result = await new AgentOrchestrator(
    { resolve: async () => ({ client, snapshot }) },
    registry,
    undefined,
    {
      initialReads: [
        { name: "search_campus_knowledge", input: { query: "隔离主题" } },
      ],
      afterInitialReads: after,
    },
  ).run({
    message: "隔离问题",
    context: {
      requestId: "fixture",
      sessionId: "fixture",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
    },
    onEvent: (e) => events.push(e),
  });
  expect(result.status).toBe("completed");
  expect(execute).toHaveBeenCalledOnce();
  expect(after).toHaveBeenCalledOnce();
  expect(events.find((e) => e.type === "tool.finished")?.payload.origin).toBe(
    "server_plan",
  );
  expect(client.requests).toHaveLength(1);
  expect(
    client.requests[0].messages.some(
      (m) => m.role === "assistant" && "tool_calls" in m,
    ),
  ).toBe(false);
  expect(JSON.stringify(client.requests[0].messages)).toContain("隔离事实");
});
