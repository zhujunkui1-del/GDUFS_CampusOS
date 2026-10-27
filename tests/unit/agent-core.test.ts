import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import type { SkillDefinition, SkillContext } from "@/domain/skills/contracts";
import type {
  ModelReply,
  ModelSnapshot,
  ModelToolCall,
} from "@/domain/models/contracts";
import type { AgentEvent } from "@/domain/agent/contracts";
import {
  AgentChatRequestSchema,
  encodeAgentEvent,
} from "@/domain/agent/contracts";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
import { ToolExecutor } from "@/lib/server/agent/tool-executor";
import { AgentOrchestrator } from "@/lib/server/agent/orchestrator";
import { RunLimiter } from "@/lib/server/agent/limits";
import { DOMAIN_SKILLS } from "@/lib/server/agent/domains";
import { ApiError } from "@/lib/server/errors";
import { MockModelProvider } from "../fixtures/mock-model";

const context: SkillContext = {
  requestId: "test-request",
  sessionId: "server-owned",
  user: null,
  permissions: [],
  campusId: "gdufs_university_town",
};
const schema = z.object({ value: z.string().max(100) }).strict();
type Input = z.infer<typeof schema>;
const definition: SkillDefinition<Input, Input> = {
  name: "test_echo",
  version: "test-only",
  description: "Isolated echo",
  inputSchema: schema,
  outputSchema: schema,
  auth: "public",
  sideEffect: "none",
  reuseResultMs: 5000,
  requiresConfirmation: false,
  timeoutMs: 30,
  execute: async (input) => ({ ok: true, data: input }),
};
function registry(overrides: Partial<SkillDefinition<Input, Input>> = {}) {
  return new SkillRegistry().register("spatial-domain", {
    ...definition,
    reuseResultMs:
      (overrides.auth && overrides.auth !== "public") ||
      overrides.requiresConfirmation ||
      (overrides.sideEffect && overrides.sideEffect !== "none")
        ? undefined
        : 5000,
    ...overrides,
  });
}
function call(
  name = "test_echo",
  args = '{"value":"fixture"}',
  id = "call-test",
): ModelToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}
const snapshot: ModelSnapshot = {
  source: "platform",
  provider: "deepseek",
  model: "test-only",
  policyVersion: "test-only",
  testedAt: "2026-10-15T00:00:00Z",
  capabilities: {
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  },
};
const final: ModelReply = {
  content: "隔离测试完成",
  toolCalls: [],
  finishReason: "stop",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
};
function toolReply(calls = [call()]): ModelReply {
  return {
    ...final,
    content: "",
    toolCalls: calls,
    finishReason: "tool_calls",
  };
}
afterEach(() => vi.useRealTimers());
it("corrects one pre-execution schema error without executing the invalid read", async () => {
  const execute = vi.fn(definition.execute);
  const provider = new MockModelProvider([
    toolReply([call("test_echo", '{"value":null}', "bad")]),
    toolReply([call("test_echo", '{"value":"fixed"}', "fixed")]),
    final,
  ]);
  const result = await new AgentOrchestrator(
    { resolve: async () => ({ client: provider, snapshot }) },
    registry({ execute }),
    undefined,
    { stopOnToolError: true },
  ).run({ message: "fixture", context, onEvent: () => {} });
  expect(result.status).toBe("completed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(provider.requests).toHaveLength(3);
  expect(JSON.stringify(provider.requests[1].messages)).toContain(
    "additionalProperties",
  );
  expect(JSON.stringify(provider.requests[1].messages)).toContain(
    '\\"path\\":\\"value\\"',
  );
});

it("shares frozen schema metadata without sharing executors or authorization", async () => {
  const a = registry();
  const b = registry({ auth: "user" });
  expect(a.get("test_echo")!.tool.function.parameters).toBe(
    b.get("test_echo")!.tool.function.parameters,
  );
  expect(Object.isFrozen(a.get("test_echo")!.tool.function.parameters)).toBe(
    true,
  );
  expect(a.get("test_echo")!.run).not.toBe(b.get("test_echo")!.run);
  expect(a.tools(context)).toHaveLength(1);
  expect(b.tools(context)).toHaveLength(0);
});

it("reuses an identical read-only tool result across different model call IDs", async () => {
  const execute = vi.fn(definition.execute);
  const provider = new MockModelProvider([
    toolReply([call("test_echo", '{"value":"fixture"}', "first")]),
    toolReply([call("test_echo", '{ "value" : "fixture" }', "second")]),
    final,
  ]);
  const events: AgentEvent[] = [];
  const result = await new AgentOrchestrator(
    { resolve: async () => ({ client: provider, snapshot }) },
    registry({ execute }),
  ).run({
    message: "fixture",
    context,
    onEvent: (event) => events.push(event),
  });
  expect(result.status).toBe("completed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(events.filter((event) => event.type === "tool.finished")).toHaveLength(
    1,
  );
});

it("does not reuse across runs or beyond the approved lifetime", async () => {
  const execute = vi.fn(definition.execute);
  const provider = new MockModelProvider([
    toolReply(),
    final,
    toolReply(),
    final,
  ]);
  const agent = new AgentOrchestrator(
    { resolve: async () => ({ client: provider, snapshot }) },
    registry({ execute }),
  );
  await agent.run({ message: "one", context, onEvent: () => {} });
  await agent.run({
    message: "two",
    context: { ...context, sessionId: "another-owner" },
    onEvent: () => {},
  });
  expect(execute).toHaveBeenCalledTimes(2);
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const expired = new MockModelProvider([
      toolReply([call("test_echo", '{"value":"x"}', "a")]),
      async () => {
        now += 5001;
        return toolReply([call("test_echo", '{"value":"x"}', "b")]);
      },
      final,
    ]);
    await new AgentOrchestrator(
      { resolve: async () => ({ client: expired, snapshot }) },
      registry({ execute }),
    ).run({ message: "expiry", context, onEvent: () => {} });
    expect(execute).toHaveBeenCalledTimes(4);
  } finally {
    clock.mockRestore();
  }
});
it("checks permissions again before replaying a cached result", async () => {
  const permissions = ["read_snapshot"];
  const execute = vi.fn(definition.execute);
  const provider = new MockModelProvider([
    toolReply([call("test_echo", '{"value":"x"}', "a")]),
    async () => {
      permissions.length = 0;
      return toolReply([call("test_echo", '{"value":"x"}', "b")]);
    },
  ]);
  const result = await new AgentOrchestrator(
    { resolve: async () => ({ client: provider, snapshot }) },
    registry({ execute, permissions: ["read_snapshot"] }),
  ).run({
    message: "scope",
    context: { ...context, permissions },
    onEvent: () => {},
  });
  expect(result).toMatchObject({ status: "failed", code: "FORBIDDEN" });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("does not reuse unapproved reads or allow write/identity scoped cache policies", async () => {
  expect(() => registry({ auth: "user", reuseResultMs: 5000 })).toThrow(
    /snapshot/,
  );
  const execute = vi.fn(definition.execute);
  const provider = new MockModelProvider([
    toolReply([call("test_echo", '{"value":"x"}', "a")]),
    toolReply([call("test_echo", '{"value":"x"}', "b")]),
    final,
  ]);
  await new AgentOrchestrator(
    { resolve: async () => ({ client: provider, snapshot }) },
    registry({ execute, reuseResultMs: undefined }),
  ).run({ message: "fresh", context, onEvent: () => {} });
  expect(execute).toHaveBeenCalledTimes(2);
});

describe("Skill Registry / Tool Executor (Mock only)", () => {
  it("keeps the original 16 names plus the authorized external-search extension across four domains", () => {
    const names = Object.values(DOMAIN_SKILLS).flat();
    expect(names).toHaveLength(17);
    expect(new Set(names).size).toBe(17);
    expect(names).toContain("search_external_campus_info");
    expect(new SkillRegistry().manifest()).toEqual([]);
  });
  it("exports strict JSON schemas and rejects duplicate names/unsafe writes", () => {
    const reg = registry();
    expect(reg.tools(context)[0].function.parameters.additionalProperties).toBe(
      false,
    );
    expect(() => reg.register("spatial-domain", definition)).toThrow(
      /duplicate/,
    );
    expect(() => registry({ sideEffect: "user_data_write" })).toThrow(/Writes/);
    expect(() =>
      registry({ inputSchema: z.object({ value: z.string() }) }),
    ).toThrow(/strict/);
  });
  it("executes and validates actual registered functions", async () => {
    expect(await new ToolExecutor(registry()).execute(call(), context)).toEqual(
      { ok: true, data: { value: "fixture" } },
    );
  });
  it.each([
    ["missing", "{}", "NOT_FOUND"],
    ["test_echo", "bad-json", "INVALID_ARGUMENT"],
    ["test_echo", '{"value":"a","userId":"admin"}', "INVALID_ARGUMENT"],
  ])("rejects invalid call %s", async (name, args, code) => {
    expect(
      await new ToolExecutor(registry()).execute(call(name, args), context),
    ).toMatchObject({ ok: false, error: { code } });
  });
  it("does not execute invalid input or forward unvalidated output", async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      data: { value: "x".repeat(101) },
    }));
    const executor = new ToolExecutor(registry({ execute }));
    expect(
      await executor.execute(call("test_echo", "{}"), context),
    ).toMatchObject({ ok: false });
    expect(execute).not.toHaveBeenCalled();
    expect(await executor.execute(call(), context)).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_ERROR" },
    });
  });
  it.each(["user", "admin", "school_authorized"] as const)(
    "hides %s tools from guests and enforces execution permissions",
    async (auth) => {
      const reg = registry({ auth });
      expect(reg.tools(context)).toEqual([]);
      expect(
        await new ToolExecutor(reg).execute(call(), {
          ...context,
          confirmedActionId: "forged",
        }),
      ).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    },
  );
  it("checks admin and explicit permissions independently", async () => {
    const user = {
      ...context,
      user: { id: "verified-owner", role: "user" as const },
    };
    expect(
      await new ToolExecutor(registry({ auth: "admin" })).execute(call(), user),
    ).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(
      await new ToolExecutor(
        registry({ permissions: ["special_scope"] }),
      ).execute(call(), user),
    ).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
  it("rejects writes despite a forged confirmation ID and never calls the writer", async () => {
    const execute = vi.fn(definition.execute);
    const executor = new ToolExecutor(
      registry({
        auth: "user",
        sideEffect: "user_data_write",
        requiresConfirmation: true,
        execute,
      }),
    );
    expect(
      await executor.execute(call(), {
        ...context,
        user: { id: "owner", role: "user" },
        confirmedActionId: "forged",
      }),
    ).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
    expect(execute).not.toHaveBeenCalled();
  });
  it("times out nonresponsive reads and passes a cancelled signal", async () => {
    let executionSignal: AbortSignal | undefined;
    const executor = new ToolExecutor(
      registry({
        execute: (_input, ctx) => {
          executionSignal = ctx.signal;
          return new Promise(() => {});
        },
      }),
    );
    expect(await executor.execute(call(), context)).toMatchObject({
      error: { code: "TIMEOUT" },
    });
    expect(executionSignal?.aborted).toBe(true);
  });
  it("cancels before execution and hides unexpected exception secrets", async () => {
    const execute = vi.fn(async () => {
      throw new Error("test-secret-token");
    });
    const executor = new ToolExecutor(registry({ execute }));
    const controller = new AbortController();
    controller.abort();
    expect(
      await executor.execute(call(), { ...context, signal: controller.signal }),
    ).toMatchObject({ error: { code: "CANCELLED" } });
    expect(execute).not.toHaveBeenCalled();
    expect(
      JSON.stringify(await executor.execute(call(), context)),
    ).not.toContain("test-secret-token");
  });
  it("bounds valid tool outputs too", async () => {
    const reg = new SkillRegistry().register("spatial-domain", {
      ...definition,
      outputSchema: z.string(),
      execute: async () => ({ ok: true, data: "x".repeat(32769) }),
    });
    expect(await new ToolExecutor(reg).execute(call(), context)).toMatchObject({
      error: { code: "UPSTREAM_ERROR" },
    });
  });
});

describe("bounded orchestrator and events (Mock only)", () => {
  it("handles pre-aborted invalid input without an unhandled rejection", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new AgentOrchestrator(
      {
        resolve: async () => ({ client: new MockModelProvider([]), snapshot }),
      },
      registry(),
    ).run({
      message: "",
      context: { ...context, signal: controller.signal },
      onEvent() {},
    });
    expect(result.status).toBe("failed");
    await Promise.resolve();
  });
  async function run(
    provider: MockModelProvider,
    reg = registry(),
    signal?: AbortSignal,
  ) {
    const events: AgentEvent[] = [];
    const result = await new AgentOrchestrator(
      { resolve: async () => ({ client: provider, snapshot }) },
      reg,
    ).run({
      message: "隔离测试",
      context: { ...context, signal },
      onEvent: (event) => events.push(event),
    });
    return { events, result };
  }
  it("calls a tool, feeds validated result to model, then streams final text", async () => {
    const provider = new MockModelProvider([toolReply(), final]);
    const { result, events } = await run(provider);
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.finished",
      "message.delta",
      "run.completed",
    ]);
    expect(provider.requests[1].messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-test",
      content: '{"ok":true,"data":{"value":"fixture"}}',
    });
    expect(new Set(events.map((event) => event.eventId)).size).toBe(
      events.length,
    );
    expect(encodeAgentEvent(events[0])).toContain("event: tool.started\ndata:");
  });
  it("rejects unknown tools without execution and informs the next model round", async () => {
    const provider = new MockModelProvider([
      toolReply([call("eval_javascript")]),
      final,
    ]);
    const { events } = await run(provider);
    expect(
      events.find((event) => event.type === "tool.finished")?.payload.result,
    ).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(provider.requests[1].messages.at(-1)?.content).toContain(
      "FORBIDDEN",
    );
  });
  it("never treats free text as a tool call", async () => {
    const execute = vi.fn(definition.execute);
    await run(
      new MockModelProvider([
        { ...final, content: "test_echo({value:'fake'})" },
      ]),
      registry({ execute }),
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("stops at six rounds and does not make a seventh request", async () => {
    const provider = new MockModelProvider(
      Array.from({ length: 7 }, (_, i) =>
        toolReply([call("test_echo", '{"value":"a"}', `call-${i}`)]),
      ),
    );
    expect((await run(provider)).result).toMatchObject({
      status: "failed",
      code: "RUN_LIMIT_EXCEEDED",
    });
    expect(provider.requests).toHaveLength(6);
  });
  it("caps tool executions at twelve", async () => {
    const execute = vi.fn(definition.execute);
    const provider = new MockModelProvider(
      Array.from({ length: 4 }, (_, round) =>
        toolReply(
          Array.from({ length: 4 }, (_, i) =>
            call(
              "test_echo",
              JSON.stringify({ value: `${round}:${i}` }),
              `call-${round}-${i}`,
            ),
          ),
        ),
      ),
    );
    expect((await run(provider, registry({ execute }))).result.code).toBe(
      "RUN_LIMIT_EXCEEDED",
    );
    expect(execute).toHaveBeenCalledTimes(12);
  });
  it("reserves bounded tokens when provider usage is absent", async () => {
    const provider = new MockModelProvider(
      Array.from({ length: 6 }, (_, i) => ({
        ...toolReply([call("test_echo", '{"value":"a"}', `call-${i}`)]),
        usage: undefined,
      })),
    );
    expect((await run(provider)).result.code).toBe("RUN_LIMIT_EXCEEDED");
    expect(provider.requests).toHaveLength(4);
  });
  it("does not re-execute a repeated call ID and rejects altered arguments", async () => {
    const execute = vi.fn(definition.execute);
    const { result } = await run(
      new MockModelProvider([toolReply(), toolReply(), final]),
      registry({ execute }),
    );
    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (
        await run(
          new MockModelProvider([
            toolReply(),
            toolReply([call("test_echo", '{"value":"altered"}')]),
          ]),
        )
      ).result.code,
    ).toBe("INVALID_ARGUMENT");
  });
  it("stops on confirmation without executing a writer", async () => {
    const execute = vi.fn(definition.execute);
    const events: AgentEvent[] = [];
    const result = await new AgentOrchestrator(
      {
        resolve: async () => ({
          client: new MockModelProvider([toolReply()]),
          snapshot,
        }),
      },
      registry({
        auth: "user",
        sideEffect: "user_data_write",
        requiresConfirmation: true,
        execute,
      }),
    ).run({
      message: "test",
      context: { ...context, user: { id: "trusted", role: "user" } },
      onEvent: (event) => events.push(event),
    });
    expect(result.status).toBe("needs_confirmation");
    expect(events.at(-1)?.type).toBe("confirmation.required");
    expect(execute).not.toHaveBeenCalled();
  });
  it("fails safely when model is unavailable and releases concurrency", async () => {
    const { events, result } = await run(
      new MockModelProvider([new Error("test-secret-token")]),
    );
    expect(result.status).toBe("failed");
    expect(JSON.stringify(events)).not.toContain("test-secret-token");
  });
  it("cancels noncooperative model calls without emitting late replies", async () => {
    const controller = new AbortController();
    let finish: ((reply: ModelReply) => void) | undefined;
    const pending = run(
      new MockModelProvider([
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ]),
      registry(),
      controller.signal,
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    controller.abort();
    const { result, events } = await pending;
    expect(result.code).toBe("CANCELLED");
    finish!(final);
    await Promise.resolve();
    expect(events.at(-1)?.type).toBe("run.failed");
    expect(events.some((event) => event.type === "message.delta")).toBe(false);
  });
  it("enforces subject and isolate concurrency and minute quotas", () => {
    let now = 0;
    const limiter = new RunLimiter(() => now);
    const first = limiter.acquire("a");
    const second = limiter.acquire("b");
    expect(() => limiter.acquire("a")).toThrow(ApiError);
    expect(() => limiter.acquire("c")).toThrow(ApiError);
    first();
    second();
    for (let i = 0; i < 7; i++) limiter.acquire("a")();
    expect(() => limiter.acquire("a")).toThrow(ApiError);
    now = 600001;
    expect(() => limiter.acquire("a")()).not.toThrow();
  });
  it("rejects client identity, provider secrets, arbitrary history and script payloads", () => {
    for (const extra of [
      { userId: "admin" },
      { history: [] },
      { apiKey: "test-only" },
      { provider: "mock" },
      { mapActions: [{ type: "EVAL" }] },
    ])
      expect(
        AgentChatRequestSchema.safeParse({ message: "hi", ...extra }).success,
      ).toBe(false);
    expect(
      AgentChatRequestSchema.safeParse({
        message: "hi",
        mapContext: { selectedPlaceId: "unknown" },
      }).success,
    ).toBe(true); // Semantic ID checks belong to the service; HTTP execution is still closed.
  });
});
