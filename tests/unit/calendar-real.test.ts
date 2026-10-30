import { it, expect } from "vitest";
import corpus from "../fixtures/calendar-real-articles.json";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
it.each(corpus.cases)(
  "real source event date roles: $id",
  ({ input, expected }) => {
    const a = analyzeArticle(input).activities.filter(
      (a) => a.calendar?.eligible,
    );
    expect(a.map((x) => x.startsAt?.date)).toEqual(expected.dates);
    if (expected.end) expect(a[0].endsAt?.date).toBe(expected.end);
    if (expected.time)
      expect(a[0].startsAt?.at?.slice(11, 16)).toBe(expected.time);
  },
);
