import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import {
  KnowledgeCategorySchema,
  knowledgeCategories,
  RadarCategorySchema,
  radarCategories,
} from "@/domain/console/taxonomy";

const QuerySchema = z
  .object({
    id: ConsoleIdSchema.optional(),
    version: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
    offset: z.coerce.number().int().min(0).max(200).default(0),
    cursor: z.string().max(500).optional(),
    grouped: z.literal("1").optional(),
    surface: z.enum(["radar", "knowledge"]).optional(),
    q: z.string().trim().max(100).optional(),
    source: z.string().trim().max(100).optional(),
    category: z.string().max(50).optional(),
  })
  .strict();
const groupedCountsCache = new WeakMap<
  object,
  Map<string, { expiresAt: number; counts: Record<string, number> }>
>();
export async function readPublicContent(
  db: SqlDatabase,
  raw: unknown,
  cacheScope: object = db,
) {
  const q = QuerySchema.parse(raw);
  if (q.version && !q.id)
    throw new ApiError("INVALID_ARGUMENT", "请指定内容记录。");
  if (q.grouped && (!q.surface || q.id || q.category || q.cursor || q.offset))
    throw new ApiError("INVALID_ARGUMENT", "分组列表参数无效。");
  const where = ["1=1"];
  const params: unknown[] = [];
  if (q.id) {
    where.push("d.id=?");
    params.push(q.id);
  }
  if (q.version) {
    where.push("d.version=?");
    params.push(q.version);
  }
  const pattern = (v: string) => "%" + v.replace(/[\\%_]/g, "\\$&") + "%";
  if (q.surface)
    where.push(
      q.surface === "radar"
        ? "d.radar_category IS NOT NULL"
        : "d.knowledge_category IS NOT NULL AND d.radar_category IS NULL",
    );
  const category = q.category
    ? (() => {
        if (!q.surface)
          throw new ApiError("INVALID_ARGUMENT", "请指定内容页面。");
        return (
          q.surface === "radar" ? RadarCategorySchema : KnowledgeCategorySchema
        ).parse(q.category);
      })()
    : null;
  if (q.q) {
    where.push("d.title LIKE ? ESCAPE '\\'");
    params.push(pattern(q.q));
  }
  if (q.source) {
    where.push("s.display_name LIKE ? ESCAPE '\\'");
    params.push(pattern(q.source));
  }
  const base = `FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${where.join(" AND ")}`;
  const categoryColumn =
    q.surface === "radar" ? "d.radar_category" : "d.knowledge_category";
  const groupColumn =
    q.surface === "radar" ? "radar_category" : "knowledge_category";
  let cachedGroupedCounts: Record<string, number> | null = null;
  if (q.grouped && q.surface && !q.q && !q.source) {
    const revision = await db
      .prepare(
        "SELECT public_visibility_revision AS revision FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<{ revision: number }>();
    const cacheKey = q.surface + ":" + (revision?.revision || 0);
    let cache = groupedCountsCache.get(cacheScope);
    if (!cache) {
      cache = new Map();
      groupedCountsCache.set(cacheScope, cache);
    }
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      cachedGroupedCounts = cached.counts;
    } else {
      const condition =
        q.surface === "radar"
          ? "d.radar_category IS NOT NULL"
          : "d.knowledge_category IS NOT NULL AND d.radar_category IS NULL";
      const result = await db
        .prepare(
          `SELECT ${categoryColumn} AS category,count(*) AS n
           FROM console_public_documents d WHERE ${condition}
           GROUP BY ${categoryColumn}`,
        )
        .all<{ category: string; n: number }>();
      cachedGroupedCounts = Object.fromEntries(
        result.results.map((row) => [row.category, row.n]),
      );
      if (cache.size > 4) cache.clear();
      cache.set(cacheKey, {
        expiresAt: Date.now() + 30_000,
        counts: cachedGroupedCounts,
      });
    }
  }
  const facets =
    q.surface && !q.id && !q.grouped
      ? await db
          .prepare(
            q.source
              ? `WITH matched_sources(id) AS MATERIALIZED (
                   SELECT id FROM knowledge_sources WHERE display_name LIKE ? ESCAPE '\\'
                 )
                 SELECT ${categoryColumn} AS category,count(*) AS n
                 FROM console_public_documents d
                 JOIN matched_sources m ON m.id=d.source_id
                 WHERE ${q.surface === "radar" ? "d.radar_category IS NOT NULL" : "d.knowledge_category IS NOT NULL AND d.radar_category IS NULL"}
                   ${q.q ? "AND d.title LIKE ? ESCAPE '\\'" : ""}
                 GROUP BY ${categoryColumn}`
              : `SELECT ${categoryColumn} AS category,count(*) AS n ${base} GROUP BY ${categoryColumn}`,
          )
          .bind(
            ...(q.source
              ? [pattern(q.source), ...(q.q ? [pattern(q.q)] : [])]
              : params),
          )
          .all<{ category: string; n: number }>()
      : { results: [] };
  const counts: Record<string, number> = Object.fromEntries(
    facets.results.map((r) => [r.category, r.n]),
  );
  if (cachedGroupedCounts) Object.assign(counts, cachedGroupedCounts);
  if (category) {
    where.push(categoryColumn + "=?");
    params.push(category);
  }
  if (q.cursor) {
    if (q.id || q.offset)
      throw new ApiError("INVALID_ARGUMENT", "分页参数冲突。");
    let cursor: [string | null, string];
    try {
      cursor = z
        .tuple([z.string().max(100).nullable(), ConsoleIdSchema])
        .parse(JSON.parse(atob(q.cursor)));
    } catch {
      throw new ApiError("INVALID_ARGUMENT", "分页位置无效。");
    }
    if (cursor[0] === null) {
      where.push("d.published_at IS NULL AND d.id>?");
      params.push(cursor[1]);
    } else {
      where.push(
        "(d.published_at<? OR (d.published_at=? AND d.id>?) OR d.published_at IS NULL)",
      );
      params.push(cursor[0], cursor[0], cursor[1]);
    }
  }
  const from = `FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${where.join(" AND ")}`;
  const projection =
    "d.id,d.version,d.title,d.url,d.published_at,d.updated_at,d.content_type,d.campus_scope,d.knowledge_category,d.radar_category,d.body_format,d.rights_scope,s.id AS source_id,s.display_name,s.channel_type,s.official_status";
  const rows =
    q.grouped && q.surface && !q.q && !q.source
      ? {
          results: (
            await Promise.all(
              (q.surface === "radar" ? radarCategories : knowledgeCategories)
                .filter((entry) => (cachedGroupedCounts?.[entry.code] || 0) > 0)
                .map(async (entry) => {
                  const condition =
                    q.surface === "radar"
                      ? "d.radar_category IS NOT NULL"
                      : "d.knowledge_category IS NOT NULL AND d.radar_category IS NULL";
                  return (
                    await db
                      .prepare(
                        `SELECT ${projection} FROM console_public_documents d
                       JOIN knowledge_sources s ON s.id=d.source_id
                       WHERE ${condition} AND d.${groupColumn}=?
                       ORDER BY d.published_at DESC,d.id LIMIT ?`,
                      )
                      .bind(entry.code, q.limit)
                      .all<Record<string, string | number | null>>()
                  ).results;
                }),
            )
          ).flat(),
        }
      : q.grouped
        ? await db
            .prepare(
              `SELECT * FROM (SELECT ${projection},count(*) OVER(PARTITION BY d.${groupColumn}) AS category_count,ROW_NUMBER() OVER(PARTITION BY d.${groupColumn} ORDER BY d.published_at DESC,d.id) AS group_position ${base}) WHERE group_position<=? ORDER BY ${groupColumn},published_at DESC,id`,
            )
            .bind(...params, q.limit)
            .all<Record<string, string | number | null>>()
        : await db
            .prepare(
              `SELECT ${projection} ${from} ORDER BY d.published_at DESC,d.id LIMIT ? OFFSET ?`,
            )
            .bind(...params, q.id ? 1 : q.limit + 1, q.id ? 0 : q.offset)
            .all<Record<string, string | number | null>>();
  if (q.grouped && (q.q || q.source))
    for (const row of rows.results)
      counts[String(row[groupColumn])] = Number(row.category_count);
  const total = Object.values(counts).reduce((n, count) => n + count, 0);
  const selectedRows = q.id
    ? rows.results.slice(0, 1)
    : q.grouped
      ? rows.results
      : rows.results.slice(0, q.limit);
  const items = selectedRows.map((r) => ({
    id: r.id,
    version: r.version,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    contentType: r.content_type,
    campusScope: r.campus_scope,
    knowledgeCategory: r.knowledge_category,
    radarCategory: r.radar_category,
    readable:
      r.body_format === "reading_html" &&
      r.rights_scope === "licensed_full_text",
    source: {
      id: r.source_id,
      name: r.display_name,
      type: r.channel_type,
      official: r.official_status === "verified_official",
    },
  }));
  const groups = q.grouped
    ? items.reduce<Record<string, typeof items>>((result, item) => {
        const code = item.radarCategory || item.knowledgeCategory;
        if (code) (result[code] ||= []).push(item);
        return result;
      }, {})
    : undefined;
  if (q.id && !items.length)
    throw new ApiError("NOT_FOUND", "此内容尚未公开或已失效。");
  return {
    items,
    groups,
    limit: q.id ? 1 : q.limit,
    offset: q.id ? 0 : q.offset,
    hasMore: q.grouped
      ? Object.values(counts).some((count) => count > q.limit)
      : !q.id && rows.results.length > q.limit,
    nextCursor:
      !q.grouped && !q.id && rows.results.length > q.limit && items.length
        ? btoa(JSON.stringify([items.at(-1)!.publishedAt, items.at(-1)!.id]))
        : null,
    counts,
    total,
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
    env.DB as object,
  );
});
