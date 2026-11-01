import { it, expect, vi } from "vitest";
import { AgentOrchestrator } from "@/lib/server/agent/orchestrator";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
import { meteredClient } from "@/lib/server/assistant/model-run";
import { DeepseekModelClient } from "@/lib/server/models/deepseek";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { AssistantStore } from "@/lib/server/assistant/store";
import { z } from "zod";
import { PlanRouteInputSchema } from "@/domain/maps/skill-contracts";
const snapshot = {
  source: "platform" as const,
  provider: "deepseek" as const,
  model: "deepseek-flash",
  policyVersion: "fixture",
  testedAt: new Date().toISOString(),
  capabilities: {
    toolCalling: true as const,
    jsonObject: true as const,
    strictJsonSchema: false as const,
  },
};

it("offers an exact unambiguous route contract without changing the original skill input", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db, undefined, true),
      u = await store.identity(new Request("https://fixture.invalid")),
      c = await store.conversation(u),
      run = await store.reserve(u, c, crypto.randomUUID(), "fixture");
    const route = {
      start: { type: "place" as const, placeId: "verified-start" },
      endPlaceId: "verified-end",
      mode: "walking" as const,
    };
    const upstream = vi.fn(async () => ({
      content: "",
      toolCalls: [
        {
          id: "route-call",
          type: "function" as const,
          function: { name: "plan_route", arguments: JSON.stringify(route) },
        },
      ],
      finishReason: "tool_calls" as const,
    }));
    const meter = meteredClient(
      { generateWithTools: upstream, generateStructured: vi.fn() },
      snapshot,
      store,
      u.owner,
      run,
      () => false,
      undefined,
      "plan_route",
      undefined,
      undefined,
      undefined,
      2048,
      undefined,
      { unrestricted: true, requiredRoute: route },
    );
    const reply = await meter.client.generateWithTools({
      messages: [{ role: "user", content: "route fixture" }],
      tools: [
        {
          type: "function",
          function: {
            name: "plan_route",
            description: "original skill",
            parameters: z.toJSONSchema(PlanRouteInputSchema),
          },
        },
      ],
      maxTokens: 1024,
      signal: new AbortController().signal,
    });
    expect(
      PlanRouteInputSchema.safeParse(
        JSON.parse(reply.toolCalls[0].function.arguments),
      ).success,
    ).toBe(true);
    const offered = JSON.stringify(upstream.mock.calls[0]);
    expect(offered).toContain("verified-start");
    expect(offered).toContain("verified-end");
    expect(offered).toContain('"const":"place"');
  } finally {
    f.close();
  }
});
it("website completion policy allows more than six model rounds, twelve tools and 4096 output tokens", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db, undefined, true),
      identity = await store.identity(new Request("https://fixture.invalid")),
      c = await store.conversation(identity),
      run = await store.reserve(identity, c, crypto.randomUUID(), "fixture");
    let rounds = 0,
      executions = 0;
    const generateWithTools = vi.fn(async () => {
      const n = rounds++;
      return {
        content: n < 7 ? "" : "long ".repeat(1200),
        toolCalls:
          n < 7
            ? [0, 1].map((j) => ({
                id: `call-${n}-${j}`,
                type: "function" as const,
                function: {
                  name: "lookup",
                  arguments: JSON.stringify({ n: n * 2 + j }),
                },
              }))
            : [],
        finishReason: n < 7 ? ("tool_calls" as const) : ("stop" as const),
        usage: { promptTokens: 1, completionTokens: 1000, totalTokens: 1001 },
      };
    });
    const registry = new SkillRegistry().register("spatial-domain", {
      name: "lookup",
      version: "fixture",
      description: "isolated lookup",
      inputSchema: z.object({ n: z.number() }).strict(),
      outputSchema: z.object({ n: z.number() }),
      auth: "public",
      sideEffect: "none",
      requiresConfirmation: false,
      timeoutMs: 1000,
      execute: async (x) => {
        executions++;
        return { ok: true, data: x };
      },
    });
    const meter = meteredClient(
      { generateWithTools, generateStructured: vi.fn() },
      snapshot,
      store,
      identity.owner,
      run,
      () => false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      2048,
      undefined,
      { unrestricted: true },
    );
    const orchestrator = new AgentOrchestrator(
      { resolve: async () => ({ client: meter.client, snapshot }) },
      registry,
      undefined,
      { unrestricted: true },
    );
    const result = await orchestrator.run({
      message: "fixture",
      runId: run,
      context: {
        requestId: crypto.randomUUID(),
        sessionId: identity.owner,
        user: null,
        permissions: [],
        campusId: "gdufs_university_town",
      },
      onEvent: () => {},
    });
    expect(result.status).toBe("completed");
    expect(rounds).toBe(8);
    expect(executions).toBe(14);
    expect(meter.metrics().completionTokens).toBe(8000);
  } finally {
    f.close();
  }
});
it("platform generation leaves output length to the provider; bounded diagnostics keep max_tokens", async () => {
  for (const managed of [true, false]) {
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          }),
        ),
    );
    const client = new DeepseekModelClient(
      "fixture",
      "fixture-key",
      "https://api.deepseek.com",
      transport,
      1000,
      "deepseek",
      1024,
      managed,
    );
    await client.generateWithTools({
      messages: [{ role: "user", content: "fixture" }],
      tools: [],
      maxTokens: 256,
      signal: new AbortController().signal,
    });
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.max_tokens).toBe(managed ? undefined : 256);
  }
});

it("a full long saved reply stays visible and its model projection supports a next turn", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db, undefined, true),
      u = await store.identity(new Request("https://fixture.invalid")),
      c = await store.conversation(u);
    await store.append(c, "assistant", "长".repeat(10000));
    const visible = await store.history(u, c.id),
      working = await store.history(u, c.id, { context: true });
    expect(visible.messages[0].text).toHaveLength(10000);
    expect(working.messages[0].text).toHaveLength(8000);
    const client = {
      generateWithTools: vi.fn(async () => ({
        content: "fixture follow-up",
        toolCalls: [],
        finishReason: "stop" as const,
      })),
      generateStructured: vi.fn(),
    };
    const agent = new AgentOrchestrator(
      { resolve: async () => ({ client, snapshot }) },
      new SkillRegistry(),
      undefined,
      { unrestricted: true },
    );
    const result = await agent.run({
      message: "继续",
      history: working.messages.map((m) => ({ role: m.role, content: m.text })),
      context: {
        requestId: crypto.randomUUID(),
        sessionId: u.owner,
        user: null,
        permissions: [],
        campusId: "gdufs_university_town",
      },
      onEvent: () => {},
    });
    expect(result.status).toBe("completed");
    expect(client.generateWithTools).toHaveBeenCalledOnce();
  } finally {
    f.close();
  }
});
