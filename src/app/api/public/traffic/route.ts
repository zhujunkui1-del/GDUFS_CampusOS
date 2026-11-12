import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  primaryDatabase,
  type SqlDatabase,
} from "@/lib/server/assistant/database";
import { withApi } from "@/lib/server/http";
import { ApiError } from "@/lib/server/errors";
import { trafficSummary } from "@/lib/server/console/traffic";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const env = getCloudflareContext().env as unknown as Record<string, unknown>;
  if (!env.DB)
    throw new ApiError("SERVICE_UNAVAILABLE", "访问统计暂不可用。", true);
  const summary = await trafficSummary(primaryDatabase(env.DB as SqlDatabase));
  return {
    startedAt: summary.startedAt,
    measuredAt: summary.measuredAt,
    today: summary.today,
    last7: summary.last7,
    last30: summary.last30,
    total: summary.total,
    days: summary.days,
  };
});
