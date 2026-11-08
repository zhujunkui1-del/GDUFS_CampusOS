import type { PlannedRead } from "../agent/orchestrator";
import { entityQueryVariants, type ContentTool } from "./content-intent";
import type { ExternalPolicy } from "../external-search/policy";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";
import { stripSearchControls } from "@/lib/retrieval/query-controls";
import {
  queryFocus,
  sportsQueryTerms,
  participationQuery,
  activityNounQuery,
} from "@/lib/retrieval/query-focus";
/** Forward a bounded public topic, never identifiers or private application material. */
export function publicQuery(query: string) {
  if (
    /\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:学号|身份证|密码|密钥|token)\s*[:：是为]?\s*[\w-]{6,}/i.test(
      query,
    )
  )
    return null;
  query = stripSearchControls(query);
  if (queryFocus(query) === "sports") {
    const specifics = sportsQueryTerms(query);
    const subject = specifics.includes("体育")
      ? "体育比赛"
      : specifics.join(" ");
    const campus = /大学城|南校/.test(query)
      ? " 大学城校区"
      : /白云山|北校/.test(query)
        ? " 白云山校区"
        : "";
    const year =
      query.match(/20\d{2}年?/)?.[0] ||
      (participationQuery(query)
        ? String(new Date(Date.now() + 8 * 3600000).getUTCFullYear())
        : "");
    return `${/广外|广东外语外贸大学|学校|校内|校园/.test(query) ? "广外" : ""}${campus} ${subject} ${year} ${buildQueryPlan(
      query,
    )
      .qualifiers.filter((t) => !/^20\d{2}$/.test(t))
      .join(
        " ",
      )} ${/截止|截至/.test(query) ? "报名截止" : participationQuery(query) ? "报名 通知" : ""} ${query.match(/(?:\d{1,2}月\d{1,2}日|本周|这周|下周|下个月)/)?.[0] || ""}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }
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
    const specifics = query
      .replace(
        /广东外语外贸大学|广外|大学城(?:校区)?|白云山(?:校区)?|南校(?:区)?|北校(?:区)?|第一(?:食堂|饭堂)|第二(?:食堂|饭堂)|第三(?:食堂|饭堂)|一饭|二饭|三饭|文采园|博雅园|风采园/g,
        " ",
      )
      .replace(
        /(?:有几个|有什么|有没有|有啥|什么|多少|推荐一下|推荐|请问|帮我|查一下|搜索|食堂|饭堂|好吃|美食|周边|附近|校外|我对|本人|的|吗|呢|呀)/g,
        " ",
      )
      .replace(/[，,；;。？！?\s]+/g, " ")
      .trim();
    return `广外 ${campus} ${venue === "食堂" && specifics ? "美食" : venue}${specifics ? " " + specifics : ""}`.slice(
      0,
      120,
    );
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
  retrievalQuery = query,
  hasUsableEvidence: () => boolean = () => false,
  radarCategory?: string,
  recentDiscovery = false,
  discoveryFollowup = false,
  recentBefore?: string,
  articleTitle?: string,
  articleKeywords?: string,
  publishedCursor?: { at: string; id: string },
): PlannedRead[] {
  void discoveryFollowup;
  const external = publicQuery(query);
  // A bare activity noun ("院运会") asks what exists across the campus, not for
  // one article: read a wider page so a single college's notice cannot hide
  // the others. The answer still cites at most five cards.
  const activity = activityNounQuery(retrievalQuery);
  // Each tool schema caps its own page: knowledge is a passage lookup at 4,
  // events is a list at 6. Asking for more fails the whole call before any
  // retrieval runs, so the ceiling is enforced here rather than at the caller.
  const PAGE_SIZE: Record<ContentTool, number> = {
    search_campus_knowledge: 4,
    search_campus_events: 6,
  };
  const inputFor = (name: ContentTool, text: string, exactTitle = true) => ({
    query: text,
    ...(/官网|官方网页|官方网站/.test(query)
      ? { sourceTypes: ["official_web"] }
      : {}),
    ...(exactTitle && articleTitle ? { title: articleTitle } : {}),
    limit:
      exactTitle && articleTitle
        ? 3
        : recentDiscovery || activity
          ? Math.min(5, PAGE_SIZE[name])
          : // Three was too few once the corpus grew: the rule that answers a
            // question often sits just outside the top three, and the write-up
            // then claims the corpus says nothing.
            Math.min(5, PAGE_SIZE[name]),
    ...(recentDiscovery ? { sort: "published_desc" as const } : {}),
    ...(recentDiscovery && publishedCursor ? { publishedCursor } : {}),
    ...(recentDiscovery && recentBefore
      ? { publishedBefore: recentBefore }
      : {}),
    ...(name === "search_campus_events" &&
    radarCategory &&
    radarCategory !== "culture_sports"
      ? { category: radarCategory }
      : {}),
  });
  const primary: PlannedRead[] = tools.map((name) => ({
    name,
    input: inputFor(name, retrievalQuery),
  }));
  // Same entity, different wording: read the official alias before concluding
  // that no body exists. Each variant is skipped once a usable body is found.
  const retries: PlannedRead[] = entityQueryVariants(retrievalQuery).flatMap(
    (variant) =>
      tools.map((name) => ({
        name,
        input: inputFor(name, variant),
        when: () => !hasUsableEvidence(),
      })),
  );
  // Exact-title misses and long statements fall back to their content words.
  // This is a second read plan, not a second answer template: evidence still
  // comes from the same tools and the same D1 rows.
  const keywordRetries: PlannedRead[] =
    articleKeywords && articleKeywords !== retrievalQuery
      ? tools.map((name) => ({
          name,
          input: {
            ...inputFor(name, articleKeywords, false),
            // A short literal prefix is an exact title lookup, not a semantic
            // paraphrase; instr() finds it even when the stored title wraps a
            // fragment in typographic quotes.
            ...(articleTitle ? { title: articleKeywords } : {}),
          },
          // A full-title FTS read can return unrelated rows with bodies and
          // make hasUsableEvidence true; the title-keyword read must still run.
          when: () => !hasUsableEvidence(),
        }))
      : [];
  return [
    ...primary,
    ...retries,
    ...keywordRetries,
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
