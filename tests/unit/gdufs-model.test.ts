import { describe, expect, it, vi } from "vitest";
import {
  DeepseekModelClient,
  approvedGdufsEndpoint,
} from "@/lib/server/models/deepseek";
import { ModelRouter, configurationFingerprint, policyVersionFor } from "@/lib/server/models/router";
import { PriorityModelRouter } from "@/lib/server/models/priority";
import { ApiError } from "@/lib/server/errors";
import type { ModelClient } from "@/domain/models/contracts";

const BASE = "https://modelsq.gdufs.edu.cn/v1-openai";
const request = {
  messages: [{ role: "user" as const, content: "test" }],
  tools: [],
  maxTokens: 64,
  signal: AbortSignal.timeout(10000),
};
const reply = (body: unknown) => new Response(JSON.stringify(body));
const client = (transport: typeof fetch) =>
  new DeepseekModelClient("DeepSeek-V4.1-Flash-1017", "fixture", BASE, transport, 1000, "gdufs");

describe("campus gateway adapter", () => {
  it("accepts only the campus gateway endpoint", () => {
    expect(approvedGdufsEndpoint(BASE)).toBe(`${BASE}/chat/completions`);
    expect(approvedGdufsEndpoint(`${BASE}/`)).toBe(`${BASE}/chat/completions`);
    for (const bad of [
      "https://api.deepseek.com",
      "https://modelsq.gdufs.edu.cn/v1",
      "https://modelsq.gdufs.edu.cn/v1-openai/../v1",
      "http://modelsq.gdufs.edu.cn/v1-openai",
    ])
      expect(() => approvedGdufsEndpoint(bad)).toThrow();
  });

  it("disables reasoning with the chat-template flag the gateway honours", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      reply({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    );
    await client(transport).generateWithTools(request);
    expect(transport.mock.calls[0][0]).toBe(`${BASE}/chat/completions`);
    const firstCall = transport.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse(String(firstCall?.[1]?.body));
    expect(body).toMatchObject({ chat_template_kwargs: { thinking: false } });
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("normalizes the gateway's stop-with-tool-calls reply", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      reply({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "search_places", arguments: "{}" },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    const value = await client(transport).generateWithTools(request);
    expect(value.finishReason).toBe("tool_calls");
    expect(value.toolCalls).toHaveLength(1);
  });

  it("keeps the strict contract for other providers", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      reply({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "search_places", arguments: "{}" },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    const deepseek = new DeepseekModelClient(
      "deepseek-flash",
      "fixture",
      "https://api.deepseek.com",
      transport,
      1000,
    );
    await expect(deepseek.generateWithTools(request)).rejects.toMatchObject({
      code: "MODEL_SERVICE_UNAVAILABLE",
    });
  });

  it("classifies the gateway's 404s by message instead of status", async () => {
    for (const [body, code] of [
      [{ message: "API 密钥[sk-invalid]不存在", details: null }, "MODEL_KEY_INVALID"],
      [
        { message: "NotFound (Code: 404): Model not found", details: "x" },
        "MODEL_NOT_FOUND_OR_FORBIDDEN",
      ],
    ] as const) {
      const transport = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 404 }));
      await expect(client(transport).generateWithTools(request)).rejects.toMatchObject({
        code,
      });
    }
  });

  it("falls through to a quota error only when the gateway says so", async () => {
    const quota = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "额度已用尽" }), { status: 429 }),
      );
    await expect(client(quota).generateWithTools(request)).rejects.toMatchObject({
      code: "MODEL_QUOTA_EXHAUSTED",
    });
    const throttled = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "请求过于频繁" }), { status: 429 }),
      );
    await expect(
      client(throttled).generateWithTools(request),
    ).rejects.toMatchObject({ code: "MODEL_RATE_LIMITED" });
  });
});

async function router(
  provider: "gdufs" | "stepfun" | "deepseek",
  value: ModelClient,
) {
  const model =
    provider === "gdufs"
      ? "DeepSeek-V4.1-Flash-1017"
      : provider === "stepfun"
        ? "step-3.5-flash-2603"
        : "deepseek-flash";
  const baseUrl =
    provider === "gdufs"
      ? BASE
      : provider === "stepfun"
        ? "https://api.stepfun.com/step_plan/v1"
        : "https://api.deepseek.com";
  const config = {
    provider,
    apiKey: "fixture-key-only",
    model,
    baseUrl,
  };
  return new ModelRouter(
    {
      ...config,
      capabilityReceipt: JSON.stringify({
        provider,
        model,
        policyVersion: policyVersionFor(provider),
        fingerprint: await configurationFingerprint(config),
        testedAt: new Date().toISOString(),
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      }),
    },
    { create: () => value },
  );
}

const ok = { content: "ok", toolCalls: [], finishReason: "stop" as const };

describe("three-tier priority", () => {
  it("walks gdufs → stepfun → deepseek on quota exhaustion only", async () => {
    const gdufs = {
      generateWithTools: vi.fn().mockRejectedValue(new ApiError("MODEL_QUOTA_EXHAUSTED", "f")),
      generateStructured: vi.fn(),
    };
    const step = {
      generateWithTools: vi.fn().mockRejectedValue(new ApiError("MODEL_QUOTA_EXHAUSTED", "f")),
      generateStructured: vi.fn(),
    };
    const deepseek = {
      generateWithTools: vi.fn().mockResolvedValue(ok),
      generateStructured: vi.fn(),
    };
    const value = await new PriorityModelRouter(
      await router("gdufs", gdufs),
      [await router("stepfun", step), await router("deepseek", deepseek)],
    ).resolve();
    expect(value.snapshot.provider).toBe("gdufs");
    expect(await value.client.generateWithTools(request)).toEqual(ok);
    expect(value.snapshot.provider).toBe("deepseek");
    expect(gdufs.generateWithTools).toHaveBeenCalledTimes(1);
    expect(step.generateWithTools).toHaveBeenCalledTimes(1);
    expect(deepseek.generateWithTools).toHaveBeenCalledTimes(1);
  });

  it("stops at the first tier that is not quota-exhausted", async () => {
    const gdufs = {
      generateWithTools: vi.fn().mockRejectedValue(new ApiError("MODEL_KEY_INVALID", "f")),
      generateStructured: vi.fn(),
    };
    const step = { generateWithTools: vi.fn(), generateStructured: vi.fn() };
    const deepseek = { generateWithTools: vi.fn(), generateStructured: vi.fn() };
    const value = await new PriorityModelRouter(
      await router("gdufs", gdufs),
      [await router("stepfun", step), await router("deepseek", deepseek)],
    ).resolve();
    await expect(value.client.generateWithTools(request)).rejects.toMatchObject({
      code: "MODEL_KEY_INVALID",
    });
    expect(step.generateWithTools).not.toHaveBeenCalled();
  });

  it("never crosses two tiers after a partial stream", async () => {
    const gdufs: ModelClient = {
      generateWithTools: async (r) => {
        r.onText?.("partial");
        throw new ApiError("MODEL_QUOTA_EXHAUSTED", "f");
      },
      generateStructured: vi.fn(),
    };
    const step = { generateWithTools: vi.fn(), generateStructured: vi.fn() };
    const deepseek = { generateWithTools: vi.fn(), generateStructured: vi.fn() };
    const value = await new PriorityModelRouter(
      await router("gdufs", gdufs),
      [await router("stepfun", step), await router("deepseek", deepseek)],
    ).resolve();
    await expect(
      value.client.generateWithTools({ ...request, onText: () => {} }),
    ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
    expect(step.generateWithTools).not.toHaveBeenCalled();
  });

  it("skips a tier that has no capability receipt instead of failing the chat", async () => {
    // The campus gateway is configured but its receipt has not been produced yet
    // (or the key was rotated). Skipping it spends no credit and sends no request.
    const unverified = new ModelRouter({
      provider: "gdufs",
      apiKey: "fixture-key-only",
      model: "DeepSeek-V4.1-Flash-1017",
      baseUrl: BASE,
    });
    const step = { generateWithTools: vi.fn().mockResolvedValue(ok), generateStructured: vi.fn() };
    const value = await new PriorityModelRouter(
      unverified,
      [await router("stepfun", step), await router("deepseek", { generateWithTools: vi.fn(), generateStructured: vi.fn() })],
    ).resolve();
    expect(value.snapshot.provider).toBe("stepfun");
    expect(await value.client.generateWithTools(request)).toEqual(ok);
    expect(step.generateWithTools).toHaveBeenCalledTimes(1);
  });

  it("reports the first tier that would actually serve traffic", async () => {
    const unverified = new ModelRouter({
      provider: "gdufs",
      apiKey: "fixture-key-only",
      model: "DeepSeek-V4.1-Flash-1017",
      baseUrl: BASE,
    });
    const value = new PriorityModelRouter(
      unverified,
      [await router("stepfun", { generateWithTools: vi.fn(), generateStructured: vi.fn() })],
    );
    expect(await value.status()).toMatchObject({
      ready: true,
      model: { provider: "stepfun" },
    });
  });
});
