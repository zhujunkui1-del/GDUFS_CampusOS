import {
  SourceSessionResultSchema,
  SourceControlInputSchema,
  type SourceSession,
} from "@/domain/console/dashboard";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";
import { relayDelay, relayMeter } from "../external-search/relay";

export async function sourceSessionSnapshot(db: SqlDatabase) {
  const row = await db
    .prepare(
      "SELECT state,checked_at_ms FROM external_source_session_state WHERE provider='xiaohongshu'",
    )
    .first<{ state: SourceSession["state"]; checked_at_ms: number }>();
  return {
    state: row?.state ?? "unknown",
    checkedAt: row?.checked_at_ms ?? null,
    qr: null,
    qrExpiresAt: null,
  };
}
export async function saveSessionState(db: SqlDatabase, raw: unknown) {
  const v = SourceSessionResultSchema.parse(raw);
  if (Math.abs(Date.now() - v.checkedAt) > 60000)
    throw new ApiError("INVALID_ARGUMENT", "会话检测时间已过期。");
  // QR challenges are never copied to the persistent status snapshot.
  return db
    .prepare(
      "INSERT INTO external_source_session_state(provider,state,checked_at_ms) VALUES('xiaohongshu',?,?) ON CONFLICT(provider) DO UPDATE SET state=excluded.state,checked_at_ms=excluded.checked_at_ms WHERE excluded.checked_at_ms>=checked_at_ms",
    )
    .bind(v.state, v.checkedAt)
    .run();
}
export async function sourceControl(
  db: SqlDatabase,
  owner: string,
  raw: unknown,
  signal?: AbortSignal,
) {
  const input = SourceControlInputSchema.parse(raw),
    id = crypto.randomUUID(),
    now = Date.now(),
    meter = relayMeter(db);
  const queued = await meter.all<{ id: string }>(
    db
      .prepare(
        "INSERT INTO agent_external_search_jobs(id,owner_key,input_json,state,created_at_ms,expires_at_ms) SELECT ?,?,?,'pending',?,? WHERE (SELECT count(*) FROM (SELECT 1 FROM agent_external_search_jobs WHERE state='pending' LIMIT 16))<16 RETURNING id",
      )
      .bind(id, "admin:" + owner, JSON.stringify(input), now, now + 31000),
  );
  if (!queued.length)
    throw new ApiError("RATE_LIMITED", "搜索服务正忙，请稍后检测。");
  let claimed = false;
  try {
    while (Date.now() - now < 26000 && !signal?.aborted) {
      const rows = await meter.all<{
        state: string;
        result_json: string | null;
      }>(
        db
          .prepare(
            "SELECT state,result_json FROM agent_external_search_jobs WHERE id=? AND owner_key=?",
          )
          .bind(id, "admin:" + owner),
      );
      if (!rows.length) break;
      claimed ||= rows[0].state !== "pending";
      if (rows[0].state === "done" && rows[0].result_json)
        return {
          ...SourceSessionResultSchema.parse(JSON.parse(rows[0].result_json)),
          usage: meter.usage,
        };
      await relayDelay(1000, signal);
    }
    return {
      state: "unavailable" as const,
      checkedAt: Date.now(),
      qr: null,
      qrExpiresAt: null,
      reason: claimed ? "check_timeout" : "runner_offline",
      usage: meter.usage,
    };
  } finally {
    await meter.run(
      db
        .prepare(
          "DELETE FROM agent_external_search_jobs WHERE id=? AND owner_key=?",
        )
        .bind(id, "admin:" + owner),
    );
  }
}
export async function finishSourceControl(
  db: SqlDatabase,
  id: string,
  runnerId: string,
  raw: unknown,
) {
  const result = SourceSessionResultSchema.parse(raw),
    meter = relayMeter(db);
  const rows = await meter.all<{
    input_json: string;
    result_json: string | null;
    state: string;
  }>(
    db
      .prepare(
        "SELECT input_json,result_json,state FROM agent_external_search_jobs WHERE id=? AND runner_id=? AND expires_at_ms>? AND owner_key LIKE 'admin:%'",
      )
      .bind(id, runnerId, Date.now()),
  );
  if (!rows.length)
    throw new ApiError("CONFLICT", "登录检测已过期，请重新检测。");
  SourceControlInputSchema.parse(JSON.parse(rows[0].input_json));
  const json = JSON.stringify(result);
  if (rows[0].state === "done") {
    if (rows[0].result_json !== json)
      throw new ApiError("CONFLICT", "检测结果已提交。");
  } else {
    await saveSessionState(db, result);
    await meter.run(
      db
        .prepare(
          "UPDATE agent_external_search_jobs SET state='done',result_json=? WHERE id=? AND runner_id=? AND state='running' AND expires_at_ms>?",
        )
        .bind(json, id, runnerId, Date.now()),
    );
  }
  return { accepted: true, usage: meter.usage };
}
