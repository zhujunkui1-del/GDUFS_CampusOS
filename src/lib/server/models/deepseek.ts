import { z } from "zod";
import type {
  ModelClient,
  ModelReply,
  ModelRequest,
  ModelToolCall,
} from "@/domain/models/contracts";
import { ApiError } from "../errors";

export const MODEL_POLICY_VERSION = "deepseek-default-v1";
export const STEP_POLICY_VERSION = "stepfun-plan-v1";
export const GDUFS_POLICY_VERSION = "gdufs-openai-v1";
export type ProviderId = "deepseek" | "stepfun" | "gdufs";
// The campus gateway is an OpenAI-compatible endpoint on the school's own
// host. It is not api.deepseek.com: different base path, different quirks.
export function approvedGdufsEndpoint(baseUrl: string) {
  if (
    ![
      "https://modelsq.gdufs.edu.cn/v1-openai",
      "https://modelsq.gdufs.edu.cn/v1-openai/",
    ].includes(baseUrl)
  )
    throw new ApiError("MODEL_ENDPOINT_INVALID", "模型服务地址未获准。");
  return "https://modelsq.gdufs.edu.cn/v1-openai/chat/completions";
}
export function approvedStepEndpoint(baseUrl: string) {
  if (
    ![
      "https://api.stepfun.com/step_plan/v1",
      "https://api.stepfun.com/step_plan/v1/",
    ].includes(baseUrl)
  )
    throw new ApiError("MODEL_ENDPOINT_INVALID", "模型服务地址未获准。");
  return "https://api.stepfun.com/step_plan/v1/chat/completions";
}
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
  prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
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
  provider: ProviderId = "deepseek",
): ModelReply {
  // The campus gateway reports finish_reason "stop" even when it returns
  // tool_calls. Normalize that observed quirk; every other provider keeps the
  // strict two-way contract.
  const normalized =
    provider === "gdufs" && calls.length > 0 && finish === "stop"
      ? "tool_calls"
      : finish;
  if (
    (normalized !== "stop" && normalized !== "tool_calls") ||
    (normalized === "tool_calls") !== calls.length > 0 ||
    content.length > 200000 ||
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
    finishReason: normalized,
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          ...(usage.prompt_cache_hit_tokens !== undefined
            ? { cachedPromptTokens: usage.prompt_cache_hit_tokens }
            : {}),
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
  provider: ProviderId = "deepseek",
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
      if (content.length > 200000)
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
      provider,
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
    private readonly provider: ProviderId = "deepseek",
    // Server-only opt-in; production callers retain the existing 1024 default.
    private readonly maxOutputTokens = 1024,
    private readonly providerManagedOutput = false,
  ) {
    if (
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens < 1 ||
      maxOutputTokens > 4096
    )
      throw new ApiError("MODEL_SELECTION_REQUIRED", "模型输出预算配置无效。");
    this.#endpoint =
      provider === "gdufs"
        ? approvedGdufsEndpoint(baseUrl)
        : provider === "stepfun"
          ? approvedStepEndpoint(baseUrl)
          : approvedDeepseekEndpoint(baseUrl);
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
      request.maxTokens > this.maxOutputTokens ||
      !Number.isInteger(request.maxTokens) ||
      request.tools.length > 16
    )
      throw new ApiError("RUN_LIMIT_EXCEEDED", "本次对话超过限制。");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      const response = await this.transport(this.#endpoint, {
        method: "POST",
        // workerd rejects redirect:"error"; manual plus an explicit 3xx rejection never forwards credentials.
        redirect: "manual",
        signal,
        headers: {
          Authorization: `Bearer ${this.#key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          ...(this.providerManagedOutput
            ? {}
            : { max_tokens: request.maxTokens }),
          // Grounded campus answers should not vary between identical questions.
          temperature: 0.2,
          ...(this.provider === "deepseek"
            ? { thinking: { type: "disabled" } }
            : this.provider === "gdufs"
              ? // The gateway ignores OpenAI-style reasoning switches; its
                // chat template only honours this flag. Verified: 0 reasoning
                // tokens, normal content.
                { chat_template_kwargs: { thinking: false } }
              : { reasoning_effort: "low" }),
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
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new ApiError(
          "MODEL_ENDPOINT_INVALID",
          "模型服务地址发生重定向，已停止请求。",
        );
      }
      if (!response.ok) {
        if (this.provider === "gdufs") {
          // The campus gateway answers 404 for both an unknown key and an
          // unknown model, so the status alone cannot classify the failure.
          let message = "";
          try {
            const data = JSON.parse(await readLimited(response, 8192));
            message = String(data.message ?? data.error?.message ?? "");
          } catch {
            /* No raw provider error leaves this boundary. */
          }
          if (/密钥|api[\s_-]?key|unauthori[sz]ed|invalid token/i.test(message))
            throw new ApiError("MODEL_KEY_INVALID", "模型密钥无效或已失效。");
          if (/model not found|模型不存在|not found/i.test(message))
            throw new ApiError(
              "MODEL_NOT_FOUND_OR_FORBIDDEN",
              "模型不存在或当前账号没有权限。",
            );
          // Quota exhaustion is the only condition the owner authorized to
          // fall back; the gateway is inconsistent about its HTTP status.
          if (
            [402, 429].includes(response.status) &&
            /quota|额度|余额|配额|insufficient|exhaust/i.test(message)
          )
            throw new ApiError("MODEL_QUOTA_EXHAUSTED", "首选模型额度已用完。");
          throw upstreamError(response.status);
        }
        if (
          this.provider === "stepfun" &&
          [402, 429].includes(response.status)
        ) {
          let quota = response.status === 402;
          try {
            const data = JSON.parse(await readLimited(response, 8192));
            const code = String(data.error?.code ?? data.code ?? ""),
              message = String(data.error?.message ?? data.message ?? "");
            quota ||=
              /^(insufficient_quota|insufficient_balance|quota_exceeded|credit_limit_exceeded|plan_quota_exceeded)$/.test(
                code,
              ) ||
              (/quota|credit|balance|额度|余额|配额/i.test(message) &&
                /exhaust|exceed|insufficient|耗尽|用尽|不足|超出/i.test(
                  message,
                ));
          } catch {
            /* No raw provider error leaves this boundary. */
          }
          if (quota)
            throw new ApiError("MODEL_QUOTA_EXHAUSTED", "首选模型额度已用完。");
        } else await response.body?.cancel();
        throw upstreamError(response.status);
      }
      if (request.onText)
        return await streamedReply(response, request.onText, this.provider);
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
        this.provider,
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
