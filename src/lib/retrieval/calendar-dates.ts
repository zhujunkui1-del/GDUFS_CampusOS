import { z } from "zod";
export const CalendarDateSchema = z.iso
  .date()
  .refine(
    (d) =>
      Number.isFinite(Date.parse(d + "T00:00:00Z")) &&
      new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d,
    "无效日期",
  );
export const chinaDate = (now = Date.now()) =>
  new Date(now + 28800000).toISOString().slice(0, 10);
export function addDays(day: string, n: number) {
  CalendarDateSchema.parse(day);
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function weekOf(day: string) {
  const w = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;
  const first = addDays(day, -w);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}
export function intervalDays(
  start: string,
  end: string,
  after = start,
  before = end,
) {
  CalendarDateSchema.parse(start);
  CalendarDateSchema.parse(end);
  const n = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (n < 0 || n > 366) throw Error("活动日期区间无效");
  const from = start > after ? start : after,
    to = end < before ? end : before,
    result: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    result.push(day);
    if (result.length > 367) throw Error("日期区间过大");
  }
  return result;
}
export function occurrenceTime(
  day: string,
  a: {
    startsAt: { date: string | null; at: string | null } | null;
    endsAt: { date: string | null; at: string | null } | null;
  },
) {
  const start =
      a.startsAt?.date === day ? a.startsAt.at?.slice(11, 16) || null : null,
    end = a.endsAt?.date === day ? a.endsAt.at?.slice(11, 16) || null : null;
  return { startTime: start, endTime: end };
}
