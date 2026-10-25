import {
  ExternalSearchInputSchema,
  ExternalSearchResultSchema,
  type ExternalSearchResult,
} from "@/domain/retrieval/external";
import type { SkillRegistry } from "../agent/skill-registry";
import {
  searchWeb,
  searchXiaohongshu,
  type ExternalConfig,
  type ProviderResult,
} from "./providers";
import type { ExternalPolicy } from "./policy";
import { ApiError } from "../errors";
export function registerExternalSearch(
  registry: SkillRegistry,
  policy: ExternalPolicy,
  config: ExternalConfig,
  hasInternalAttempt: () => boolean,
) {
  let attempted = false;
  return registry.register("knowledge-domain", {
    name: "search_external_campus_info",
    version: "1.0.0",
    auth: "public",
    sideEffect: "none",
    requiresConfirmation: false,
    timeoutMs: 15000,
    description:
      "在已查询CampusOS内部文章后，按问题性质补充真实互联网或小红书搜索。规则、奖学金条件和截止日期只查广外官方网页；口味/居住感受可查学生经验。内部缺失不等于必须查小红书。传入尚缺的具体信息gap；结果含来源等级和片段，title_only不能冒充正文，unavailable不是无结果。",
    inputSchema: ExternalSearchInputSchema,
    outputSchema: ExternalSearchResultSchema,
    execute: async (input, context) => {
      if (!policy.active || !hasInternalAttempt())
        throw new ApiError(
          "FORBIDDEN",
          "请先查询校园文章，再按问题性质补充外部资料。",
        );
      if (attempted)
        throw new ApiError(
          "RUN_LIMIT_EXCEEDED",
          "本轮外部搜索已完成，请依据现有来源回答。",
        );
      attempted = true;
      if (input.gap === "student_experience" && !policy.useXiaohongshu)
        throw new ApiError(
          "INVALID_ARGUMENT",
          "这类规则或时限问题需要官方来源。",
        );
      const started = performance.now();
      let results: ProviderResult[] = [];
      const signal = AbortSignal.any([
        ...(context.signal ? [context.signal] : []),
        AbortSignal.timeout(13500),
      ]);
      const query =
        policy.campus && !/广外|广东外语外贸大学/.test(input.query)
          ? "广东外语外贸大学 " + input.query
          : input.query;
      if (policy.useXiaohongshu && policy.intent !== "events") {
        results = await Promise.all([
          searchXiaohongshu(query, input.limit, config, signal),
          ...(config.webEnabled !== false
            ? [
                searchWeb(
                  query,
                  { ...policy, officialOnly: policy.intent === "mixed" },
                  2,
                  signal,
                  fetch,
                  false,
                  config.exaApiKey,
                ),
              ]
            : []),
        ]);
        if (!results[0].items.length && config.webEnabled !== false)
          results.push(
            await searchWeb(
              query,
              policy,
              input.limit,
              signal,
              fetch,
              true,
              config.exaApiKey,
            ),
          );
      } else if (config.webEnabled !== false) {
        results = [
          await searchWeb(
            query,
            policy,
            input.limit,
            signal,
            fetch,
            false,
            config.exaApiKey,
          ),
        ];
      }
      const items = [
        ...new Map(
          results.flatMap((r) => r.items).map((i) => [i.originalUrl, i]),
        ).values(),
      ].slice(0, 6);
      const warnings: string[] = [];
      if (items.some((i) => i.authority === "student_experience"))
        warnings.push(
          "学生经验仅供参考，不能确认学校政策、正式活动或截止日期。",
        );
      if (results.some((r) => r.status === "login_required"))
        warnings.push(
          "小红书站内搜索尚未登录；公开网页结果会单独标明，不冒充站内结果。",
        );
      if (
        results.some(
          (r) =>
            r.status === "not_configured" ||
            r.status === "unavailable" ||
            r.status === "busy",
        )
      )
        warnings.push("部分外部搜索暂不可用，仅依据实际返回的资料回答。");
      if (items.some((i) => i.evidenceKind === "title_only"))
        warnings.push("仅标题的结果不能作为正文事实证据。");
      if (!items.length)
        warnings.push("外部搜索未取得可用证据，不能据此补编答案。");
      const data: ExternalSearchResult = {
        status: items.length
          ? results.some((r) => !["ok", "empty"].includes(r.status))
            ? "partial"
            : "ok"
          : "unavailable",
        intent: policy.intent,
        query: input.query,
        items,
        providers: results.map((r) => ({
          provider: r.provider,
          status: r.status,
          count: r.items.length,
          ...(r.failureCode ? { failureCode: r.failureCode } : {}),
          ...(r.httpStatus ? { httpStatus: r.httpStatus } : {}),
          ...(r.edgeCode ? { edgeCode: r.edgeCode } : {}),
          durationMs: r.durationMs,
        })),
        warnings,
        durationMs: Math.round(performance.now() - started),
      };
      return {
        ok: true,
        data,
        sources: items.map((i) => ({
          title: i.title.slice(0, 200),
          url: i.originalUrl,
          ...(i.publishedAt ? { publishedAt: i.publishedAt } : {}),
        })),
        warnings,
      };
    },
  });
}
