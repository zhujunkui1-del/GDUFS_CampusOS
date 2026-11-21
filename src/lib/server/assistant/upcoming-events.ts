import { requestTimeWindow } from "./time-window";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { addDays, chinaDate } from "@/lib/retrieval/calendar-dates";
import { readCalendar, type CalendarItem } from "../calendar/query";
import type { SqlDatabase } from "./database";

type Kind = "lecture" | "competition" | "activity";
type RegistrationMode =
  | "open"
  | "not_required"
  | "either"
  | "unknown"
  | "all"
  | "joinable"
  | "any";

// An event word alone is not enough: “《新利益法学》讲座现在还能参加吗” is an
// article lookup, so quoted titles stay out of the listing path.
const EVENT_WORD = /讲座|讲坛|论坛|沙龙|报告会|比赛|竞赛|大赛|活动/;
const KIND_OF: Record<Exclude<Kind, "activity">, RegExp> = {
  lecture: /讲座|讲坛|论坛|沙龙|报告会|宣讲/,
  competition: /比赛|竞赛|大赛|挑战杯|初赛|决赛|评审|选拔|赛区/,
};
const CAMPUS_NAME: Record<string, string> = {
  university_town: "大学城校区",
  baiyun: "白云山校区",
  online: "线上",
};

function kindOf(question: string): Kind | undefined {
  // 「讲座或比赛」 asks for either, so no single kind may filter the list.
  const lecture = /讲座/.test(question);
  const competition = /比赛|竞赛/.test(question);
  if (lecture && competition) return undefined;
  if (lecture) return "lecture";
  if (competition) return "competition";
  return undefined;
}

// Registration wording is a filter, not a keyword: "可以报名或不用报名" asks
// for both groups, while "报名要求不确定" asks for the unknown group.
function registrationModeOf(question: string): RegistrationMode {
  const unclear =
    /报名(?:要求|方式|条件).{0,8}(?:不确定|未知|不一定|不清楚)|不确定.{0,8}报名/.test(
      question,
    );
  if (unclear)
    return /也(?:列|算|包括)|都(?:列|要)/.test(question) ? "all" : "unknown";
  const noRegistration = /(?:不用|无需|不需要|免)报名|(?:不用|无需)预约/.test(
    question,
  );
  const registration =
    /(?:可以|能|开放|正在|还可|还能|可)报名|报名中|接受报名/.test(question);
  if (noRegistration && registration) return "either";
  if (noRegistration) return "not_required";
  if (registration) return "open";
  if (/不限报名|报名方式不限|不限方式|都可以|都行/.test(question)) return "any";
  if (/可以参加|能参加|想参加/.test(question)) return "joinable";
  if (/有什么活动|有哪些活动/.test(question)) return "all";
  return /报名/.test(question) ? "open" : "all";
}

function topicsOf(question: string): string[] {
  const raw =
    question.match(
      /(?:最近|近期)(?:有没有|有无|有)?([\p{Script=Han}A-Za-z0-9]{2,20}?)(?:相关)?的(?:讲座|活动|比赛|竞赛)/u,
    )?.[1] ||
    question.match(
      /([\p{Script=Han}A-Za-z0-9]{2,20}?)(?:相关)?的(?:讲座|活动|比赛|竞赛)/u,
    )?.[1];
  // “最近有什么讲座” and “最近有什么可以报名的活动” name no subject; the
  // grammar of the question is not a topic. The lazy capture swallows the
  // interrogative, so strip it before deciding whether a subject survived.
  if (!raw) return [];
  const asked = raw.replace(/^(?:有|哪些|哪几[个场条]|什么)/, "").replace(/相关$/, "");
  if (
    !asked ||
    /^(?:如何|怎么|多少|可以|能|还|值得)/.test(asked) ||
    /报名|参加|预约|方式|要求|不用|无需|需要/.test(asked)
  )
    return [];
  // A long sentence is a framed request, not a topic: “未来七天广外有没有适合
  // 计算机专业学生参加的活动，优先考虑人工智能、程序设计…” names several
  // subjects at once. Any of them is a match, so the whole sentence is scanned
  // rather than the first clause.
  if (asked.length > 12) {
    const known = TOPICS.filter((topic) => question.includes(topic));
    return known.length ? known : [];
  }
  return [asked];
}

// The subject vocabulary the calendar actually carries. A long request that
// names one of these is asking about that subject.
const TOPICS = ["人工智能", "AI", "计算机", "程序设计", "创新创业", "就业", "招聘", "科研"];

function matchesTopic(topics: string[], values: string[]) {
  if (!topics.length) return true;
  const text = values.join("\n").normalize("NFKC").toLowerCase();
  return topics.some((topic) => {
    if (/^(?:AI|人工智能)$/i.test(topic)) return /人工智能|\bai\b/i.test(text);
    return text.includes(topic.toLowerCase());
  });
}

function askedForEvents(question: string) {
  const subject = question.replace(/[？?。!！]/g, "");
  if (!EVENT_WORD.test(subject)) return false;
  if (/[《》「」“”"]/.test(subject)) return false;
  if (!/(?:什么|哪些|有没有|有无|其他|别的|还有)/.test(subject)) return false;
  return /^(?:最近(?:时间段)?|近期|(?:未来|最近|近|接下来|往后|过去)\s*[一二三四五六七八九十百\d]+\s*天|[这本]周|[这下]?周|下周|[今明后]天|[今明]日|[下上]个?月|\d{1,2}月\d{1,2}[日号]|还有(?:其他|别的)?|其他|别的)/.test(
    subject
      .replace(/^(?:(?:帮我|请|麻烦|我想|我想问|想|要|能|可以|说说|看看|查一下|查查|找一下|找找|了解一下|告诉我)[，,]?\s*)+/, "")
      .replace(/(?:大学城|白云山)(?:校区)?|[南北]校区?|学校|校园|广外/g, ""),
  );
}

function campusOf(item: CalendarItem) {
  return item.activity.calendar?.campus ?? "";
}

export async function upcomingEvents(
  db: SqlDatabase,
  question: string,
  campus?: "university" | "baiyun",
  now = Date.now(),
) {
  if (!askedForEvents(question)) return undefined;
  const subject = question
    .replace(/[？?。!！]/g, "")
    .replace(/(?:大学城|白云山)(?:校区)?|[南北]校区?|学校|校园/g, "");
  const kind = kindOf(subject);
  const topics = topicsOf(subject);
  // 「是否需要报名以及报名方式」 asks *about* registration, not for events
  // that are open for registration. Only the latter narrows the window.
  const registrationMode = registrationModeOf(subject);
  const registrationQuery =
    registrationMode === "open" || registrationMode === "either";
  const today = chinaDate(now),
    range = requestTimeWindow(subject, now);
  // 「最近有什么讲座」 means the recent past as well as the coming days; an
  // upcoming-only window would hide last week's lecture.
  const recentLecture =
    !range && kind === "lecture" && /最近|近期/.test(subject);
  const date = range?.after ?? (recentLecture ? addDays(today, -14) : today),
    before =
      range?.before ??
      addDays(today, recentLecture ? 14 : registrationQuery ? 30 : 14);
  const read = (timeRole: "event" | "registration") =>
    readCalendar(
      db,
      {
        after: date,
        before,
        timeRole,
        limit: 50,
      },
      new Date(now).toISOString(),
    );
  const eventResult = await read("event");
  // A registration deadline can fall inside the window while the event itself
  // starts after it. Read that index too, otherwise "报名中但下月举办" is
  // silently excluded by the event-date window.
  const registrationResult = registrationQuery
    ? await read("registration")
    : undefined;
  const merged = new Map<string, CalendarItem>();
  const identity = (item: CalendarItem) =>
    `${item.sources[0]?.documentId || item.eventId}|${item.activity.title}|${item.activity.startsAt?.date ?? ""}`;
  for (const item of [
    ...eventResult.items,
    ...(registrationResult?.items ?? []),
  ]) {
    if (!merged.has(identity(item))) merged.set(identity(item), item);
  }
  const scope = campus === "university" ? "university_town" : campus;
  const rows = [...merged.values()]
    .filter((item) => item.activity.status !== "cancelled")
    // A suspension notice, a call for papers and a review stage are not
    // activities a reader can attend, even when the extractor dated them.
    .filter(
      (item) =>
        !/停课|征文|征稿|启事|评审阶段|公示|名单/.test(item.activity.title) &&
        !/^关于(?:公布|发布|印发|公示).{0,60}(?:通知|名单|结果|公示)$/.test(
          item.activity.title,
        ),
    )
    .filter((item) =>
      matchesTopic(topics, [
        item.activity.title,
        item.activity.placeRaw ?? "",
        ...item.activity.evidence.map((e) => e.text),
        ...item.sources.map((s) => s.title),
      ]),
    )
    .filter((item) => {
      const start = item.activity.startsAt;
      if (!start) return false;
      // An event that is still running today is still an option; only one
      // that has already ended is dropped. "最近有什么讲座" explicitly asks
      // about the recent past too, so a lecture held inside that window stays
      // in the list and is labelled as already held.
      const recentFloor = recentLecture ? date : today;
      const endAt = item.activity.endsAt?.at;
      if (endAt) {
        const endDay = chinaDate(Date.parse(endAt));
        return Date.parse(endAt) > now || (recentLecture && endDay >= recentFloor);
      }
      if (start.at)
        return (
          Date.parse(start.at) > now ||
          (recentLecture && !!start.date && start.date >= recentFloor)
        );
      const lastDay = item.activity.endsAt?.date ?? start.date;
      return !!lastDay && lastDay >= recentFloor;
    })
    .filter((item) => {
      const state = item.registrationState;
      switch (registrationMode) {
        case "open":
          return state === "open";
        case "not_required":
          return state === "not_required";
        case "either":
          return state === "open" || state === "not_required";
        case "unknown":
          return state === "unknown" || state === "capacity_unknown";
        case "all":
          return true;
        case "joinable":
          // "可以参加" includes walk-ins and unknowns, but a closed
          // registration is not something the reader can still join.
          return state !== "closed";
        default:
          return true;
      }
    })
    .sort((a, b) =>
      (a.activity.startsAt?.at ?? a.activity.startsAt?.date ?? "").localeCompare(
        b.activity.startsAt?.at ?? b.activity.startsAt?.date ?? "",
      ),
    )
    // One event can be indexed twice: the announcement and the rules notice
    // carry the same start time and venue. Keep the first, but leave date-only
    // rows alone because two different all-day items may share a venue.
    .filter((item, index, all) => {
      const at = item.activity.startsAt?.at;
      if (!at) return true;
      const place = item.activity.placeRaw ?? "";
      return (
        all.findIndex(
          (other) =>
            other.activity.startsAt?.at === at &&
            (other.activity.placeRaw ?? "") === place,
        ) === index
      );
    });
  // Source categories mislabel real events (a contest filed as a notice), so
  // the title decides and a mismatch falls back to every match instead of
  // hiding the answer.
  // A call for papers shares the "论坛/讲座" vocabulary but is a submission
  // notice, not something to attend. A forum preview is likewise not a
  // lecture when the question asks specifically for 讲座.
  const lectureOnly =
    kind === "lecture" && /讲座/.test(question) && !/论坛|会议/.test(question);
  const relevant = lectureOnly
    ? rows.filter(
        (row) =>
          !/征文|征稿|启事/.test(row.activity.title) &&
          !/论坛|研讨会|会议预告|宣讲/.test(row.activity.title),
      )
    : kind === "lecture"
      ? rows.filter((row) => !/征文|征稿|启事/.test(row.activity.title))
      : rows;
  const typed =
    kind && kind !== "activity"
      ? relevant.filter((row) => KIND_OF[kind].test(row.activity.title))
      : relevant;
  const chosen = typed.length
    ? typed
    : lectureOnly
      ? []
      : relevant;
  const inScope = scope
    ? chosen.filter((row) => campusOf(row) === scope)
    : chosen;
  const elsewhere = inScope.length
    ? []
    : chosen.filter((row) => campusOf(row) && campusOf(row) !== scope);
  const listed = (inScope.length ? inScope : elsewhere).slice(0, 8);
  const noun = kind === "lecture" ? "讲座" : kind === "competition" ? "比赛" : "活动";
  const label = topics.length
    ? `与「${topics.join("、")}」相关的${noun}`
    : registrationMode === "open"
      ? `还可以报名的${noun}`
      : registrationMode === "not_required"
        ? `无需报名的${noun}`
        : registrationMode === "either"
          ? `可以报名或无需报名的${noun}`
          : registrationMode === "unknown"
            ? `报名要求未注明的${noun}`
            : noun;
  const cards: AssistantCard[] = listed.map((item) => {
    const source = item.sources[0];
    return {
      kind: "source",
      documentId: source.documentId,
      title: source.title.slice(0, 250),
      sourceName: source.source.name,
      originalUrl: source.originalUrl,
      publishedAt: source.publishedAt,
      snippet: "",
      evidenceType: "metadata",
      classificationState:
        source.classificationState === "knowledge" ? "knowledge" : "radar",
      validity: "current",
      readable: source.bodyAvailable,
      calendarLinks: [
        { title: item.activity.title.slice(0, 250), href: item.calendarUrl },
      ],
    };
  });
  const line = (item: CalendarItem, index: number) => {
    const activity = item.activity,
      start = activity.startsAt!;
    const where = CAMPUS_NAME[campusOf(item)] ?? "";
    const place = (activity.placeRaw ?? "").replace(/^【[^】]*】/, "").trim();
    const placeHasCampus = !!where && place.includes(where);
    const endDate = activity.endsAt?.date;
    const startDay = start.date ?? (start.at ? start.at.slice(0, 10) : today);
    const span = endDate && endDate !== startDay ? `${startDay} 至 ${endDate}` : startDay;
    const phase = item.historical
      ? " · 已举办"
      : startDay < today && (!endDate || endDate >= today)
        ? " · 进行中"
        : "";
    const state =
      item.registrationState === "open"
        ? " · 报名中"
        : item.registrationState === "not_required"
          ? " · 无需报名"
          : item.registrationState === "not_started"
            ? " · 报名未开始"
            : item.registrationState === "closed"
              ? " · 报名已截止"
              : item.registrationState === "capacity_unknown"
                ? " · 名额情况未注明"
                : " · 报名要求未注明";
    return `${index + 1}. ${activity.title} · ${span}${start.at ? ` ${start.at.slice(11, 16)}` : ""}${place ? ` · ${place}` : " · 地点未注明"}${where && !placeHasCampus ? ` · ${where}` : ""}${phase}${state} [${index + 1}]`;
  };
  const window = date === before ? date : `${date} 至 ${before}`;
  const scopeNote =
    scope && !inScope.length && elsewhere.length
      ? `活动日历中${CAMPUS_NAME[scope] ?? ""}没有找到，以下是其他校区或未注明校区的场次：\n`
      : "";
  const openCount = chosen.filter((item) => item.registrationState === "open").length;
  const walkInCount = chosen.filter(
    (item) => item.registrationState === "not_required",
  ).length;
  const groupNote =
    registrationMode !== "either" || !listed.length
      ? ""
      : openCount && walkInCount
        ? "以下包括正在报名和无需报名的活动。\n"
        : openCount
          ? "以下为正在报名的活动；本轮没有找到确认无需报名的活动。\n"
          : walkInCount
            ? "以下为确认无需报名的活动；本轮没有找到正在开放报名的活动。\n"
            : "";
  const text = listed.length
    ? `${scopeNote}${groupNote}${listed.map(line).join("\n")}`
    : `已查活动日历 ${window}，没有找到${label}。活动日历只收录通过结构化校验的活动，部分招募公告可能尚未进入日历；这不代表学校没有此类活动。`;
  const metrics = {
    rowsRead:
      eventResult.metrics.rowsRead + (registrationResult?.metrics.rowsRead ?? 0),
    rowsWritten: 0,
    queries:
      eventResult.metrics.queries + (registrationResult?.metrics.queries ?? 0),
    durationMs:
      eventResult.metrics.durationMs +
      (registrationResult?.metrics.durationMs ?? 0),
    usageAvailable:
      eventResult.metrics.usageAvailable &&
      (registrationResult?.metrics.usageAvailable ?? true),
  };
  return { text, cards, metrics };
}
