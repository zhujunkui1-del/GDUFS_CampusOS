import { describe, expect, it } from "vitest";
import {
  dateConflicts,
  dateConflictNote,
  statedDates,
} from "@/lib/retrieval/dates";

const article = [
  "✅ 比赛时间：2026年11月7日",
  "✅ 比赛地点：假草场",
  "⌛ 报名时间：11月7日24点前截止",
  "11月7日，信息学院第二十届院运会燃情启幕。",
].join("\n");

describe("stated dates", () => {
  it("tags each date with the fact its label binds", () => {
    const dates = statedDates(article);
    expect(dates.map((d) => d.monthDay)).toEqual(["11-07", "11-07", "11-07"]);
    expect(dates.map((d) => d.key)).toEqual(["time", "registration", "time"]);
    expect(dates[0].year).toBe("2026");
  });

  it("keeps a bare month-day date unresolved rather than inventing a year", () => {
    const [only] = statedDates("报名截止：11月7日");
    expect(only.year).toBeNull();
    expect(only.raw).toBe("11月7日");
  });
});

describe("date conflicts", () => {
  it("stays quiet when the same fact is written in two formats", () => {
    const text = "时间：2026年11月7日\n时间：2026.11.7 7:30-9:20";
    expect(dateConflicts(text)).toEqual([]);
  });

  it("does not call a deadline and a start time a conflict", () => {
    const text = [
      "报名时间：2026年10月29日截止",
      "比赛时间：2026年11月7日",
    ].join("\n");
    expect(dateConflicts(text)).toEqual([]);
  });

  it("reports two different dates bound to the same fact", () => {
    const text = ["比赛时间：2026年11月7日", "比赛时间：2026年11月17日"].join(
      "\n",
    );
    const conflicts = dateConflicts(text);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].raws).toContain("2026年11月7日");
    expect(conflicts[0].raws).toContain("2026年11月17日");
    expect(dateConflictNote(text)).toContain("请自行核对");
  });

  it("says nothing when the article is consistent", () => {
    expect(dateConflictNote(article)).toBe("");
  });
});
