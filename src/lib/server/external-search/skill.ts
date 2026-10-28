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
import { isOfficialCampusUrl } from "./policy";
import { ApiError } from "../errors";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { withinWindow, type TimeWindow } from "../assistant/time-window";
import { isDiscoveryIndex } from "@/lib/retrieval/temporal-claims";
/** Another region's same-named entity (e.g. a Beijing “广外医院”) is not campus evidence. */
const OTHER_REGION =
  /北京|上海|天津|重庆|南京|武汉|西安|成都|杭州|苏州|哈尔滨|沈阳|大连|青岛|济南|郑州|长沙|合肥|福州|厦门|南昌|昆明|贵阳|南宁|兰州|太原|石家庄|长春|内蒙古|新疆|西藏|宁夏|青海|香港|澳门|台湾/;
function outsideCampusScope(
  item: { title: string; snippet?: string; originalUrl: string },
  policy: ExternalPolicy,
) {
  // A campus assistant treats non-experience questions as GDUFS-scoped even when
  // the user did not repeat the school name in a follow-up.
  if (policy.intent === "experience" && !policy.campus) return false;
  if (isOfficialCampusUrl(item.originalUrl)) return false;
  const text = item.title + " " + (item.snippet || "");
  if (/广东外语外贸大学/.test(text)) return false;
  return (
    !/广外|南校|北校|大学城|白云山校区/.test(text) ||
    OTHER_REGION.test(item.title)
  );
}
export function registerExternalSearch(
  registry: SkillRegistry,
  policy: ExternalPolicy,
  config: ExternalConfig,
  hasInternalAttempt: () => boolean,
  timeWindow?: TimeWindow,
) {
  let attempted = false;
  return registry.register("knowledge-domain", {
    name: "search_external_campus_info",
    version: "1.0.0",
    auth: "public",
    sideEffect: "none",
    requiresConfirmation: false,
    timeoutMs: 30000,
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
        AbortSignal.timeout(28500),
      ]);
      const query =
        (policy.campus || policy.intent !== "experience") &&
        !/广外|广东外语外贸大学/.test(input.query)
          ? "广东外语外贸大学 " + input.query
          : input.query;
      const web = (p: ExternalPolicy, limit: number, onlyXhs = false) =>
        config.relay && !config.exaApiKey
          ? config.relay(
              {
                kind: "web",
                query: query.slice(0, 300),
                limit,
                policy: {
                  intent: p.intent,
                  officialOnly: p.officialOnly,
                  campus: p.campus,
                },
                onlyXhs,
              },
              signal,
            )
          : searchWeb(
              query,
              p,
              limit,
              signal,
              fetch,
              onlyXhs,
              config.exaApiKey,
            );
      if (policy.useXiaohongshu) {
        results = await Promise.all([
          searchXiaohongshu(
            query,
            input.limit,
            config,
            signal,
            fetch,
            !!timeWindow,
          ),
          ...(config.webEnabled !== false && !policy.onlyXhs
            ? [web({ ...policy, officialOnly: policy.intent === "mixed" }, 2)]
            : []),
        ]);
        if (
          !results[0].items.length &&
          config.webEnabled !== false &&
          !policy.onlyXhs &&
          !signal.aborted
        )
          results.push(await web(policy, input.limit, true));
      } else if (config.webEnabled !== false) {
        results = [await web(policy, input.limit)];
      }
      const items = [
        ...new Map(
          results.flatMap((r) => r.items).map((i) => [i.originalUrl, i]),
        ).values(),
      ]
        .filter(
          (item) =>
            !outsideCampusScope(item, policy) &&
            (!(policy.needsParticipation || policy.intent === "events") ||
              !isDiscoveryIndex(item.originalUrl, item.title)) &&
            queryRelevance(buildQueryPlan(policy.relevanceQuery || query), item)
              .relevant &&
            (!timeWindow ||
              timeWindow.role !== "publication" ||
              withinWindow(item.publishedAt, timeWindow)),
        )
        .slice(0, 6);
      const warnings: string[] = [];
      if (timeWindow?.role === "publication")
        warnings.push(
          `仅返回发布日期在${timeWindow.after}至${timeWindow.before}的资料；发布日期不证明活动在此期间发生，日期未知结果不作为该时间段证据。`,
        );
      else if (timeWindow)
        warnings.push(
          `所问${timeWindow.role === "event" ? "活动" : "报名"}日期范围为${timeWindow.after}至${timeWindow.before}；不按文章发布日期排除，须以原文对应时间证据核对，未知不可当作符合范围。`,
        );
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
          ...(r.cacheHit !== undefined ? { cacheHit: r.cacheHit } : {}),
          ...(r.failureCode ? { failureCode: r.failureCode } : {}),
          ...(r.httpStatus ? { httpStatus: r.httpStatus } : {}),
          ...(r.edgeCode ? { edgeCode: r.edgeCode } : {}),
          ...(r.relayUsage ? { relayUsage: r.relayUsage } : {}),
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
