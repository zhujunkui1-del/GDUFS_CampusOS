import type {
  ArticleAnalysis,
  ArticleTimePoint,
} from "@/domain/console/article-analysis";
import type { EvidenceHit } from "@/domain/retrieval/contracts";

/** Read-only completion of missing fields from <=780 chars already retrieved.
 * No HTML reads, year inference, classifier run, persisted update or date-role substitution. */
export function completeSnippetTimes(
  analysis: ArticleAnalysis | null,
  hit: EvidenceHit,
) {
  if (!analysis || analysis.activities.length !== 1 || !hit.bodyAvailable)
    return analysis;
  const a = analysis.activities[0];
  if (a.startsAt) return analysis;
  const m = hit.contentSnippet.match(
    /(?:定于|时间[：:]\s*)(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})(?:日?\s*(?:至|—|–|-)\s*(?:(\d{1,2})月)?(\d{1,2}))?日[^。\n]{0,70}/,
  );
  if (
    !m ||
    !/举办|举行|比赛|讲座|运动会|活动/.test(m[0]) ||
    /报名|截止|申请|提交/.test(m[0].slice(0, 20)) ||
    /日(?:之后|以后|起)|预计|左右/.test(m[0])
  )
    return analysis;
  const make = (month: string, day: string): ArticleTimePoint | null => {
    const date = `${m[1]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      return null;
    const start = hit.startOffset + m.index!;
    return {
      raw: m[0],
      date,
      at: null,
      timezone: "Asia/Shanghai",
      precision: "date",
      resolution: "day",
      inferred: false,
      inferenceBasis: null,
      evidence: {
        field: "body",
        startOffset: start,
        endOffset: start + m[0].length,
        text: m[0],
        role: "event_time",
      },
    };
  };
  const startsAt = make(m[2], m[3]),
    endsAt = m[5] ? make(m[4] || m[2], m[5]) : null;
  if (!startsAt || (endsAt && endsAt.date! < startsAt.date!)) return analysis;
  return {
    ...analysis,
    activities: [
      {
        ...a,
        startsAt,
        endsAt: a.endsAt || endsAt,
        evidence: [...a.evidence, startsAt.evidence].slice(0, 20),
      },
    ],
  };
}
