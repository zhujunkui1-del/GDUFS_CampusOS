import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  approvedDeepseekEndpoint,
  DeepseekModelClient,
  MODEL_POLICY_VERSION,
} from "@/lib/server/models/deepseek";
import {
  CapabilityReceiptSchema,
  configurationFingerprint,
  ModelRouter,
} from "@/lib/server/models/router";
import type { ModelRequest } from "@/domain/models/contracts";

const secret = "test-only-never-a-real-key";
const request: ModelRequest = {
  messages: [{ role: "user", content: "test" }],
  tools: [],
  maxTokens: 128,
  signal: new AbortController().signal,
};
function client(transport: typeof fetch, timeout = 15000) {
  return new DeepseekModelClient(
    "test-only",
    secret,
    "https://api.deepseek.com",
    transport,
    timeout,
  );
}
function jsonReply(content: string, finish_reason = "stop") {
  return Response.json({
    choices: [{ message: { content }, finish_reason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}
function sse(lines: unknown[], done = true) {
  const data =
    lines.map((line) => `data: ${JSON.stringify(line)}\r\n\r\n`).join("") +
    (done ? "data: [DONE]\r\n\r\n" : "");
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function delta(value: unknown, finish: string | null = null) {
  return { choices: [{ index: 0, delta: value, finish_reason: finish }] };
}

describe("DeepSeek transport contract (Mock HTTP only)", () => {
  it("uses the workerd-compatible manual policy and rejects redirects without a second request", async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.redirect !== "manual") throw new TypeError("workerd rejects redirect:error");
      return new Response(null, { status: 302, headers: { Location: "https://untrusted.invalid" } });
    });
    await expect(client(transport).generateWithTools(request)).rejects.toMatchObject({ code: "MODEL_ENDPOINT_INVALID" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    "http://api.deepseek.com",
    "https://api.deepseek.com.evil.invalid",
    "https://api.deepseek.com@127.0.0.1",
    "https://api.deepseek.com:443",
    "https://api.deepseek.com/?key=secret",
    "https://127.0.0.1",
    "https://api.deepseek.com/beta",
    "https://api.deepseek.com/v1/../",
  ])("rejects unapproved exact endpoint %s before fetch", (url) => {
    expect(() => approvedDeepseekEndpoint(url)).toThrow(/未获准/);
  });
  it("only sends the key in server authorization and disables redirects/retries/thinking", async () => {
    const transport = vi.fn<typeof fetch>(async () => jsonReply("hello"));
    expect((await client(transport).generateWithTools(request)).content).toBe(
      "hello",
    );
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.redirect).toBe("manual");
    expect(JSON.stringify(init?.body)).not.toContain(secret);
    expect(JSON.stringify(client(transport))).not.toContain(secret);
    expect(JSON.parse(String(init?.body)).thinking.type).toBe("disabled");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, "MODEL_KEY_INVALID"],
    [402, "MODEL_QUOTA_EXHAUSTED"],
    [403, "MODEL_NOT_FOUND_OR_FORBIDDEN"],
    [429, "MODEL_RATE_LIMITED"],
    [500, "MODEL_SERVICE_UNAVAILABLE"],
  ])("maps HTTP %s without exposing response body", async (status, code) => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(secret, { status: Number(status) }),
    );
    const promise = client(transport).generateWithTools(request);
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow(secret);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("handles Unicode and arbitrary network fragmentation, ignores reasoning", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      sse([
        delta({ reasoning_content: "hidden-test-reasoning" }),
        delta({ content: "南苑" }),
        delta({ content: "7栋" }, "stop"),
      ]),
    );
    const onText = vi.fn();
    const reply = await client(transport).generateWithTools({
      ...request,
      onText,
    });
    expect(reply.content).toBe("南苑7栋");
    expect(onText.mock.calls.flat().join("")).toBe("南苑7栋");
    expect(JSON.stringify(reply)).not.toContain("hidden-test-reasoning");
  });
  it("assembles streamed tool arguments before returning executable calls", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      sse([
        delta({
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "test_echo", arguments: '{"value":' },
            },
          ],
        }),
        delta(
          { tool_calls: [{ index: 0, function: { arguments: '"南苑"}' } }] },
          "tool_calls",
        ),
      ]),
    );
    expect(
      (await client(transport).generateWithTools({ ...request, onText() {} }))
        .toolCalls[0],
    ).toMatchObject({
      id: "call-1",
      function: { arguments: '{"value":"南苑"}' },
    });
  });
  it("rejects interrupted and token-truncated model streams", async () => {
    await expect(
      client(async () =>
        sse([delta({ content: "partial" }, "stop")], false),
      ).generateWithTools({ ...request, onText() {} }),
    ).rejects.toMatchObject({ code: "MODEL_SERVICE_UNAVAILABLE" });
    await expect(
      client(async () => jsonReply("partial", "length")).generateWithTools(
        request,
      ),
    ).rejects.toMatchObject({ code: "MODEL_SERVICE_UNAVAILABLE" });
  });
  it("validates JSON against the business schema instead of accepting valid but wrong JSON", async () => {
    const schema = z.object({ status: z.literal("ready") }).strict();
    await expect(
      client(async () => jsonReply('{"status":"ready"}')).generateStructured(
        request,
        schema,
      ),
    ).resolves.toEqual({ status: "ready" });
    await expect(
      client(async () => jsonReply('{"status":"invented"}')).generateStructured(
        request,
        schema,
      ),
    ).rejects.toMatchObject({ code: "MODEL_JSON_UNSUPPORTED" });
  });
  it("sends the actual structured schema even when callers provide only a short prompt", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      jsonReply('{"status":"ready"}'),
    );
    await client(transport).generateStructured(
      request,
      z.object({ status: z.literal("ready") }).strict(),
    );
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain('"const":"ready"');
    expect(body.response_format.type).toBe("json_object");
  });
  it("bounds upstream bytes and request context", async () => {
    await expect(
      client(async () => jsonReply("x".repeat(270000))).generateWithTools(
        request,
      ),
    ).rejects.toMatchObject({ code: "MODEL_SERVICE_UNAVAILABLE" });
    const transport = vi.fn<typeof fetch>(async () => jsonReply("x"));
    await expect(
      client(transport).generateWithTools({ ...request, maxTokens: 1025 }),
    ).rejects.toMatchObject({ code: "RUN_LIMIT_EXCEEDED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("aborts upstream timeout and distinguishes user cancellation", async () => {
    const transport: typeof fetch = (_url, options) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error(secret)),
          { once: true },
        ),
      );
    await expect(
      client(transport, 20).generateWithTools(request),
    ).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
    const controller = new AbortController();
    const pending = client(transport).generateWithTools({
      ...request,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("ModelRouter capability gate (Mock receipts only)", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const config = {
    model: "test-only",
    apiKey: secret,
    baseUrl: "https://api.deepseek.com",
  };
  async function receipt() {
    return {
      provider: "deepseek",
      model: config.model,
      policyVersion: MODEL_POLICY_VERSION,
      fingerprint: await configurationFingerprint(config),
      testedAt: new Date(now).toISOString(),
      toolCalling: true,
      jsonObject: true,
      strictJsonSchema: false,
    };
  }
  it("never returns ready with absent credentials or untested configuration", async () => {
    expect(await new ModelRouter({}).status()).toEqual({
      ready: false,
      code: "MODEL_SELECTION_REQUIRED",
    });
    expect(await new ModelRouter(config).status()).toEqual({
      ready: false,
      code: "MODEL_TEST_REQUIRED",
    });
  });
  it("produces a public snapshot without secrets/fingerprint and performs no network probe", async () => {
    const value = await new ModelRouter(
      { ...config, capabilityReceipt: JSON.stringify(await receipt()) },
      undefined,
      () => now,
    ).status();
    expect(value.ready).toBe(true);
    expect(JSON.stringify(value)).not.toContain(secret);
    expect(JSON.stringify(value)).not.toContain("fingerprint");
    expect(JSON.stringify(value)).toContain('"strictJsonSchema":false');
  });
  it("invalidates capabilities after key/model changes or expiration", async () => {
    const capabilityReceipt = JSON.stringify(await receipt());
    for (const altered of [
      { ...config, apiKey: "different-test-only" },
      { ...config, model: "other-test-only" },
    ])
      expect(
        (
          await new ModelRouter(
            { ...altered, capabilityReceipt },
            undefined,
            () => now,
          ).status()
        ).ready,
      ).toBe(false);
    expect(
      (
        await new ModelRouter(
          { ...config, capabilityReceipt },
          undefined,
          () => now + 86400001,
        ).status()
      ).ready,
    ).toBe(false);
  });
  it("requires verified tools and JSON and rejects extra secret fields", async () => {
    expect(
      CapabilityReceiptSchema.safeParse({
        ...(await receipt()),
        toolCalling: false,
      }).success,
    ).toBe(false);
    expect(
      CapabilityReceiptSchema.safeParse({
        ...(await receipt()),
        apiKey: secret,
      }).success,
    ).toBe(false);
  });
});
