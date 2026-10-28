import type { ContentSearchResult } from "@/domain/retrieval/skills";
import { buildQueryPlan, queryRelevance } from "./query-plan";

type Activity = ContentSearchResult["activities"][number];
export function activityAvailability(a: Activity, now = Date.now()) {
  const today = new Date(now + 28800000).toISOString().slice(0, 10);
  const before = (t: Activity["startsAt"]) =>
    !!t && (t.at ? Date.parse(t.at) < now : !!t.date && t.date < today);
  const after = (t: Activity["startsAt"]) =>
    !!t && (t.at ? Date.parse(t.at) > now : !!t.date && t.date > today);
  const eventState = ["cancelled", "postponed"].includes(a.eventStatus)
    ? a.eventStatus
    : a.eventStatus === "ended" ||
        before(a.endsAt) ||
        (!a.endsAt && before(a.startsAt))
      ? "ended"
      : after(a.startsAt)
        ? "upcoming"
        : a.startsAt && a.endsAt && !after(a.startsAt) && !before(a.endsAt)
          ? "ongoing"
          : "unknown";
  const participation =
    eventState === "ended" || eventState === "cancelled"
      ? "closed"
      : a.registrationState === "open"
        ? "registration_open_eligibility_unknown"
        : a.registrationState === "not_required" &&
            ["upcoming", "ongoing"].includes(eventState)
          ? "no_registration_eligibility_unknown"
          : "unknown";
  return {
    existence: "documented" as const,
    eventState,
    registrationState: a.registrationState,
    participation,
  };
}
export type EvidenceInput = {
  hits: (Pick<
    ContentSearchResult["hits"][number],
    "bodyAvailable" | "contentSnippet"
  > &
    Partial<ContentSearchResult["hits"][number]>)[];
  activities: Activity[];
};
export function assessEvidence(
  query: string,
  results: EvidenceInput[],
  options: { officialOnly?: boolean; failed?: boolean; now?: number } = {},
) {
  const plan = buildQueryPlan(query),
    hits = results.flatMap((r) => r.hits),
    related = hits.filter((h) => queryRelevance(plan, h).relevant),
    bodies = related.filter(
      (h) => h.bodyAvailable && (!options.officialOnly || h.official),
    ),
    ids = new Set(bodies.map((h) => h.documentId));
  const activities = results
    .flatMap((r) => r.activities)
    .filter((a) => ids.has(a.documentId))
    .map((a) => ({
      documentId: a.documentId,
      ...activityAvailability(a, options.now),
    }));
  const missing: string[] = [];
  if (!bodies.length) missing.push("relevant_readable_evidence");
  const text = bodies.map((h) => h.contentSnippet).join("\n");
  if (
    plan.goal === "procedure" &&
    !/流程|办理|步骤|指南|手续|登录|点击|凭.{0,12}(?:卡|证)|依次|提交/.test(
      text,
    )
  )
    missing.push("procedure_evidence");
  if (
    plan.goal === "requirements" &&
    !/条件|资格|材料|要求|须|需提供|需满足|面向|适用/.test(text)
  )
    missing.push("requirement_evidence");
  if (
    plan.goal === "policy" &&
    !/办法|规定|规则|制度|政策|第[一二三四五六七八九十]+条/.test(text)
  )
    missing.push("policy_evidence");
  if (
    plan.goal === "experience" &&
    !/推荐|体验|好吃|不好吃|味道|口味|入住|居住|隔音|亲测/.test(text)
  )
    missing.push("experience_evidence");
  const current =
    plan.goal === "participation" ||
    plan.goal === "registration" ||
    /近期|最近|今天|本周|这周|下周|下个月/.test(plan.temporalExpression || "");
  if (
    current &&
    !activities.some(
      (a) =>
        ["upcoming", "ongoing"].includes(a.eventState) ||
        a.registrationState === "open",
    )
  )
    missing.push("current_event_evidence");
  if (
    (plan.goal === "participation" || plan.goal === "registration") &&
    !activities.some((a) =>
      [
        "registration_open_eligibility_unknown",
        "no_registration_eligibility_unknown",
      ].includes(a.participation),
    )
  )
    missing.push("participation_or_registration_evidence");
  const state =
    options.failed && !hits.length
      ? "search_failed"
      : !hits.length
        ? "no_candidates"
        : !related.length
          ? "off_topic"
          : !bodies.length
            ? "metadata_or_authority_insufficient"
            : missing.length
              ? "related_but_incomplete"
              : "supported";
  return {
    state,
    relatedDocuments: [
      ...new Set(related.map((h) => h.documentId).filter(Boolean)),
    ],
    missing,
    activities,
    needsSupplement: state !== "supported",
    negativeExistenceProven: false as const,
  };
}
export function falseNegativeAnswer(
  answer: string,
  query: string,
  results: EvidenceInput[],
) {
  const assessment = assessEvidence(query, results);
  if (!assessment.relatedDocuments.length) return false;
  if (
    !/[\[【]来源\s*\d+/.test(answer) &&
    /(?:没有|未(?:能)?(?:找到|查到|检索到)|没(?:找到|查到))/.test(answer)
  )
    return true;
  // Missing a verified current window is a valid limit, not a claim that no
  // related articles exist. Do not reject honest uncertainty about eligibility.
  if (
    /没有|未(?:能)?(?:找到|查到|检索到)|没(?:找到|查到)/.test(answer) &&
    /截止|仍可|还能|当前可|确认|报名状态|报名时间|开放/.test(answer) &&
    !/均为学科/.test(answer)
  )
    return false;
  return /(?:没有|未(?:能)?(?:找到|查到|检索到)|没(?:找到|查到))[^。\n]{0,30}(?:相关(?:信息|资料|文章)|体育(?:比赛|赛事)|赛事(?:信息|通知)|讲座(?:信息|通知)|借阅(?:规则|指南))|均为学科类竞赛/.test(
    answer,
  );
}
