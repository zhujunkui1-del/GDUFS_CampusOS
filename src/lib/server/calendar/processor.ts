import { calendarBodyAllowedSql } from "./content-scope";
import type { SqlDatabase } from "../assistant/database";
import type {
  ArticleAnalysis,
  ArticleAnalysisInput,
} from "@/domain/console/article-analysis";
import {
  calendarInput,
  calendarizeArticle,
} from "@/lib/ingestion/calendar-extraction";
import { analysisStatements } from "../console/article-analysis";
import { enrichCalendar, type CalendarAI } from "./enrichment";
export async function reserveCalendarModel(
  db: SqlDatabase,
  now = new Date().toISOString(),
) {
  const day = now.slice(0, 10);
  const r = await db
    .prepare(
      "UPDATE console_engine_settings SET calendar_ai_day=?,calendar_ai_calls=CASE WHEN calendar_ai_day=? THEN calendar_ai_calls+1 ELSE 1 END WHERE id='console-v2-settings' AND (calendar_ai_day IS NULL OR calendar_ai_day<>? OR calendar_ai_calls<40)",
    )
    .bind(day, day, day)
    .run();
  return (r.meta?.changes || 0) > 0;
}
export async function runCalendarBatch(db: SqlDatabase, ai?: CalendarAI) {
  const result = {
    processed: 0,
    accepted: 0,
    modelCalls: 0,
    ocrCalls: 0,
    failures: 0,
  };
  const budget = await db
    .prepare(
      "SELECT calendar_ai_day AS day,calendar_ai_calls AS calls FROM console_engine_settings WHERE id='console-v2-settings'",
    )
    .first<{ day: string | null; calls: number }>();
  const canEnrich =
    !!ai &&
    (budget?.day !== new Date().toISOString().slice(0, 10) ||
      (budget?.calls || 0) < 40);
  const candidates = await db
    .prepare(
      `SELECT x.document_id,x.content_revision,x.input_hash,x.calendar_status FROM document_article_analysis x WHERE x.calendar_status ${canEnrich ? "IN('pending','needs_enrichment')" : "='pending'"} AND x.calendar_attempts IN(0,1,2) AND x.calendar_lease_until_ms<? ORDER BY x.calendar_status,x.calendar_attempts,x.calendar_lease_until_ms,x.document_id LIMIT 2`,
    )
    .bind(Date.now())
    .all<{
      document_id: string;
      content_revision: number;
      input_hash: string;
      calendar_status: string;
    }>();
  for (const c of candidates.results) {
    const claim = await db
      .prepare(
        "UPDATE document_article_analysis SET calendar_lease_until_ms=? WHERE document_id=? AND input_hash=? AND content_revision=? AND calendar_lease_until_ms<?",
      )
      .bind(
        Date.now() + 300000,
        c.document_id,
        c.input_hash,
        c.content_revision,
        Date.now(),
      )
      .run();
    if (!claim.meta?.changes) continue;
    try {
      const d = await db
        .prepare(
          `WITH candidate AS MATERIALIZED (SELECT d.id,CASE WHEN ${calendarBodyAllowedSql()} THEN 1 ELSE 0 END AS body_allowed,d.title,CASE WHEN ${calendarBodyAllowedSql()} THEN d.body ELSE '' END AS body,d.body_format,d.body_status,d.published_at,d.url,d.source_id,s.display_name,x.analysis_json FROM knowledge_documents d JOIN document_article_analysis x ON x.document_id=d.id JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=? AND d.input_hash=? AND d.content_revision=?) SELECT v.* FROM candidate v WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=v.id)`,
        )
        .bind(c.document_id, c.input_hash, c.content_revision)
        .first<Record<string, string> & { body_allowed: number }>();
      if (!d || !d.body_allowed) {
        await db
          .prepare(
            "UPDATE document_article_analysis SET calendar_lease_until_ms=? WHERE document_id=? AND input_hash=? AND content_revision=?",
          )
          .bind(
            Date.now() + 3600000,
            c.document_id,
            c.input_hash,
            c.content_revision,
          )
          .run();
        continue;
      }
      const base = JSON.parse(d.analysis_json) as ArticleAnalysis;
      let input: ArticleAnalysisInput = calendarInput({
        documentId: c.document_id,
        title: d.title,
        body: d.body,
        bodyFormat: d.body_format === "reading_html" ? "reading_html" : "plain",
        bodyStatus: d.body_status as "complete",
        publishedAt: d.published_at,
        originalUrl: d.url,
        sourceId: d.source_id,
        sourceName: d.display_name,
        calendarSources: base.calendar?.sources || [],
      });
      let a = calendarizeArticle(input, base);
      if (c.calendar_status === "needs_enrichment" && ai && canEnrich) {
        const enriched = await enrichCalendar(input, base, ai, () =>
          reserveCalendarModel(db),
        );
        input = enriched.input;
        a = enriched.analysis;
        result.modelCalls += enriched.metrics.modelCalls;
        result.ocrCalls += enriched.metrics.ocrCalls;
        result.failures += enriched.metrics.failures.length;
      }
      await db.batch(
        await analysisStatements(
          db,
          c.document_id,
          c.content_revision,
          c.input_hash,
          input,
          a,
        ),
      );
      result.processed++;
      if (a.calendar?.status === "accepted") result.accepted++;
    } catch {
      result.failures++;
      // A thrown step is usually a transient fault (a lost lease, a D1
      // hiccup), not a verdict about the article. Parking the row on the
      // second failure made one bad minute permanent, so it takes three
      // consecutive failures before the row is given up on.
      await db
        .prepare(
          "UPDATE document_article_analysis SET calendar_attempts=calendar_attempts+1,calendar_lease_until_ms=0,calendar_status=CASE WHEN calendar_attempts+1>=3 THEN 'excluded' ELSE 'needs_enrichment' END WHERE document_id=? AND input_hash=? AND content_revision=?",
        )
        .bind(c.document_id, c.input_hash, c.content_revision)
        .run();
    }
  }
  return result;
}
