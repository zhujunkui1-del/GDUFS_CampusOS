/** Dates are facts people act on. A retrieved passage often states the same
 * moment twice ("2026年11月7日" and "11.7"), but occasionally two statements
 * disagree ("11月7日" next to "11月17日"). Silently picking one turns a source
 * contradiction into our claim, so the disagreement is surfaced instead. */
const DATE_LITERAL =
  /(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?|(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g;
const LABEL =
  /(?:比赛|活动|举办|开幕(?:式)?|报名截止|报名)?\s*时间\s*[：:]?\s*$/;

/** Which fact a nearby label binds the date to. Two dates that answer different
 * questions (when to sign up vs when it starts) are not a contradiction. */
export type DateKey = "deadline" | "registration" | "time";

const LABEL_KEYS: Array<[RegExp, DateKey]> = [
  [/报名截止|截止/, "deadline"],
  [/报名/, "registration"],
];

export const DATE_KEY_LABEL: Record<DateKey, string> = {
  deadline: "报名截止",
  registration: "报名时间",
  time: "举办/活动时间",
};

export type StatedDate = {
  key: DateKey;
  raw: string;
  /** Month and day as written; a year is only set when the source states one. */
  monthDay: string;
  year: string | null;
};

function keyFor(label: string): DateKey {
  for (const [pattern, key] of LABEL_KEYS) if (pattern.test(label)) return key;
  return "time";
}

/** Every dated statement in the text, tagged with the fact it binds to. */
export function statedDates(text: string): StatedDate[] {
  const out: StatedDate[] = [];
  for (const match of text.matchAll(DATE_LITERAL)) {
    const at = match.index ?? 0;
    const label = text.slice(Math.max(0, at - 24), at).match(LABEL)?.[0] ?? "";
    const year = match[1] ? Number(match[1]) : null;
    const month = match[2] ? Number(match[2]) : Number(match[4]);
    const day = match[3] ? Number(match[3]) : Number(match[5]);
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) continue;
    out.push({
      key: keyFor(label),
      raw: match[0].replace(/\s+/g, ""),
      monthDay: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      year: year && year >= 1990 && year <= 2100 ? String(year) : null,
    });
  }
  return out;
}

/** Only disagreements about the same fact are reported; near-duplicate formats
 * ("2026年11月7日" / "11.7") collapse to one month and day and stay quiet. */
export function dateConflicts(text: string) {
  const byKey = new Map<
    DateKey,
    Map<string, { days: Set<string>; years: Set<string>; raws: Set<string> }>
  >();
  for (const date of statedDates(text)) {
    const bucket = byKey.get(date.key) ?? new Map();
    const entry = bucket.get(date.monthDay) ?? {
      days: new Set<string>(),
      years: new Set<string>(),
      raws: new Set<string>(),
    };
    entry.days.add(date.monthDay);
    if (date.year) entry.years.add(date.year);
    entry.raws.add(date.raw);
    bucket.set(date.monthDay, entry);
    byKey.set(date.key, bucket);
  }
  return [...byKey.entries()]
    .filter(([, bucket]) => bucket.size > 1)
    .map(([key, bucket]) => ({
      key,
      label: DATE_KEY_LABEL[key],
      raws: [...bucket.values()].flatMap((entry) => [...entry.raws]),
    }));
}

/** One sentence for an answer body, or empty when the source agrees with itself. */
export function dateConflictNote(text: string) {
  const conflicts = dateConflicts(text);
  if (!conflicts.length) return "";
  return `⚠️ 原文对同一件事给出了不同日期（${conflicts
    .map((c) => `${c.label}：${c.raws.join(" / ")}`)
    .join("；")}），按原文并列，请自行核对。`;
}
