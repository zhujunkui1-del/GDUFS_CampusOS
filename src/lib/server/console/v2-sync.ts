import { z } from "zod";
import { ConsoleDateGateStore as ConsoleRetentionStore } from "./date-gate-store";
import { consolePermission } from "./auth";
import { dispatchDue } from "./scheduler";
import { CreateJobSchema } from "@/domain/console/ingestion";
import { ConsoleIdSchema, CommandSchema } from "@/domain/console/contracts";
import { tokenHash, randomToken } from "../assistant/crypto";

import { SourcesV2Query } from "@/domain/console/v2";
import { ApiError } from "../errors";
type Row = Record<string, string | number | null>;
export const runnerActor = {
  id: "sys-console-runner",
  email: "ingestion@system.invalid",
  role: "operator" as const,
};
export const cloudRunnerActor = {
  id: "sys-console-cloud",
  email: "web-runner@system.invalid",
  role: "operator" as const,
};
export class ConsoleSyncStore extends ConsoleRetentionStore {
  runnerId?: string;
  private priorSuccess: string | null | undefined;
  protected override async mutate(
    ...args: Parameters<ConsoleRetentionStore["mutate"]>
  ) {
    if (this.runnerId) args[9] = { ...args[9], runnerId: this.runnerId };
    if (args[1] === "admin.revoke")
      args[5] = [
        ...args[5],
        this.db
          .prepare(
            "UPDATE console_runner_tokens SET revoked_at_ms=? WHERE admin_id=?",
          )
          .bind(Date.parse(this.now()), args[3]),
      ];
    if (args[1] === "job.commit")
      args[5] = [
        ...args[5],
        this.db
          .prepare(
            "UPDATE knowledge_sources SET last_executor=? WHERE id=(SELECT source_id FROM ingestion_jobs WHERE id=?)",
          )
          .bind(
            this.actor.id === cloudRunnerActor.id ? "cloud" : "local",
            args[3],
          ),
        this.db
          .prepare(
            "UPDATE knowledge_sources SET last_success_at=CASE WHEN EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=? AND phase='complete' AND status='completed') THEN ? ELSE ? END,sync_state=(SELECT CASE WHEN status='failed' THEN 'blocked' WHEN phase='complete' THEN 'completed' ELSE 'queued' END FROM ingestion_jobs WHERE id=?),next_sync_at_ms=CASE WHEN EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=? AND status='failed') THEN ? ELSE next_sync_at_ms END WHERE id=(SELECT source_id FROM ingestion_jobs WHERE id=?)",
          )
          .bind(
            args[3],
            this.now(),
            this.priorSuccess || null,
            args[3],
            args[3],
            Date.parse(this.now()) + 3600000,
            args[3],
          ),
      ];
    return super.mutate(...args);
  }
  async syncNow(raw: unknown) {
    consolePermission(this.actor, "write");
    const v = z
      .object({
        commandId: z.string().uuid(),
        sourceId: ConsoleIdSchema.optional(),
      })
      .strict()
      .parse(raw);
    if (v.sourceId) await this.source(v.sourceId);
    else consolePermission(this.actor, "admin");
    const globalLimit = v.sourceId
      ? undefined
      : Number(
          (
            await this.db
              .prepare(
                "SELECT count(*) AS n FROM knowledge_sources WHERE console_managed=1 AND source_type='official_web' AND channel_type='official_web' AND archived_at IS NULL",
              )
              .first<{ n: number }>()
          )?.n || 0,
        );
    return dispatchDue(this.db, {
      sourceId: v.sourceId,
      manualId: v.commandId,
      limit: globalLimit === undefined ? undefined : Math.max(50, globalLimit),
    });
  }
  async assignOperator(sourceId: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = CommandSchema.extend({
      operatorId: ConsoleIdSchema,
      enabled: z.boolean(),
    })
      .strict()
      .parse(raw);
    await this.source(sourceId);
    const operator = await this.db
      .prepare(
        "SELECT id FROM console_admins WHERE id=? AND role='operator' AND principal_type='human' AND status='active'",
      )
      .bind(v.operatorId)
      .first();
    if (!operator)
      throw new ApiError("INVALID_ARGUMENT", "需要有效的运营人员身份。");
    return this.mutate(
      v,
      "source.operator-scope",
      "source",
      sourceId,
      v,
      [
        v.enabled
          ? this.db
              .prepare(
                "INSERT OR REPLACE INTO console_source_scopes(admin_id,source_id,granted_by,created_at) VALUES(?,?,?,?)",
              )
              .bind(v.operatorId, sourceId, this.actor.id, this.now())
          : this.db
              .prepare(
                "DELETE FROM console_source_scopes WHERE admin_id=? AND source_id=?",
              )
              .bind(v.operatorId, sourceId),
        this.db
          .prepare(
            "UPDATE knowledge_sources SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), sourceId),
      ],
      "admin",
    );
  }
  async operationRecords(
    sourceId: string | undefined,
    kind: "jobs" | "history",
    raw: unknown,
  ) {
    consolePermission(this.actor, "read");
    if (sourceId) await this.sourceV2(sourceId);
    const q = z
        .object({
          q: z.string().max(100).optional(),
          status: z
            .enum(["queued", "running", "completed", "failed"])
            .optional(),
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .extend({
          sort: z.enum(["time", "status", "target"]).default("time"),
          direction: z.enum(["asc", "desc"]).default("desc"),
        })
        .strict()
        .parse(raw),
      where: string[] = [],
      args: unknown[] = [];
    let fromSql: string, select: string, order: string;
    if (kind === "jobs") {
      fromSql =
        " FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id";
      select =
        "j.*,s.display_name AS source_name,(SELECT count(*) FROM console_intake_skips k WHERE k.job_id=j.id) AS skipped_count";
      order = "j.created_at";
      where.push("s.console_managed=1 AND s.source_type<>'user_private'");
      if (sourceId) {
        where.push("j.source_id=?");
        args.push(sourceId);
      }
      if (q.status) {
        where.push("j.status=?");
        args.push(q.status);
      }
      if (q.q) {
        where.push(
          "(s.display_name LIKE ? ESCAPE '\\' OR j.id LIKE ? ESCAPE '\\' OR j.error_code LIKE ? ESCAPE '\\')",
        );
        const v = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
        args.push(v, v, v);
      }
    } else {
      fromSql = " FROM console_audit_logs a";
      select = "a.*";
      order = "a.created_at";
      if (sourceId) {
        where.push(
          "((a.target_type='source' AND a.target_id=?) OR (a.target_type='job' AND EXISTS(SELECT 1 FROM ingestion_jobs j WHERE j.id=a.target_id AND j.source_id=?)) OR (a.target_type='document' AND EXISTS(SELECT 1 FROM knowledge_documents d WHERE d.id=a.target_id AND (d.source_id=? OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=?)))))",
        );
        args.push(sourceId, sourceId, sourceId, sourceId);
      }
      if (q.q) {
        where.push(
          "(a.action LIKE ? ESCAPE '\\' OR a.target_id LIKE ? ESCAPE '\\')",
        );
        const v = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
        args.push(v, v);
      }
    }
    if (q.from) {
      where.push(`date(${order},'+8 hours')>=?`);
      args.push(q.from);
    }
    if (q.to) {
      where.push(`date(${order},'+8 hours')<=?`);
      args.push(q.to);
    }
    order =
      kind === "jobs"
        ? { time: "j.created_at", status: "j.status", target: "j.id" }[q.sort]
        : { time: "a.created_at", status: "a.action", target: "a.target_id" }[
            q.sort
          ];
    const filter = where.length ? " WHERE " + where.join(" AND ") : "";
    const rows = await this.db
      .prepare(
        "SELECT " +
          select +
          fromSql +
          filter +
          ` ORDER BY ${order} ${q.direction} LIMIT ? OFFSET ?`,
      )
      .bind(...args, q.limit, q.offset)
      .all<Record<string, string | number | null>>();
    const total = await this.db
      .prepare("SELECT count(*) n" + fromSql + filter)
      .bind(...args)
      .first<{ n: number }>();
    return {
      items: rows.results,
      total: total?.n || 0,
      limit: q.limit,
      offset: q.offset,
      collectorEnabled: true,
    };
  }
  async runnerTokens() {
    consolePermission(this.actor, "admin");
    const tokens = await this.db
      .prepare(
        "SELECT id,label,source_ids_json,expires_at_ms,revoked_at_ms,created_at,last_seen_at,(revoked_at_ms IS NULL AND expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AS active FROM console_runner_tokens ORDER BY created_at DESC LIMIT 20",
      )
      .all();
    const admin = await this.db
      .prepare("SELECT version FROM console_admins WHERE id=?")
      .bind(this.actor.id)
      .first<{ version: number }>();
    return { items: tokens.results, adminVersion: admin?.version };
  }
  async createRunnerToken(raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = CommandSchema.extend({
      label: z.string().trim().min(2).max(80),
      sourceIds: z.array(ConsoleIdSchema).min(1).max(2000),
      validityDays: z.number().int().min(1).max(30),
    })
      .strict()
      .parse(raw);
    for (const id of v.sourceIds) {
      await this.source(id);
      await this.policy(id);
    }
    const token = randomToken(),
      hash = await tokenHash(token),
      id = "runner-" + v.commandId;
    const result = await this.mutate(
      v,
      "runner.create",
      "admin",
      this.actor.id,
      v,
      [
        this.db
          .prepare(
            "INSERT INTO console_runner_tokens(id,token_hash,label,source_ids_json,expires_at_ms,admin_id,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            hash,
            v.label,
            JSON.stringify([...new Set(v.sourceIds)]),
            Date.parse(this.now()) + v.validityDays * 86400000,
            this.actor.id,
            this.now(),
          ),
        this.db
          .prepare("UPDATE console_admins SET version=version+1 WHERE id=?")
          .bind(this.actor.id),
      ],
      "admin",
    );
    return {
      id,
      token: result.idempotent ? null : token,
      expiresInDays: v.validityDays,
    };
  }
  async revokeRunnerToken(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = CommandSchema.parse(raw);
    return this.mutate(
      v,
      "runner.revoke",
      "admin",
      this.actor.id,
      { ...v, id },
      [
        this.db
          .prepare(
            "UPDATE console_runner_tokens SET revoked_at_ms=? WHERE id=?",
          )
          .bind(Date.parse(this.now()), id),
        this.db
          .prepare("UPDATE console_admins SET version=version+1 WHERE id=?")
          .bind(this.actor.id),
      ],
      "admin",
    );
  }
  override async createJob(raw: unknown) {
    const value = CreateJobSchema.parse(raw),
      source = await this.sourceV2(value.sourceId);
    if (source.syncState === "blocked")
      throw new ApiError("CONFLICT", "请先重新核对来源访问许可。");
    const r = await super.createJob(raw);
    const j = await this.job(r.id);
    await this.db
      .prepare("UPDATE knowledge_sources SET sync_state='queued' WHERE id=?")
      .bind(j.source_id)
      .run();
    return r;
  }
  override async claim(id: string, raw: unknown) {
    const r = await super.claim(id, raw);
    await this.db
      .prepare("UPDATE knowledge_sources SET sync_state='running' WHERE id=?")
      .bind(r.sourceId)
      .run();
    return r;
  }
  override async control(
    id: string,
    raw: unknown,
    action: "pause" | "resume" | "cancel",
  ) {
    if (action === "resume") {
      const job = await this.job(id);
      if (!String(job.run_key || "").startsWith("manual:")) {
        const source = await this.sourceV2(String(job.source_id));
        if (source.syncState === "blocked")
          throw new ApiError(
            "CONFLICT",
            "请先重新核对来源访问许可，再重试同步。",
          );
      }
    }
    return super.control(id, raw, action);
  }
  override async setPolicy(id: string, raw: unknown) {
    const r = await super.setPolicy(id, raw);
    await this.db
      .prepare(
        "UPDATE knowledge_sources SET sync_state='ready',next_sync_at_ms=? WHERE id=?",
      )
      .bind(Date.parse(this.now()), id)
      .run();
    return r;
  }
  override async commit(id: string, raw: unknown) {
    const j = await this.job(id),
      s = await this.source(String(j.source_id));
    this.priorSuccess = s.lastSuccessAt;
    try {
      return await super.commit(id, raw);
    } finally {
      this.priorSuccess = undefined;
    }
  }
  async permit(id: string, raw: unknown) {
    const v = z
        .object({
          leaseToken: z.string().uuid(),
          fence: z.number().int().positive(),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(raw),
      hash = await tokenHash(this.actor.id + ":" + v.leaseToken);
    const row = await this.db
      .prepare(
        "SELECT j.id FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id CROSS JOIN console_engine_settings e WHERE j.id=? AND j.version=? AND j.lease_fence=? AND j.lease_hash=? AND j.lease_until_ms>? AND j.control_state='active' AND j.status='running' AND s.archived_at IS NULL AND s.version=j.source_version AND p.version IS j.policy_version AND (j.run_key LIKE 'manual:%' OR (s.enabled=1 AND s.sync_state<>'blocked' AND s.verification_status='verified' AND s.official_status='verified_official' AND s.operating_status='active' AND s.permission_status='approved' AND s.authorization_status='approved' AND p.expires_at_ms>?)) AND (e.auto_sync_enabled=1 OR j.run_key NOT LIKE 'scheduled:%')",
      )
      .bind(
        id,
        v.version,
        v.fence,
        hash,
        Date.parse(this.now()),
        Date.parse(this.now()),
      )
      .first();
    if (!row)
      throw new ApiError("CONFLICT", "执行许可已失效，请停止网络请求。");
    return { permitted: true };
  }
  override async dashboard(raw: unknown) {
    const q = SourcesV2Query.pick({
      q: true,
      type: true,
      state: true,
    })
      .extend({ from: z.iso.date().optional(), to: z.iso.date().optional() })
      .strict()
      .parse(raw);
    const { from, to } = q,
      day = new Date(Date.parse(this.now()) + 28800000)
        .toISOString()
        .slice(0, 10),
      start = from || day,
      end = to || day,
      where = [
        "s.console_managed=1",
        "s.source_type<>'user_private'",
        q.state === "archived"
          ? "s.archived_at IS NOT NULL"
          : "s.archived_at IS NULL",
      ],
      args: unknown[] = [];
    if (start > end)
      throw new ApiError("INVALID_ARGUMENT", "统计起日不能晚于止日。");
    if (q.q) {
      where.push(
        "(s.display_name LIKE ? ESCAPE '\\' OR s.id LIKE ? ESCAPE '\\' OR s.organization LIKE ? ESCAPE '\\')",
      );
      const text = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
      args.push(text, text, text);
    }
    if (q.type) {
      where.push("s.channel_type=?");
      args.push(q.type);
    }
    const active = "s.enabled=1 AND s.archived_at IS NULL";
    if (q.state === "enabled") where.push(active);
    if (q.state === "paused")
      where.push(
        "NOT(" +
          active +
          ") AND operating_status NOT IN('closed','unreachable')",
      );
    if (q.state === "closed")
      where.push("s.operating_status IN('closed','unreachable')");
    const metricsResult = await this.db
      .prepare(
        `WITH fs AS MATERIALIZED (
          SELECT s.id,s.enabled,s.archived_at FROM knowledge_sources s WHERE ${where.join(" AND ")}
        ), active_protections AS MATERIALIZED (
          SELECT target_type,target_id FROM console_protections
          WHERE active=1 AND (expires_at_ms IS NULL OR expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
        ), today_receipts AS (
          SELECT count(DISTINCT r.document_id) AS n
          FROM campus_collector_receipts r
          JOIN knowledge_documents d ON d.id=r.document_id
          JOIN fs f ON f.id=d.source_id
          WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private'
            AND date(r.created_at,'+8 hours') BETWEEN ? AND ?
            AND NOT EXISTS(
              SELECT 1 FROM campus_collector_receipts prior
              WHERE prior.document_id=r.document_id AND prior.created_at<r.created_at
            )
        ), today_first_versions AS (
          SELECT count(*) AS n
          FROM console_content_versions v
          JOIN knowledge_documents d ON d.id=v.document_id
          JOIN fs f ON f.id=d.source_id
          WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND v.version=1
            AND date(v.created_at,'+8 hours') BETWEEN ? AND ?
            AND NOT EXISTS(SELECT 1 FROM campus_collector_receipts r WHERE r.document_id=d.id)
        ), protected_documents AS (
          SELECT d.id
          FROM active_protections p
          JOIN knowledge_documents d ON d.id=p.target_id
          JOIN fs f ON f.id=d.source_id
          WHERE p.target_type='document' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
          UNION
          SELECT d.id
          FROM active_protections p
          JOIN fs f ON f.id=p.target_id
          JOIN knowledge_documents d ON d.source_id=f.id
          WHERE p.target_type='source' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
          UNION
          SELECT d.id
          FROM active_protections p
          JOIN document_origins o ON o.source_id=p.target_id
          JOIN knowledge_documents d ON d.id=o.document_id
          JOIN fs f ON f.id=d.source_id
          WHERE p.target_type='source' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
        )
        SELECT (SELECT count(*) FROM fs) sources,
          (SELECT count(*) FROM fs WHERE enabled=1 AND archived_at IS NULL) enabled,
          (SELECT n FROM today_receipts)+(SELECT n FROM today_first_versions) todayNew,
          (SELECT count(*) FROM active_protections p WHERE p.target_type='source' AND p.target_id IN(SELECT id FROM fs)) protectedSources,
          (SELECT count(*) FROM protected_documents) protectedArticles`,
      )
      .bind(...args, start, end, start, end)
      .all<{
        sources: number;
        enabled: number;
        todayNew: number;
        protectedSources: number;
        protectedArticles: number;
      }>();
    const metrics = metricsResult.results[0],
      storage =
        typeof metricsResult.meta?.size_after === "number"
          ? [
              {
                provider: "cloudflare_api",
                measured_at: this.now(),
                bytes: metricsResult.meta.size_after,
              },
            ]
          : (
              await this.db
                .prepare(
                  "SELECT * FROM console_storage_samples ORDER BY measured_at DESC,id DESC LIMIT 2",
                )
                .all<Row>()
            ).results;
    return {
      stats: {
        sources: Number(metrics?.sources || 0),
        enabled: Number(metrics?.enabled || 0),
        todayNew: Number(metrics?.todayNew || 0),
      },
      filteredSources: Number(metrics?.sources || 0),
      settings: null,
      networkUsage: 0,
      storage,
      unsupported: 0,
      runnerOnline: false,
      protectedSources: metrics?.protectedSources || 0,
      protectedArticles: metrics?.protectedArticles || 0,
      scheduler: "not_connected",
      autoPublishedToday: null,
      latestJobs: [],
    };
  }
  async recheckPending() {
    consolePermission(this.actor, "write");
    const rows = await this.db
      .prepare(
        "SELECT d.id FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND d.publication_status='draft' AND NOT EXISTS(SELECT 1 FROM console_content_checks c WHERE c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.source_version=s.version AND c.policy_version=COALESCE((SELECT version FROM console_publication_policies WHERE source_id=s.id),0) AND c.control_generation=COALESCE((SELECT generation FROM console_document_controls WHERE document_id=d.id),0)) ORDER BY d.updated_at,d.id LIMIT 2",
      )
      .all<{ id: string }>();
    const out = [];
    for (const r of rows.results) out.push(await this.analyse(r.id));
    return { items: out };
  }
}
