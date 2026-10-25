import type {
  ArticleActivitySchema,
  RegistrationWindow,
  ArticleTimePoint,
} from "@/domain/console/article-analysis";
import type { z } from "zod";
export type RegistrationNow =
  | "open"
  | "not_started"
  | "closed"
  | "not_required"
  | "unknown"
  | "capacity_unknown";
export function registrationWindowState(
  w: RegistrationWindow,
  now: string,
): RegistrationNow {
  const stamp = Date.parse(now),
    today = new Date(stamp + 8 * 3600000).toISOString().slice(0, 10);
  if (w.issues.length) return "unknown";
  const end = w.end;
  // Date-only on the cutoff day is uncertain: no fabricated end-of-day instant.
  if (
    end?.at
      ? w.deadlineSemantics === "before"
        ? stamp >= Date.parse(end.at)
        : stamp > Date.parse(end.at)
      : !!end?.date &&
        (end.date < today ||
          (end.date === today && w.deadlineSemantics === "before"))
  )
    return "closed";
  const start = w.start;
  if (
    start?.at
      ? Date.parse(start.at) > stamp
      : !!start?.date && start.date > today
  )
    return "not_started";
  if (w.capacityLimited) return "capacity_unknown";
  const started = start?.at
    ? Date.parse(start.at) <= stamp
    : !!start?.date && start.date < today;
  const beforeEnd = end?.at
    ? Date.parse(end.at) > stamp
    : !!end?.date && end.date > today;
  return started && beforeEnd ? "open" : "unknown";
}
export function registrationState(
  a: z.infer<typeof ArticleActivitySchema>,
  now: string,
): RegistrationNow {
  if (a.registrationStatus === "not_required") return "not_required";
  if (
    a.registrationStatus !== "required" ||
    ["cancelled", "postponed", "ended"].includes(a.status)
  )
    return a.status === "ended" ? "closed" : "unknown";
  const states = a.registrationWindows.map((w) =>
    registrationWindowState(w, now),
  );
  if (states.includes("open")) return "open";
  if (states.includes("capacity_unknown")) return "capacity_unknown";
  if (states.length && states.every((s) => s === "closed")) return "closed";
  if (states.length && states.every((s) => s === "not_started"))
    return "not_started";
  return "unknown";
}
export function timePast(p: ArticleTimePoint | null, now: string) {
  return (
    !!p &&
    (p.at
      ? Date.parse(p.at) < Date.parse(now)
      : !!p.date &&
        p.date <
          new Date(Date.parse(now) + 8 * 3600000).toISOString().slice(0, 10))
  );
}
