import type { SqlDatabase, Statement } from "../assistant/database";
import {
  RelayInputSchema,
  RelayResultSchema,
  type RelayInput,
  type RelayUsage,
} from "@/domain/retrieval/relay";
import type { ProviderResult } from "./providers";
import { ApiError } from "../errors";
import { isOfficialCampusUrl } from "./policy";
export function relayMeter(db: SqlDatabase) {
  const usage: RelayUsage = {
    queries: 0,
    rowsRead: 0,
    rowsWritten: 0,
    usageAvailable: true,
  };
  function record(meta?: { rows_read?: number; rows_written?: number }) {
    usage.queries++;
    usage.rowsRead += meta?.rows_read || 0;
    usage.rowsWritten += meta?.rows_written || 0;
    usage.usageAvailable &&=
      typeof meta?.rows_read === "number" &&
      typeof meta?.rows_written === "number";
  }
  return {
    usage,
    async all<T>(s: Statement) {
      const r = await s.all<T>();
      record(r.meta);
      return r.results;
    },
    async run(s: Statement) {
      const r = await s.run();
      record(r.meta);
      return r.meta;
    },
    db,
  };
}
export function relayDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error("CANCELLED"));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(Error("CANCELLED"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
export function createDbRelay(db: SqlDatabase, owner: string) {
  return async (
    raw: RelayInput,
    signal?: AbortSignal,
  ): Promise<ProviderResult> => {
    const input = RelayInputSchema.parse(raw),
      id = crypto.randomUUID(),
      started = performance.now(),
      meter = relayMeter(db),
      now = Date.now();
    const provider =
      input.kind === "web"
        ? input.onlyXhs
          ? "exa_xiaohongshu_local"
          : "exa_web_local"
        : "xiaohongshu_local";
    let result: ProviderResult = {
      provider,
      items: [],
      status: "unavailable",
      durationMs: 0,
    };
    let created = false;
    try {
      if (signal?.aborted) return { ...result, relayUsage: meter.usage };
      const inserted = await meter.run(
        db
          .prepare(
            `INSERT INTO agent_external_search_jobs(id,owner_key,input_json,state,created_at_ms,expires_at_ms)
    SELECT ?,?,?,'pending',?,? WHERE (SELECT count(*) FROM (SELECT id FROM agent_external_search_jobs INDEXED BY idx_external_search_pending WHERE state='pending' LIMIT 16))<16`,
          )
          .bind(id, owner, JSON.stringify(input), now, now + 31000),
      );
      created = inserted.changes > 0;
      if (!created)
        return { ...result, status: "busy", relayUsage: meter.usage };
      while (Date.now() - now < 28500 && !signal?.aborted) {
        const rows = await meter.all<{
          state: string;
          result_json: string | null;
        }>(
          db
            .prepare(
              "SELECT state,result_json FROM agent_external_search_jobs WHERE id=? AND owner_key=?",
            )
            .bind(id, owner),
        );
        if (!rows.length) break;
        if (rows[0].state === "done" && rows[0].result_json) {
          result = RelayResultSchema.parse(JSON.parse(rows[0].result_json));
          break;
        }
        await relayDelay(750, signal);
      }
    } catch {
      /* A cancelled/failed relay never invents search results. */
    } finally {
      if (created)
        await meter
          .run(
            db
              .prepare(
                "DELETE FROM agent_external_search_jobs WHERE id=? AND owner_key=?",
              )
              .bind(id, owner),
          )
          .catch(() => {});
    }
    return {
      ...result,
      provider: result.provider,
      durationMs: Math.round(performance.now() - started),
      relayUsage: { ...meter.usage },
    };
  };
}
export async function claimRelay(
  db: SqlDatabase,
  runnerId: string,
  waitMs: number,
  signal?: AbortSignal,
) {
  const meter = relayMeter(db),
    started = Date.now();
  await meter.run(
    db
      .prepare(
        "DELETE FROM agent_external_search_jobs WHERE id IN (SELECT id FROM agent_external_search_jobs INDEXED BY idx_external_search_expiry WHERE expires_at_ms<? ORDER BY expires_at_ms LIMIT 20)",
      )
      .bind(Date.now()),
  );
  do {
    const now = Date.now();
    const next = await meter.all<{ id: string }>(
      db
        .prepare(
          "SELECT id FROM agent_external_search_jobs INDEXED BY idx_external_search_pending WHERE state='pending' AND expires_at_ms>? ORDER BY created_at_ms,id LIMIT 1",
        )
        .bind(now),
    );
    if (next.length) {
      const work = await meter.all<{ id: string; input_json: string }>(
        db
          .prepare(
            "UPDATE agent_external_search_jobs SET state='running',runner_id=? WHERE id=? AND state='pending' AND expires_at_ms>? RETURNING id,input_json",
          )
          .bind(runnerId, next[0].id, now),
      );
      if (work.length)
        return {
          work: {
            id: work[0].id,
            input: RelayInputSchema.parse(JSON.parse(work[0].input_json)),
          },
          usage: meter.usage,
        };
    }
    if (Date.now() - started >= waitMs) break;
    await relayDelay(Math.min(2000, waitMs - (Date.now() - started)), signal);
  } while (!signal?.aborted);
  return { work: null, usage: meter.usage };
}
export async function finishRelay(
  db: SqlDatabase,
  id: string,
  runnerId: string,
  raw: unknown,
) {
  const result = RelayResultSchema.parse(raw),
    meter = relayMeter(db);
  const rows = await meter.all<{
    state: string;
    runner_id: string;
    input_json: string;
    result_json: string | null;
  }>(
    db
      .prepare(
        "SELECT state,runner_id,input_json,result_json FROM agent_external_search_jobs WHERE id=? AND expires_at_ms>?",
      )
      .bind(id, Date.now()),
  );
  const row = rows[0];
  if (!row || row.runner_id !== runnerId)
    throw new ApiError("CONFLICT", "搜索请求已过期或已取消。");
  const input = RelayInputSchema.parse(JSON.parse(row.input_json));
  if (
    input.kind === "xiaohongshu" &&
    result.items.some(
      (i) =>
        i.platform !== "xiaohongshu" ||
        i.authority !== "student_experience" ||
        i.canConfirmAdministrativeFacts,
    )
  )
    throw new ApiError("INVALID_ARGUMENT", "笔记来源等级不符。");
  if (
    input.kind === "web" &&
    input.policy.officialOnly &&
    result.items.some(
      (i) => !isOfficialCampusUrl(i.originalUrl) || i.authority !== "official",
    )
  )
    throw new ApiError("INVALID_ARGUMENT", "需要官方原文。");
  const json = JSON.stringify(result);
  if (row.state === "done") {
    if (row.result_json !== json)
      throw new ApiError("CONFLICT", "已收到不同的搜索结果。");
  } else
    await meter.run(
      db
        .prepare(
          "UPDATE agent_external_search_jobs SET state='done',result_json=? WHERE id=? AND runner_id=? AND state='running' AND expires_at_ms>?",
        )
        .bind(json, id, runnerId, Date.now()),
    );
  return { accepted: true, usage: meter.usage };
}
