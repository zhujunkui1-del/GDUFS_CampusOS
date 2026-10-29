import type { SkillContext, SkillResult } from "@/domain/skills/contracts";
import type { ModelToolCall } from "@/domain/models/contracts";
import { ApiError, ERROR_STATUS } from "../errors";
import { canCall, SkillRegistry } from "./skill-registry";

export class ToolExecutor {
  constructor(private readonly registry: SkillRegistry) {}
  async execute(
    call: ModelToolCall,
    context: SkillContext,
  ): Promise<SkillResult<unknown>> {
    const skill = this.registry.get(call.function.name);
    try {
      context.signal?.throwIfAborted();
      if (!skill) throw new ApiError("NOT_FOUND", "此工具未开放。");
      if (skill.auth !== "public" && !context.user)
        throw new ApiError("UNAUTHORIZED", "请先登录。");
      if (!canCall(skill, context))
        throw new ApiError("FORBIDDEN", "没有使用此工具的权限。");
      // A client/model-supplied confirmedActionId is never sufficient. Writes stay closed until the confirmation ledger exists.
      if (skill.requiresConfirmation || skill.sideEffect !== "none")
        throw new ApiError("CONFIRMATION_REQUIRED", "此操作需要确认。");
      if (call.function.arguments.length > 16384)
        throw new ApiError("INVALID_ARGUMENT", "工具参数过长。");
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        throw new ApiError("INVALID_ARGUMENT", "工具参数无效。");
      }
      const controller = new AbortController();
      const signal = context.signal
        ? AbortSignal.any([context.signal, controller.signal])
        : controller.signal;
      signal.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (() => void) | undefined;
      const stopped = new Promise<never>((_, reject) => {
        rejectAbort = () =>
          reject(
            new ApiError(
              context.signal?.aborted ? "CANCELLED" : "TIMEOUT",
              context.signal?.aborted ? "已停止执行。" : "工具执行超时。",
              !context.signal?.aborted,
            ),
          );
        signal.addEventListener("abort", rejectAbort, { once: true });
        timer = setTimeout(() => controller.abort(), skill.timeoutMs);
      });
      try {
        const result = await Promise.race([
          skill.run(input, { ...context, signal }),
          stopped,
        ]);
        signal.throwIfAborted();
        if (JSON.stringify(result).length > 32768)
          throw new ApiError("UPSTREAM_ERROR", "工具结果超过限制。");
        return result;
      } finally {
        clearTimeout(timer);
        if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
      }
    } catch (error) {
      if (!(error instanceof ApiError))
        console.error(
          "[tool] " + call.function.name + " failed:",
          error instanceof Error ? error.message : String(error),
        );
      const controlled = context.signal?.aborted
        ? new ApiError("CANCELLED", "已停止执行。")
        : error instanceof ApiError && error.code in ERROR_STATUS
          ? error
          : new ApiError("UPSTREAM_ERROR", "工具执行失败，请重试。", true);
      return {
        ok: false,
        error: {
          code: controlled.code,
          message: controlled.message,
          retryable: controlled.retryable,
        },
      };
    }
  }
}
