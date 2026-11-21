import type { SqlDatabase } from "../assistant/database";
import type { PersonalTask } from "@/domain/account/tasks";
import { articleTitleKey } from "@/lib/retrieval/article-title";
import { CALENDAR_VERSION } from "@/domain/calendar/extraction";
import { safeExternalUrl } from "@/domain/console/contracts";
import { readCalendar, type CalendarItem } from "./query";
import { calendarBodyAllowedSql } from "./content-scope";
import { articleText } from "@/lib/ingestion/article-text";
import { CalendarDateSchema, chinaDate } from "@/lib/retrieval/calendar-dates";

const calendarTitleKey = (title: string) =>
  articleTitleKey(title).replace(/["–—－-]/g, "");

export const asksScheduleConflict = (question: string) =>
  /冲突|重叠|撞(?:时间|期)|时间.{0,4}撞/.test(question);
export function calendarPair(question: string): [string, string] | undefined {
  if (!asksScheduleConflict(question)) return;
  const subject = question
    .trim()
    .replace(/^[^\n]{0,36}?(?:我问你|我问的是|请问)\s*/, "")
    .replace(/^我的?(?:待办|代办)(?:事项)?(?:里|中|里的|中的)?[，、:\s：]*/, "")
    .replace(/^(?:请帮我|帮我|请)(?:比较|看看|查一下)?\s*/, "")
    .replace(
      /\s*(?:这两(?:场|项)(?:活动|比赛|赛事)?(?:的)?)?\s*(?:举办)?时间(?:会不会|是否|有没有|有无|会)?(?:冲突|重叠|撞(?:时间|期)).*$/,
      "",
    )
    .replace(
      /\s*(?:这两(?:场|项)(?:活动|比赛|赛事)?(?:的)?)?\s*(?:会不会|是否|是不是)?(?:冲突|重叠|撞(?:时间|期)).*$/,
      "",
    );
  const quoted = [
    ...subject.matchAll(/“([^”]+)”|「([^」]+)」|《([^》]+)》/g),
  ].map((m) => m[1] ?? m[2] ?? m[3]);
  const parts =
    quoted.length === 2 ? quoted : subject.split(/\s*(?:以及|和|与|跟|、)\s*/);
  if (
    parts.length !== 2 ||
    parts.some((name) => calendarTitleKey(name).length < 4)
  )
    return;
  return parts.map((part) => part.trim().replace(/^[“「《]|[”」》]$/g, "")) as [
    string,
    string,
  ];
}

type ComparisonPlan = {
  pair: [string, string];
  dates: [string | null, string | null];
};
export type CalendarComparisonState = ComparisonPlan & { pending: number[] };
type CalendarIntent = ComparisonPlan | { title: string; date: string };

function requestedDates(question: string, now: number) {
  return [
    ...question.matchAll(
      /(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)|\b(20\d{2})-(\d{2})-(\d{2})\b/g,
    ),
  ].flatMap((match) => {
    const date = match[4]
      ? match[0]
      : `${match[1] ?? chinaDate(now).slice(0, 4)}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    return CalendarDateSchema.safeParse(date).success
      ? [{ date, offset: match.index, end: match.index + match[0].length }]
      : [];
  });
}

async function calendarTitleCandidates(db: SqlDatabase, date?: string) {
  const rows = await db
    .prepare(
      `SELECT DISTINCT a.group_key AS id,a.title AS activity_title,d.title AS article_title
     FROM article_activity_index a JOIN knowledge_documents d ON d.id=a.document_id
     JOIN document_article_analysis x ON x.document_id=d.id AND x.input_hash=d.input_hash AND x.content_revision=d.content_revision
     WHERE a.calendar_eligible=1 AND a.calendar_version=? AND x.calendar_version=a.calendar_version
       AND (? IS NULL OR ? BETWEEN a.starts_day AND COALESCE(a.ends_day,a.starts_day))
       AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id AND p.version=d.version)`,
    )
    .bind(CALENDAR_VERSION, date ?? null, date ?? null)
    .all<{
      id: string;
      activity_title: string;
      article_title: string;
    }>();
  return rows.results;
}

async function publishedTitles(db: SqlDatabase, questionKey: string) {
  const rows = await calendarTitleCandidates(db);
  const candidates = [
    ...new Set(
      rows.flatMap(({ activity_title, article_title }) => [
        activity_title,
        article_title,
      ]),
    ),
  ]
    .map((title) => ({ title, key: calendarTitleKey(title) }))
    .filter(({ key }) => key.length >= 4 && questionKey.includes(key))
    .sort((a, b) => b.key.length - a.key.length);
  const titles: { title: string; key: string; start: number; end: number }[] =
    [];
  for (const row of candidates) {
    const start = questionKey.indexOf(row.key);
    const end = start + row.key.length;
    if (!titles.some((item) => start < item.end && end > item.start))
      titles.push({ ...row, start, end });
  }
  return titles.sort((a, b) => a.start - b.start);
}

export async function resolveCalendarIntent(
  db: SqlDatabase,
  question: string,
  previous?: CalendarComparisonState,
  now = Date.now(),
): Promise<CalendarIntent | undefined> {
  // "发布时间：2026-11-09" is when the page was published, not the date the
  // user asks about. Treating it as the requested event date sent an article
  // lookup into runCalendarDate("…", "2026-11-09") and answered "未能核实场次"
  // without ever reading the article's stated schedule.
  question = question.replace(
    /(?:发布时间|发布日期|发表时间|更新时间|来源|作者|编辑)\s*[:：][^\n]*/g,
    " ",
  );
  const dates = requestedDates(question, now);
  const key = calendarTitleKey(question);
  const comparing = asksScheduleConflict(question);
  const titles =
    comparing || dates.length ? await publishedTitles(db, key) : [];
  const when = dates.filter(({ offset, end }) => {
    const startKey = calendarTitleKey(question.slice(0, offset)).length;
    const endKey = calendarTitleKey(question.slice(0, end)).length;
    return !titles.some(
      (title) => startKey >= title.start && endKey <= title.end,
    );
  });
  const withoutDates = when.reduceRight(
    (text, { offset, end }) =>
      text.slice(0, offset) +
      text.slice(end).replace(/^\s*(?:当天|当日)?(?:的)?\s*/, " "),
    question,
  );
  const fallback = comparing ? calendarPair(withoutDates) : undefined;
  const [first, second] = titles;
  const explicitPair: [string, string] | undefined =
    first && second && comparing ? [first.title, second.title] : fallback;
  if (explicitPair) {
    const assigned: ComparisonPlan["dates"] = [null, null];
    if (when.length === 1) {
      const offset = calendarTitleKey(question.slice(0, when[0].offset)).length;
      if (first && second && offset >= first.end && offset < second.start)
        assigned[0] = when[0].date;
      else assigned.fill(when[0].date);
    } else if (when.length === 2) {
      assigned[0] = when[0].date;
      assigned[1] = when[1].date;
    }
    return { pair: explicitPair, dates: assigned };
  }

  const choice = when.length === 1 ? when[0] : undefined;
  if (previous && (choice || comparing)) {
    const mentioned = previous.pair
      .map((title, index) =>
        key.includes(calendarTitleKey(title)) ? index : -1,
      )
      .filter((index) => index >= 0);
    const isBareDate =
      choice &&
      /^(?:就|选|是|改成|就选)?(?:的)?(?:那天|当天|那场|场次)?[吗呢]?$/.test(
        calendarTitleKey(withoutDates),
      );
    const index =
      mentioned.length === 1
        ? mentioned[0]
        : isBareDate && previous.pending.length === 1
          ? previous.pending[0]
          : undefined;
    if (
      choice &&
      index !== undefined &&
      (previous.pending.includes(index) ||
        comparing ||
        /改成|换成/.test(question))
    ) {
      const selected: ComparisonPlan["dates"] = [...previous.dates];
      selected[index] = choice.date;
      return { pair: previous.pair, dates: selected };
    }
    if (
      comparing &&
      !choice &&
      !first &&
      /^(?:这两|那两|它们|刚才|时间|^冲突)/.test(key)
    )
      return { pair: previous.pair, dates: previous.dates };
  }
  if (
    choice &&
    !comparing &&
    !/怎么报名|如何报名|能报名|报名条件|报名材料|报名截止/.test(question)
  ) {
    const title =
      first?.title ??
      withoutDates
        .replace(/^(?:请问|想查|帮我查一下)\s*/, "")
        .replace(/[的在\s]+$/, "")
        .trim();
    if (
      first ||
      (/场次|比赛|活动|讲座|宣讲/.test(question) &&
        calendarTitleKey(title).length >= 4 &&
        title.length <= 250)
    )
      return { title, date: choice.date };
  }
}

// A question about an event is not the event name: “《新利益法学》讲座现在还
// 能参加吗” is stored as “著名教授论坛…第763讲：新利益法学”. Strip the asking
// tail before comparing, or a real session looks unverified.
const EVENT_SUFFIXES = [
  /(?:吗|么|呢)$/,
  /(?:现在)?(?:还能|还可以|可以|能)(?:参加|报名)$/,
  /(?:参加|报名)(?:吗|么|呢)?$/,
  /(?:的)?(?:场次)$/,
  /(?:的)?(?:讲座)$/,
  /(?:的)?(?:活动)$/,
  /(?:的)?(?:报告)$/,
  /(?:的)?(?:比赛)$/,
  /(?:的)?(?:论坛)$/,
];
function eventSubject(name: string) {
  let text = name;
  for (let round = 0; round < 4; round += 1) {
    let next = text;
    for (const suffix of EVENT_SUFFIXES) {
      const trimmed = next.replace(suffix, "");
      if (trimmed && trimmed !== next) next = trimmed;
    }
    if (next === text) break;
    text = next;
  }
  return text;
}
function score(name: string, title: string) {
  const key = calendarTitleKey(title.replace(/^(?:参加|报名)\s*[:：]\s*/, ""));
  if (key === name) return 2;
  // `name` arrives as a title key already; the asking tail is what makes a
  // question stop looking like the stored title.
  const subject = eventSubject(name);
  // A very short leftover (“学生”) would match half the calendar; only a
  // real subject is worth a fuzzy match.
  if (!subject || subject === name || subject.length < 4) return 0;
  return key === subject ? 2 : key.includes(subject) ? 1 : 0;
}

async function publicMatches(db: SqlDatabase, name: string, date?: string) {
  if (!name) return [];
  const ranked = new Map<string, number>();
  for (const {
    id,
    activity_title,
    article_title,
  } of await calendarTitleCandidates(db, date)) {
    const activity = score(name, activity_title);
    const article = score(name, article_title);
    const rank =
      activity === 2 ? 4 : article === 2 ? 3 : activity === 1 ? 2 : article;
    if (rank > (ranked.get(id) ?? 0)) ranked.set(id, rank);
  }
  const rows = [...ranked]
    .sort(([aId, a], [bId, b]) => b - a || aId.localeCompare(bId))
    .slice(0, 12);
  const result: CalendarItem[] = [];
  let best = 0;
  for (const [id, rank] of rows) {
    if (rank < best) break;
    const [event] = (await readCalendar(db, { event: id, day: date })).items;
    if (
      !event ||
      (date && !event.dates.includes(date)) ||
      (!score(name, event.activity.title) &&
        !event.sources.some(({ title }) => score(name, title)))
    )
      continue;
    best = rank;
    result.push(event);
  }
  return result;
}

async function taskMatches(
  db: SqlDatabase,
  name: string,
  tasks: PersonalTask[],
) {
  const matches = tasks
    .map((task) => ({ task, score: score(name, task.title) }))
    .filter((row) => row.score > 0);
  const best = Math.max(0, ...matches.map((row) => row.score));
  const events = new Map<string, CalendarItem>();
  for (const { task, score: rank } of matches) {
    const source = task.source;
    if (rank < best || !source?.articleAvailable) continue;
    const { items } = await readCalendar(
      db,
      source.eventId
        ? { event: source.eventId }
        : { articleId: source.articleId, limit: 50 },
    );
    const sameArticle = items.filter((item) =>
      item.sources.some((s) => s.documentId === source.articleId),
    );
    const selected =
      source.eventId || sameArticle.length === 1
        ? sameArticle
        : sameArticle.filter((item) => score(name, item.activity.title));
    for (const item of selected.length ? selected : sameArticle)
      events.set(item.eventId, item);
  }
  return [...events.values()];
}

const md = (text: string) => text.replace(/[\\[\]`*_<>]/g, "\\$&");
const clock = (point: CalendarItem["activity"]["startsAt"]) =>
  point?.at?.slice(0, 16).replace("T", " ") || point?.date;

export async function confirmedEnd(db: SqlDatabase, event: CalendarItem) {
  const { activity, sources } = event;
  if (activity.endsAt?.at) return activity.endsAt.at;
  const start = activity.startsAt;
  const raw = start?.raw.trim();
  if (
    !start?.at ||
    !raw ||
    start.evidence.field !== "body" ||
    start.evidence.sourceId
  )
    return null;
  const ends = new Set<string>();
  for (const source of sources) {
    const row = await db
      .prepare(
        `WITH candidate AS MATERIALIZED (
      SELECT d.id,d.title,d.body,d.body_format,d.body_status FROM knowledge_documents d
      WHERE d.id=? AND d.version=? AND (${calendarBodyAllowedSql()})
    ) SELECT * FROM candidate c WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=c.id)`,
      )
      .bind(source.documentId, source.version)
      .first<{
        title: string;
        body: string;
        body_format: "plain" | "reading_html";
        body_status: "complete" | "partial" | "not_provided";
      }>();
    if (!row) continue;
    const { text } = articleText({
      title: row.title,
      body: row.body,
      bodyFormat: row.body_format,
      bodyStatus: row.body_status,
    });
    const { startOffset, endOffset } = start.evidence;
    if (text.slice(startOffset, endOffset) !== raw) continue;
    const end =
      /^[ \t]*[-–—~～至到][ \t]*(\d{1,2})[:：]([0-5]\d)(?![\d:])/.exec(
        text.slice(endOffset),
      );
    if (!end || Number(end[1]) >= 24) continue;
    const at = `${start.date}T${end[1].padStart(2, "0")}:${end[2]}:00+08:00`;
    if (Date.parse(at) > Date.parse(start.at)) ends.add(at);
  }
  return ends.size === 1 ? [...ends][0] : null;
}

export async function retrieveCalendarComparison(
  db: SqlDatabase,
  plan: ComparisonPlan,
  tasks?: PersonalTask[],
) {
  const { pair: names, dates } = plan;
  const matches = await Promise.all(
    names.map((label, index) => {
      const key = calendarTitleKey(label);
      return tasks
        ? taskMatches(db, key, tasks)
        : publicMatches(db, key, dates[index] ?? undefined);
    }),
  );
  let sameDay = false;
  if (!tasks && dates.every((date) => !date)) {
    for (const [index, group] of matches.entries()) {
      const other = matches[1 - index];
      if (group.length < 2 || other.length !== 1) continue;
      const date = other[0].activity.startsAt?.date;
      const nearby = group.filter(
        (event) => date && event.dates.includes(date),
      );
      if (nearby.length === 1) {
        matches[index] = nearby;
        sameDay = true;
      }
    }
  }
  const ends = await Promise.all(
    matches.map((events) =>
      events.length === 1 ? confirmedEnd(db, events[0]) : null,
    ),
  );
  const state: CalendarComparisonState = {
    pair: names,
    dates: [
      dates[0] ??
        (matches[0].length === 1
          ? (matches[0][0].activity.startsAt?.date ?? null)
          : null),
      dates[1] ??
        (matches[1].length === 1
          ? (matches[1][0].activity.startsAt?.date ?? null)
          : null),
    ],
    pending: matches.flatMap((events, index) =>
      events.length > 1 ? [index] : [],
    ),
  };
  const subjects = matches.map((events, index) => ({
    title: names[index],
    requestedDate: dates[index],
    matches: events.map((event) =>
      calendarEvidence(event, events.length === 1 ? ends[index] : undefined),
    ),
  }));
  return { matches, ends, state, subjects, sameDay, personal: !!tasks };
}

export function renderCalendarComparison({
  matches,
  ends,
  sameDay,
  state,
  personal,
}: Awaited<ReturnType<typeof retrieveCalendarComparison>>) {
  const names = state.pair;
  const rows = matches.map((events, index) => {
    if (!events.length)
      return `- ${md(names[index])}：${personal ? "在你的待办里未能核实关联场次" : "未能核实公开活动场次"}。`;
    if (events.length > 1)
      return `- ${md(names[index])}：找到多个场次，请指定日期（${[...new Set(events.map((event) => event.activity.startsAt?.date).filter(Boolean))].join("、")}）。`;
    const { activity, sources } = events[0];
    const url = safeExternalUrl(sources[0]?.originalUrl);
    const title = md(activity.title);
    const end = ends[index];
    const endText =
      end &&
      (end.slice(0, 10) === activity.startsAt?.date
        ? end.slice(11, 16)
        : end.slice(0, 16).replace("T", " "));
    return `- ${url ? `[${title}](<${url}>)` : title}：${clock(activity.startsAt) ?? "开始时间未公布"}${endText ? ` 至 ${endText}` : "，结束时间未确认"}。`;
  });
  if (matches.some((group) => group.length !== 1))
    return `${rows.join("\n")}\n\n场次确认后才能判断是否冲突。`;
  const [a, b] = matches.map((group) => group[0]);
  if (a.eventId === b.eventId)
    return "两项名称指向同一个活动场次，请确认另一场活动的名称。";
  const starts = [a.activity.startsAt?.at, b.activity.startsAt?.at];
  let verdict = "现有时间信息不足，暂不能确认两场是否冲突。";
  if (starts[0] && starts[1]) {
    const time = [Date.parse(starts[0]), Date.parse(starts[1])];
    const earlier = time[0] <= time[1] ? 0 : 1;
    const early = earlier === 0 ? a : b;
    if (time[0] === time[1]) verdict = "两场活动同时开始，时间冲突。";
    else if (ends[earlier]) {
      verdict =
        Date.parse(ends[earlier]!) <= time[1 - earlier]
          ? "前一场结束后才开始后一场，时间不冲突。"
          : "后一场开始时前一场尚未结束，时间冲突。";
    } else
      verdict = `两场开始时间不同。${md(early.activity.title)}的结束时间未确认，暂不能确定是否冲突。`;
  }
  if (ends[0] && ends[1] && starts[0] && starts[1]) {
    const overlapMinutes =
      (Math.min(Date.parse(ends[0]), Date.parse(ends[1])) -
        Math.max(Date.parse(starts[0]), Date.parse(starts[1]))) /
      60_000;
    if (overlapMinutes > 0 && Number.isInteger(overlapMinutes))
      verdict += `重叠 ${overlapMinutes} 分钟。`;
  }
  return `${verdict}${sameDay ? "其中一项有多个场次，这里比较两项在同一天的场次。" : ""}\n\n${rows.join("\n")}`;
}

export function calendarComparisonStatus(
  result: Awaited<ReturnType<typeof retrieveCalendarComparison>>,
) {
  const counts = result.matches.map((group) => group.length);
  const retrievalStatus = counts.every((count) => count > 0)
    ? "matched"
    : counts.some((count) => count > 0)
      ? "partial"
      : "empty";
  if (counts.some((count) => count > 1))
    return { retrievalStatus, taskStatus: "needs_input" };
  const [a, b] = result.matches.map((group) => group[0]);
  if (!a || !b) return { retrievalStatus, taskStatus: "insufficient_evidence" };
  if (a.eventId === b.eventId)
    return { retrievalStatus, taskStatus: "needs_input" };
  const first = Date.parse(a.activity.startsAt?.at ?? "");
  const second = Date.parse(b.activity.startsAt?.at ?? "");
  const earlierEnd = result.ends[first <= second ? 0 : 1];
  return {
    retrievalStatus,
    taskStatus:
      Number.isFinite(first) &&
      Number.isFinite(second) &&
      (first === second ||
        (earlierEnd && Number.isFinite(Date.parse(earlierEnd))))
        ? "completed"
        : "insufficient_evidence",
  };
}

export async function runCalendarComparison(
  db: SqlDatabase,
  plan: ComparisonPlan,
  tasks?: PersonalTask[],
) {
  const result = await retrieveCalendarComparison(db, plan, tasks);
  return { ...result, text: renderCalendarComparison(result) };
}

function calendarEvidence(event: CalendarItem, end?: string | null) {
  return {
    eventId: event.eventId,
    title: event.activity.title,
    startsAt: clock(event.activity.startsAt),
    endsAt: end ?? clock(event.activity.endsAt),
    place: event.activity.placeRaw,
    sources: event.sources.map((source) => ({
      title: source.title,
      url: source.originalUrl,
    })),
  };
}

export async function compareCalendarPair(
  db: SqlDatabase,
  names: [string, string],
  tasks?: PersonalTask[],
) {
  return (
    await runCalendarComparison(db, { pair: names, dates: [null, null] }, tasks)
  ).text;
}

export async function runCalendarDate(
  db: SqlDatabase,
  title: string,
  date: string,
) {
  const events = await publicMatches(db, calendarTitleKey(title), date);
  const ends = await Promise.all(
    events.map((event) => confirmedEnd(db, event)),
  );
  const subjects = [
    {
      title,
      requestedDate: date,
      matches: events.map((event, index) =>
        calendarEvidence(event, ends[index]),
      ),
    },
  ];
  const text = events.length
    ? events
        .map((event, index) => {
          const start = clock(event.activity.startsAt);
          const end = ends[index];
          const url = safeExternalUrl(event.sources[0]?.originalUrl);
          const name = md(event.activity.title);
          return `- ${url ? `[${name}](<${url}>)` : name}：${start ?? date}${end ? ` 至 ${end.slice(11, 16)}` : "，结束时间未确认"}${event.activity.placeRaw ? `，${md(event.activity.placeRaw)}` : ""}。`;
        })
        .join("\n")
    : `未能核实「${md(title)}」在 ${date} 的公开场次。`;
  return { text, subjects, state: undefined };
}

export async function describeCalendarDate(
  db: SqlDatabase,
  title: string,
  date: string,
) {
  return (await runCalendarDate(db, title, date)).text;
}
