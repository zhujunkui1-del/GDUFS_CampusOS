import type { EventCandidate } from "@/domain/console/ingestion";
// Explicit dates only. Relative/yearless expressions have no trusted anchor here.
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
// The English site stamps articles as "October 9, 2026"; every other
// template uses a numeric stamp.
function englishDate(raw: string) {
  const m = raw.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/i,
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

export function parseCampusTime(raw: string) {
  const m = raw.match(
    /(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})(?:(日)\s*|(\s+|T))?(?:(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?/,
  );
  if (!m) {
    const english = englishDate(raw);
    if (!english) {
      return { date: null, time: null, iso: null, precision: "unknown" as const };
    }
    const stamp = Date.parse(`${english}T00:00:00Z`);
    if (
      !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== english
    )
      return { date: null, time: null, iso: null, precision: "unknown" as const };
    return { date: english, time: null, iso: null, precision: "date" as const };
  }
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const stamp = Date.parse(date + "T00:00:00Z");
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== date ||
    (m[6] &&
      ((!m[4] && !m[5]) || +m[6] > 23 || +m[7] > 59 || +(m[8] || 0) > 59))
  )
    return { date: null, time: null, iso: null, precision: "unknown" as const };
  if (!m[6]) return { date, time: null, iso: null, precision: "date" as const };
  const time = `${m[6].padStart(2, "0")}:${m[7]}:${m[8] || "00"}`;
  return {
    date,
    time,
    iso: new Date(`${date}T${time}+08:00`).toISOString(),
    precision: "exact_time" as const,
  };
}

export function extractEvents(body: string): EventCandidate[] {
  const headings = [
    ...body.matchAll(/(?:活动名称|讲座题目|活动主题)[：:]\s*([^\n]{1,100})/g),
  ];
  return headings.slice(0, 3).map((m, i) => {
    const segment = body.slice(m.index, headings[i + 1]?.index || body.length);
    const field = (key: string) =>
      segment
        .match(new RegExp(`(?:${key})[：:]\\s*([^\\n]{1,150})`))?.[1]
        ?.trim() || null;
    const timeEvidence: NonNullable<EventCandidate["timeEvidence"]> = [];
    const exact = (
      fieldName: "startsAt" | "endsAt" | "registrationDeadline",
      key: string,
    ) => {
      const match = segment.match(
        new RegExp(`(?:${key})[：:]\\s*([^\\n]{1,150})`),
      );
      if (!match) return null;
      const rawText = match[1].trim();
      const startOffset =
        m.index! +
        match.index! +
        match[0].lastIndexOf(match[1]) +
        match[1].indexOf(rawText);
      const parsed = parseCampusTime(rawText);
      timeEvidence.push({
        field: fieldName,
        rawText,
        startOffset,
        endOffset: startOffset + rawText.length,
        date: parsed.date,
        time: parsed.time,
        precision: parsed.precision,
        inferred: false,
        verificationStatus: "pending",
      });
      return parsed.iso;
    };
    const link = field("报名链接");
    return {
      title: m[1].trim(),
      organizer: field("主办单位|主办方"),
      startsAt: exact("startsAt", "开始时间|活动时间|讲座时间"),
      endsAt: exact("endsAt", "结束时间"),
      registrationDeadline: exact(
        "registrationDeadline",
        "报名截止时间|报名截止",
      ),
      registrationUrl: link && /^https:\/\/[^\s]+$/.test(link) ? link : null,
      rawPlaceName: field("活动地点|讲座地点|地点"),
      campusScope: "unknown",
      audience: field("参与对象|面向对象"),
      changeStatus: /取消/.test(segment)
        ? "cancelled"
        : /延期|改期/.test(segment)
          ? "postponed"
          : "unknown",
      timeEvidence,
    };
  });
}
