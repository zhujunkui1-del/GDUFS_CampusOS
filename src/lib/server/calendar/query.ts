import { calendarBodyAllowedSql } from "./content-scope";
import { z } from "zod";
import { ArticleActivitySchema } from "@/domain/console/article-analysis";
import { RadarCategorySchema } from "@/domain/console/taxonomy";
import { CALENDAR_VERSION } from "@/domain/calendar/extraction";
import {
  CalendarDateSchema,
  chinaDate,
  addDays,
  weekOf,
  intervalDays,
  occurrenceTime,
} from "@/lib/retrieval/calendar-dates";
import {
  registrationState,
  type RegistrationNow,
} from "@/lib/retrieval/registration-state";
import { articleMapPlace } from "@/lib/retrieval/activity-place";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";
export const CalendarQuerySchema = z
  .object({
    category: RadarCategorySchema.optional(),
    after: CalendarDateSchema.optional(),
    before: CalendarDateSchema.optional(),
    day: CalendarDateSchema.optional(),
    timeRole: z.enum(["event", "registration"]).default("event"),
    sourceId: z.string().max(128).optional(),
    sourceTypes: z
      .preprocess(
        (v) => (typeof v === "string" ? v.split(",") : v),
        z
          .array(
            z.enum(["official_web", "wechat_subscription", "wechat_service"]),
          )
          .max(3),
      )
      .optional(),
    campus: z
      .enum(["university_town", "baiyun", "online", "unknown"])
      .optional(),
    registration: z
      .enum([
        "open",
        "not_started",
        "closed",
        "not_required",
        "unknown",
        "capacity_unknown",
      ])
      .optional(),
    event: z
      .string()
      .regex(/^event-[a-f0-9]{40}$/)
      .optional(),
    cursor: z.string().max(1200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type CalendarSourceArticle = {
  documentId: string;
  version: number;
  title: string;
  originalUrl: string;
  publishedAt: string | null;
  source: { id: string; name: string };
  bodyAvailable: boolean;
  contentRevision: number;
  inputHash: string;
  classificationState: "radar" | "knowledge" | "unknown";
  radarCategory: z.infer<typeof RadarCategorySchema> | null;
  knowledgeCategory: string | null;
};
export type CalendarItem = {
  eventId: string;
  activity: z.infer<typeof ArticleActivitySchema>;
  sources: CalendarSourceArticle[];
  registrationState: RegistrationNow;
  historical: boolean;
  mapPlace: ReturnType<typeof articleMapPlace>;
  calendarUrl: string;
  dates: string[];
};
type Row = {
  document_id: string;
  activity_key: string;
  group_key: string;
  activity_json: string;
  version: number;
  content_revision: number;
  input_hash: string;
  document_title: string;
  url: string;
  published_at: string | null;
  source_id: string;
  display_name: string;
  rights_scope: string;
  primary_destination: "radar" | "knowledge" | "unknown";
  radar_category: z.infer<typeof RadarCategorySchema> | null;
  knowledge_category: string | null;
};
export async function readCalendar(
  db: SqlDatabase,
  raw: unknown,
  now = new Date().toISOString(),
) {
  const started = performance.now(),
    q = CalendarQuerySchema.parse(raw),
    days = weekOf(q.day || chinaDate(Date.parse(now))),
    after = q.after || days[0],
    before = q.before || days[6];
  if (
    after > before ||
    (Date.parse(before) - Date.parse(after)) / 86400000 > 30
  )
    throw new ApiError("INVALID_ARGUMENT", "请选择不超过31天的日期范围。");
  if (q.day && (q.day < after || q.day > before))
    throw new ApiError("INVALID_ARGUMENT", "所选日期不在查询范围内。");
  const metrics = {
    rowsRead: 0,
    rowsWritten: 0,
    queries: 0,
    durationMs: 0,
    usageAvailable: true,
  };
  const read = async <T>(sql: string, args: unknown[]) => {
    const r = await db
      .prepare(sql)
      .bind(...args)
      .all<T>();
    metrics.rowsRead += r.meta?.rows_read || 0;
    metrics.rowsWritten += r.meta?.rows_written || 0;
    metrics.queries++;
    metrics.usageAvailable &&= typeof r.meta?.rows_read === "number";
    return r.results;
  };
  const revision = await read<{ revision: number }>(
    "SELECT public_visibility_revision AS revision FROM console_engine_settings WHERE id='console-v2-settings'",
    [],
  );
  const rv = revision[0]?.revision || 0,
    filters = [
      "a.calendar_eligible=1",
      "a.calendar_version=?",
      "x.calendar_version=?",
      "x.content_revision=d.content_revision",
      "x.input_hash=d.input_hash",
      "d.owner_user_id IS NULL",
      "d.data_domain<>'user_private'",
    ],
    args: unknown[] = [CALENDAR_VERSION, CALENDAR_VERSION];
  if (q.event) {
    filters.push("a.group_key=?");
    args.push(q.event);
  } else if (q.timeRole === "registration") {
    filters.push(
      "EXISTS(SELECT 1 FROM article_registration_windows w WHERE w.document_id=a.document_id AND w.activity_key=a.activity_key AND ((w.ends_day BETWEEN ? AND ?) OR (w.starts_day<=? AND w.ends_day>=?)))",
    );
    args.push(after, before, before, after);
  } else {
    filters.push(
      "a.starts_day BETWEEN ? AND ?",
      "COALESCE(a.ends_day,a.starts_day)>=?",
    );
    args.push(addDays(after, -366), before, after);
  }
  if (q.category) {
    filters.push("a.category=?");
    args.push(q.category);
  }
  if (q.sourceId) {
    filters.push("d.source_id=?");
    args.push(q.sourceId);
  }
  if (q.sourceTypes?.length) {
    filters.push(
      `s.channel_type IN(${q.sourceTypes.map(() => "?").join(",")})`,
    );
    args.push(...q.sourceTypes);
  }
  if (q.campus) {
    filters.push("a.campus_scope=?");
    args.push(q.campus);
  }
  filters.push(
    `(json_extract(a.activity_json,'$.calendar.usesBody')=0 OR (${calendarBodyAllowedSql()}))`,
  );
  const rows = await read<Row>(
    `WITH permitted AS MATERIALIZED (SELECT a.document_id,a.activity_key,a.group_key,a.activity_json,d.version,d.content_revision,d.input_hash,d.title AS document_title,d.url,d.published_at,d.source_id,s.display_name,d.rights_scope,CASE WHEN m.document_id IS NOT NULL THEN CASE WHEN m.radar_category IS NOT NULL THEN 'radar' ELSE 'knowledge' END ELSE x.primary_destination END AS primary_destination,CASE WHEN m.document_id IS NOT NULL THEN m.radar_category ELSE x.radar_category END AS radar_category,CASE WHEN m.document_id IS NOT NULL THEN m.knowledge_category ELSE x.knowledge_category END AS knowledge_category FROM article_activity_index a JOIN knowledge_documents d ON d.id=a.document_id JOIN document_article_analysis x ON x.document_id=d.id JOIN knowledge_sources s ON s.id=d.source_id LEFT JOIN document_classification_overrides m ON m.document_id=d.id WHERE ${filters.join(" AND ")}) SELECT v.* FROM permitted v WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=v.document_id AND p.version=v.version) ORDER BY json_extract(v.activity_json,'$.startsAt.date'),v.group_key,v.document_id LIMIT 1001`,
    args,
  );
  if (rows.length > 1000)
    throw new ApiError("INVALID_ARGUMENT", "活动较多，请缩小日期或筛选范围。");
  const groups = new Map<string, CalendarItem>(),
    today = chinaDate(Date.parse(now));
  const observations = new Map<string, Set<RegistrationNow>>();
  for (const r of rows) {
    let a;
    try {
      a = ArticleActivitySchema.parse(JSON.parse(r.activity_json));
    } catch {
      continue;
    }
    if (
      !a.calendar?.eligible ||
      !a.startsAt?.date ||
      ["cancelled", "postponed"].includes(a.status)
    )
      continue;
    const end = a.endsAt?.date || a.startsAt.date;
    let dates;
    try {
      dates = intervalDays(
        a.startsAt.date,
        end,
        q.event || q.timeRole === "registration" ? a.startsAt.date : after,
        q.event || q.timeRole === "registration" ? end : before,
      );
    } catch {
      continue;
    }
    if (!dates.length) continue;
    const source: CalendarSourceArticle = {
      documentId: r.document_id,
      version: r.version,
      title: r.document_title,
      originalUrl: r.url,
      publishedAt: r.published_at,
      source: { id: r.source_id, name: r.display_name },
      bodyAvailable: r.rights_scope === "licensed_full_text",
      contentRevision: r.content_revision,
      inputHash: r.input_hash,
      classificationState: r.primary_destination,
      radarCategory: r.radar_category,
      knowledgeCategory: r.knowledge_category,
    };
    const state = registrationState({ ...a, status: "unknown" }, now),
      history = a.endsAt?.at
        ? Date.parse(a.endsAt.at) < Date.parse(now)
        : end < today;
    const group = groups.get(r.group_key);
    const states = observations.get(r.group_key) || new Set<RegistrationNow>();
    if (state !== "unknown") states.add(state);
    observations.set(r.group_key, states);
    if (group) {
      if (!group.sources.some((s) => s.documentId === source.documentId))
        group.sources.push(source);
    } else
      groups.set(r.group_key, {
        eventId: r.group_key,
        activity: a,
        sources: [source],
        registrationState: state,
        historical: history,
        mapPlace: articleMapPlace(a.placeRaw),
        calendarUrl: `/calendar?date=${dates[0]}&event=${r.group_key}`,
        dates,
      });
  }
  for (const g of groups.values()) {
    const states = observations.get(g.eventId)!;
    g.registrationState = states.size === 1 ? [...states][0] : "unknown";
    if (states.size > 1)
      g.activity = {
        ...g.activity,
        registrationStatus: "unknown",
        registrationWindows: [],
        issues: [...g.activity.issues, "来源报名安排存在冲突"],
      };
  }
  let all = [...groups.values()].filter(
    (g) =>
      !q.registration ||
      (g.registrationState === q.registration &&
        !(q.registration === "open" && g.historical)),
  );
  const dailyCounts: Record<string, number> = {};
  for (const day of intervalDays(after, before))
    dailyCounts[day] = all.filter((g) => g.dates.includes(day)).length;
  if (q.day) all = all.filter((g) => g.dates.includes(q.day!));
  const key = (g: CalendarItem) => {
    const day = q.day || g.dates[0],
      t = occurrenceTime(day, g.activity).startTime || "99:99";
    return `${day}|${t}|${g.eventId}`;
  };
  all.sort((a, b) => key(a).localeCompare(key(b)));
  const signature = JSON.stringify([
    after,
    before,
    q.day,
    q.category,
    q.campus,
    q.registration,
    q.timeRole,
    q.sourceId,
    q.sourceTypes,
    q.event,
  ]);
  let cursorKey = "";
  if (q.cursor) {
    try {
      const c = JSON.parse(atob(q.cursor));
      if (
        c.revision !== rv ||
        c.signature !== signature ||
        typeof c.key !== "string"
      )
        throw Error();
      cursorKey = c.key;
    } catch {
      throw new ApiError("INVALID_ARGUMENT", "活动已更新，请刷新后重试。");
    }
  }
  const remaining = all.filter((g) => key(g) > cursorKey),
    items = remaining.slice(0, q.limit),
    hasMore = remaining.length > q.limit;
  metrics.durationMs = Math.round(performance.now() - started);
  return {
    items,
    after,
    before,
    day: q.day || null,
    dailyCounts,
    total: all.length,
    hasMore,
    nextCursor: hasMore
      ? btoa(
          JSON.stringify({ revision: rv, signature, key: key(items.at(-1)!) }),
        )
      : null,
    occurrences: items.flatMap((g) =>
      g.dates.map((date) => ({
        eventId: g.eventId,
        date,
        ...occurrenceTime(date, g.activity),
      })),
    ),
    limit: q.limit,
    now,
    timeZone: "Asia/Shanghai" as const,
    modelCalls: 0,
    metrics,
  };
}
