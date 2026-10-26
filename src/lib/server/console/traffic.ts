import { z } from "zod";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ApiError } from "../errors";
import { sameOrigin, readJson } from "../assistant/http-context";
import { withApi } from "../http";
import type { TrafficSummary } from "@/domain/console/dashboard";

const VisitSchema = z
  .object({ id: z.string().uuid(), views: z.number().int().min(1).max(20) })
  .strict();
export async function recordVisits(db: SqlDatabase, raw: unknown) {
  const v = VisitSchema.parse(raw);
  const r = await db
    .prepare(
      "INSERT OR IGNORE INTO site_visit_batches(id,views,received_at_ms) VALUES(?,?,?)",
    )
    .bind(v.id, v.views, Date.now())
    .run();
  // Bounded, indexed cleanup; retries never double count while the 48h receipt exists.
  if (Math.random() < 1 / 32)
    await db
      .prepare(
        "DELETE FROM site_visit_batches WHERE id IN (SELECT id FROM site_visit_batches INDEXED BY idx_site_visit_batch_expiry WHERE received_at_ms<? ORDER BY received_at_ms LIMIT 64)",
      )
      .bind(Date.now() - 172800000)
      .run();
  return {
    accepted: true,
    usage: { rowsRead: r.meta.rows_read, rowsWritten: r.meta.rows_written },
  };
}
export const visitPost = withApi(async (request) => {
  sameOrigin(request);
  const env = getCloudflareContext().env as unknown as Record<string, unknown>;
  if (!env.DB) throw new ApiError("SERVICE_UNAVAILABLE", "访问统计暂不可用。");
  const limiter = env.MAP_RATE_LIMITER as
    { limit(v: { key: string }): Promise<{ success: boolean }> } | undefined;
  if (
    limiter &&
    !(
      await limiter.limit({
        key: "visits:" + (request.headers.get("CF-Connecting-IP") || "local"),
      })
    ).success
  )
    throw new ApiError("RATE_LIMITED", "请求过于频繁。", true);
  return recordVisits(
    primaryDatabase(env.DB as SqlDatabase),
    await readJson(request, 256),
  );
});
export async function trafficSummary(
  db: SqlDatabase,
  now = Date.now(),
): Promise<TrafficSummary> {
  const today = new Date(now + 28800000).toISOString().slice(0, 10);
  const first = new Date(Date.parse(today + "T00:00:00Z") - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [settings, days, total] = await Promise.all([
    db
      .prepare("SELECT started_at_ms FROM site_visit_settings WHERE id=1")
      .first<{ started_at_ms: number }>(),
    db
      .prepare(
        "SELECT day,views FROM site_visit_days WHERE day>=? AND day<=? ORDER BY day",
      )
      .bind(first, today)
      .all<{ day: string; views: number }>(),
    db
      .prepare(
        "SELECT cumulative FROM site_visit_days ORDER BY day DESC LIMIT 1",
      )
      .first<{ cumulative: number }>(),
  ]);
  const startedAt = settings!.started_at_ms;
  const startDay = new Date(startedAt + 28800000).toISOString().slice(0, 10);
  const rows = new Map(days.results.map((r) => [r.day, r.views]));
  const chart = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.parse(first + "T00:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10);
    return { day, views: day < startDay ? null : (rows.get(day) ?? 0) };
  });
  const sum = (n: number) =>
    chart.slice(-n).reduce((a, d) => a + (d.views ?? 0), 0);
  return {
    startedAt,
    measuredAt: now,
    today: sum(1),
    last7: sum(7),
    last30: sum(30),
    total: total?.cumulative ?? 0,
    days: chart,
  };
}
