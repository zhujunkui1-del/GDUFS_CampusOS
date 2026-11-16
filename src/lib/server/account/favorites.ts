import { z } from "zod";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import { CALENDAR_VERSION } from "@/domain/calendar/extraction";
import { calendarBodyAllowedSql } from "../calendar/content-scope";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";

export const FavoriteSurfaceSchema = z.enum(["radar", "knowledge", "calendar"]);
export type FavoriteSurface = z.infer<typeof FavoriteSurfaceSchema>;

export const FavoriteQuerySchema = z
  .object({
    surface: z.enum(["all", "radar", "knowledge", "calendar"]).default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const FavoriteStatusSchema = z
  .object({
    articleIds: z.array(ConsoleIdSchema).max(100),
  })
  .strict();

const AddFavoriteSchema = z
  .object({ originSurface: FavoriteSurfaceSchema })
  .strict();

export type FavoriteItem = {
  articleId: string;
  favoriteId: string;
  originSurface: FavoriteSurface;
  surfaces: FavoriteSurface[];
  createdAt: string;
  available: boolean;
  readable: boolean;
  title: string;
  url: string;
  publishedAt: string | null;
  version: number;
  sourceName: string;
};

type FavoriteRow = {
  id: string;
  article_id: string;
  origin_surface: string;
  created_at_ms: number;
  title: string | null;
  url: string | null;
  published_at: string | null;
  version: number | null;
  display_name: string | null;
  available: number;
  readable: number;
  radar: number;
  knowledge: number;
  calendar: number;
};

const favoriteMemberships = `
  WITH saved AS MATERIALIZED (
    SELECT f.*,d.title,d.url,d.published_at,d.version,d.content_revision,d.input_hash,
      d.source_id,d.body_format,d.rights_scope,s.display_name
    FROM user_article_favorites f
    LEFT JOIN knowledge_documents d ON d.id=f.article_id
    LEFT JOIN knowledge_sources s ON s.id=d.source_id WHERE f.user_id=?
  ), visible AS MATERIALIZED (
    SELECT d.*,
      EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.article_id AND p.version=d.version) AS available,
      (SELECT c.primary_destination FROM console_article_classifications c WHERE c.document_id=d.article_id) AS destination
    FROM saved d
  ), memberships AS MATERIALIZED (
    SELECT d.*,
      CASE WHEN d.available AND d.body_format='reading_html' AND d.rights_scope='licensed_full_text' THEN 1 ELSE 0 END AS readable,
      CASE WHEN d.available AND (d.destination IN('radar','unknown')
        OR EXISTS(SELECT 1 FROM campus_article_hotspots h WHERE h.document_id=d.article_id)) THEN 1 ELSE 0 END AS radar,
      CASE WHEN d.available AND d.destination='knowledge' THEN 1 ELSE 0 END AS knowledge,
      CASE WHEN d.available AND EXISTS(
        SELECT 1 FROM article_activity_index a JOIN document_article_analysis x ON x.document_id=a.document_id
        WHERE a.document_id=d.article_id AND a.calendar_eligible=1 AND a.starts_day IS NOT NULL
          AND a.calendar_version=? AND x.calendar_version=?
          AND x.content_revision=d.content_revision AND x.input_hash=d.input_hash
          AND COALESCE(json_extract(a.activity_json,'$.status'),'') NOT IN('cancelled','postponed')
          AND (json_extract(a.activity_json,'$.calendar.usesBody')=0 OR (${calendarBodyAllowedSql()}))
      ) THEN 1 ELSE 0 END AS calendar
    FROM visible d
  )`;

function item(row: FavoriteRow): FavoriteItem {
  const originSurface = FavoriteSurfaceSchema.parse(row.origin_surface);
  const surfaces = FavoriteSurfaceSchema.options.filter(
    (surface) => row[surface] === 1,
  );
  return {
    articleId: row.article_id,
    favoriteId: row.id,
    originSurface,
    surfaces: surfaces.length ? surfaces : [originSurface],
    createdAt: new Date(Number(row.created_at_ms)).toISOString(),
    available: row.available === 1,
    readable: row.readable === 1,
    title: row.title || "文章已不可用",
    url: row.url || "",
    publishedAt: row.published_at || null,
    version: Number(row.version || 1),
    sourceName: row.display_name || "来源不可用",
  };
}

export class ArticleFavoriteStore {
  constructor(private readonly db: SqlDatabase) {}

  async list(userId: string, raw: unknown) {
    const query = FavoriteQuerySchema.parse(raw);
    const params: unknown[] = [userId, CALENDAR_VERSION, CALENDAR_VERSION];
    let filter = "";
    if (query.surface !== "all") {
      filter = `WHERE ${query.surface}=1 OR (radar=0 AND knowledge=0 AND calendar=0 AND origin_surface=?)`;
      params.push(query.surface);
    }
    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .prepare(
        `${favoriteMemberships}, matching AS MATERIALIZED (SELECT * FROM memberships ${filter}),
          page AS (SELECT * FROM matching ORDER BY created_at_ms DESC,id DESC LIMIT ? OFFSET ?)
         SELECT p.*,summary.total FROM (SELECT count(*) AS total FROM matching) summary LEFT JOIN page p ON 1=1
         ORDER BY p.created_at_ms DESC,p.id DESC`,
      )
      .bind(...params, query.limit, offset)
      .all<FavoriteRow & { total: number }>();
    const total = Number(rows.results[0]?.total || 0);
    const items = rows.results.filter((row) => row.id).map(item);
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      hasMore: offset + items.length < total,
    };
  }

  async status(userId: string, raw: unknown) {
    const ids = FavoriteStatusSchema.parse(raw).articleIds;
    if (!ids.length) return { favorited: [] as string[] };
    const rows = await this.db
      .prepare(
        `SELECT article_id FROM user_article_favorites WHERE user_id = ? AND article_id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(userId, ...ids)
      .all<{ article_id: string }>();
    return { favorited: rows.results.map((row) => row.article_id) };
  }

  async add(userId: string, articleId: string, raw: unknown) {
    const id = ConsoleIdSchema.parse(articleId);
    const { originSurface } = AddFavoriteSchema.parse(raw);
    const document = await this.db
      .prepare(
        "SELECT d.id FROM knowledge_documents d WHERE d.id = ? AND EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id = d.id)",
      )
      .bind(id)
      .first<{ id: string }>();
    if (!document)
      throw new ApiError("NOT_FOUND", "文章不存在或已不可公开阅读。");
    const now = Date.now();
    await this.db
      .prepare(
        "INSERT INTO user_article_favorites(id,user_id,article_id,origin_surface,created_at_ms) VALUES(?,?,?,?,?) ON CONFLICT(user_id,article_id) DO NOTHING",
      )
      .bind(crypto.randomUUID(), userId, id, originSurface, now)
      .run();
    const saved = await this.db
      .prepare(
        "SELECT origin_surface,created_at_ms FROM user_article_favorites WHERE user_id = ? AND article_id = ?",
      )
      .bind(userId, id)
      .first<{ origin_surface: string; created_at_ms: number }>();
    return {
      articleId: id,
      favorited: true,
      originSurface: (saved?.origin_surface ||
        originSurface) as FavoriteSurface,
      createdAt: new Date(Number(saved?.created_at_ms || now)).toISOString(),
    };
  }

  async remove(userId: string, articleId: string) {
    const id = ConsoleIdSchema.parse(articleId);
    const result = await this.db
      .prepare(
        "DELETE FROM user_article_favorites WHERE user_id = ? AND article_id = ?",
      )
      .bind(userId, id)
      .run();
    return {
      articleId: id,
      favorited: false,
      removed: Number(result.meta.changes || 0) > 0,
    };
  }
}
