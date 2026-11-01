import { z } from "zod";
import type {
  ModelClient,
  ModelReply,
  ModelRequest,
  ModelToolCall,
  ModelSnapshot,
} from "@/domain/models/contracts";
import { providerById, type ModelProtocol } from "@/domain/models/providers";
import { ApiError } from "../errors";
import { assertSafeModelBaseUrl, type StoredModelConfig } from "./credentials";

type Fetch = typeof fetch;

function endpoint(base: string, path: string) {
  const clean = base.replace(/\/+$/, "");
  if (path === "/chat/completions" && clean.endsWith("/chat/completions"))
    return clean;
  if (path === "/messages" && clean.endsWith("/messages")) return clean;
  return clean + path;
}
function protocol(provider: string): ModelProtocol {
  return providerById(provider)?.protocol || "openai";
}
function privateHost(host: string) {
  const lower = host.toLowerCase();
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  );
}
function upstream(status: number) {
  if (status === 401 || status === 403)
    return new ApiError("MODEL_KEY_INVALID", "API Key 无效或没有权限。");
  if (status === 402 || status === 429)
    return new ApiError("MODEL_QUOTA_EXHAUSTED", "额度不足或请求过于频繁。", true);
  if (status === 404)
    return new ApiError("MODEL_NOT_FOUND_OR_FORBIDDEN", "模型不存在或不可用。");
  return new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型服务暂时不可用。", true);
}
async function readJson(response: Response) {
  const text = await response.text();
  if (text.length > 524288)
    throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复格式无效。");
  }
}
function usage(value: unknown) {
  const u = value as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | undefined;
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    totalTokens:
      u.total_tokens ??
      (u.prompt_tokens ?? u.input_tokens ?? 0) +
        (u.completion_tokens ?? u.output_tokens ?? 0),
  };
}
function parseArgs(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

/** Non-streaming adapter. Streaming is intentionally not trusted for arbitrary providers. */
export class PersonalModelClient implements ModelClient {
  readonly snapshot: ModelSnapshot;
  constructor(
    readonly config: StoredModelConfig,
    readonly fetchImpl: Fetch = fetch,
    readonly timeoutMs = 45000,
  ) {
    this.config.baseUrl = assertSafeModelBaseUrl(config.baseUrl);
    this.snapshot = {
      source: "personal",
      provider: protocol(config.provider),
      model: config.model,
      policyVersion: "personal-v1",
      testedAt: new Date().toISOString(),
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    };
  }
  async #post(url: string, headers: Record<string, string>, body: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("model timeout")),
      this.timeoutMs,
    );
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw upstream(response.status);
      return await readJson(response);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /timeout/i.test(error.message))
      )
        throw new ApiError("MODEL_TIMEOUT", "模型请求超时。", true);
      throw new ApiError("MODEL_NETWORK_ERROR", "无法连接模型服务。", true);
    } finally {
      clearTimeout(timer);
    }
  }
  async generateWithTools(request: ModelRequest): Promise<ModelReply> {
    const p = protocol(this.config.provider);
    const reply =
      p === "anthropic"
        ? await this.#anthropic(request)
        : p === "gemini"
          ? await this.#gemini(request)
          : await this.#openai(request);
    request.onText?.(reply.content);
    return reply;
  }
  async generateStructured<T>(
    request: Omit<ModelRequest, "tools" | "onText" | "toolChoice">,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const reply = await this.generateWithTools({
      ...request,
      tools: [],
      maxTokens: request.maxTokens,
    });
    const match = reply.content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match)
      throw new ApiError("MODEL_JSON_UNSUPPORTED", "模型没有返回 JSON。");
    try {
      return schema.parse(JSON.parse(match[0]));
    } catch {
      throw new ApiError("MODEL_JSON_UNSUPPORTED", "模型返回的 JSON 不符合要求。");
    }
  }
  async #openai(request: ModelRequest): Promise<ModelReply> {
    const data = await this.#post(
      endpoint(this.config.baseUrl, "/chat/completions"),
      { Authorization: `Bearer ${this.config.apiKey}` },
      {
        model: this.config.model,
        messages: request.messages.map((message) => {
          if (message.role === "system" || message.role === "user")
            return { role: message.role, content: message.content };
          if (message.role === "assistant")
            return {
              role: "assistant",
              content: message.content,
              ...(message.tool_calls?.length
                ? {
                    tool_calls: message.tool_calls.map((call) => ({
                      id: call.id,
                      type: "function",
                      function: call.function,
                    })),
                  }
                : {}),
            };
          if (message.role !== "tool") throw new Error("invalid role");
          return {
            role: "tool",
            content: message.content,
            tool_call_id: message.tool_call_id,
          };
        }),
        tools: request.tools,
        tool_choice: request.toolChoice || "auto",
        max_tokens: request.maxTokens,
        stream: false,
      },
    );
    const value = data as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type?: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: unknown;
      error?: { message?: string };
    };
    const choice = value.choices?.[0];
    if (!choice?.message)
      throw new ApiError(
        "MODEL_SERVICE_UNAVAILABLE",
        value.error?.message || "模型没有返回内容。",
        true,
      );
    const calls: ModelToolCall[] = (choice.message.tool_calls || []).map((c) => ({
      id: c.id,
      type: "function",
      function: {
        name: c.function.name,
        arguments: parseArgs(c.function.arguments),
      },
    }));
    return {
      content: choice.message.content || "",
      toolCalls: calls,
      finishReason: calls.length ? "tool_calls" : "stop",
      usage: usage(value.usage),
    };
  }
  async #anthropic(request: ModelRequest): Promise<ModelReply> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages: unknown[] = [];
    for (const message of request.messages) {
      if (message.role === "system") continue;
      if (message.role === "user") {
        messages.push({ role: "user", content: message.content });
        continue;
      }
      if (message.role === "assistant") {
        const content: unknown[] = [];
        if (message.content) content.push({ type: "text", text: message.content });
        for (const call of message.tool_calls || [])
          content.push({
            type: "tool_use",
            id: call.id,
            name: call.function.name,
            input: safeObject(call.function.arguments),
          });
        messages.push({ role: "assistant", content });
        continue;
      }
      if (message.role !== "tool") continue;
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id,
            content: message.content,
          },
        ],
      });
    }
    const data = await this.#post(
      endpoint(this.config.baseUrl, "/messages"),
      {
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      {
        model: this.config.model,
        max_tokens: request.maxTokens,
        ...(system ? { system } : {}),
        messages,
        tools: request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters,
        })),
        ...(request.toolChoice
          ? { tool_choice: { type: "auto" } }
          : {}),
      },
    );
    const value = data as {
      content?: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      >;
      stop_reason?: string;
      usage?: unknown;
    };
    if (!value.content)
      throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型没有返回内容。", true);
    const text = value.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("");
    const calls: ModelToolCall[] = value.content
      .filter(
        (
          part,
        ): part is {
          type: "tool_use";
          id: string;
          name: string;
          input: unknown;
        } => part.type === "tool_use",
      )
      .map((part) => ({
        id: part.id,
        type: "function",
        function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
      }));
    return {
      content: text,
      toolCalls: calls,
      finishReason: calls.length ? "tool_calls" : "stop",
      usage: usage(value.usage),
    };
  }
  async #gemini(request: ModelRequest): Promise<ModelReply> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const names = new Map<string, string>();
    const contents: unknown[] = [];
    for (const message of request.messages) {
      if (message.role === "system") continue;
      if (message.role === "user") {
        contents.push({ role: "user", parts: [{ text: message.content }] });
        continue;
      }
      if (message.role === "assistant") {
        const parts: unknown[] = [];
        if (message.content) parts.push({ text: message.content });
        for (const call of message.tool_calls || []) {
          names.set(call.id, call.function.name);
          parts.push({
            functionCall: {
              name: call.function.name,
              args: safeObject(call.function.arguments),
            },
          });
        }
        contents.push({ role: "model", parts });
        continue;
      }
      if (message.role !== "tool") continue;
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: names.get(message.tool_call_id) || "tool",
              response: { result: message.content },
            },
          },
        ],
      });
    }
    const model = encodeURIComponent(this.config.model);
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/models/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`;
    const data = await this.#post(url, {}, {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      tools: request.tools.length
        ? [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
              })),
            },
          ]
        : undefined,
      generationConfig: { maxOutputTokens: request.maxTokens },
    });
    const value = data as {
      candidates?: Array<{
        content?: {
          parts?: Array<
            | { text?: string }
            | { functionCall?: { name: string; args?: unknown } }
          >;
        };
        finishReason?: string;
      }>;
      usageMetadata?: unknown;
    };
    const candidate = value.candidates?.[0];
    if (!candidate?.content?.parts)
      throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型没有返回内容。", true);
    let text = "";
    const calls: ModelToolCall[] = [];
    for (const [index, part] of candidate.content.parts.entries()) {
      if ("text" in part && part.text) text += part.text;
      if ("functionCall" in part && part.functionCall)
        calls.push({
          id: `gemini-${Date.now()}-${index}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: parseArgs(part.functionCall.args),
          },
        });
    }
    return {
      content: text,
      toolCalls: calls,
      finishReason: calls.length ? "tool_calls" : "stop",
      usage: usage(value.usageMetadata),
    };
  }
}

function safeObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const dnsCache = new Map<string, number>();
function ipv4(value: string) {
  const p = value.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return null;
  return p;
}
function privateIp(value: string) {
  const v4 = ipv4(value);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = value.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb")
  );
}
async function publicDns(host: string, fetchImpl: Fetch) {
  const cached = dnsCache.get(host);
  if (cached && cached > Date.now()) return;
  const results: string[] = [];
  for (const type of ["A", "AAAA"]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetchImpl(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        {
          headers: { Accept: "application/dns-json" },
          signal: controller.signal,
        },
      );
      if (!response.ok) continue;
      const data = (await response.json()) as {
        Answer?: Array<{ type: number; data: string }>;
      };
      for (const answer of data.Answer || [])
        if (answer.type === 1 || answer.type === 28) results.push(answer.data);
    } catch {
      /* A resolution failure is handled by the caller. */
    } finally {
      clearTimeout(timer);
    }
  }
  if (!results.length)
    throw new ApiError(
      "MODEL_ENDPOINT_INVALID",
      "无法解析接入地址的域名，请检查地址。",
    );
  if (results.some(privateIp))
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址不能指向内网。");
  dnsCache.set(host, Date.now() + 300000);
}

export async function testPersonalConnection(
  config: StoredModelConfig,
  options: { validateDns?: boolean; fetchImpl?: Fetch } = {},
) {
  const baseUrl = assertSafeModelBaseUrl(config.baseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const host = new URL(baseUrl).hostname;
  if (options.validateDns !== false && !privateHost(host) && !ipv4(host))
    await publicDns(host, fetchImpl);
  if (privateHost(host))
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址不能指向本机。");
  const client = new PersonalModelClient(
    { ...config, baseUrl },
    fetchImpl,
    12000,
  );
  const started = Date.now();
  const reply = await client.generateWithTools({
    messages: [
      { role: "system", content: "只回复 OK，不要解释。" },
      { role: "user", content: "连接测试" },
    ],
    tools: [],
    maxTokens: 16,
    signal: AbortSignal.timeout(12000),
  });
  if (!reply.content.trim() && !reply.toolCalls.length)
    throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型没有返回内容。");
  return {
    ok: true as const,
    latencyMs: Date.now() - started,
    model: config.model,
    reply: reply.content.slice(0, 80),
  };
}
