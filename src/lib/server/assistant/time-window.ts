/** Trusted request constraints. Publication dates never establish when an event happened. */
export type TimeWindow = {
  after: string;
  before: string;
  role: "publication" | "event" | "registration";
  timezone: "Asia/Shanghai";
};
export function chinaDay(value: string | number | Date): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms)
    ? new Date(ms + 28800000).toISOString().slice(0, 10)
    : null;
}
const MONTH_DAY_RANGE =
  /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:到|至|~|～|—|-)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?|(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:到|至|~|～|—|-)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/;
const ISO_RANGE =
  /(\d{4}-\d{2}-\d{2})\s*(?:到|至|~|～|—)\s*(\d{4}-\d{2}-\d{2})/;

/** A written date range ("11月10号到11月22号") is a constraint the user gave,
 * never a keyword an article must contain. The year is taken from the source
 * when stated, otherwise the current year; a range that has already passed
 *, but that the user asks to attend ("可以参加"), rolls forward one year. */
export function dateRangeIn(
  query: string,
  today: string,
): { after: string; before: string } | null {
  const iso = ISO_RANGE.exec(query);
  if (iso && iso[1] <= iso[2]) return { after: iso[1], before: iso[2] };
  const m = MONTH_DAY_RANGE.exec(query);
  if (!m) return null;
  const year = m[1] ? Number(m[1]) : Number(today.slice(0, 4));
  const fromMonth = m[1] ? Number(m[2]) : Number(m[6]);
  const fromDay = m[1] ? Number(m[3]) : Number(m[7]);
  const toMonth = m[1] ? Number(m[4]) : Number(m[8]);
  const toDay = m[1] ? Number(m[5]) : Number(m[9]);
  if (![fromMonth, toMonth].every((x) => x >= 1 && x <= 12)) return null;
  if (![fromDay, toDay].every((x) => x >= 1 && x <= 31)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const build = (y: number) => ({
    after: `${y}-${pad(fromMonth)}-${pad(fromDay)}`,
    before: `${y}-${pad(toMonth)}-${pad(toDay)}`,
  });
  let range = build(year);
  if (range.before < range.after) return null;
  if (range.before < today && !m[1]) {
    // Wait for next year only when the same months have not happened yet.
    const next = build(year + 1);
    if (next.after >= today) range = next;
    else return null;
  }
  return range;
}

/** Time words are constraints, not subjects: an article never contains
 * “最近两周” or “11月10号到11月22号”. Strip them before lexical retrieval. */
export function stripTimeRange(query: string): string {
  return query
    .replace(ISO_RANGE, " ")
    .replace(MONTH_DAY_RANGE, " ")
    .replace(
      /最近一两周|最近两周|近两周|这两周|未来两周|接下来两周|过去两周|前两周|最近一周|这一周|过去一周|过去7天|最近7天|本周|这周|下周|下个月|今天|今日|明天|明日|后天|近半个月|半个月/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function requestTimeWindow(
  query: string,
  now = Date.now(),
): TimeWindow | undefined {
  const today = chinaDay(now)!;
  const day = Date.parse(today + "T00:00:00Z");
  const at = (offset: number) =>
    new Date(day + offset * 86400000).toISOString().slice(0, 10);
  let range: [string, string] | undefined;
  const explicit = dateRangeIn(query, today);
  if (explicit) range = [explicit.after, explicit.before];
  else if (/这一周|最近一周|过去一周|过去7天|最近7天/.test(query))
    range = [at(-6), today];
  else if (/最近一两周|最近两周|近两周|这两周|未来两周|接下来两周/.test(query))
    // “最近两周可以去参加的活动” is an upcoming-attendance window; a past
    // publication window would answer with activities that already ended.
    range = /通知|公告|资讯|新闻|动态|消息/.test(query)
      ? [at(-13), today]
      : [today, at(14)];
  else if (/过去两周|前两周/.test(query)) range = [at(-13), today];
  else if (/本周|这周|下周/.test(query)) {
    const monday =
      -((new Date(day).getUTCDay() + 6) % 7) + (/下周/.test(query) ? 7 : 0);
    range = [at(monday), at(monday + 6)];
  } else if (
    /最近|近期/.test(query) &&
    /通知|公告|资讯|新闻|动态|消息/.test(query)
  ) {
    // "最近的校园通知" means a recent publication window, not an event window.
    // Event discovery ("最近有什么竞赛/讲座") intentionally has no hard window:
    // the category is sorted by published_at DESC, then older items follow.
    range = [at(-29), today];
  } else if (/最近|近期/.test(query) && /报名|申请/.test(query)) {
    // "最近可报名的讲座" is a registration window: upcoming/open items, not a
    // publication window. Plain "最近有什么竞赛/讲座" stays windowless so it can
    // return the newest published items even when the event itself is over.
    range = [today, at(30)];
  } else if (/今天|今日/.test(query)) range = [today, today];
  else if (/明天|明日/.test(query)) range = [at(1), at(1)];
  else if (/下个月/.test(query)) {
    const d = new Date(day);
    range = [
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 10),
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))
        .toISOString()
        .slice(0, 10),
    ];
  }
  if (!range) return;
  // 讲座/活动/竞赛是「事件」，不是「资讯」：它们的日期应按活动发生日过滤，
  // 不能因为出现在「最近」句里就把整条查询降级成发布日期窗口。
  const news =
    /趣事|有趣|新闻|动态|分享|通知|公告|资讯|消息|发生.{0,10}(?:事|什么)/.test(
      query,
    );
  if (news && range[1] > today && !/下周|下个月/.test(query)) range[1] = today;
  return {
    after: range[0],
    before: range[1],
    role: news
      ? "publication"
      : /报名|申请.*截止/.test(query)
        ? "registration"
        : "event",
    timezone: "Asia/Shanghai",
  };
}
export function withinWindow(publishedAt: string | null, window: TimeWindow) {
  const day = publishedAt && chinaDay(publishedAt);
  return !!day && day >= window.after && day <= window.before;
}
