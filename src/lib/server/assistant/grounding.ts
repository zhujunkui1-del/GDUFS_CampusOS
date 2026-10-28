import type { ContentSearchResult } from "@/domain/retrieval/skills";
import type { ExternalSearchResult } from "@/domain/retrieval/external";
import type { ExternalPolicy } from "../external-search/policy";
import { chinaDay } from "./time-window";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
/** Do not let a model turn a known publication day into an unverified event day. */
export function publicationDateFallback(
  answer: string,
  sources: { title: string; publishedAt: string | null; citation: number }[],
  knownEventDates: string[],
  playful: boolean,
) {
  const published = new Set(
    sources.flatMap((s) => {
      const day = s.publishedAt && chinaDay(s.publishedAt);
      return day ? [day] : [];
    }),
  );
  const events = new Set(knownEventDates);
  const claims = [
    ...answer.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日([^。\n]{0,80})/g),
  ];
  const conflated = claims.some((m) => {
    const days = [...published].filter(
      (day) =>
        (!m[1] || day.slice(0, 4) === m[1]) &&
        Number(day.slice(5, 7)) === Number(m[2]) &&
        Number(day.slice(8, 10)) === Number(m[3]),
    );
    return (
      days.some((day) => !events.has(day)) &&
      /举办|举行|召开|开展|受邀|担任|随团|赴|开始|截止|报名/.test(m[4])
    );
  });
  if (!conflated) return undefined;
  return (
    (playful
      ? "本鱼按发布日期捞到这些文章，事情实际发生时间还不能仅凭发文日期确认：\n"
      : "检索到以下期间发布的文章；发布日期不能证明事情当天发生：\n") +
    sources
      .slice(0, 3)
      .map(
        (s) =>
          `- 发布于${s.publishedAt ? chinaDay(s.publishedAt) || "日期待确认" : "日期待确认"}：${s.title}[来源${s.citation}]`,
      )
      .join("\n")
  );
}
/** Affiliated-school posts are not automatically university-campus facts. */
export function universityScope(hit: {
  sourceName: string;
  title: string;
  contentSnippet: string;
}) {
  if (!/外校|附属|中学|小学|幼儿园/.test(hit.sourceName)) return true;
  return /广东外语外贸大学(?!附属|实验中学|外校)/.test(
    hit.title + " " + hit.contentSnippet,
  );
}
/** Evidence readiness precedes prose style. A missing body cannot be rescued by a cute guess. */
export function evidenceFallback(
  internal: ContentSearchResult[],
  external: ExternalSearchResult | undefined,
  policy: ExternalPolicy,
  playful = false,
) {
  const plan = buildQueryPlan(policy.relevanceQuery || "");
  const usable = internal
    .flatMap((r) => r.hits)
    .filter((h) => h.bodyAvailable && queryRelevance(plan, h).relevant);
  const outside = (external?.items || []).filter(
    (i) =>
      i.evidenceKind !== "title_only" &&
      queryRelevance(plan, i).relevant &&
      (!policy.officialOnly ||
        (i.authority === "official" && i.canConfirmAdministrativeFacts)),
  );
  const bodies = [
    ...usable.map((h) => h.title + " " + h.contentSnippet),
    ...outside.map((i) => i.title + " " + i.snippet),
  ];
  if (
    (policy.intent === "experience" || policy.intent === "mixed") &&
    !bodies.length
  )
    return external?.providers.some((p) => p.status === "login_required")
      ? playful
        ? "本鱼去小红书翻了翻，这次得重新登录才看得到，先不瞎推荐啦。"
        : "本次小红书搜索需要重新登录，没有取得可用的学生体验资料，暂时不能据此推荐或猜测。"
      : playful
        ? "本鱼把能翻的都翻了，这次真没找到撑得住的学生体验，先不瞎推荐，免得坑你。🐟"
        : "本次没有取得能回答这个问题的学生体验资料，暂不能据此推荐或猜测。";
  if (!bodies.length) {
    const unavailable = external?.providers.some(
      (p) => !["ok", "empty"].includes(p.status),
    );
    if (unavailable)
      return playful
        ? "本鱼这轮联网没翻到可用资料，校园文章里也没有能确认的正文，先不瞎说；查询失败不代表没有，换个问法我再去翻。"
        : "本次外部查询未取得可用资料，现有校园文章也不足以确认答案。查询失败不代表所问信息不存在。";
    return playful
      ? "本鱼翻了一圈，没找到能撑住这个说法的原文，这次先不乱讲，免得骗到你。🐟 换个更具体的问法，本鱼再帮你翻。"
      : "这次没有取得能回答该问题的正文证据，暂无法确认；可以换个更具体的问法再查。";
  }
}
/** Detect expression conflicts without altering URLs, citations, dates or structured tool data. */
export function expressionConflicts(
  text: string,
  tone: string,
  citationCount: number,
  options: { trustedQuotedExcerpts?: boolean } = {},
) {
  const issues: string[] = [];
  const narrative = options.trustedQuotedExcerpts
    ? text.replace(/“[^”]*”/g, "")
    : text;
  if (
    [...text.matchAll(/[\[【]来源\s*(\d+)[\]】]/g)].some(
      (m) => Number(m[1]) < 1 || Number(m[1]) > citationCount,
    )
  )
    issues.push("unsupported_citation");
  if (
    (tone === "off" || tone === "serious") &&
    /本鱼|小鱼干|[🐋🐟🫧]|[（(][^）)]*(?:心声|OS)[^）)]*[）)]/u.test(narrative)
  )
    issues.push("persona_not_converged");
  if (
    [
      ...narrative.matchAll(
        /(?:本鱼|我)[^，。！？\n]{0,12}?(?:逛遍|逛过|吃过|住过|去过|尝过|打卡过|亲测|实测)/g,
      ),
    ].some(
      (m) =>
        !/不|没|未|无法|别人|作者|帖子|分享|整理|检索|搜|查|收集|引用/.test(
          m[0],
        ),
    )
  )
    issues.push("fabricated_personal_experience");
  return issues;
}
