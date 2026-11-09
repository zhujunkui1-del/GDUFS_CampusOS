import {
  ContentSearchResultSchema,
  type ContentSearchResult,
  type EventSearchInputSchema,
} from "@/domain/retrieval/skills";
import type { z } from "zod";
import { CALENDAR_VERSION } from "@/domain/calendar/extraction";
import { readCalendar } from "./query";
import type { SqlDatabase } from "../assistant/database";
import { isOfficialCampusUrl } from "../external-search/policy";
import { registrationWindowState } from "@/lib/retrieval/registration-state";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { stripTimeRange } from "../assistant/time-window";
import { addDays, chinaDate } from "@/lib/retrieval/calendar-dates";
import type { ArticleTimePoint } from "@/domain/console/article-analysis";
import type { EvidenceHit } from "@/domain/retrieval/contracts";

/** Calendar projections use their own index/version and current publication gate. */
export async function revalidateCalendarEvidence(
  db: SqlDatabase,
  hits: EvidenceHit[],
) {
  const groups = new Map<string, Awaited<ReturnType<typeof readCalendar>>>();
  for (const hit of hits) {
    if (!groups.has(hit.chunkId))
      groups.set(
        hit.chunkId,
        await readCalendar(db, { event: hit.chunkId, limit: 1 }),
      );
    const item = groups.get(hit.chunkId)!.items[0];
    if (
      !item?.sources.some(
        (s) =>
          s.documentId === hit.documentId &&
          s.version === hit.documentVersion &&
          s.contentRevision === hit.contentRevision &&
          s.inputHash === hit.inputHash,
      )
    )
      return false;
  }
  return true;
}
const time = (p: ArticleTimePoint | null) =>
  p
    ? {
        raw: p.raw,
        date: p.date,
        at: p.at,
        timezone: p.timezone,
        precision: p.precision,
        resolution: p.resolution,
        inferred: p.inferred,
        inferenceBasis: p.inferenceBasis,
        evidence: p.evidence.text.slice(0, 240),
      }
    : null;
export async function calendarContentSearch(
  db: SqlDatabase,
  event: z.output<typeof EventSearchInputSchema>,
  now: string,
): Promise<ContentSearchResult> {
  const query = await readCalendar(
    db,
    {
      after: event.after,
      before: event.before,
      category: event.category,
      sourceId: event.sourceId,
      sourceTypes: event.sourceTypes,
      registration: event.registrationState,
      timeRole: event.timeRole,
      limit: 50,
    },
    now,
  );
  // Time words are constraints, not subjects: “最近两周” must not become a
  // relevance modifier that rejects every lecture in the window.
  const plan = buildQueryPlan(stripTimeRange(event.query));
  const specific =
    plan.topics.some((t) => !["competition"].includes(t.id)) ||
    plan.entities.length ||
    plan.modifiers.length;
  // A follow-up page must skip what the previous answer already showed, or the
  // same five entries come back forever.
  const excluded = new Set(event.excludeDocumentIds ?? []);
  let items = query.items
    .filter((g) => !excluded.has(g.sources[0]?.documentId))
    .filter(
      (g) =>
        !specific ||
        queryRelevance(plan, {
          title: g.activity.title,
          contentSnippet: g.activity.evidence.map((e) => e.text).join(" "),
        }).relevant,
    )
    .slice(0, event.limit);
  // An empty page inside a time box is not the same as "no such event": the
  // useful answer is the nearest one outside the box. Say so instead of
  // claiming the corpus has nothing.
  const warnings: string[] = [];
  if (!items.length && (event.after || event.before) && event.nearestIfEmpty) {
    // readCalendar defaults to the current week when no range is given, so a
    // single "no range" read could never see next month's lecture. The useful
    // fallback is the nearest upcoming match, so scan forward in 30-day
    // windows (the schema's own ceiling) until something is found.
    const today = chinaDate(Date.parse(now));
    for (let offset = 0; offset < 90 && !items.length; offset += 30) {
      const next = await readCalendar(
        db,
        {
          after: addDays(today, offset),
          before: addDays(today, offset + 30),
          category: event.category,
          sourceId: event.sourceId,
          sourceTypes: event.sourceTypes,
          registration: event.registrationState,
          timeRole: event.timeRole,
          limit: 50,
        },
        now,
      );
      const upcoming = next.items
        .filter(
          (g) =>
            !excluded.has(g.sources[0]?.documentId) &&
            // The category filter already names the subject; demanding the
            // word “讲座” in the title would drop the nearest forum whose
            // title says “研讨会”. Without a category, relevance still guards
            // the page against unrelated activities.
            (!specific ||
              !!event.category ||
              queryRelevance(plan, {
                title: g.activity.title,
                contentSnippet: g.activity.evidence.map((e) => e.text).join(" "),
              }).relevant) &&
            (g.activity.startsAt?.date ?? "") >= today,
        )
        .sort((a, b) =>
          (a.activity.startsAt?.date ?? "").localeCompare(
            b.activity.startsAt?.date ?? "",
          ),
        )
        .slice(0, event.limit);
      if (upcoming.length) {
        items = upcoming;
        warnings.push(
          "所问时间范围内没有符合条件的活动，以下是之后最近的安排，日期不在所问范围内。",
        );
      }
    }
  }
  const seen = new Set<string>();
  const hits = items.flatMap((item) =>
    item.sources.flatMap((s) => {
      if (seen.has(s.documentId) || seen.size >= 6) return [];
      seen.add(s.documentId);
      const evidence =
        item.activity.evidence.find((e) => e.role === "event_time") ||
        item.activity.startsAt!.evidence;
      const snippet = evidence.text.slice(0, 780);
      return [
        {
          documentId: s.documentId,
          chunkId: item.eventId,
          title: s.title,
          sourceId: s.source.id,
          sourceName: s.source.name,
          originalUrl: s.originalUrl,
          publishedAt: s.publishedAt,
          contentSnippet: snippet,
          startOffset: evidence.startOffset,
          endOffset: evidence.startOffset + snippet.length,
          evidenceBasis: "activity_projection",
          evidenceType: evidence.field === "title" ? "metadata" : "excerpt",
          bodyAvailable: evidence.field !== "title",
          bodyPartial: true,
          relevanceScore: 1,
          rankingReasons: ["按实际举办日期查询共享活动索引"],
          classificationState: s.classificationState,
          radarCategory: s.radarCategory,
          knowledgeCategory: s.knowledgeCategory,
          classificationOrigin: "automatic",
          contentRevision: s.contentRevision,
          inputHash: s.inputHash,
          documentVersion: s.version,
          publicAvailable: true,
          validity: "unknown",
          official: isOfficialCampusUrl(s.originalUrl),
          readable: s.bodyAvailable,
          linkedSources: [],
          calendarUrl: item.calendarUrl,
        },
      ];
    }),
  );
  return ContentSearchResultSchema.parse({
    hits,
    metrics: {
      ...query.metrics,
      candidateChunks: 0,
      candidateActivities: query.total,
    },
    indexVersion: CALENDAR_VERSION,
    method: "calendar_index",
    warnings,
    purpose: "events",
    query: event.query,
    now,
    timeZone: "Asia/Shanghai",
    knowledge: [],
    activities: items.map((item) => {
      const a = item.activity;
      return {
        eventId: item.eventId,
        documentId: item.sources[0].documentId,
        activityKey: a.key,
        name: a.title.slice(0, 250),
        kind: a.kind,
        category: a.category,
        startsAt: time(a.startsAt),
        endsAt: time(a.endsAt),
        placeRaw: a.placeRaw,
        organizer: a.organizer,
        eventStatus: item.historical ? "historical" : "scheduled",
        historical: item.historical,
        registrationRequirement: a.registrationStatus,
        registrationState: item.registrationState,
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
          .map((d) => ({ role: d.role, time: time(d.time) })),
        registrationUrl: a.registrationUrl,
        evidence: a.evidence.slice(0, 3).map((e) => e.text.slice(0, 240)),
        mapPlace: item.mapPlace,
        calendarUrl: item.calendarUrl,
      };
    }),
  });
}
