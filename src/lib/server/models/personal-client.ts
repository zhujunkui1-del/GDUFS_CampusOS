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
async function readSse(
  response: Response,
  onEvent: (event: string | undefined, data: string) => void,
  limit = 1048576,
) {
  if (!response.body)
    throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复为空。", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let bytes = 0;
  let event: string | undefined;
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) onEvent(event, data.join("\n"));
    event = undefined;
    data = [];
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (!line) dispatch();
        else if (line.startsWith(":")) continue;
        else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (pending.length > 65536)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型流格式无效。");
    }
    pending += decoder.decode();
    if (pending.trim()) {
      const line = pending.replace(/\r$/, "");
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      dispatch();
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function incomplete() {
  return new ApiError(
    "MODEL_SERVICE_UNAVAILABLE",
    "模型回复未完整完成，请重试。",
    true,
  );
}

async function openaiStream(
  response: Response,
  onText: (text: string) => void,
): Promise<ModelReply> {
  let content = "";
  let finish: string | undefined;
  let done = false;
  let tokens: ReturnType<typeof usage>;
  const calls = new Map<
    number,
    { id: string; type: "function"; function: { name: string; arguments: string } }
  >();
  await readSse(response, (_event, data) => {
    if (data === "[DONE]") {
      done = true;
      return;
    }
    if (!data || done) return;
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        index?: number;
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: unknown;
    };
    tokens = usage(parsed.usage) || tokens;
    if (parsed.choices && parsed.choices.length > 1) throw incomplete();
    const choice = parsed.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    if (choice.delta?.content) {
      content += choice.delta.content;
      if (content.length > 200000)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
      onText(choice.delta.content);
    }
    for (const part of choice.delta?.tool_calls || []) {
      const call = calls.get(part.index) || {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments)
        call.function.arguments += part.function.arguments;
      if (
        call.id.length > 128 ||
        call.function.name.length > 64 ||
        call.function.arguments.length > 16384
      )
        throw new ApiError(
          "MODEL_SERVICE_UNAVAILABLE",
          "模型工具参数超过限制。",
        );
      calls.set(part.index, call);
    }
  });
  if (!done && !finish) throw incomplete();
  if (finish === "length") throw incomplete();
  const toolCalls: ModelToolCall[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.function.name,
        arguments: call.function.arguments || "{}",
      },
    }));
  return {
    content,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: tokens,
  };
}

async function anthropicStream(
  response: Response,
  onText: (text: string) => void,
): Promise<ModelReply> {
  let content = "";
  let stop: string | undefined;
  let done = false;
  let promptTokens = 0;
  let completionTokens = 0;
  const blocks = new Map<
    number,
    { id: string; name: string; input: unknown; json: string }
  >();
  await readSse(response, (event, data) => {
    if (!data || done) return;
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (event === "error" || parsed.type === "error")
      throw new ApiError(
        "MODEL_SERVICE_UNAVAILABLE",
        String(
          (parsed.error as { message?: string } | undefined)?.message ||
            "模型服务暂时不可用。",
        ),
        true,
      );
    if (parsed.type === "message_start") {
      const message = parsed.message as
        | { usage?: { input_tokens?: number } }
        | undefined;
      promptTokens = message?.usage?.input_tokens || promptTokens;
      return;
    }
    if (parsed.type === "content_block_start") {
      const index = Number(parsed.index);
      const block = parsed.content_block as
        | { type?: string; id?: string; name?: string; input?: unknown; text?: string }
        | undefined;
      if (block?.type === "text" && block.text) {
        content += block.text;
        onText(block.text);
      }
      if (block?.type === "tool_use")
        blocks.set(index, {
          id: block.id || "",
          name: block.name || "",
          input: block.input,
          json: "",
        });
      return;
    }
    if (parsed.type === "content_block_delta") {
      const index = Number(parsed.index);
      const delta = parsed.delta as
        | { type?: string; text?: string; partial_json?: string }
        | undefined;
      if (delta?.type === "text_delta" && delta.text) {
        content += delta.text;
        if (content.length > 200000)
          throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
        onText(delta.text);
      }
      if (delta?.type === "input_json_delta" && delta.partial_json) {
        const block = blocks.get(index);
        if (!block) throw incomplete();
        block.json += delta.partial_json;
        if (block.json.length > 16384)
          throw new ApiError(
            "MODEL_SERVICE_UNAVAILABLE",
            "模型工具参数超过限制。",
          );
      }
      return;
    }
    if (parsed.type === "message_delta") {
      const delta = parsed.delta as { stop_reason?: string } | undefined;
      const deltaUsage = parsed.usage as
        | { output_tokens?: number }
        | undefined;
      if (delta?.stop_reason) stop = delta.stop_reason;
      completionTokens = deltaUsage?.output_tokens || completionTokens;
      return;
    }
    if (parsed.type === "message_stop") done = true;
  });
  if (!done && !stop) throw incomplete();
  if (stop === "max_tokens") throw incomplete();
  const toolCalls: ModelToolCall[] = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, block]) => ({
      id: block.id,
      type: "function",
      function: {
        name: block.name,
        arguments: block.json || JSON.stringify(block.input ?? {}),
      },
    }));
  return {
    content,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

async function geminiStream(
  response: Response,
  onText: (text: string) => void,
): Promise<ModelReply> {
  let content = "";
  let finish: string | undefined;
  let tokens: ReturnType<typeof usage>;
  const toolCalls: ModelToolCall[] = [];
  await readSse(response, (_event, data) => {
    if (!data) return;
    const parsed = JSON.parse(data) as {
      candidates?: Array<{
        content?: {
          parts?: Array<
            { text?: string } | { functionCall?: { name?: string; args?: unknown } }
          >;
        };
        finishReason?: string;
      }>;
      usageMetadata?: unknown;
      error?: { message?: string };
    };
    if (parsed.error)
      throw new ApiError(
        "MODEL_SERVICE_UNAVAILABLE",
        parsed.error.message || "模型服务暂时不可用。",
        true,
      );
    tokens = usage(parsed.usageMetadata) || tokens;
    const candidate = parsed.candidates?.[0];
    if (!candidate) return;
    if (candidate.finishReason) finish = candidate.finishReason;
    for (const [index, part] of (candidate.content?.parts || []).entries()) {
      if ("text" in part && part.text) {
        content += part.text;
        if (content.length > 200000)
          throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
        onText(part.text);
      }
      if ("functionCall" in part && part.functionCall)
        toolCalls.push({
          id: `gemini-${Date.now()}-${index}-${toolCalls.length}`,
          type: "function",
          function: {
            name: part.functionCall.name || "",
            arguments: parseArgs(part.functionCall.args),
          },
        });
    }
  });
  if (!finish) throw incomplete();
  if (finish === "MAX_TOKENS") throw incomplete();
  return {
    content,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: tokens,
  };
}

export class PersonalProviderRegistry {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly timeoutMs = 45000,
  ) {}
  create(config: StoredModelConfig): PersonalModelClient {
    if (!providerById(config.provider))
      throw new ApiError("MODEL_SELECTION_REQUIRED", "不支持的模型供应商。");
    return new PersonalModelClient(config, this.fetchImpl, this.timeoutMs);
  }
}

function openaiJson(data: unknown): ModelReply {
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

/** User-scoped adapter; streams when the caller supplies onText. */
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
  async #send(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("model timeout")),
      this.timeoutMs,
    );
    const combined = signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal;
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: combined,
      });
      if (!response.ok) throw upstream(response.status);
      return {
        response,
        cleanup: () => clearTimeout(timer),
      };
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof ApiError) throw error;
      if (signal?.aborted)
        throw new ApiError("CANCELLED", "已停止回复。");
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /timeout/i.test(error.message))
      )
        throw new ApiError("MODEL_TIMEOUT", "模型请求超时。", true);
      throw new ApiError("MODEL_NETWORK_ERROR", "无法连接模型服务。", true);
    }
  }
  async #post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal?: AbortSignal,
  ) {
    const { response, cleanup } = await this.#send(url, headers, body, signal);
    try {
      return await readJson(response);
    } finally {
      cleanup();
    }
  }
  async generateWithTools(request: ModelRequest): Promise<ModelReply> {
    const p = protocol(this.config.provider);
    return p === "anthropic"
      ? await this.#anthropic(request)
      : p === "gemini"
        ? await this.#gemini(request)
        : await this.#openai(request);
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
    const url = endpoint(this.config.baseUrl, "/chat/completions");
    const headers = { Authorization: `Bearer ${this.config.apiKey}` };
    const body = {
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
      stream: !!request.onText,
      ...(request.onText
        ? { stream_options: { include_usage: true } }
        : {}),
    };
    if (request.onText) {
      const { response, cleanup } = await this.#send(
        url,
        headers,
        body,
        request.signal,
      );
      try {
        if (
          !(response.headers.get("content-type") || "").includes(
            "text/event-stream",
          )
        ) {
          const reply = openaiJson(await readJson(response));
          if (reply.content) request.onText(reply.content);
          return reply;
        }
        return await openaiStream(response, request.onText);
      } finally {
        cleanup();
      }
    }
    return openaiJson(await this.#post(url, headers, body, request.signal));
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
    const url = endpoint(this.config.baseUrl, "/messages");
    const headers = {
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
    };
    const body = {
      model: this.config.model,
      max_tokens: request.maxTokens,
      stream: !!request.onText,
      ...(system ? { system } : {}),
      messages,
      tools: request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
      ...(request.toolChoice ? { tool_choice: { type: "auto" } } : {}),
    };
    if (request.onText) {
      const { response, cleanup } = await this.#send(
        url,
        headers,
        body,
        request.signal,
      );
      try {
        return await anthropicStream(response, request.onText);
      } finally {
        cleanup();
      }
    }
    const data = await this.#post(url, headers, body, request.signal);
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
    const streaming = !!request.onText;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/models/${model}:${
      streaming ? "streamGenerateContent?alt=sse&" : "generateContent?"
    }key=${encodeURIComponent(this.config.apiKey)}`;
    const body = {
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
    };
    if (request.onText) {
      const { response, cleanup } = await this.#send(
        url,
        {},
        body,
        request.signal,
      );
      try {
        return await geminiStream(response, request.onText);
      } finally {
        cleanup();
      }
    }
    const data = await this.#post(url, {}, body, request.signal);
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
