import { it, expect, vi } from "vitest";
import {
  ModelRouter,
  configurationFingerprint,
  type DefaultModelConfig,
} from "@/lib/server/models/router";
import { PriorityModelRouter } from "@/lib/server/models/priority";
import {
  DeepseekModelClient,
  MODEL_POLICY_VERSION,
  STEP_POLICY_VERSION,
} from "@/lib/server/models/deepseek";
import { ApiError } from "@/lib/server/errors";
import type { ModelClient } from "@/domain/models/contracts";
const request = {
  messages: [{ role: "user" as const, content: "test" }],
  tools: [],
  maxTokens: 64,
  signal: AbortSignal.timeout(10000),
};
const reply = { content: "ok", toolCalls: [], finishReason: "stop" as const };
async function router(provider: "stepfun" | "deepseek", client: ModelClient) {
  const config: DefaultModelConfig = {
    provider,
    apiKey: "fixture-key-only",
    model: provider === "stepfun" ? "step-3.5-flash-2603" : "deepseek-flash",
    baseUrl:
      provider === "stepfun"
        ? "https://api.stepfun.com/step_plan/v1"
        : "https://api.deepseek.com",
  };
  config.capabilityReceipt = JSON.stringify({
    provider,
    model: config.model,
    policyVersion:
      provider === "stepfun" ? STEP_POLICY_VERSION : MODEL_POLICY_VERSION,
    fingerprint: await configurationFingerprint(config),
    testedAt: new Date().toISOString(),
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  });
  return new ModelRouter(config, { create: () => client });
}
it("prefers the verified Step model and switches once to DeepSeek only for explicit exhausted quota", async () => {
  const primary = {
    generateWithTools: vi
      .fn()
      .mockRejectedValue(new ApiError("MODEL_QUOTA_EXHAUSTED", "fixture")),
    generateStructured: vi.fn(),
  };
  const fallback = {
    generateWithTools: vi.fn().mockResolvedValue(reply),
    generateStructured: vi.fn(),
  };
  const value = await new PriorityModelRouter(
    await router("stepfun", primary),
    await router("deepseek", fallback),
  ).resolve();
  expect(value.snapshot.provider).toBe("stepfun");
  expect(await value.client.generateWithTools(request)).toEqual(reply);
  expect(value.snapshot.provider).toBe("deepseek");
  await value.client.generateWithTools(request);
  expect(primary.generateWithTools).toHaveBeenCalledTimes(1);
  expect(fallback.generateWithTools).toHaveBeenCalledTimes(2);
});
it("auth, network, and ordinary throttling errors do not spend fallback credits", async () => {
  for (const code of [
    "MODEL_KEY_INVALID",
    "MODEL_NETWORK_ERROR",
    "MODEL_RATE_LIMITED",
  ] as const) {
    const primary = {
      generateWithTools: vi
        .fn()
        .mockRejectedValue(new ApiError(code, "fixture")),
      generateStructured: vi.fn(),
    };
    const fallback = {
      generateWithTools: vi.fn(),
      generateStructured: vi.fn(),
    };
    const v = await new PriorityModelRouter(
      await router("stepfun", primary),
      await router("deepseek", fallback),
    ).resolve();
    await expect(v.client.generateWithTools(request)).rejects.toMatchObject({
      code,
    });
    expect(fallback.generateWithTools).not.toHaveBeenCalled();
  }
});
it("never appends a fallback answer to a partial primary stream", async () => {
  const primary: ModelClient = {
    generateWithTools: async (r) => {
      r.onText?.("partial");
      throw new ApiError("MODEL_QUOTA_EXHAUSTED", "fixture");
    },
    generateStructured: vi.fn(),
  };
  const fallback = { generateWithTools: vi.fn(), generateStructured: vi.fn() };
  const v = await new PriorityModelRouter(
    await router("stepfun", primary),
    await router("deepseek", fallback),
  ).resolve();
  await expect(
    v.client.generateWithTools({ ...request, onText: () => {} }),
  ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
  expect(fallback.generateWithTools).not.toHaveBeenCalled();
});
it("distinguishes Step Plan quota exhaustion from HTTP 429 rate limiting", async () => {
  for (const [code, expected] of [
    ["insufficient_quota", "MODEL_QUOTA_EXHAUSTED"],
    ["rate_limit_exceeded", "MODEL_RATE_LIMITED"],
  ]) {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code } }), { status: 429 }),
      );
    const client = new DeepseekModelClient(
      "step-3.5-flash-2603",
      "fixture",
      "https://api.stepfun.com/step_plan/v1",
      transport,
      1000,
      "stepfun",
    );
    await expect(client.generateWithTools(request)).rejects.toMatchObject({
      code: expected,
    });
    expect(transport.mock.calls[0][0]).toBe(
      "https://api.stepfun.com/step_plan/v1/chat/completions",
    );
  }
});
