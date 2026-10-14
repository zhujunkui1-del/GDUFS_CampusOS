import { z } from "zod";
import type {
  ModelClient,
  ModelMessage,
  ModelSnapshot,
  ModelToolCall,
} from "@/domain/models/contracts";
import type { SkillContext, SkillResult } from "@/domain/skills/contracts";
import type { AgentEvent } from "@/domain/agent/contracts";
import { ApiError } from "../errors";
import { SYSTEM_PROMPT } from "./domains";
import { RUN_LIMITS, RunLimiter } from "./limits";
import { SkillRegistry } from "./skill-registry";
import { ToolExecutor } from "./tool-executor";

const toolCallSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        arguments: z.string().max(16384),
      })
      .strict(),
  })
  .strict();
export type AgentRunInput = {
  message: string;
  context: SkillContext;
  // Only server-retrieved history is accepted here; HTTP payload has no history/userId fields.
  history?: readonly { role: "user" | "assistant"; content: string }[];
  onEvent: (event: AgentEvent) => void;
};
export type ModelResolver = {
  resolve(): Promise<{ client: ModelClient; snapshot: ModelSnapshot }>;
};

function whenAborted(signal: AbortSignal) {
  let listener: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    listener = () =>
      reject(
        new ApiError(
          signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED",
          signal.reason?.name === "TimeoutError"
            ? "本次对话超时。"
            : "已停止回复。",
        ),
      );
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    dispose: () => {
      if (listener) signal.removeEventListener("abort", listener);
    },
  };
}

export class AgentOrchestrator {
  constructor(
    private readonly router: ModelResolver,
    private readonly registry: SkillRegistry,
    private readonly limiter = new RunLimiter(),
  ) {}
  async run(input: AgentRunInput) {
    const runId = crypto.randomUUID();
    let sequence = 0;
    const timeout = AbortSignal.timeout(RUN_LIMITS.timeoutMs);
    const signal = input.context.signal
      ? AbortSignal.any([input.context.signal, timeout])
      : timeout;
    const context = { ...input.context, signal };
    const emit = (type: AgentEvent["type"], payload: Record<string, unknown>) =>
      input.onEvent({
        runId,
        eventId: `${runId}:${++sequence}`,
        timestamp: new Date().toISOString(),
        type,
        payload,
      });
    let release: (() => void) | undefined;
    const stopped = whenAborted(signal);
    // An already-aborted request may fail validation before the first race attaches.
    void stopped.promise.catch(() => {});
    const ledger = new Map<
      string,
      { signature: string; result: SkillResult<unknown> }
    >();
    let toolsExecuted = 0;
    let tokensRemaining = RUN_LIMITS.completionTokens;
    try {
      const message = z.string().trim().min(1).max(2000).parse(input.message);
      const history = z
        .array(
          z
            .object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(4000),
            })
            .strict(),
        )
        .max(12)
        .parse(input.history || []);
      if (JSON.stringify(history).length > 24000)
        throw new ApiError("RUN_LIMIT_EXCEEDED", "对话上下文过长。");
      release = this.limiter.acquire(context.sessionId);
      const { client, snapshot } = await Promise.race([
        this.router.resolve(),
        stopped.promise,
      ]);
      const tools = this.registry.tools(context);
      const allowed = new Set(tools.map((tool) => tool.function.name));
      const messages: ModelMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ];
      const executor = new ToolExecutor(this.registry);
      for (let round = 0; round < RUN_LIMITS.rounds; round++) {
        signal.throwIfAborted();
        if (tokensRemaining <= 0)
          throw new ApiError("RUN_LIMIT_EXCEEDED", "本次对话已达到用量限制。");
        const maxTokens = Math.min(
          tokensRemaining,
          RUN_LIMITS.tokensPerRequest,
        );
        const reply = await Promise.race([
          client.generateWithTools({
            messages,
            tools,
            maxTokens,
            signal,
            onText: (text) => {
              if (!signal.aborted)
                emit("message.delta", {
                  text: z.string().max(32768).parse(text),
                });
            },
          }),
          stopped.promise,
        ]);
        signal.throwIfAborted();
        tokensRemaining -= reply.usage?.completionTokens ?? maxTokens;
        const calls: ModelToolCall[] = z
          .array(toolCallSchema)
          .max(4)
          .parse(reply.toolCalls);
        if (
          new Set(calls.map((call) => call.id)).size !== calls.length ||
          (reply.finishReason === "tool_calls") !== calls.length > 0
        )
          throw new ApiError("MODEL_SERVICE_UNAVAILABLE", "模型工具回复无效。");
        if (!calls.length) {
          emit("run.completed", {
            model: snapshot,
            rounds: round + 1,
            toolCalls: toolsExecuted,
            completionTokensBudgetUsed:
              RUN_LIMITS.completionTokens - tokensRemaining,
          });
          return {
            runId,
            status: "completed" as const,
            model: snapshot,
            toolCalls: toolsExecuted,
          };
        }
        messages.push({
          role: "assistant",
          content: reply.content || null,
          tool_calls: calls,
        });
        for (const call of calls) {
          signal.throwIfAborted();
          if (toolsExecuted >= RUN_LIMITS.toolCalls)
            throw new ApiError(
              "RUN_LIMIT_EXCEEDED",
              "本次工具调用已达到限制。",
            );
          const signature = JSON.stringify(call.function);
          const previous = ledger.get(call.id);
          if (previous && previous.signature !== signature)
            throw new ApiError("INVALID_ARGUMENT", "工具调用编号重复。");
          if (previous) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(previous.result),
            });
            continue;
          }
          emit("tool.started", {
            toolCallId: call.id,
            name: call.function.name,
          });
          toolsExecuted++;
          const result: SkillResult<unknown> = allowed.has(call.function.name)
            ? await Promise.race([
                executor.execute(call, context),
                stopped.promise,
              ])
            : {
                ok: false,
                error: {
                  code: "FORBIDDEN",
                  message: "此工具未开放。",
                  retryable: false,
                },
              };
          signal.throwIfAborted();
          ledger.set(call.id, { signature, result });
          emit("tool.finished", {
            toolCallId: call.id,
            name: call.function.name,
            result,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
          if (!result.ok && result.error.code === "CONFIRMATION_REQUIRED") {
            emit("confirmation.required", {
              toolCallId: call.id,
              name: call.function.name,
              message: "此操作需要确认。",
            });
            return {
              runId,
              status: "needs_confirmation" as const,
              model: snapshot,
              toolCalls: toolsExecuted,
            };
          }
        }
      }
      throw new ApiError("RUN_LIMIT_EXCEEDED", "本次对话已达到执行轮数限制。");
    } catch (error) {
      const controlled = signal.aborted
        ? new ApiError(
            timeout.aborted ? "TIMEOUT" : "CANCELLED",
            timeout.aborted ? "本次对话超时。" : "已停止回复。",
          )
        : error instanceof ApiError
          ? error
          : error instanceof z.ZodError
            ? new ApiError("INVALID_ARGUMENT", "对话或工具回复格式无效。")
            : new ApiError(
                "MODEL_SERVICE_UNAVAILABLE",
                "AI 暂时不可用，请稍后重试。",
                true,
              );
      emit("run.failed", {
        error: {
          code: controlled.code,
          message: controlled.message,
          retryable: controlled.retryable,
        },
        toolCalls: toolsExecuted,
      });
      return {
        runId,
        status: "failed" as const,
        code: controlled.code,
        toolCalls: toolsExecuted,
      };
    } finally {
      stopped.dispose();
      release?.();
    }
  }
}
