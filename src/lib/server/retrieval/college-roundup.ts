// Enumeration queries need breadth, not top-k.
//
// "院运会" / "还有别的学院的院运会吗" asks which colleges hold one. A top-k
// lexical search answers with whatever three chunks happen to score best, which
// is why one college can be missing entirely even though its notice is in D1.
// The facets written by the ingestion pipeline (college + event_type + dates)
// let us ask that question directly in SQL, then hand the candidate ids to the
// normal retriever so authority checks still apply.
import { activityNounQuery } from "@/lib/retrieval/query-focus";
import { COLLEGE_NAMES } from "@/lib/retrieval/colleges";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";
import { EVENT_KINDS, eventKindOf } from "@/lib/ingestion/article-college";
import type { SqlDatabase } from "../assistant/database";

// Words that fence a list rather than narrow it: "还有别的学院的院运会吗"
// is still the same question as "院运会".
const ENUMERATION = new Set([
  "学院",
  "别的",
  "其他",
  "还有",
  "哪些",
  "哪个",
  "什么",
  "有",
  "吗",
  "呢",
  "的",
]);

/**
 * Whether the question is a roll call across colleges rather than a lookup.
 *
 * Two things disqualify it: naming a college (that is a specific lookup), and
 * carrying a real subject besides the activity ("人工智能讲座" is not a list of
 * every college's lectures). Enumeration words are not subjects.
 */
function isRollCall(query: string, kind: string): boolean {
  if (COLLEGE_NAMES.some((name) => query.includes(name))) return false;
  return buildQueryPlan(query).modifiers.every(
    (m) => ENUMERATION.has(m.original) || eventKindOf(m.original) === kind,
  );
}

/**
 * One document per college, notice-like rows first.
 */
export async function collegeRoundupIds(
  db: SqlDatabase,
  query: string,
  now = new Date().toISOString(),
): Promise<string[]> {
  if (!activityNounQuery(query)) return [];
  const kind = eventKindOf(query);
  if (!kind || !isRollCall(query, kind)) return [];
  const pattern = EVENT_KINDS.find((k) => k.code === kind)?.pattern;
  const recent = new Date(Date.parse(now) + 8 * 3600000 - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  // The index carries derived facets only; publication status, rights and
  // tombstoning are still re-checked by currentPublicArticles() downstream. The
  // revision/input_hash join keeps a stale analysis from speaking for a
  // document that has since been re-collected.
  //
  // A recap often states no date in the body, so its event_start is null and it
  // would drop out of the list entirely. Those rows are kept as a fallback —
  // but only when the title itself names the activity, because a recap's
  // nearest neighbours are alumni features and week-in-review posts that
  // merely mention the same ground.
  const r = await db
    .prepare(
      `SELECT a.college,a.document_id,a.event_start,d.title,
        COALESCE(a.event_start,substr(d.published_at,1,10)) AS recent
   FROM document_article_analysis a JOIN knowledge_documents d ON d.id=a.document_id AND d.content_revision=a.content_revision AND d.input_hash=a.input_hash
   WHERE a.event_type=? AND a.college<>'' AND COALESCE(a.event_start,substr(d.published_at,1,10))>=?
    AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
   ORDER BY (a.event_start IS NULL),recent DESC LIMIT 200`,
    )
    .bind(kind, recent)
    .all<{
      document_id: string;
      college: string;
      title: string;
      event_start: string | null;
    }>();
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const row of r.results) {
    if (row.event_start === null && pattern && !pattern.test(row.title))
      continue;
    if (seen.has(row.college)) continue;
    seen.add(row.college);
    picked.push(row.document_id);
    if (picked.length >= 24) break;
  }
  return picked;
}
