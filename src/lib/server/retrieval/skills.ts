import { z } from "zod";
import {
  ContentSearchResultSchema,
  KnowledgeSearchInputSchema,
  EventSearchInputSchema,
  type ContentSearchResult,
} from "@/domain/retrieval/skills";
import type { ArticleTimePoint } from "@/domain/console/article-analysis";
import { PUBLIC_RETRIEVAL_SCOPE } from "@/domain/retrieval/contracts";
import {
  registrationState,
  registrationWindowState,
  timePast,
} from "@/lib/retrieval/registration-state";
import { activityStatus } from "@/lib/ingestion/article-times";
import type { SqlDatabase } from "../assistant/database";
import { D1KeywordRetriever } from "./retriever";
import { requestSemanticRetriever } from "./vector";
import { SkillRegistry } from "../agent/skill-registry";
import { ApiError } from "../errors";
import type { TimeWindow } from "../assistant/time-window";
import { requestTimeWindow } from "../assistant/time-window";
import { universityScope } from "../assistant/grounding";
import { completeSnippetTimes } from "@/lib/retrieval/snippet-time";
import { calendarContentSearch } from "../calendar/search";
import { collegeRoundupIds } from "./college-roundup";
import { calendarIdentity } from "@/lib/ingestion/calendar-identity";

const time = (t: ArticleTimePoint | null) =>
  t
    ? {
        raw: t.raw.slice(0, 160),
        date: t.date,
        at: t.at,
        timezone: t.timezone,
        precision: t.precision,
        resolution: t.resolution,
        inferred: t.inferred,
        inferenceBasis: t.inferenceBasis?.slice(0, 240) || null,
        evidence: t.evidence.text.slice(0, 240),
      }
    : null;
export { articleMapPlace } from "@/lib/retrieval/activity-place";
import { articleMapPlace } from "@/lib/retrieval/activity-place";
export async function searchContent(
  db: SqlDatabase,
  purpose: "knowledge" | "events",
  raw: z.input<typeof EventSearchInputSchema>,
  now = new Date().toISOString(),
  signal?: AbortSignal,
): Promise<ContentSearchResult> {
  let q =
    purpose === "events"
      ? EventSearchInputSchema.parse(raw)
      : KnowledgeSearchInputSchema.parse(raw);
  let event = purpose === "events" ? EventSearchInputSchema.parse(raw) : null;
  const inferredWindow =
    event &&
    !event.after &&
    !event.before &&
    !event.publishedAfter &&
    !event.publishedBefore
      ? requestTimeWindow(event.query, Date.parse(now))
      : undefined;
  if (event && inferredWindow) {
    event = EventSearchInputSchema.parse({
      ...event,
      ...(inferredWindow.role === "publication"
        ? {
            publishedAfter: inferredWindow.after,
            publishedBefore: inferredWindow.before,
          }
        : {
            after: inferredWindow.after,
            before: inferredWindow.before,
            timeRole: inferredWindow.role,
          }),
    });
    q = event;
  }
  if (event?.after && event.before && event.after > event.before)
    throw new ApiError("INVALID_ARGUMENT", "开始日期不能晚于结束日期。");
  if (event?.timeRole === "event" && event.after && event.before)
    return calendarContentSearch(db, event, now);
  let documentIds: string[] | undefined;
  let filterMetrics = {
    rowsRead: 0,
    rowsWritten: 0,
    queries: 0,
    usageAvailable: true,
  };
  if (
    event &&
    (event.after || event.before || event.registrationState === "open")
  ) {
    const byEvent =
      event.timeRole === "event" && !!(event.after || event.before);
    const alias = byEvent ? "a.starts_day" : "a.ends_day",
      conditions = [alias + " IS NOT NULL"],
      args: unknown[] = [];
    if (event.after) {
      conditions.push(alias + ">=?");
      args.push(event.after);
    }
    if (event.before) {
      conditions.push(alias + "<=?");
      args.push(event.before);
    }
    const from = byEvent
      ? "article_activity_index"
      : "article_registration_windows";
    if (event.registrationState === "open") {
      const today = new Date(Date.parse(now) + 8 * 3600000)
        .toISOString()
        .slice(0, 10);
      conditions.push(`EXISTS(SELECT 1 FROM article_registration_windows w WHERE w.document_id=a.document_id AND w.activity_key=a.activity_key ${byEvent ? "" : "AND w.ordinal=a.ordinal"}
       AND ((w.starts_at IS NOT NULL AND julianday(w.starts_at)<=julianday(?)) OR (w.starts_at IS NULL AND w.starts_day<?))
       AND ((w.ends_at IS NOT NULL AND julianday(w.ends_at)>julianday(?)) OR (w.ends_at IS NULL AND w.ends_day>?)))`);
      args.push(now, today, now, today);
    }
    const r = await db
      .prepare(
        `SELECT DISTINCT a.document_id FROM ${from} a JOIN document_article_analysis x ON x.document_id=a.document_id JOIN knowledge_documents d ON d.id=a.document_id AND d.content_revision=x.content_revision AND d.input_hash=x.input_hash WHERE ${conditions.join(" AND ")} ORDER BY ${alias},a.document_id LIMIT 80`,
      )
      .bind(...args)
      .all<{ document_id: string }>();
    documentIds = r.results.map((d) => d.document_id);
    filterMetrics = {
      rowsRead: r.meta?.rows_read || 0,
      rowsWritten: r.meta?.rows_written || 0,
      queries: 1,
      usageAvailable: typeof r.meta?.rows_read === "number",
    };
  }
  // An enumeration question ("还有别的学院的院运会吗") is answered by the
  // derived facets, not by a top-k guess: read one upcoming notice per
  // college. A date or registration filter still wins, because it is a
  // narrower constraint than the enumeration.
  if (
    purpose === "events" &&
    !documentIds &&
    !event?.after &&
    !event?.before &&
    !event?.registrationState
  ) {
    const roundup = await collegeRoundupIds(db, q.query, now);
    if (roundup.length) {
      documentIds = roundup;
      filterMetrics.queries += 1;
    }
  }
  const {
    after: _after,
    before: _before,
    timeRole: _role,
    registrationState: _reg,
    ...base
  } = event || {
    ...q,
    after: undefined,
    before: undefined,
    timeRole: undefined,
    registrationState: undefined,
  };
  void _after;
  void _before;
  void _role;
  void _reg;
  const search = await new D1KeywordRetriever(
    db,
    requestSemanticRetriever(),
  ).search(
    {
      ...base,
      purpose,
      limit:
        event && (event.registrationState || event.after || event.before)
          ? Math.min(6, q.limit * 2)
          : q.limit,
    },
    PUBLIC_RETRIEVAL_SCOPE,
    undefined,
    signal,
    documentIds,
  );
  const result: ContentSearchResult = {
    ...search.result,
    purpose,
    query: q.query,
    now,
    timeZone: "Asia/Shanghai",
    activities: [],
    knowledge: [],
  };
  result.metrics.rowsRead += filterMetrics.rowsRead;
  result.metrics.rowsWritten += filterMetrics.rowsWritten;
  result.metrics.queries += filterMetrics.queries;
  result.metrics.usageAvailable &&= filterMetrics.usageAvailable;
  const groups = new Set<string>();
  const uncertainDates = new Set<string>();
  for (const { hit, analysis: storedAnalysis } of search.articles) {
    const analysis =
      storedAnalysis?.calendar?.status === "accepted"
        ? storedAnalysis
        : completeSnippetTimes(storedAnalysis, hit);
    // An absent/metadata body cannot establish policy conditions or activity facts.
    if (!analysis || !hit.bodyAvailable) {
      if (event && (event.after || event.before))
        uncertainDates.add(hit.documentId);
      continue;
    }
    const k = analysis.knowledge;
    result.knowledge.push({
      documentId: hit.documentId,
      validity: hit.validity,
      effectiveFrom: time(k.effectiveFrom),
      effectiveUntil: time(k.effectiveUntil),
      conditions: k.conditions.slice(0, 3).map((e) => e.text.slice(0, 300)),
      materials: k.materials.slice(0, 3).map((e) => e.text.slice(0, 300)),
      steps: k.steps.slice(0, 3).map((e) => e.text.slice(0, 300)),
    });
    for (const a of analysis.activities.slice(0, 3)) {
      if (event?.category && a.category !== event.category) continue;
      if (event?.after || event?.before) {
        const days =
          event.timeRole === "event"
            ? [a.startsAt?.date]
            : a.registrationWindows.map((w) => w.end?.date);
        if (!days.some(Boolean)) uncertainDates.add(hit.documentId);
        else if (
          !days.some(
            (day) =>
              day &&
              (!event.after || day >= event.after) &&
              (!event.before || day <= event.before),
          )
        )
          continue;
      }
      const current = { ...a, status: activityStatus(a, now) },
        state = registrationState(current, now);
      if (event?.registrationState && state !== event.registrationState)
        continue;
      // Only exact start + explicit location can deduplicate sessions across articles.
      const group = a.calendar?.eligible
        ? await calendarIdentity(a, hit.documentId, hit.sourceName)
        : a.startsAt?.at && a.placeRaw
          ? `${a.title}|${a.startsAt.at}|${a.placeRaw}`
          : hit.documentId + "/" + a.key;
      if (groups.has(group)) continue;
      groups.add(group);
      result.activities.push({
        eventId: group,
        documentId: hit.documentId,
        activityKey: a.key,
        name: a.title.slice(0, 250),
        kind: a.kind,
        category: a.category,
        startsAt: time(a.startsAt),
        endsAt: time(a.endsAt),
        placeRaw: a.placeRaw?.slice(0, 300) || null,
        organizer: a.organizer?.slice(0, 300) || null,
        eventStatus: current.status,
        historical: timePast(a.endsAt, now) || timePast(a.startsAt, now),
        registrationRequirement:
          a.registrationStatus === "required"
            ? "required"
            : a.registrationStatus === "not_required"
              ? "not_required"
              : "unknown",
        registrationState: state,
        registrationWindows: a.registrationWindows.slice(0, 3).map((w) => ({
          roundLabel: w.roundLabel,
          start: time(w.start),
          end: time(w.end),
          deadlineSemantics: w.deadlineSemantics,
          capacityLimited: w.capacityLimited,
          state: registrationWindowState(w, now),
          evidence: w.evidence.slice(0, 2).map((e) => e.text.slice(0, 240)),
        })),
        otherDeadlines: a.otherDeadlines
          .slice(0, 3)
          .map((d) => ({ role: d.role, time: time(d.time)! })),
        registrationUrl: a.registrationUrl,
        evidence: a.evidence.slice(0, 3).map((e) => e.text.slice(0, 240)),
        mapPlace: articleMapPlace(a.placeRaw),
        calendarUrl:
          a.calendar?.eligible && a.startsAt?.date
            ? `/calendar?date=${a.startsAt.date}&event=${group}`
            : undefined,
      });
    }
  }
  if (event && (event.registrationState || event.after || event.before)) {
    const ids = new Set(result.activities.map((a) => a.documentId));
    result.hits = result.hits.filter(
      (h) =>
        ids.has(h.documentId) ||
        (!event.registrationState && uncertainDates.has(h.documentId)),
    );
    result.knowledge = result.knowledge.filter((k) => ids.has(k.documentId));
  }
  if (uncertainDates.size)
    result.warnings.push(
      "部分相关原文尚无可靠的对应日期，作为待核对资料返回；不能声称符合所问日期范围或没有活动，需继续官方补查。",
    );
  result.hits = result.hits.slice(0, q.limit);
  const returned = new Set(result.hits.map((h) => h.documentId));
  result.activities = result.activities.filter((a) =>
    returned.has(a.documentId),
  );
  result.knowledge = result.knowledge.filter((k) => returned.has(k.documentId));
  if (documentIds?.length === 80)
    result.warnings.push(
      "日期候选达到本次上限，可缩小时间范围；空结果不表示全校没有相关活动。",
    );
  let bounded = false;
  while (
    JSON.stringify(result).length > 24000 &&
    result.activities.length > 1
  ) {
    result.activities.pop();
    bounded = true;
  }
  if (bounded)
    result.warnings.push(
      "活动证据达到本次返回上限，可按活动标题或日期细化查询。",
    );
  return ContentSearchResultSchema.parse(result);
}
export function registerContentSkills(
  registry: SkillRegistry,
  db: SqlDatabase,
  window?: TimeWindow,
  universityOnly = false,
) {
  const define = <T extends z.ZodType>(
    name: string,
    purpose: "knowledge" | "events",
    schema: T,
    description: string,
  ) => ({
    name,
    description,
    inputSchema: schema,
    outputSchema: ContentSearchResultSchema,
    version: "1.0.0",
    auth: "public" as const,
    sideEffect: "none" as const,
    requiresConfirmation: false,
    timeoutMs: 12000,
    execute: async (input: z.output<T>, context: { signal?: AbortSignal }) => {
      const constrained = {
        ...(input as Record<string, unknown>),
        ...(window?.role === "publication"
          ? { publishedAfter: window.after, publishedBefore: window.before }
          : {}),
        ...(window && window.role !== "publication" && purpose === "events"
          ? {
              after: window.after,
              before: window.before,
              timeRole: window.role,
            }
          : {}),
      };
      const data = await searchContent(
        db,
        purpose,
        constrained as z.input<typeof EventSearchInputSchema>,
        new Date().toISOString(),
        context.signal,
      );
      if (universityOnly) {
        const before = data.hits.length;
        data.hits = data.hits.filter(universityScope);
        const ids = new Set(data.hits.map((h) => h.documentId));
        data.activities = data.activities.filter((a) => ids.has(a.documentId));
        data.knowledge = data.knowledge.filter((a) => ids.has(a.documentId));
        if (data.hits.length < before)
          data.warnings.push(
            "附属学校来源未明确涉及大学本部的结果不作为本次校园事实证据。",
          );
      }
      return {
        ok: true as const,
        data,
        sources: data.hits.map((h) => ({
          title: h.title.slice(0, 200),
          url: h.originalUrl,
          ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
        })),
        warnings: data.warnings,
      };
    },
  });
  registry.register(
    "knowledge-domain",
    define(
      "search_campus_knowledge",
      "knowledge",
      KnowledgeSearchInputSchema,
      "查询广外真实政策、办事流程、图书馆借阅、选课、奖助条件及就业指南。检索网站/公众号及校园资讯正文，返回证据与来源。只依据正文证据作答；元数据不能冒充全文，validity=unknown不能说是现行永久政策。追问请带上原问题主题。",
    ),
  );
  registry.register(
    "events-domain",
    define(
      "search_campus_events",
      "events",
      EventSearchInputSchema,
      "查询真实讲座、文体、竞赛、招聘就业、科研申报、奖助机会与临时公告，包含未明确分类的校园资讯。时间过滤after/before使用实际活动或报名日期(timeRole)，不是发布日期。报标记不代表可报名；只有registrationState=open可称明确开放；unknown/额满即止均不能保证可报名。返回证据与原文。",
    ),
  );
  return registry;
}
