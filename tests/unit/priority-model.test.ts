import { it, expect, vi } from "vitest";
import {
  ModelRouter,
  configurationFingerprint,
  type DefaultModelConfig,
} from "@/lib/server/models/router";
import {
  modelPriorityOrder,
  PriorityModelRouter,
} from "@/lib/server/models/priority";
import {
  DeepseekModelClient,
  MODEL_POLICY_VERSION,
  STEP_POLICY_VERSION,
} from "@/lib/server/models/deepseek";
import { ApiError, type ErrorCode } from "@/lib/server/errors";
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
async function chain(
  primary: ModelClient,
  fallback: ModelClient,
  onEvent?: (event: {
    event: "fallback" | "failed";
    provider: string;
    model?: string;
    from?: string;
    code?: string;
  }) => void,
) {
  return new PriorityModelRouter(
    await router("deepseek", primary),
    await router("stepfun", fallback),
    onEvent,
  ).resolve();
}
it("leads with DeepSeek and puts StepFun second unless the operator flips it", () => {
  expect(modelPriorityOrder(undefined)).toEqual(["deepseek", "stepfun"]);
  expect(modelPriorityOrder("deepseek")).toEqual(["deepseek", "stepfun"]);
  expect(modelPriorityOrder("stepfun")).toEqual(["stepfun", "deepseek"]);
  expect(modelPriorityOrder("gdufs")).toEqual(["gdufs", "deepseek", "stepfun"]);
});
it("serves from the verified DeepSeek model and switches once to StepFun when DeepSeek cannot answer", async () => {
  const primary = {
    generateWithTools: vi
      .fn()
      .mockRejectedValue(new ApiError("MODEL_QUOTA_EXHAUSTED", "fixture")),
    generateStructured: vi.fn(),
  };
  const fallback = {
    generateWithTools: vi.fn().mockResolvedValue(reply),
    generateStructured: vi.fn().mockResolvedValue({ value: 1 }),
  };
  const value = await chain(primary, fallback);
  expect(value.snapshot.provider).toBe("deepseek");
  expect(await value.client.generateWithTools(request)).toEqual(reply);
  expect(value.snapshot.provider).toBe("stepfun");
  await value.client.generateWithTools(request);
  await value.client.generateStructured(request, {} as never);
  expect(primary.generateWithTools).toHaveBeenCalledTimes(1);
  expect(fallback.generateWithTools).toHaveBeenCalledTimes(2);
  expect(fallback.generateStructured).toHaveBeenCalledTimes(1);
});
it("falls back on availability failures of the primary provider", async () => {
  for (const code of [
    "MODEL_QUOTA_EXHAUSTED",
    "MODEL_RATE_LIMITED",
    "MODEL_SERVICE_UNAVAILABLE",
    "MODEL_NETWORK_ERROR",
    "MODEL_TIMEOUT",
  ] as const) {
    const primary = {
      generateWithTools: vi
        .fn()
        .mockRejectedValue(new ApiError(code, "fixture")),
      generateStructured: vi.fn(),
    };
    const fallback = {
      generateWithTools: vi.fn().mockResolvedValue(reply),
      generateStructured: vi.fn(),
    };
    const v = await chain(primary, fallback);
    expect(await v.client.generateWithTools(request)).toEqual(reply);
    expect(v.snapshot.provider).toBe("stepfun");
    expect(fallback.generateWithTools).toHaveBeenCalledTimes(1);
  }
});
it("keeps a rejected DeepSeek key or a configuration error visible instead of spending StepFun credit", async () => {
  for (const code of [
    "MODEL_KEY_INVALID",
    "MODEL_NOT_FOUND_OR_FORBIDDEN",
    "MODEL_TOOLS_UNSUPPORTED",
    "MODEL_JSON_UNSUPPORTED",
  ] as ErrorCode[]) {
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
    const v = await chain(primary, fallback);
    await expect(v.client.generateWithTools(request)).rejects.toMatchObject({
      code,
    });
    expect(v.snapshot.provider).toBe("deepseek");
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
  const v = await chain(primary, fallback);
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

it("records a tier swap so the console can show which model answered", async () => {
  const events: {
    event: string;
    provider: string;
    from?: string;
    code?: string;
  }[] = [];
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
  const v = await chain(primary, fallback, (event) => events.push(event));
  await v.client.generateWithTools(request);
  expect(events).toEqual([
    {
      event: "fallback",
      provider: "stepfun",
      model: "step-3.5-flash-2603",
      from: "deepseek",
      code: "MODEL_QUOTA_EXHAUSTED",
    },
  ]);
});
it("records the final availability failure after the last tier also fails", async () => {
  const events: {
    event: string;
    provider: string;
    from?: string;
    code?: string;
  }[] = [];
  const broken = () => ({
    generateWithTools: vi
      .fn()
      .mockRejectedValue(new ApiError("MODEL_TIMEOUT", "fixture")),
    generateStructured: vi.fn(),
  });
  const v = await chain(broken(), broken(), (event) => events.push(event));
  await expect(v.client.generateWithTools(request)).rejects.toMatchObject({
    code: "MODEL_TIMEOUT",
  });
  // One swap, then the failure that ends the run on the tier that could not answer.
  expect(events).toEqual([
    {
      event: "fallback",
      provider: "stepfun",
      model: "step-3.5-flash-2603",
      from: "deepseek",
      code: "MODEL_TIMEOUT",
    },
    {
      event: "failed",
      provider: "stepfun",
      model: "step-3.5-flash-2603",
      code: "MODEL_TIMEOUT",
    },
  ]);
});
