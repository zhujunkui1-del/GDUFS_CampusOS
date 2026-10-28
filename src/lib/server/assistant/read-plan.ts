import type { PlannedRead } from "../agent/orchestrator";
import type { ContentTool } from "./content-intent";
import type { ExternalPolicy } from "../external-search/policy";
import { queryFocus } from "@/lib/retrieval/query-focus";
/** Forward a bounded public topic, never identifiers or private application material. */
export function publicQuery(query: string) {
  if (
    /\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:学号|身份证|密码|密钥|token)\s*[:：是为]?\s*[\w-]{6,}/i.test(
      query,
    )
  )
    return null;
  if (queryFocus(query) === "food" && /广外|广东外语外贸大学/.test(query)) {
    const campus = /北校|白云/.test(query)
      ? "北校"
      : /大学城|南校/.test(query)
        ? "南校"
        : "";
    const venue = /周边|校外|附近/.test(query)
      ? "周边 美食"
      : /第一(?:食堂|饭堂)|一饭|文采园/.test(query)
        ? "一饭"
        : /二饭|第二(?:食堂|饭堂)/.test(query)
          ? "二饭"
          : /三饭|第三(?:食堂|饭堂)/.test(query)
            ? "三饭"
            : "食堂";
    return `广外 ${campus} ${venue}`;
  }
  const normalized = query
    .replace(
      /(?:请|帮我|来点|告诉我|看看|查询|搜索|调用|通过|用小红书来查|用小红书查|小红书上查|只看小红书|不要联网)/g,
      " ",
    )
    .trim();
  if (/趣事|有趣的事情|校园新闻|校园分享/.test(normalized))
    return /广外|广东外语外贸大学/.test(normalized)
      ? "广外 校园"
      : normalized.slice(0, 120);
  return normalized.slice(0, 120);
}
export function contentReadPlan(
  tools: ContentTool[],
  query: string,
  policy: ExternalPolicy,
  needSupplement: () => boolean,
): PlannedRead[] {
  const external = publicQuery(query);
  return [
    ...tools.map((name) => ({ name, input: { query, limit: 3 } })),
    ...(external && policy.active
      ? [
          {
            name: "search_external_campus_info" as const,
            input: {
              query: external,
              limit: 3,
              gap:
                policy.intent === "experience" || policy.intent === "mixed"
                  ? "student_experience"
                  : "freshness_check",
            },
            when: needSupplement,
          },
        ]
      : []),
  ];
}
