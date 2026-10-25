import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArticleAnalysisSchema } from "@/domain/console/article-analysis";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import { RadarCategorySchema } from "@/domain/console/taxonomy";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { activityStatus } from "@/lib/ingestion/article-times";

export async function readPublicAnalysis(
  db: SqlDatabase,
  id: string,
  now = new Date().toISOString(),
) {
  ConsoleIdSchema.parse(id);
  const r = await db
    .prepare(
      `SELECT d.id,d.version,d.title,d.url,d.published_at,d.source_id,d.body_status,d.rights_scope,s.display_name,c.primary_destination,c.radar_category,c.knowledge_category,c.classification_origin,c.analysis_json
 FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_article_classifications c ON c.document_id=d.id WHERE d.id=?`,
    )
    .bind(id)
    .first<Record<string, string | number | null>>();
  if (!r) throw new ApiError("NOT_FOUND", "此文章尚未公开或已下架。");
  const stored = r.analysis_json
    ? ArticleAnalysisSchema.parse(JSON.parse(String(r.analysis_json)))
    : null;
  const analysis = stored
    ? {
        ...stored,
        primaryDestination: r.primary_destination,
        radarCategory: r.radar_category,
        knowledgeCategory: r.knowledge_category,
        activities: stored.activities.map((a) => ({
          ...a,
          status: activityStatus(a, now),
        })),
      }
    : null;
  return {
    documentId: r.id,
    version: r.version,
    title: r.title,
    originalUrl: r.url,
    publishedAt: r.published_at,
    source: { id: r.source_id, name: r.display_name },
    bodyAvailable:
      r.rights_scope === "licensed_full_text" && !!stored?.bodyAvailable,
    classificationOrigin: r.classification_origin,
    publicationStatus: "published",
    analysis,
  };
}
const ActivitiesQuerySchema = z
  .object({
    category: RadarCategorySchema.optional(),
    after: z.iso.date().optional(),
    before: z.iso.date().optional(),
    registration: z.literal("open").optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();
export async function readPublicActivities(
  db: SqlDatabase,
  raw: unknown,
  now = new Date().toISOString(),
) {
  const q = ActivitiesQuerySchema.parse(raw),
    conditions = [
      "a.kind<>'notice'",
      "x.content_revision=d.content_revision",
      "x.input_hash=d.input_hash",
    ],
    params: unknown[] = [];
  if (q.category) {
    conditions.push("a.category=?");
    params.push(q.category);
  }
  if (q.after) {
    conditions.push("a.starts_day>=?");
    params.push(q.after);
  }
  if (q.before) {
    conditions.push("a.starts_day<=?");
    params.push(q.before);
  }
  if (q.after && q.before && q.after > q.before)
    throw new ApiError("INVALID_ARGUMENT", "开始日期不能晚于结束日期。");
  if (q.registration) {
    conditions.push(
      "a.registration_requirement='required' AND EXISTS(SELECT 1 FROM article_registration_windows w WHERE w.document_id=a.document_id AND w.activity_key=a.activity_key AND w.starts_at IS NOT NULL AND w.ends_at IS NOT NULL AND julianday(w.starts_at)<=julianday(?) AND julianday(w.ends_at)>julianday(?))",
    );
    params.push(now, now);
  }
  const rows = await db
    .prepare(
      `SELECT a.document_id,a.activity_key,a.group_key FROM article_activity_index a JOIN knowledge_documents d ON d.id=a.document_id JOIN document_article_analysis x ON x.document_id=d.id WHERE ${conditions.join(" AND ")} AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=a.document_id) ORDER BY a.starts_day,a.document_id,a.activity_key LIMIT ?`,
    )
    .bind(...params, q.limit)
    .all<{
      document_id: string;
      activity_key: string;
      group_key: string | null;
    }>();
  const docs = new Map<
      string,
      Awaited<ReturnType<typeof readPublicAnalysis>>
    >(),
    groups = new Map<
      string,
      {
        activity: NonNullable<
          Awaited<ReturnType<typeof readPublicAnalysis>>["analysis"]
        >["activities"][number];
        sources: Awaited<ReturnType<typeof readPublicAnalysis>>[];
      }
    >();
  for (const r of rows.results) {
    let d = docs.get(r.document_id);
    if (!d) {
      try {
        d = await readPublicAnalysis(db, r.document_id, now);
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_FOUND") continue;
        throw e;
      }
      docs.set(r.document_id, d);
    }
    const a = d.analysis?.activities.find((a) => a.key === r.activity_key);
    if (!a || (["cancelled", "postponed"].includes(a.status) && q.registration))
      continue;
    const key = r.group_key || r.document_id + "/" + r.activity_key;
    const g = groups.get(key);
    if (g) g.sources.push(d);
    else groups.set(key, { activity: a, sources: [d] });
  }
  return {
    items: [...groups.values()],
    limit: q.limit,
    now,
    timeZone: "Asia/Shanghai",
    modelCalls: 0,
  };
}
function endpoint(kind: "analysis" | "activities") {
  return withApi(async (request) => {
    const env = getCloudflareContext().env as unknown as Record<
      string,
      unknown
    >;
    if (!env.DB)
      throw new ApiError("SERVICE_UNAVAILABLE", "内容服务暂不可用。");
    const limiter = env.MAP_RATE_LIMITER as
      { limit(v: { key: string }): Promise<{ success: boolean }> } | undefined;
    if (
      limiter &&
      !(
        await limiter.limit({
          key:
            "public-analysis:" +
            (request.headers.get("CF-Connecting-IP") || "local"),
        })
      ).success
    )
      throw new ApiError("RATE_LIMITED", "请求较频繁，请稍后重试。");
    const db = primaryDatabase(env.DB as SqlDatabase),
      raw = Object.fromEntries(new URL(request.url).searchParams);
    return kind === "analysis"
      ? readPublicAnalysis(
          db,
          z.object({ id: ConsoleIdSchema }).strict().parse(raw).id,
        )
      : readPublicActivities(db, raw);
  });
}
export const publicAnalysis = endpoint("analysis");
export const publicActivities = endpoint("activities");
