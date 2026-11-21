import { requestTimeWindow } from "./time-window";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { addDays, chinaDate } from "@/lib/retrieval/calendar-dates";
import { readCalendar, type CalendarItem } from "../calendar/query";
import type { SqlDatabase } from "./database";

type Kind = "lecture" | "competition" | "activity";

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
  if (!asked || /^(?:如何|怎么|多少|可以|能|还|报名|参加|值得)/.test(asked)) return [];
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
  if (!/(?:什么|哪些|有没有|有无)/.test(subject)) return false;
  return /^(?:最近(?:时间段)?|近期|(?:未来|最近|近|接下来|往后|过去)\s*[一二三四五六七八九十百\d]+\s*天|[这本]周|[这下]?周|下周|[今明后]天|[今明]日|[下上]个?月|\d{1,2}月\d{1,2}[日号])/.test(
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
  const registration =
    /(?:还能|可以|正在|开放|可)报名|报名中/.test(subject) &&
    !/报名方式|报名要求|是否需要报名|报名条件|要不要报名/.test(subject);
  const today = chinaDate(now),
    range = requestTimeWindow(subject, now);
  // 「最近有什么讲座」 means the recent past as well as the coming days; an
  // upcoming-only window would hide last week's lecture.
  const recentLecture =
    !range && kind === "lecture" && /最近|近期/.test(subject);
  const date = range?.after ?? (recentLecture ? addDays(today, -14) : today),
    before = range?.before ?? addDays(today, registration ? 30 : 14);
  const result = await readCalendar(
    db,
    {
      after: date,
      before,
      timeRole: registration ? "registration" : "event",
      limit: 50,
    },
    new Date(now).toISOString(),
  );
  const scope = campus === "university" ? "university_town" : campus;
  const rows = result.items
    .filter((item) => item.activity.status !== "cancelled")
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
    .sort((a, b) =>
      (a.activity.startsAt?.at ?? a.activity.startsAt?.date ?? "").localeCompare(
        b.activity.startsAt?.at ?? b.activity.startsAt?.date ?? "",
      ),
    );
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
    : registration
      ? `还可以报名的${noun}`
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
        : item.registrationState === "not_started"
          ? " · 报名未开始"
          : item.registrationState === "closed"
            ? " · 报名已截止"
            : "";
    return `${index + 1}. ${activity.title} · ${span}${start.at ? ` ${start.at.slice(11, 16)}` : ""}${activity.placeRaw ? ` · ${activity.placeRaw}` : ""}${where ? ` · ${where}` : ""}${phase}${state} [${index + 1}]`;
  };
  const window = date === before ? date : `${date} 至 ${before}`;
  const scopeNote =
    scope && !inScope.length && elsewhere.length
      ? `活动日历中${CAMPUS_NAME[scope] ?? ""}没有找到，以下是其他校区或未注明校区的场次：\n`
      : "";
  const text = listed.length
    ? `${scopeNote}${listed.map(line).join("\n")}`
    : `已查活动日历 ${window}，没有找到${label}。`;
  return { text, cards, metrics: result.metrics };
}
