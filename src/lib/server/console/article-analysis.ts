import {
  ARTICLE_CLASSIFIER_VERSION,
  type ArticleAnalysis,
  type ArticleAnalysisInput,
} from "@/domain/console/article-analysis";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import { articleText } from "@/lib/ingestion/article-text";
import type { SqlDatabase } from "../assistant/database";
import { tokenHash } from "../assistant/crypto";
import { validateArticleAnalysis } from "@/lib/ingestion/article-validation";
import { retrievalIndexStatements } from "../retrieval/indexer";
import {
  calendarInput,
  calendarizeArticle,
} from "@/lib/ingestion/calendar-extraction";
import { calendarIdentity } from "@/lib/ingestion/calendar-identity";

export async function analysisStatements(
  db: SqlDatabase,
  id: string,
  revision: number,
  inputHash: string,
  input: ArticleAnalysisInput,
  provided?: ArticleAnalysis,
  rights?: string,
) {
  input = calendarInput(input);
  const analysis = validateArticleAnalysis(
      input,
      provided
        ? provided.calendar
          ? provided
          : calendarizeArticle(input, provided)
        : analyzeArticle(input),
    ),
    canonical = articleText(input);
  const inputDigest = await tokenHash(
    JSON.stringify([
      canonical.title,
      canonical.text,
      input.bodyStatus,
      input.publishedAt,
      input.originalUrl,
    ]),
  );
  const projection = JSON.stringify(analysis),
    projectionHash = await tokenHash(projection),
    stamp = new Date().toISOString();
  const guard =
    "EXISTS(SELECT 1 FROM document_article_analysis a JOIN knowledge_documents d ON d.id=a.document_id AND d.input_hash=a.input_hash AND d.content_revision=a.content_revision WHERE a.document_id=? AND a.projection_hash=? AND a.processed_at=?)";
  const args = [id, projectionHash, stamp];
  const activityRows = await Promise.all(
    analysis.activities.map(async (a) => ({
      ...a,
      identity: await calendarIdentity(a, id, input.sourceName),
    })),
  );
  return [
    db
      .prepare(
        `INSERT INTO document_article_analysis(document_id,content_revision,input_hash,classifier_version,input_digest,projection_hash,processed_at,primary_destination,radar_category,knowledge_category,has_registration,college,event_type,event_start,event_end,analysis_json,calendar_version,calendar_status,calendar_attempts)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM knowledge_documents d WHERE d.id=? AND d.content_revision=? AND d.input_hash=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
      ON CONFLICT(document_id) DO UPDATE SET content_revision=excluded.content_revision,input_hash=excluded.input_hash,classifier_version=excluded.classifier_version,input_digest=excluded.input_digest,projection_hash=excluded.projection_hash,processed_at=excluded.processed_at,primary_destination=excluded.primary_destination,radar_category=excluded.radar_category,knowledge_category=excluded.knowledge_category,has_registration=excluded.has_registration,college=excluded.college,event_type=excluded.event_type,event_start=excluded.event_start,event_end=excluded.event_end,analysis_json=excluded.analysis_json
      ,calendar_version=excluded.calendar_version,calendar_status=excluded.calendar_status,calendar_attempts=excluded.calendar_attempts,calendar_lease_until_ms=0
      WHERE document_article_analysis.content_revision<>excluded.content_revision OR document_article_analysis.input_hash<>excluded.input_hash OR document_article_analysis.classifier_version<>excluded.classifier_version OR document_article_analysis.projection_hash<>excluded.projection_hash`,
      )
      .bind(
        id,
        revision,
        inputHash,
        ARTICLE_CLASSIFIER_VERSION,
        inputDigest,
        projectionHash,
        stamp,
        analysis.primaryDestination,
        analysis.radarCategory,
        analysis.knowledgeCategory,
        Number(analysis.hasRegistration),
        analysis.college || "",
        analysis.eventType || "",
        analysis.eventStart || null,
        analysis.eventEnd || null,
        projection,
        analysis.calendar?.version || "",
        analysis.calendar?.status || "pending",
        analysis.calendar?.attempts || 0,
        id,
        revision,
        inputHash,
      ),
    db
      .prepare(
        `DELETE FROM article_activity_index WHERE document_id=? AND ${guard}`,
      )
      .bind(id, ...args),
    db
      .prepare(
        `INSERT INTO article_activity_index(document_id,activity_key,title,kind,category,starts_day,starts_at,ends_day,ends_at,place_raw,registration_requirement,group_key,calendar_eligible,calendar_version,campus_scope,activity_json)
     SELECT ?,json_extract(value,'$.key'),json_extract(value,'$.title'),json_extract(value,'$.kind'),json_extract(value,'$.category'),json_extract(value,'$.startsAt.date'),json_extract(value,'$.startsAt.at'),json_extract(value,'$.endsAt.date'),json_extract(value,'$.endsAt.at'),json_extract(value,'$.placeRaw'),json_extract(value,'$.registrationStatus'),
     json_extract(value,'$.identity'),COALESCE(json_extract(value,'$.calendar.eligible'),0),?,COALESCE(json_extract(value,'$.calendar.campus'),'unknown'),json_remove(value,'$.identity')
     FROM json_each(?) WHERE ${guard}`,
      )
      .bind(
        id,
        analysis.calendar?.version || "",
        JSON.stringify(activityRows),
        ...args,
      ),
    db
      .prepare(
        `INSERT INTO article_registration_windows(document_id,activity_key,ordinal,starts_day,starts_at,ends_day,ends_at)
     SELECT ?,json_extract(e.value,'$.key'),w.key,json_extract(w.value,'$.start.date'),json_extract(w.value,'$.start.at'),json_extract(w.value,'$.end.date'),json_extract(w.value,'$.end.at')
     FROM json_each(?,'$.activities') e,json_each(e.value,'$.registrationWindows') w WHERE ${guard}`,
      )
      .bind(id, projection, ...args),
    db
      .prepare(
        `INSERT OR IGNORE INTO document_tags(document_id,content_revision,tag) SELECT ?,?,value FROM json_each(?,'$.tags') WHERE ${guard} LIMIT max(0,12-(SELECT count(*) FROM document_tags WHERE document_id=? AND content_revision=?))`,
      )
      .bind(id, revision, projection, ...args, id, revision),
    ...(rights
      ? await retrievalIndexStatements(
          db,
          id,
          revision,
          inputHash,
          input,
          rights,
        )
      : []),
  ];
}

/** One point lookup; a current version never re-reads/parses a body. */
export async function ensureArticleAnalysis(db: SqlDatabase, id: string) {
  const d = await db
    .prepare(
      `SELECT d.id,d.content_revision,d.input_hash,d.title,d.body,d.body_format,d.body_status,d.source_id,d.url,d.published_at,d.content_type,d.rights_scope,s.display_name
   FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
   WHERE d.id=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND d.input_hash IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM document_article_analysis a WHERE a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash AND a.classifier_version=?)`,
    )
    .bind(id, ARTICLE_CLASSIFIER_VERSION)
    .first<Record<string, string | number | null>>();
  if (!d) return false;
  const input: ArticleAnalysisInput = {
    documentId: id,
    title: String(d.title),
    body: String(d.body),
    bodyFormat: d.body_format === "reading_html" ? "reading_html" : "plain",
    bodyStatus: d.body_status as "complete",
    sourceId: String(d.source_id),
    sourceName: String(d.display_name),
    originalUrl: String(d.url),
    publishedAt: d.published_at ? String(d.published_at) : null,
  };
  await db.batch(
    await analysisStatements(
      db,
      id,
      Number(d.content_revision),
      String(d.input_hash),
      input,
      undefined,
      String(d.rights_scope),
    ),
  );
  return true;
}
