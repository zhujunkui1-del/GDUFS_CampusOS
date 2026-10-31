import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArticleAnalysisSchema } from "@/domain/console/article-analysis";
import { ConsoleIdSchema } from "@/domain/console/contracts";
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
        calendar: stored.calendar
          ? { ...stored.calendar, sources: [] }
          : undefined,
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
export { readCalendar as readPublicActivities } from "../calendar/query";
import { readCalendar as readPublicActivities } from "../calendar/query";
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
