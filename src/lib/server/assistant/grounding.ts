import type { ContentSearchResult } from "@/domain/retrieval/skills";
import type { ExternalSearchResult } from "@/domain/retrieval/external";
import type { ExternalPolicy } from "../external-search/policy";
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
) {
  const usable = internal
    .flatMap((r) => r.hits)
    .filter((h) => h.bodyAvailable && (!policy.officialOnly || h.official));
  const outside = (external?.items || []).filter(
    (i) =>
      i.evidenceKind !== "title_only" &&
      (!policy.officialOnly ||
        (i.authority === "official" && i.canConfirmAdministrativeFacts)),
  );
  const bodies = [
    ...usable.map((h) => h.title + " " + h.contentSnippet),
    ...outside.map((i) => i.title + " " + i.snippet),
  ];
  if (
    (policy.intent === "experience" || policy.intent === "mixed") &&
    !bodies.some((s) =>
      /食堂|饭堂|[一二三四]饭|餐饮|菜品|口味|住宿|宿舍|入住|居住|隔音/.test(s),
    )
  )
    return external?.providers.some((p) => p.status === "login_required")
      ? "本次小红书搜索需要重新登录，没有取得可用的学生体验资料，暂时不能据此推荐或猜测。"
      : "本次没有取得能回答这个问题的学生体验资料，暂时无法可靠推荐；不能用不相关文章或猜测代替。";
  if (!bodies.length) {
    const unavailable = external?.providers.some(
      (p) => !["ok", "empty"].includes(p.status),
    );
    return unavailable
      ? "本次外部查询未取得可用资料，现有校园文章也不足以确认答案。查询失败不代表所问信息不存在。"
      : "本次没有取得足以回答问题的正文证据，暂时无法确认。只有标题、链接或日期不能补出规则、菜品、身份或报名时间。";
  }
}
/** Detect expression conflicts without altering URLs, citations, dates or structured tool data. */
export function expressionConflicts(
  text: string,
  tone: string,
  citationCount: number,
) {
  const issues: string[] = [];
  if (
    [...text.matchAll(/[\[【]来源\s*(\d+)[\]】]/g)].some(
      (m) => Number(m[1]) < 1 || Number(m[1]) > citationCount,
    )
  )
    issues.push("unsupported_citation");
  if (
    (tone === "off" || tone === "serious") &&
    /本鱼|小鱼干|[🐋🐟🫧]|[（(][^）)]*(?:心声|OS)[^）)]*[）)]/u.test(text)
  )
    issues.push("persona_not_converged");
  if (/(?:本鱼|我)(?:亲自|亲身|亲测)(?:吃过|住过|去过|体验过)/.test(text))
    issues.push("fabricated_personal_experience");
  return issues;
}
