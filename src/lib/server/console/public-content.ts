import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";

const QuerySchema = z
  .object({
    id: ConsoleIdSchema.optional(),
    version: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
    offset: z.coerce.number().int().min(0).max(200).default(0),
  })
  .strict();
export async function readPublicContent(db: SqlDatabase, raw: unknown) {
  const q = QuerySchema.parse(raw);
  if (q.version && !q.id)
    throw new ApiError("INVALID_ARGUMENT", "请指定内容记录。");
  const rows = await db
    .prepare(
      `SELECT d.id,d.version,d.title,d.url,d.published_at,d.updated_at,d.summary,d.content_type,d.campus_scope,d.knowledge_category,d.radar_category,s.id AS source_id,s.display_name,s.channel_type,s.official_status FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE (? IS NULL OR d.id=?) AND (? IS NULL OR d.version=?) ORDER BY d.updated_at DESC,d.id LIMIT ? OFFSET ?`,
    )
    .bind(
      q.id || null,
      q.id || null,
      q.version || null,
      q.version || null,
      q.id ? 1 : q.limit,
      q.id ? 0 : q.offset,
    )
    .all<Record<string, string | number | null>>();
  const items = rows.results.map((r) => ({
    id: r.id,
    version: r.version,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    summary: r.summary,
    contentType: r.content_type,
    campusScope: r.campus_scope,
    knowledgeCategory: r.knowledge_category,
    radarCategory: r.radar_category,
    source: {
      id: r.source_id,
      name: r.display_name,
      type: r.channel_type,
      official: r.official_status === "verified_official",
    },
  }));
  if (q.id && !items.length)
    throw new ApiError("NOT_FOUND", "此内容尚未公开或已失效。");
  return { items, limit: q.id ? 1 : q.limit, offset: q.id ? 0 : q.offset };
}
export const publicContent = withApi(async (request) => {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "内容服务暂不可用。");
  }
  if (!env.DB) throw new ApiError("SERVICE_UNAVAILABLE", "内容服务暂不可用。");
  const limiter = env.MAP_RATE_LIMITER as
    { limit(args: { key: string }): Promise<{ success: boolean }> } | undefined;
  if (
    limiter &&
    !(
      await limiter.limit({
        key:
          "public-content:" +
          (request.headers.get("CF-Connecting-IP") || "local"),
      })
    ).success
  )
    throw new ApiError("RATE_LIMITED", "请求较频繁，请稍后重试。");
  return readPublicContent(
    primaryDatabase(env.DB as SqlDatabase),
    Object.fromEntries(new URL(request.url).searchParams),
  );
});
