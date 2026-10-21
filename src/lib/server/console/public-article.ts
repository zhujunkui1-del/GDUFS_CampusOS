import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { withApi } from "../http";
import { ApiError } from "../errors";

export const publicArticle = withApi(async (request) => {
  const q = z
    .object({ id: ConsoleIdSchema })
    .strict()
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "阅读服务暂不可用。");
  }
  if (!env.DB) throw new ApiError("SERVICE_UNAVAILABLE", "阅读服务暂不可用。");
  const limiter = env.MAP_RATE_LIMITER as
    { limit(v: { key: string }): Promise<{ success: boolean }> } | undefined;
  if (
    limiter &&
    !(
      await limiter.limit({
        key: "article:" + (request.headers.get("CF-Connecting-IP") || "local"),
      })
    ).success
  )
    throw new ApiError("RATE_LIMITED", "请求较频繁，请稍后重试。");
  // A fresh visibility read precedes every body response, including after removal.
  const row = await primaryDatabase(env.DB as SqlDatabase)
    .prepare(
      "SELECT d.id,d.title,d.url,d.body,d.body_status,d.published_at,d.updated_at,s.display_name FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=? AND d.body_format='reading_html' AND d.rights_scope='licensed_full_text'",
    )
    .bind(q.id)
    .first<Record<string, string | null>>();
  if (!row)
    throw new ApiError("NOT_FOUND", "此文章已下架，或尚未提供站内正文。");
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    readingHtml: row.body || "",
    partial: row.body_status === "partial",
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    sourceName: row.display_name,
  };
});
