import { afterEach, describe, expect, it, vi } from "vitest";
import { accountFixture } from "../fixtures/account";
import { createAccountApi } from "@/lib/server/account/api";
import {
  assertSafeModelBaseUrl,
  decryptModelSecret,
  encryptModelSecret,
  maskKey,
  ModelSettingsStore,
} from "@/lib/server/models/credentials";
import {
  PersonalModelClient,
  testPersonalConnection,
} from "@/lib/server/models/personal-client";
import { personalModelRuntime } from "@/lib/server/models/personal-runtime";
import { ModelConfigStore } from "@/lib/server/models/model-config-store";

const secret = "fixture-model-credential-secret-123456";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("personal model endpoint safety", () => {
  it("accepts public HTTPS endpoints and strips trailing slashes", () => {
    expect(assertSafeModelBaseUrl("https://api.deepseek.com/v1/")).toBe(
      "https://api.deepseek.com/v1",
    );
    expect(assertSafeModelBaseUrl("https://openrouter.ai/api/v1")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it.each([
    ["http://api.example.com/v1", "HTTPS"],
    ["https://localhost/v1", "本机"],
    ["https://127.0.0.1/v1", "内网"],
    ["https://10.1.2.3/v1", "内网"],
    ["https://[::1]/v1", "内网"],
    ["https://169.254.169.254/latest", "内网"],
    ["https://metadata.google.internal/v1", "允许"],
    ["https://api.example.com:8443/v1", "443"],
    ["https://user:pass@api.example.com/v1", "不能包含"],
    ["https://api.example.com/v1?debug=1", "不能包含"],
  ])("rejects %s", (url, message) => {
    expect(() => assertSafeModelBaseUrl(url)).toThrow(message);
  });
});

describe("personal model credential storage", () => {
  it("encrypts with AES-GCM, decrypts round-trip and never returns the raw key", async () => {
    const cipher = await encryptModelSecret(secret, "sk-secret-value-1234");
    expect(cipher).toMatch(/^v1\./);
    expect(cipher).not.toContain("sk-secret");
    await expect(decryptModelSecret(secret, cipher)).resolves.toBe(
      "sk-secret-value-1234",
    );
    await expect(
      decryptModelSecret(secret + "x", cipher),
    ).rejects.toMatchObject({ code: "MODEL_KEY_INVALID" });
  });

  it("masks keys and exposes only the last four characters", () => {
    expect(maskKey("sk-1234567890")).toBe("••••7890");
    expect(maskKey("abc")).toBe("••••");
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("personal model client adapters", () => {
  it("calls an OpenAI-compatible endpoint with bearer auth and parses tool calls", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        choices: [
          {
            message: {
              content: "hello",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "lookup", arguments: '{"q":"x"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    });
    const client = new PersonalModelClient(
      {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-test",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const reply = await client.generateWithTools({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    expect(reply.content).toBe("hello");
    expect(reply.toolCalls[0]).toMatchObject({
      id: "call-1",
      function: { name: "lookup" },
    });
    expect(reply.usage?.totalTokens).toBe(5);
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(
      (calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer sk-test");
    expect(client.snapshot).toMatchObject({
      source: "personal",
      provider: "openai",
      model: "deepseek-chat",
    });
  });

  it("maps Anthropic Messages API shape", async () => {
    let request: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      request = init;
      return jsonResponse({
        content: [
          { type: "text", text: "hi from claude" },
          { type: "tool_use", id: "tool-1", name: "lookup", input: { q: "x" } },
        ],
        usage: { input_tokens: 4, output_tokens: 2 },
      });
    });
    const client = new PersonalModelClient(
      {
        provider: "claude",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-ant",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const reply = await client.generateWithTools({
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "hi" },
      ],
      tools: [],
      maxTokens: 64,
      signal: new AbortController().signal,
    });
    expect(reply.content).toBe("hi from claude");
    expect(reply.toolCalls[0]).toMatchObject({
      id: "tool-1",
      function: { name: "lookup" },
    });
    const body = JSON.parse(String(request?.body));
    expect(body.system).toBe("system prompt");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect((request?.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant",
    );
  });

  it("tests a connection without storing it", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("cloudflare-dns.com"))
        return jsonResponse({ Answer: [{ type: 1, data: "93.184.216.34" }] });
      return jsonResponse({
        choices: [{ message: { content: "OK" } }],
        usage: { total_tokens: 1 },
      });
    });
    const result = await testPersonalConnection(
      {
        provider: "custom",
        baseUrl: "https://api.example.com/v1",
        model: "model-a",
        apiKey: "sk-test",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("personal runtime resolution", () => {
  it("uses the saved personal config for the owning account only", async () => {
    const f = accountFixture();
    try {
      const a = await f.register("RuntimeUser");
      const configs = new ModelConfigStore(f.db, secret);
      const created = await configs.create(a.profile.id, {
        displayName: "runtime",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-runtime",
      });
      await configs.setStatus(a.profile.id, created.id, "connected", null);
      await configs.setPreference(a.profile.id, "personal", created.id);
      const runtime = await personalModelRuntime(
        f.db,
        "u:" + a.profile.id,
        secret,
      );
      expect(runtime?.snapshot).toMatchObject({
        source: "personal",
        provider: "openai",
        model: "deepseek-chat",
      });
      expect(
        await personalModelRuntime(f.db, "g:guest", secret),
      ).toBeNull();
      await expect(
        personalModelRuntime(f.db, "u:" + a.profile.id, "short"),
      ).rejects.toMatchObject({ code: "MODEL_NOT_CONNECTED" });
    } finally {
      f.close();
    }
  });
});

describe("personal settings account API", () => {
  it("saves, lists masked keys, deletes and never returns the secret", async () => {
    const f = accountFixture();
    try {
      const a = await f.register("ApiUser");
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.includes("cloudflare-dns.com"))
          return jsonResponse({ Answer: [{ type: 1, data: "93.184.216.34" }] });
        return jsonResponse({ choices: [{ message: { content: "OK" } }] });
      });
      vi.stubGlobal("fetch", fetchImpl);
      const api = createAccountApi({
        store: f.store,
        enabled: true,
        credentialSecret: secret,
        defer: () => {},
      });
      const call = async (method: string, body?: unknown) =>
        (
          (await (
            await api(
              new Request("https://campus.example/api/me/model-settings", {
                method,
                headers: {
                  Cookie: "campusos_session=" + a.token,
                  "Content-Type": "application/json",
                  Origin: "https://campus.example",
                },
                body: body === undefined ? undefined : JSON.stringify(body),
              }),
            )
          ).json()) as { data: Record<string, unknown> }
        ).data;
      const saved = await call("PATCH", {
        action: "save",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-super-secret-key",
      });
      expect(saved).toMatchObject({
        settings: [
          {
            provider: "deepseek",
            keyHint: "••••-key",
            status: "connected",
          },
        ],
      });
      expect(JSON.stringify(saved)).not.toContain("sk-super-secret-key");
      const listed = await call("GET");
      expect(listed.settings).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain("sk-super-secret-key");
      const stored = await new ModelSettingsStore(
        f.db,
        secret,
      ).get(a.profile.id);
      expect(stored?.apiKey).toBe("sk-super-secret-key");
      expect(await call("DELETE", {})).toEqual({ settings: [] });
      expect(await call("GET")).toEqual({ settings: [] });
    } finally {
      f.close();
    }
  });
});

describe("multiple personal model configs", () => {
  it("keeps several configs, masks keys and never falls back after deleting active", async () => {
    const f = accountFixture();
    try {
      const a = await f.register("MultiUser");
      const store = new ModelConfigStore(f.db, secret);
      const first = await store.create(a.profile.id, {
        displayName: "deepseek",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-first-secret",
      });
      const second = await store.create(a.profile.id, {
        displayName: "kimi",
        provider: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "moonshot-v1-8k",
        apiKey: "sk-second-secret",
      });
      const listed = await store.list(a.profile.id);
      expect(listed).toHaveLength(2);
      expect(JSON.stringify(listed)).not.toContain("sk-first-secret");
      expect((await store.preference(a.profile.id)).mode).toBe("platform");

      await store.setStatus(a.profile.id, first.id, "connected", null);
      await store.setPreference(a.profile.id, "personal", first.id);
      expect((await store.active(a.profile.id)).config?.apiKey).toBe(
        "sk-first-secret",
      );

      await store.update(a.profile.id, first.id, {
        displayName: "deepseek-renamed",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "",
      });
      await expect(store.active(a.profile.id)).rejects.toMatchObject({
        code: "MODEL_NOT_CONNECTED",
      });
      await store.setStatus(a.profile.id, first.id, "connected", null);
      expect((await store.active(a.profile.id)).config?.apiKey).toBe(
        "sk-first-secret",
      );
      await expect(
        store.setPreference(a.profile.id, "personal", second.id),
      ).rejects.toMatchObject({ code: "MODEL_NOT_VERIFIED" });

      await store.remove(a.profile.id, first.id);
      await expect(store.active(a.profile.id)).rejects.toMatchObject({
        code: "MODEL_NOT_CONNECTED",
      });
      expect((await store.preference(a.profile.id)).mode).toBe("personal");

      await store.setPreference(a.profile.id, "platform", null);
      expect((await store.active(a.profile.id)).mode).toBe("platform");
    } finally {
      f.close();
    }
  });

  it("never exposes one user's config to another user", async () => {
    const f = accountFixture();
    try {
      const a = await f.register("OwnerA");
      const b = await f.register("OwnerB");
      const store = new ModelConfigStore(f.store.db, secret);
      const config = await store.create(a.profile.id, {
        displayName: "owner-a",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-owner-a-secret",
      });
      await store.setStatus(a.profile.id, config.id, "connected", null);
      await store.setPreference(a.profile.id, "personal", config.id);
      expect((await store.list(b.profile.id)).length).toBe(0);
      await expect(store.update(b.profile.id, config.id, {
        displayName: "hijack",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-hijack",
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(store.active(b.profile.id)).resolves.toMatchObject({
        mode: "platform",
      });
    } finally {
      f.close();
    }
  });

  it("exposes config CRUD through the account API", async () => {
    const f = accountFixture();
    try {
      const a = await f.register("MultiApiUser");
      const api = createAccountApi({
        store: f.store,
        enabled: true,
        credentialSecret: secret,
        defer: () => {},
      });
      const call = async (method: string, body?: unknown) =>
        (
          (await (
            await api(
              new Request("https://campus.example/api/me/model-configs", {
                method,
                headers: {
                  Cookie: "campusos_session=" + a.token,
                  "Content-Type": "application/json",
                  Origin: "https://campus.example",
                },
                body: body === undefined ? undefined : JSON.stringify(body),
              }),
            )
          ).json()) as { data: Record<string, unknown> }
        ).data;
      const created = (await call("POST", {
        displayName: "api-config",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-api-secret",
      })) as {
        config: { id: string; keyHint: string; status: string };
        mode: string;
      };
      expect(created.config.keyHint).toBe("••••cret");
      expect(created.mode).toBe("platform");
      expect(JSON.stringify(created)).not.toContain("sk-api-secret");
      const listed = (await call("GET")) as {
        configs: { id: string }[];
        mode: string;
      };
      expect(listed.configs).toHaveLength(1);
      expect(listed.mode).toBe("platform");
      await call("PATCH", { action: "platform" });
      const after = (await call("GET")) as { mode: string };
      expect(after.mode).toBe("platform");
    } finally {
      f.close();
    }
  });
});
