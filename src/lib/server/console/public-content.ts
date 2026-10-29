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
    cursor: z.string().max(500).optional(),
    grouped: z.literal("1").optional(),
    surface: z.enum(["radar", "knowledge"]).optional(),
    q: z.string().trim().max(100).optional(),
    source: z.string().trim().max(100).optional(),
    category: z.string().max(50).optional(),
  })
  .strict();
type PublicResult = {
  items: Record<string, unknown>[];
  groups?: Record<string, Record<string, unknown>[]>;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextCursor: string | null;
  counts: Record<string, number>;
  total: number;
};
const groupedResultCache = new WeakMap<
  object,
  Map<string, { expiresAt: number; result: PublicResult }>
>();
export function searchTerm(value: string) {
  // D1's LIKE rejects patterns above 50 bytes, and Chinese search terms exceed
  // that at fewer than 20 characters. Use instr() for a plain substring match
  // and cap the term only to keep the bound parameter reasonable.
  return value.slice(0, 300);
}

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
  let cacheKey: string | null = null;
  let cache:
    Map<string, { expiresAt: number; result: PublicResult }> | undefined;
  if (q.grouped && !q.q && !q.source) {
    const revision = await db
      .prepare(
        "SELECT public_visibility_revision AS revision FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<{ revision: number }>();
    cacheKey = q.surface + ":" + q.limit + ":" + (revision?.revision || 0);
    cache = groupedResultCache.get(cacheScope);
    if (!cache) {
      cache = new Map();
      groupedResultCache.set(cacheScope, cache);
    }
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      const fresh = new Map<string, number>();
      for (let i = 0; i < hit.result.items.length; i += 50) {
        const ids = hit.result.items.slice(i, i + 50).map((r) => r.id);
        const rows = await db
          .prepare(
            `WITH ids(id) AS (VALUES ${ids.map(() => "(?)").join(",")}) SELECT id,(SELECT version FROM console_public_documents p WHERE p.id=ids.id) AS version FROM ids`,
          )
          .bind(...ids)
          .all<{ id: string; version: number }>();
        for (const r of rows.results) fresh.set(r.id, r.version);
      }
      if (hit.result.items.every((r) => fresh.get(String(r.id)) === r.version))
        return hit.result;
      cache.delete(cacheKey);
    }
  }
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
  if (q.surface)
    where.push(
      q.surface === "radar"
        ? "a.primary_destination IN('radar','unknown')"
        : "a.primary_destination='knowledge'",
    );
  const category = q.category
    ? (() => {
        if (!q.surface)
          throw new ApiError("INVALID_ARGUMENT", "请指定内容页面。");
        return q.surface === "radar" && q.category === "unclassified"
          ? q.category
          : (q.surface === "radar"
              ? RadarCategorySchema
              : KnowledgeCategorySchema
            ).parse(q.category);
      })()
    : null;
  if (q.q) {
    where.push("instr(d.title, ?) > 0");
    params.push(searchTerm(q.q));
  }
  if (q.source) {
    where.push("instr(s.display_name, ?) > 0");
    params.push(searchTerm(q.source));
  }
  const base = `FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_article_classifications a ON a.document_id=d.id WHERE ${where.join(" AND ")} AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id)`;
  const categoryColumn =
    q.surface === "radar"
      ? "COALESCE(a.radar_category,'unclassified')"
      : "a.knowledge_category";
  const facets =
    q.surface && !q.id && !q.grouped
      ? await db
          .prepare(
            q.source
              ? `WITH matched_sources(id) AS MATERIALIZED (
                   SELECT id FROM knowledge_sources WHERE instr(display_name, ?) > 0
                 )
                 SELECT ${categoryColumn} AS category,count(*) AS n
                 FROM knowledge_documents d JOIN console_article_classifications a ON a.document_id=d.id
                 JOIN matched_sources m ON m.id=d.source_id
                 WHERE ${q.surface === "radar" ? "a.primary_destination IN('radar','unknown')" : "a.primary_destination='knowledge'"} AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id)
                   ${q.q ? "AND instr(d.title, ?) > 0" : ""}
                 GROUP BY ${categoryColumn}`
              : `SELECT ${categoryColumn} AS category,count(*) AS n ${base} GROUP BY ${categoryColumn}`,
          )
          .bind(
            ...(q.source
              ? [searchTerm(q.source), ...(q.q ? [searchTerm(q.q)] : [])]
              : params),
          )
          .all<{ category: string; n: number }>()
      : { results: [] };
  const counts: Record<string, number> = Object.fromEntries(
    facets.results.map((r) => [r.category, r.n]),
  );
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
  const from = `FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_article_classifications a ON a.document_id=d.id WHERE ${where.join(" AND ")} AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id)`;
  const projection =
    "d.id,d.version,d.title,d.url,d.published_at,d.updated_at,d.content_type,d.campus_scope,a.knowledge_category,a.radar_category,a.primary_destination,a.has_registration,a.classification_origin,d.body_format,d.rights_scope,s.id AS source_id,s.display_name,s.channel_type,s.official_status";
  const candidateBase = `FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_article_classifications a ON a.document_id=d.id WHERE ${where.join(" AND ")}`;
  const rows = q.grouped
    ? await db
        .prepare(
          `WITH candidates AS MATERIALIZED(SELECT ${projection},${categoryColumn} AS feed_category ${candidateBase}),visible AS MATERIALIZED(SELECT * FROM candidates c WHERE EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=c.id AND p.version=c.version)) SELECT * FROM (SELECT *,count(*) OVER(PARTITION BY feed_category) AS category_count,ROW_NUMBER() OVER(PARTITION BY feed_category ORDER BY published_at DESC,id) AS group_position FROM visible) WHERE group_position<=? ORDER BY feed_category,published_at DESC,id`,
        )
        .bind(...params, q.limit)
        .all<Record<string, string | number | null>>()
    : await db
        .prepare(
          `SELECT ${projection} ${from} ORDER BY d.published_at DESC,d.id LIMIT ? OFFSET ?`,
        )
        .bind(...params, q.id ? 1 : q.limit + 1, q.id ? 0 : q.offset)
        .all<Record<string, string | number | null>>();
  if (q.grouped)
    for (const row of rows.results)
      counts[String(row.feed_category)] = Number(row.category_count);
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
    primaryDestination: r.primary_destination,
    hasRegistration: r.has_registration === 1,
    classificationOrigin: r.classification_origin,
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
        const code =
          item.radarCategory || item.knowledgeCategory || "unclassified";
        if (code) (result[code] ||= []).push(item);
        return result;
      }, {})
    : undefined;
  if (q.id && !items.length)
    throw new ApiError("NOT_FOUND", "此内容尚未公开或已失效。");
  const result = {
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
  if (cacheKey && cache) {
    if (cache.size > 4) cache.clear();
    cache.set(cacheKey, { expiresAt: Date.now() + 30_000, result });
  }
  return result;
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
