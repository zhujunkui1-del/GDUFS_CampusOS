import { requestTimeWindow } from "./time-window";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { addDays, chinaDate } from "@/lib/retrieval/calendar-dates";
import { readCalendar } from "../calendar/query";
import type { SqlDatabase } from "./database";

export async function upcomingLectures(
  db: SqlDatabase,
  question: string,
  campus?: "university" | "baiyun",
  now = Date.now(),
) {
  const subject = question
    .trim()
    .replace(/(?:大学城|白云山)(?:校区)?|学校|校园/g, "");
  const topic = subject.match(
    /^最近(?:有没有|有无|有)([\p{Script=Han}A-Za-z0-9]{2,20})相关的讲座[？?。]?$/u,
  )?.[1];
  const matchesTopic = (value: string) => {
    if (!topic) return true;
    const normalized = value.normalize("NFKC").toLowerCase();
    if (/^(?:AI|人工智能)$/i.test(topic))
      return /人工智能|\bai\b/i.test(normalized);
    return normalized.includes(topic.toLowerCase());
  };
  const kind = /讲座/.test(subject)
    ? "lecture"
    : /比赛|竞赛/.test(subject)
      ? "competition"
      : undefined;
  const registration =
    /^(?:最近|近期)(?:有)?(?:什么|哪些)(?:还)?(?:可以|可)报名的(?:讲座|比赛|竞赛|活动)[？?。]?$/.test(
      subject,
    );
  if (
    !registration &&
    !topic &&
    !/^(?:最近(?:时间段)?|近期|这周|本周|下周|今天|明天)(?:有)?(?:什么|哪些)(?:讲座|比赛|竞赛|活动)[？?。]?$/.test(
      subject,
    )
  )
    return;
  const today = chinaDate(now),
    range = requestTimeWindow(subject, now);
  const date = range?.after ?? today,
    before = range?.before ?? addDays(today, 14);
  const result = await readCalendar(
    db,
    {
      after: date,
      before,
      timeRole: registration ? "registration" : "event",
      ...(registration ? { registration: "open" as const } : {}),
      category: kind,
      campus: campus === "university" ? "university_town" : campus,
      limit: 50,
    },
    new Date(now).toISOString(),
  );
  const events = result.items
    .filter((item) => {
      if (
        item.activity.status === "cancelled" ||
        (registration && item.registrationState !== "open")
      )
        return false;
      if (
        topic &&
        ![
          item.activity.title,
          ...item.activity.evidence.map((e) => e.text),
          ...item.sources.map((s) => s.title),
        ].some((value) => matchesTopic(value))
      )
        return false;
      const start = item.activity.startsAt;
      return start?.at
        ? Date.parse(start.at) > now
        : !!start?.date && start.date > today;
    })
    .sort((a, b) =>
      (
        a.activity.startsAt?.at ||
        a.activity.startsAt?.date ||
        ""
      ).localeCompare(
        b.activity.startsAt?.at || b.activity.startsAt?.date || "",
      ),
    )
    .slice(0, 8);
  const cards: AssistantCard[] = events.map((item) => {
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
  return {
    text: events.length
      ? events
          .map((item, i) => {
            const a = item.activity,
              start = a.startsAt!;
            return `${i + 1}. ${a.title} · ${start.date}${start.at ? " " + start.at.slice(11, 16) : ""} · ${a.placeRaw || "地点未注明"} [${i + 1}]`;
          })
          .join("\n")
      : `已查活动日历中 ${date} 至 ${before} 的活动，暂未找到${topic ? "与「" + topic + "」相关且尚未开始的讲座" : "符合条件的场次"}。`,
    cards,
    metrics: result.metrics,
  };
}
