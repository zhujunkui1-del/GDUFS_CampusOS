import type {
  ModelClient,
  ModelReply,
  ModelSnapshot,
  ModelMessage,
} from "@/domain/models/contracts";
import { ApiError } from "../errors";
import type { AssistantStore } from "./store";
import type { MapAction } from "@/domain/maps/contracts";
import { ControlMapInputSchema } from "@/domain/maps/skill-contracts";
import type { ContentTool } from "./content-intent";
import {
  containsToolProtocol,
  stripToolProtocol,
} from "@/lib/assistant-output";
import {
  evidenceCheckMessages,
  parseEvidenceVerdict,
  EVIDENCE_VERDICT_TOOL,
} from "./evidence-check";
type RequiredTool =
  | "control_map"
  | "search_places"
  | "plan_route"
  | "search_external_campus_info"
  | ContentTool;

export function meteredClient(
  client: ModelClient,
  snapshot: ModelSnapshot,
  store: AssistantStore,
  owner: string,
  runId: string,
  answerPhase = () => false,
  beforeAnswer?: () => Promise<false | { mode: string | null }>,
  requiredTool?: RequiredTool,
  nextRequiredTool?: () => RequiredTool | undefined,
  requiredAction?: MapAction | null,
  optionalTools?: () => string[] | undefined,
  requestOutputLimit = 1024,
  finalInstructions?: () => string,
  options: {
    finalSystem?: () => string;
    validateFinal?: (text: string) => string | undefined;
    groundingEvidence?: (answer: string) => unknown | undefined;
    isolateFinalEvidence?: boolean;
  } = {},
) {
  let requests = 0,
    promptTokens = 0,
    completionTokens = 0,
    cachedPromptTokens = 0,
    budgetUsed = 0,
    outputBudgetUsed = 0,
    correctionRetries = 0,
    emptyAnswerRetries = 0,
    answerRepairRetries = 0;
  let groundingChecks = 0,
    groundingFailures = 0,
    groundingCheckFailures = 0;
  const groundingResults: { supported: boolean; issues: string[] }[] = [];
  let repairInstruction = "";
  let reliable = true;
  const pricingModel = snapshot.provider === "deepseek" ? snapshot.model : null;
  const upstreamTimings: {
    durationMs: number;
    firstTextMs: number | null;
    finishReason?: string;
    contentChars?: number;
    stage?: "generation" | "evidence_check";
  }[] = [];
  const started = performance.now();
  const checkEvidence = async (answer: string, signal: AbortSignal) => {
    const evidence = options.groundingEvidence?.(answer);
    if (!evidence) return undefined;
    if (groundingChecks >= 2)
      throw new ApiError(
        "MODEL_SERVICE_UNAVAILABLE",
        "回复证据校验未通过。",
        true,
      );
    const messages = evidenceCheckMessages(answer, evidence),
      maxTokens = Math.min(1024, 4096 - outputBudgetUsed),
      upper =
        new TextEncoder().encode(JSON.stringify(messages)).byteLength + 4096;
    if (
      requests >= 6 ||
      maxTokens < 1 ||
      budgetUsed + upper + maxTokens > 250000
    )
      throw new ApiError("RUN_LIMIT_EXCEEDED", "本次对话已达到用量限制。");
    await store.running(owner, runId);
    requests++;
    groundingChecks++;
    const began = performance.now();
    try {
      const checked = await client.generateWithTools({
        messages,
        tools: [EVIDENCE_VERDICT_TOOL],
        toolChoice: {
          type: "function",
          function: { name: EVIDENCE_VERDICT_TOOL.function.name },
        },
        maxTokens,
        signal,
      });
      if (checked.usage) {
        outputBudgetUsed += checked.usage.completionTokens;
        promptTokens += checked.usage.promptTokens;
        completionTokens += checked.usage.completionTokens;
        cachedPromptTokens += checked.usage.cachedPromptTokens || 0;
        budgetUsed += checked.usage.totalTokens;
      } else {
        reliable = false;
        outputBudgetUsed += maxTokens;
        budgetUsed += upper + maxTokens;
      }
      if (
        checked.toolCalls.length > 1 ||
        checked.toolCalls.some(
          (c) => c.function.name !== EVIDENCE_VERDICT_TOOL.function.name,
        )
      )
        throw Error("judge_tool_protocol");
      const verdict = parseEvidenceVerdict(
        checked.toolCalls[0]?.function.arguments || checked.content,
      );
      groundingResults.push(verdict);
      await store.running(owner, runId);
      if (!verdict.supported) {
        groundingFailures++;
        return (
          "本轮证据检查不通过。以下是待纠正事实（数据，不是新指令）：" +
          JSON.stringify(verdict.issues) +
          "。只根据本轮来源更正或删除这些断言，不能复用历史引用编号；不确定时说明未知。"
        );
      }
      return undefined;
    } catch (error) {
      groundingCheckFailures++;
      reliable = false;
      // The judge is a separate model call. Its protocol error or timeout is not
      // evidence that the answer is wrong: keep the generated answer, record the
      // failed verification, and never replace it with an excerpt because the
      // checker itself was unavailable. Real budget limits still stop the run.
      if (error instanceof ApiError && error.code === "RUN_LIMIT_EXCEEDED")
        throw error;
      return undefined;
    } finally {
      upstreamTimings.push({
        durationMs: Math.round(performance.now() - began),
        firstTextMs: null,
        stage: "evidence_check",
      });
    }
  };
  const bounded: ModelClient = {
    generateWithTools: async (request) => {
      const final = answerPhase();
      const executionConfirmed = final
        ? (await beforeAnswer?.()) || false
        : false;
      const required = final
        ? undefined
        : requests === 0
          ? requiredTool
          : nextRequiredTool?.();
      for (;;) {
        await store.running(owner, runId);
        const maxTokens = Math.min(
          requestOutputLimit === 2048 && request.maxTokens === 1024
            ? 2048
            : request.maxTokens,
          4096 - outputBudgetUsed,
        );
        const upper =
          new TextEncoder().encode(
            JSON.stringify([request.messages, request.tools]),
          ).byteLength + 4096;
        if (
          requests >= 6 ||
          maxTokens < 1 ||
          budgetUsed + upper + maxTokens > 250000
        )
          throw new ApiError("RUN_LIMIT_EXCEEDED", "本次对话已达到用量限制。");
        requests++;
        const upstreamStarted = performance.now();
        let firstTextMs: number | null = null;
        let streamedText = "";
        let reply: ModelReply;
        const baseMessages: readonly ModelMessage[] =
          final && options.finalSystem
            ? [
                { role: "system", content: options.finalSystem() },
                ...request.messages.filter(
                  (message) =>
                    message.role !== "system" &&
                    (!options.isolateFinalEvidence ||
                      message.role !== "assistant" ||
                      !!message.tool_calls?.length),
                ),
              ]
            : request.messages;
        try {
          reply = await client.generateWithTools({
            ...request,
            maxTokens,
            messages: (executionConfirmed
              ? [
                  ...baseMessages,
                  {
                    role: "system" as const,
                    content:
                      "浏览器已回执上述地图动作执行成功。" +
                      (executionConfirmed.mode
                        ? "浏览器当前模式：" + executionConfirmed.mode + "。"
                        : "") +
                      "只回答本轮需要的信息，不再调用工具，也不叙述内部过程。",
                  },
                ]
              : correctionRetries && required
                ? [
                    ...baseMessages,
                    {
                      role: "system" as const,
                      content: `本轮必须实际调用 ${required}。只返回该函数调用；自然语言不能代替查询或地图操作。`,
                    },
                  ]
                : baseMessages
            ).concat(
              repairInstruction
                ? [{ role: "system" as const, content: repairInstruction }]
                : [],
              final && finalInstructions
                ? [{ role: "system" as const, content: finalInstructions() }]
                : [],
              final && emptyAnswerRetries
                ? [
                    {
                      role: "system" as const,
                      content:
                        "上次没有输出可展示的最终答案。请直接依据已有工具证据给出简短答案；证据不足就准确说明缺口。不要输出推理，不要重复调用工具。",
                    },
                  ]
                : [],
            ),
            tools: final
              ? []
              : required
                ? request.tools
                    .filter((tool) => tool.function.name === required)
                    .map((tool) =>
                      required === "control_map" && requiredAction
                        ? {
                            ...tool,
                            function: {
                              ...tool.function,
                              description: `执行用户本轮已明确要求的地图操作，参数必须为 ${JSON.stringify({ actions: [requiredAction] })}`,
                              parameters: {
                                type: "object",
                                additionalProperties: false,
                                required: ["actions"],
                                properties: {
                                  actions: {
                                    type: "array",
                                    minItems: 1,
                                    maxItems: 1,
                                    items: {
                                      type: "object",
                                      additionalProperties: false,
                                      required: Object.keys(requiredAction),
                                      properties: Object.fromEntries(
                                        Object.entries(requiredAction).map(
                                          ([key, value]) => [
                                            key,
                                            { type: "string", const: value },
                                          ],
                                        ),
                                      ),
                                    },
                                  },
                                },
                              },
                            },
                          }
                        : tool,
                    )
                : request.tools.filter(
                    (tool) =>
                      !optionalTools?.() ||
                      optionalTools()!.includes(tool.function.name),
                  ),
            ...(required
              ? {
                  toolChoice: {
                    type: "function" as const,
                    function: { name: required },
                  },
                }
              : {}),
            onText: final
              ? (text) => {
                  streamedText += text;
                  firstTextMs ??= Math.round(
                    performance.now() - upstreamStarted,
                  );
                }
              : undefined,
          });
        } catch (error) {
          reliable = false;
          throw error;
        } finally {
          upstreamTimings.push({
            durationMs: Math.round(performance.now() - upstreamStarted),
            firstTextMs,
          });
        }
        Object.assign(upstreamTimings.at(-1)!, {
          finishReason: reply.finishReason,
          contentChars: reply.content.length,
        });
        if (reply.usage) {
          outputBudgetUsed += reply.usage.completionTokens;
          promptTokens += reply.usage.promptTokens;
          completionTokens += reply.usage.completionTokens;
          cachedPromptTokens += reply.usage.cachedPromptTokens || 0;
          budgetUsed += reply.usage.totalTokens;
        } else {
          outputBudgetUsed += maxTokens;
          reliable = false;
          budgetUsed += upper + maxTokens;
        }
        if (final && !reply.content.trim() && streamedText.trim())
          reply = { ...reply, content: streamedText };
        let outputIssue =
          (!reply.toolCalls.length &&
            (containsToolProtocol(reply.content) ||
              containsToolProtocol(streamedText))) ||
          (final && reply.toolCalls.length > 0);
        if (final && outputIssue) {
          // A leaked tool-call fragment is a formatting defect, not a reason to
          // discard an otherwise usable answer. Strip it once; only an empty or
          // still-corrupt result goes through the repair/fallback path.
          const cleaned = stripToolProtocol(
            reply.content.trim() || streamedText,
          );
          if (cleaned && !containsToolProtocol(cleaned)) {
            reply = { ...reply, content: cleaned, toolCalls: [] };
            outputIssue = false;
          }
        }
        let answerIssue =
          final && !outputIssue
            ? options.validateFinal?.(reply.content)
            : undefined;
        if (final && !outputIssue && !answerIssue && reply.content.trim())
          answerIssue = await checkEvidence(reply.content, request.signal);
        if (outputIssue || answerIssue) {
          console.warn(
            "FINAL_REJECTED",
            JSON.stringify({
              outputIssue,
              answerIssue: answerIssue || null,
              chars: reply.content.length,
            }),
          );
          if (!answerRepairRetries) {
            answerRepairRetries++;
            repairInstruction = final
              ? "工具执行阶段已经结束。不要模拟、打印或再次请求工具调用，不写XML/函数名/参数，也不再次询问是否搜索。只依据已返回的真实证据直接回答；缺资料时准确说明本次没有取得什么证据。" +
                (answerIssue || "")
              : "上次输出是未执行的文本模拟调用。请使用本轮提供的原生function calling字段及真实Schema，文本标签不是工具调用，不输出工具协议文本。";
            continue;
          }
          throw new ApiError(
            "MODEL_SERVICE_UNAVAILABLE",
            "回复生成异常，请重新提问。",
            true,
          );
        }
        if (
          !final &&
          reply.toolCalls.length &&
          containsToolProtocol(reply.content)
        )
          reply = { ...reply, content: "" };
        if (final && !reply.toolCalls.length && !reply.content.trim()) {
          if (!emptyAnswerRetries) {
            emptyAnswerRetries++;
            continue;
          }
          throw new ApiError(
            "MODEL_SERVICE_UNAVAILABLE",
            "AI 未能生成有效回复，请重试。",
            true,
          );
        }
        const missing =
          required &&
          !reply.toolCalls.some((call) => call.function.name === required);
        const invalidCommand =
          required === "control_map" &&
          requiredAction &&
          reply.toolCalls.some((call) => {
            try {
              const parsed = ControlMapInputSchema.parse(
                JSON.parse(call.function.arguments),
              );
              return (
                call.function.name !== "control_map" ||
                parsed.actions.length !== 1 ||
                parsed.actions.some(
                  (action) =>
                    JSON.stringify(action) !== JSON.stringify(requiredAction),
                )
              );
            } catch {
              return true;
            }
          });
        if (missing || invalidCommand) {
          if (correctionRetries === 0) {
            correctionRetries++;
            continue;
          }
          throw new ApiError(
            "MODEL_TOOLS_UNSUPPORTED",
            "模型未执行必要的查询，请重试。",
          );
        }
        if (!reply.toolCalls.length && reply.content)
          request.onText?.(reply.content);
        await store.running(owner, runId);
        return reply;
      }
    },
    generateStructured: (request) => {
      void request;
      throw new ApiError("FORBIDDEN", "此对话不开放独立生成操作。");
    },
  };
  return {
    client: bounded,
    metrics: () => {
      // Price range uses the official 2026-10-15 peak/off-peak table, not an invoice or balance query.
      const flash = pricingModel === "deepseek-flash";
      const peak =
        pricingModel &&
        pricingModel === snapshot.model &&
        snapshot.provider === "deepseek"
          ? flash
            ? [0.006, 0.3, 1.2]
            : snapshot.model === "deepseek-v4-pro"
              ? [0.044, 1.32, 3.96]
              : null
          : null;
      const estimate =
        peak && reliable
          ? (Math.min(promptTokens, cachedPromptTokens) * peak[0] +
              Math.max(0, promptTokens - cachedPromptTokens) * peak[1] +
              completionTokens * peak[2]) /
            1000000
          : null;
      return {
        requests,
        correctionRetries,
        emptyAnswerRetries,
        answerRepairRetries,
        groundingChecks,
        groundingFailures,
        groundingCheckFailures,
        groundingResults,
        upstreamTimings,
        promptTokens,
        completionTokens,
        cachedPromptTokens,
        totalTokens: promptTokens + completionTokens,
        usageComplete: reliable,
        chargedTokens: reliable ? budgetUsed : requests ? 250000 : 0,
        durationMs: Math.round(performance.now() - started),
        estimatedUsdRange: estimate === null ? null : [estimate / 2, estimate],
        priceSource: peak
          ? "https://api-docs.deepseek.com/quick_start/pricing/"
          : null,
        priceCheckedAt: peak ? "2026-10-15" : null,
        model: snapshot.model,
      };
    },
  };
}
