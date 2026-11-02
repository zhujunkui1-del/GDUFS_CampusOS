import { z } from "zod";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";

export const FavoriteSurfaceSchema = z.enum([
  "radar",
  "knowledge",
  "calendar",
]);
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
};

const selection = `
  f.id,
  f.article_id,
  f.origin_surface,
  f.created_at_ms,
  d.title,
  d.url,
  d.published_at,
  d.version,
  s.display_name,
  CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS available,
  CASE
    WHEN p.id IS NOT NULL
      AND d.body_format = 'reading_html'
      AND d.rights_scope = 'licensed_full_text'
    THEN 1 ELSE 0
  END AS readable
  FROM user_article_favorites f
  LEFT JOIN knowledge_documents d ON d.id = f.article_id
  LEFT JOIN knowledge_sources s ON s.id = d.source_id
  LEFT JOIN console_public_documents p ON p.id = f.article_id
`;

function item(row: FavoriteRow): FavoriteItem {
  return {
    articleId: row.article_id,
    favoriteId: row.id,
    originSurface: row.origin_surface as FavoriteSurface,
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
    const where = ["f.user_id = ?"];
    const params: unknown[] = [userId];
    if (query.surface !== "all") {
      where.push("f.origin_surface = ?");
      params.push(query.surface);
    }
    const clause = where.join(" AND ");
    const count = await this.db
      .prepare(
        `SELECT count(*) AS n FROM user_article_favorites f WHERE ${clause}`,
      )
      .bind(...params)
      .first<{ n: number }>();
    const total = Number(count?.n || 0);
    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .prepare(
        `SELECT ${selection} WHERE ${clause} ORDER BY f.created_at_ms DESC, f.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, query.limit, offset)
      .all<FavoriteRow>();
    return {
      items: rows.results.map(item),
      page: query.page,
      limit: query.limit,
      total,
      hasMore: offset + rows.results.length < total,
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
      originSurface: (saved?.origin_surface || originSurface) as FavoriteSurface,
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
    return { articleId: id, favorited: false, removed: Number(result.meta.changes || 0) > 0 };
  }
}
