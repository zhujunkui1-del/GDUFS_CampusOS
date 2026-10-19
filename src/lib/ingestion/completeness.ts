import { extractEvents } from "./time";
import type { ContentDetail } from "@/domain/console/contracts";
export const completenessVersion = "console-completeness-v1";
export type Issue = {
  code: string;
  severity: "warning" | "error";
  message: string;
};
// This is a bounded, deterministic check; no model output grants verification.
export function contentCompleteness(
  d: ContentDetail,
  context: {
    rights: string;
    unknownDate: string;
    provenance: boolean;
    defaultCategory: string;
  },
) {
  const issues: Issue[] = [];
  const add = (code: string, message: string) =>
    issues.push({ code, severity: "error", message });
  if (!d.summary.trim()) add("summary", "简短说明缺失");
  if (!d.title.trim()) add("title", "标题缺失");
  if (!context.provenance)
    add("original_evidence", "需要核对原文身份、标题与发布时间");
  if (
    !d.publishedAt &&
    (context.unknownDate !== "metadata_unknown" ||
      d.rightsScope !== "metadata_only")
  )
    add("published_at", "原发布时间未知");
  if (d.contentType === "unknown") add("classification", "内容类型待确认");
  if (!!d.radarCategory === !!d.knowledgeCategory)
    add("category", "主分类待确认");
  if (
    context.rights !== "metadata_only" &&
    (d.bodyStatus === "unknown" || d.bodyStatus === "not_provided")
  )
    add("body", "当前发布政策要求正文");
  if (context.rights === "licensed_full_text" && d.bodyStatus !== "complete")
    add("body_incomplete", "全文不完整");
  const events = extractEvents(d.body);
  const activity =
    d.kind === "event" ||
    d.contentType === "event" ||
    /讲座|活动报名|比赛报名/.test(d.title);
  if (activity) {
    if (
      !events.length ||
      events.some(
        (e) => !e.timeEvidence?.some((t) => t.field === "startsAt" && t.date),
      )
    )
      add("event_time", "举办日期缺少可靠证据");
    if (
      /报名截止/.test(d.body) &&
      events.some(
        (e) =>
          !e.timeEvidence?.some(
            (t) => t.field === "registrationDeadline" && t.date,
          ),
      )
    )
      add("deadline", "报名截止信息待核对");
    if (
      d.kind === "event" &&
      (!d.extractedFields.timeVerified ||
        !d.extractedFields.placeVerified ||
        !d.extractedFields.deadlineVerified ||
        !d.extractedFields.startAt ||
        !d.extractedFields.endAt)
    )
      add("event_verification", "活动关键事实尚未核验");
  }
  if (
    events.some(
      (e) => e.changeStatus === "cancelled" || e.changeStatus === "postponed",
    ) ||
    /(?:活动|讲座|比赛).{0,12}(取消|改期|延期)/.test(d.title)
  )
    add("status_conflict", "取消或改期需要处理关联状态");
  return {
    issues,
    fields: {
      publishedAt: d.publishedAt,
      publishedPrecision: d.publishedAt
        ? d.publishedAt.length === 10
          ? "date"
          : "exact_time"
        : "unknown",
      events,
    },
    evidence: events.flatMap((e) => e.timeEvidence || []),
    outcome: issues.length ? ("review" as const) : ("pass" as const),
  };
}
