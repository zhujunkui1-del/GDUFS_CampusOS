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
export function requestTimeWindow(
  query: string,
  now = Date.now(),
): TimeWindow | undefined {
  const today = chinaDay(now)!;
  const day = Date.parse(today + "T00:00:00Z");
  const at = (offset: number) =>
    new Date(day + offset * 86400000).toISOString().slice(0, 10);
  let range: [string, string] | undefined;
  if (/这一周|最近一周|过去一周|过去7天|最近7天/.test(query))
    range = [at(-6), today];
  else if (/本周|这周|下周/.test(query)) {
    const monday =
      -((new Date(day).getUTCDay() + 6) % 7) + (/下周/.test(query) ? 7 : 0);
    range = [at(monday), at(monday + 6)];
  } else if (
    /最近|近期/.test(query) &&
    /通知|公告|资讯|新闻|动态|消息/.test(query)
  ) {
    // "最近的校园通知" means a recent publication window, not an event window.
    range = [at(-29), today];
  } else if (/今天|今日/.test(query)) range = [today, today];
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
