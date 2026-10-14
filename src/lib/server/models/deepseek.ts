import { z } from "zod";
import type {
  ModelClient,
  ModelReply,
  ModelRequest,
  ModelToolCall,
} from "@/domain/models/contracts";
import { ApiError } from "../errors";

export const MODEL_POLICY_VERSION = "deepseek-default-v1";
const toolCallSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    arguments: z.string().max(16384),
  }),
});
const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
const deltaSchema = z.object({
  choices: z
    .array(
      z.object({
        index: z.number().int(),
        delta: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().min(0).max(3),
                id: z.string().max(128).optional(),
                type: z.literal("function").optional(),
                function: z
                  .object({
                    name: z.string().max(64).optional(),
                    arguments: z.string().max(16384).optional(),
                  })
                  .optional(),
              }),
            )
            .max(4)
            .optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .max(1),
  usage: usageSchema.nullable().optional(),
});
const replySchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z.array(toolCallSchema).max(4).optional(),
        }),
        finish_reason: z.string(),
      }),
    )
    .length(1),
  usage: usageSchema.optional(),
});

export function approvedDeepseekEndpoint(baseUrl: string) {
  if (
    ![
      "https://api.deepseek.com",
      "https://api.deepseek.com/",
      "https://api.deepseek.com/v1",
      "https://api.deepseek.com/v1/",
    ].includes(baseUrl)
  )
    throw new ApiError("MODEL_ENDPOINT_INVALID", "模型服务地址未获准。");
  return "https://api.deepseek.com/chat/completions";
}
function upstreamError(status: number) {
  if (status === 401)
    return new ApiError("MODEL_KEY_INVALID", "模型密钥无效或已失效。");
  if (status === 402)
    return new ApiError("MODEL_QUOTA_EXHAUSTED", "模型服务额度不足。");
  if (status === 403 || status === 404)
    return new ApiError(
      "MODEL_NOT_FOUND_OR_FORBIDDEN",
      "模型不存在或当前账号没有权限。",
    );
  if (status === 429)
    return new ApiError(
      "MODEL_RATE_LIMITED",
      "模型请求过于频繁，请稍后重试。",
      true,
    );
  return new ApiError(
    "MODEL_SERVICE_UNAVAILABLE",
    "模型服务暂时不可用。",
    true,
  );
}
function safeReply(
  content: string,
  calls: ModelToolCall[],
  finish: string | undefined,
  usage?: z.infer<typeof usageSchema>,
): ModelReply {
  if (
    (finish !== "stop" && finish !== "tool_calls") ||
    (finish === "tool_calls") !== calls.length > 0 ||
    content.length > 32768 ||
    new Set(calls.map((c) => c.id)).size !== calls.length
  )
    throw new ApiError(
      "MODEL_SERVICE_UNAVAILABLE",
      "模型回复未完整完成，请重试。",
      true,
    );
  return {
    content,
    toolCalls: calls,
    finishReason: finish,
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined,
  };
}
async function readLimited(response: Response, limit = 262144) {
  if (!response.body)
    throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复为空。", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function streamedReply(
  response: Response,
  onText: (text: string) => void,
) {
  if (!response.body)
    throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复为空。", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let bytes = 0;
  let content = "";
  let finish: string | undefined;
  let done = false;
  let usage: z.infer<typeof usageSchema> | undefined;
  const calls = new Map<
    number,
    {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }
  >();
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      return;
    }
    if (!data || done) return;
    const parsed = deltaSchema.safeParse(JSON.parse(data));
    if (!parsed.success)
      throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复格式无效。");
    if (parsed.data.usage) usage = parsed.data.usage;
    const choice = parsed.data.choices[0];
    if (!choice) return;
    if (
      choice.index !== 0 ||
      (finish && (choice.delta.content || choice.delta.tool_calls))
    )
      throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型流顺序无效。");
    if (choice.finish_reason) finish = choice.finish_reason;
    // reasoning_content and other upstream fields are deliberately discarded by the schema.
    if (choice.delta.content) {
      content += choice.delta.content;
      if (content.length > 32768)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复超过限制。");
      onText(choice.delta.content);
    }
    for (const part of choice.delta.tool_calls || []) {
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
        call.function.arguments.length > 16384 ||
        call.id.length > 128 ||
        call.function.name.length > 64
      )
        throw new ApiError(
          "MODEL_SERVICE_UNAVAILABLE",
          "模型工具参数超过限制。",
        );
      calls.set(part.index, call);
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1048576)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型流超过限制。");
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        consume(pending.slice(0, newline).replace(/\r$/, ""));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 65536)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型流格式无效。");
      if (done) break;
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
    if (!done)
      throw new ApiError(
        "MODEL_SERVICE_UNAVAILABLE",
        "模型连接中断，请重试。",
        true,
      );
    return safeReply(
      content,
      [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => toolCallSchema.parse(call)),
      finish,
      usage,
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class DeepseekModelClient implements ModelClient {
  #key: string;
  #endpoint: string;
  constructor(
    private readonly model: string,
    apiKey: string,
    baseUrl = "https://api.deepseek.com",
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 15000,
  ) {
    this.#endpoint = approvedDeepseekEndpoint(baseUrl);
    this.#key = apiKey;
    if (!apiKey || !/^[a-zA-Z0-9._-]{1,100}$/.test(model))
      throw new ApiError("MODEL_SELECTION_REQUIRED", "默认模型尚未配置。");
  }
  private async request(
    request: ModelRequest,
    json = false,
  ): Promise<ModelReply> {
    if (
      request.messages.length > 48 ||
      JSON.stringify(request.messages).length > 65536 ||
      request.maxTokens < 1 ||
      request.maxTokens > 1024 ||
      !Number.isInteger(request.maxTokens) ||
      request.tools.length > 16
    )
      throw new ApiError("RUN_LIMIT_EXCEEDED", "本次对话超过限制。");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      const response = await this.transport(this.#endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${this.#key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          max_tokens: request.maxTokens,
          thinking: { type: "disabled" },
          stream: !!request.onText,
          ...(request.onText
            ? { stream_options: { include_usage: true } }
            : {}),
          ...(request.tools.length
            ? {
                tools: request.tools,
                tool_choice: request.toolChoice || "auto",
              }
            : {}),
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw upstreamError(response.status);
      }
      if (request.onText) return await streamedReply(response, request.onText);
      const parsed = replySchema.safeParse(
        JSON.parse(await readLimited(response)),
      );
      if (!parsed.success)
        throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型回复格式无效。");
      const choice = parsed.data.choices[0];
      return safeReply(
        choice.message.content || "",
        choice.message.tool_calls || [],
        choice.finish_reason,
        parsed.data.usage,
      );
    } catch (error) {
      if (request.signal.aborted)
        throw new ApiError("CANCELLED", "已停止回复。");
      if (timeout.aborted)
        throw new ApiError("MODEL_TIMEOUT", "模型回复超时，请重试。", true);
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "MODEL_NETWORK_ERROR",
        "模型连接或回复无效，请重试。",
        true,
      );
    }
  }
  generateWithTools(request: ModelRequest) {
    return this.request(request);
  }
  async generateStructured<T>(
    request: Omit<ModelRequest, "tools" | "onText" | "toolChoice">,
    schema: z.ZodType<T>,
  ) {
    const reply = await this.request(
      {
        ...request,
        tools: [],
        messages: [
          {
            role: "system",
            content: `Return only a JSON object matching this JSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}`,
          },
          ...request.messages,
        ],
      },
      true,
    );
    try {
      return schema.parse(JSON.parse(reply.content));
    } catch {
      throw new ApiError(
        "MODEL_JSON_UNSUPPORTED",
        "模型结构化回复未通过验证。",
      );
    }
  }
}
