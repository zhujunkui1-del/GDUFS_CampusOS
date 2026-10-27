import type { PlannedRead } from "../agent/orchestrator";
import type { ContentTool } from "./content-intent";
import type { ExternalPolicy } from "../external-search/policy";
/** Forward a bounded public topic, never identifiers or private application material. */
export function publicQuery(query: string) {
  if (
    /\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:学号|身份证|密码|密钥|token)\s*[:：是为]?\s*[\w-]{6,}/i.test(
      query,
    )
  )
    return null;
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
