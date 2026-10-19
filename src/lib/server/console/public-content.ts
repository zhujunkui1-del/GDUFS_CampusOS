import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import {
  KnowledgeCategorySchema,
  RadarCategorySchema,
} from "@/domain/console/taxonomy";

const QuerySchema = z
  .object({
    id: ConsoleIdSchema.optional(),
    version: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
    offset: z.coerce.number().int().min(0).max(200).default(0),
    surface: z.enum(["radar", "knowledge"]).optional(),
    q: z.string().trim().max(100).optional(),
    source: z.string().trim().max(100).optional(),
    category: z.string().max(50).optional(),
  })
  .strict();
export async function readPublicContent(db: SqlDatabase, raw: unknown) {
  const q = QuerySchema.parse(raw);
  if (q.version && !q.id)
    throw new ApiError("INVALID_ARGUMENT", "请指定内容记录。");
  const where = ["(? IS NULL OR d.id=?)", "(? IS NULL OR d.version=?)"];
  const params: unknown[] = [
    q.id || null,
    q.id || null,
    q.version || null,
    q.version || null,
  ];
  const pattern = (v: string) => "%" + v.replace(/[\\%_]/g, "\\$&") + "%";
  if (q.surface)
    where.push(
      q.surface === "radar"
        ? "d.radar_category IS NOT NULL"
        : "d.knowledge_category IS NOT NULL",
    );
  if (q.category) {
    if (!q.surface) throw new ApiError("INVALID_ARGUMENT", "请指定内容页面。");
    const category = (
      q.surface === "radar" ? RadarCategorySchema : KnowledgeCategorySchema
    ).parse(q.category);
    where.push(
      q.surface === "radar" ? "d.radar_category=?" : "d.knowledge_category=?",
    );
    params.push(category);
  }
  if (q.q) {
    where.push("d.title LIKE ? ESCAPE '\\'");
    params.push(pattern(q.q));
  }
  if (q.source) {
    where.push("s.display_name LIKE ? ESCAPE '\\'");
    params.push(pattern(q.source));
  }
  const from = `FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${where.join(" AND ")}`;
  const rows = await db
    .prepare(
      `SELECT d.id,d.version,d.title,d.url,d.published_at,d.updated_at,d.summary,d.content_type,d.campus_scope,d.knowledge_category,d.radar_category,s.id AS source_id,s.display_name,s.channel_type,s.official_status ${from} ORDER BY d.published_at DESC,d.id LIMIT ? OFFSET ?`,
    )
    .bind(...params, q.id ? 1 : q.limit + 1, q.id ? 0 : q.offset)
    .all<Record<string, string | number | null>>();
  const items = rows.results.slice(0, q.id ? 1 : q.limit).map((r) => ({
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
  return {
    items,
    limit: q.id ? 1 : q.limit,
    offset: q.id ? 0 : q.offset,
    hasMore: !q.id && rows.results.length > q.limit,
  };
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
