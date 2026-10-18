import { protectedDocumentSql } from "./v2-sql";
import { ConsoleAutomationStore } from "./v2-automation";
import {
  ProtectionSchema,
  ProtectionQuery,
  RetentionCreate,
  RetentionAction,
  RetentionFilters,
} from "@/domain/console/retention";
import { CommandSchema } from "@/domain/console/contracts";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";
import type { SqlDatabase, Statement } from "../assistant/database";
import type { ConsoleActor } from "@/domain/console/contracts";
type Row = Record<string, string | number | null>;
type PlanRow = {
  id: string;
  version: number;
  filters_json: string;
  state: string;
  cursor: string;
  scanned: number;
  logical_bytes: number;
  resume_state: string | null;
};
export class ConsoleRetentionStore extends ConsoleAutomationStore {
  constructor(
    db: SqlDatabase,
    actor: ConsoleActor,
    now = () => new Date().toISOString(),
    sessionHash?: string,
    private readonly purgeAllowed = false,
  ) {
    super(db, actor, now, sessionHash);
  }
  async protections(raw: unknown) {
    consolePermission(this.actor, "read");
    const q = ProtectionQuery.parse(raw),
      where = ["1=1"],
      args: unknown[] = [];
    if (q.type) {
      where.push("p.target_type=?");
      args.push(q.type);
    }
    if (q.q) {
      where.push(
        "(COALESCE(d.title,s.display_name) LIKE ? ESCAPE '\\' OR p.reason LIKE ? ESCAPE '\\')",
      );
      const v = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
      args.push(v, v);
    }
    if (q.sourceType) {
      where.push("s.channel_type=?");
      args.push(q.sourceType);
    }
    if (q.operating) {
      where.push("s.operating_status=?");
      args.push(q.operating);
    }
    if (q.permanent)
      where.push(
        q.permanent === "1"
          ? "p.expires_at_ms IS NULL"
          : "p.expires_at_ms IS NOT NULL",
      );
    if (q.addedAfter) {
      where.push("date(p.created_at,'+8 hours')>=?");
      args.push(q.addedAfter);
    }
    if (q.expiresBefore) {
      where.push("date(p.expires_at_ms/1000,'unixepoch','+8 hours')<=?");
      args.push(q.expiresBefore);
    }
    if (q.category) {
      where.push(
        "(d.knowledge_category=? OR d.radar_category=? OR (p.target_type='source' AND EXISTS(SELECT 1 FROM knowledge_documents x WHERE (x.source_id=p.target_id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=x.id AND o.source_id=p.target_id)) AND (x.knowledge_category=? OR x.radar_category=?))))",
      );
      args.push(q.category, q.category, q.category, q.category);
    }
    where.push(
      q.status === "removed"
        ? "p.active=0"
        : q.status === "expired"
          ? "p.active=1 AND p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"
          : "p.active=1 AND (p.expires_at_ms IS NULL OR p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))",
    );
    const base = ` FROM console_protections p LEFT JOIN knowledge_documents d ON p.target_type='document' AND d.id=p.target_id LEFT JOIN knowledge_sources s ON s.id=CASE WHEN p.target_type='source' THEN p.target_id ELSE d.source_id END WHERE ${where.join(" AND ")}`;
    const rows = await this.db
      .prepare(
        "SELECT p.*,COALESCE(d.title,s.display_name) AS title,COALESCE(d.version,s.version) AS target_version,s.display_name AS source_name,s.channel_type,s.operating_status,(CASE WHEN p.target_type='source' THEN (SELECT count(DISTINCT x.id) FROM knowledge_documents x WHERE x.source_id=p.target_id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=x.id AND o.source_id=p.target_id)) ELSE 1 END) AS protected_count" +
          base +
          ` ORDER BY ${{ updated: "p.updated_at", expires: "p.expires_at_ms", title: "COALESCE(d.title,s.display_name)" }[q.sort]} ${q.direction},p.target_id LIMIT ? OFFSET ?`,
      )
      .bind(...args, q.limit, q.offset)
      .all<Row>();
    const n = await this.db
      .prepare("SELECT count(*) AS n" + base)
      .bind(...args)
      .first<{ n: number }>();
    return {
      items: rows.results,
      total: n?.n || 0,
      limit: q.limit,
      offset: q.offset,
    };
  }
  async protection(raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = ProtectionSchema.parse(raw);
    if (v.expiresAt && Date.parse(v.expiresAt) <= Date.parse(this.now()))
      throw new ApiError("INVALID_ARGUMENT", "保护截止时间必须在将来。");
    if (v.type === "source") await this.sourceV2(v.targetId);
    else await this.document(v.targetId);
    const statements = [
      this.db
        .prepare(
          "INSERT INTO console_protections(target_type,target_id,active,history_exempt,reason,expires_at_ms,admin_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(target_type,target_id) DO UPDATE SET active=excluded.active,history_exempt=excluded.history_exempt,reason=excluded.reason,expires_at_ms=excluded.expires_at_ms,admin_id=excluded.admin_id,updated_at=excluded.updated_at",
        )
        .bind(
          v.type,
          v.targetId,
          Number(v.active),
          Number(v.historyExempt),
          v.reason,
          v.expiresAt ? Date.parse(v.expiresAt) : null,
          this.actor.id,
          this.now(),
          this.now(),
        ),
    ];
    if (v.type === "source")
      statements.push(
        this.db
          .prepare(
            "UPDATE knowledge_sources SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), v.targetId),
      );
    else
      statements.push(
        this.db
          .prepare(
            "UPDATE knowledge_documents SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), v.targetId),
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id) VALUES(?) ON CONFLICT(document_id) DO UPDATE SET generation=generation+1",
          )
          .bind(v.targetId),
        this.snapshot(v.targetId),
      );
    return this.mutate(
      v,
      v.active ? "whitelist.add" : "whitelist.remove",
      v.type,
      v.targetId,
      v,
      statements,
      "admin",
    );
  }
  override async archiveSource(id: string, raw: unknown) {
    if (
      await this.db
        .prepare(
          "SELECT 1 AS ok FROM console_protections WHERE target_type='source' AND target_id=? AND active=1 AND (expires_at_ms IS NULL OR expires_at_ms>?)",
        )
        .bind(id, Date.parse(this.now()))
        .first()
    )
      throw new ApiError(
        "CONFIRMATION_REQUIRED",
        "请先解除来源白名单保护，再删除来源。",
      );
    return super.archiveSource(id, raw);
  }
  override async publish(id: string, raw: unknown, withdraw = false) {
    if (
      !withdraw &&
      (await this.db
        .prepare(
          "SELECT 1 AS ok FROM console_document_controls WHERE document_id=? AND hold_reason='retention'",
        )
        .bind(id)
        .first())
    )
      throw new ApiError("FORBIDDEN", "请先核对清理墓碑并明确批准恢复。");
    return super.publish(id, raw, withdraw);
  }
  async releaseTombstone(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = CommandSchema.parse(raw);
    const allowed = await this.db
      .prepare("SELECT id FROM console_history_exempt WHERE id=?")
      .bind(id)
      .first();
    if (!allowed)
      throw new ApiError("FORBIDDEN", "需要明确的历史导入白名单豁免。");
    await this.document(id);
    return this.mutate(
      v,
      "whitelist.release-tombstone",
      "document",
      id,
      v,
      [
        this.db
          .prepare(
            "UPDATE console_cleanup_tombstones SET released_at=? WHERE document_id=?",
          )
          .bind(this.now(), id),
        this.db
          .prepare(
            "UPDATE console_document_controls SET hold_reason=CASE WHEN hold_reason='retention' THEN NULL ELSE hold_reason END,hold_at=CASE WHEN hold_reason='retention' THEN NULL ELSE hold_at END,generation=generation+1 WHERE document_id=?",
          )
          .bind(id),
        this.db
          .prepare(
            "UPDATE knowledge_documents SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), id),
        this.snapshot(id),
      ],
      "admin",
    );
  }
  async plans(raw: unknown) {
    consolePermission(this.actor, "read");
    const q = ProtectionQuery.omit({
      type: true,
      sourceType: true,
      status: true,
    }).parse(raw);
    const where = q.q ? "WHERE id LIKE ?" : "";
    const args = q.q ? ["%" + q.q.replace(/[%_]/g, "") + "%"] : [];
    const rows = await this.db
      .prepare(
        "SELECT * FROM console_cleanup_plans " +
          where +
          " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
      )
      .bind(...args, q.limit, q.offset)
      .all<Row>();
    const n = await this.db
      .prepare("SELECT count(*) n FROM console_cleanup_plans " + where)
      .bind(...args)
      .first<{ n: number }>();
    return {
      items: rows.results,
      total: n?.n || 0,
      limit: q.limit,
      offset: q.offset,
    };
  }
  async planItems(id: string, raw: unknown) {
    await this.plan(id);
    const q = ProtectionQuery.omit({
      type: true,
      sourceType: true,
      status: true,
    }).parse(raw);
    const args: unknown[] = [id];
    const where = q.q ? " AND d.title LIKE ? ESCAPE '\\'" : "";
    if (q.q) args.push("%" + q.q.replace(/[\\%_]/g, "\\$&") + "%");
    const base =
      " FROM console_cleanup_items i JOIN knowledge_documents d ON d.id=i.document_id WHERE i.plan_id=?" +
      where;
    const rows = await this.db
      .prepare(
        "SELECT i.*,d.title,d.published_at" +
          base +
          " ORDER BY i.document_id LIMIT ? OFFSET ?",
      )
      .bind(...args, q.limit, q.offset)
      .all<Row>();
    const n = await this.db
      .prepare("SELECT count(*) n" + base)
      .bind(...args)
      .first<{ n: number }>();
    return {
      items: rows.results,
      total: n?.n || 0,
      offset: q.offset,
      limit: q.limit,
    };
  }
  async plan(id: string): Promise<
    PlanRow & {
      counts: Row[];
      unknownDate: number;
      purgeAllowed: boolean;
      confirmation: string;
    }
  > {
    consolePermission(this.actor, "read");
    const p = await this.db
      .prepare("SELECT * FROM console_cleanup_plans WHERE id=?")
      .bind(id)
      .first<PlanRow>();
    if (!p) throw new ApiError("NOT_FOUND", "未找到清理计划。");
    const counts = await this.db
      .prepare(
        "SELECT classification,stage,count(*) AS n,sum(logical_bytes) AS logical_bytes FROM console_cleanup_items WHERE plan_id=? GROUP BY classification,stage",
      )
      .bind(id)
      .all<Row>();
    const unknown = await this.db
      .prepare(
        "SELECT count(*) n FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND published_at IS NULL",
      )
      .first<{ n: number }>();
    return {
      ...p,
      counts: counts.results,
      unknownDate: unknown?.n || 0,
      purgeAllowed: this.purgeAllowed,
      confirmation: `清理 ${id} ${p.scanned}`,
    };
  }
  async createPlan(raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = RetentionCreate.parse(raw),
      id = "retention-" + v.commandId;
    return this.mutate(
      { commandId: v.commandId, expectedVersion: 0 },
      "retention.create",
      "job",
      id,
      v,
      [
        this.db
          .prepare(
            "INSERT INTO console_cleanup_plans(id,admin_id,filters_json,state,created_at,updated_at) VALUES(?,?,?,'previewing',?,?)",
          )
          .bind(
            id,
            this.actor.id,
            JSON.stringify(v.filters),
            this.now(),
            this.now(),
          ),
      ],
      "admin",
    );
  }
  private async classification(id: string) {
    return this.db
      .prepare(
        `SELECT d.version,d.published_at,d.lifecycle_status,d.valid_until,${protectedDocumentSql()} AS protected,
 (EXISTS(SELECT 1 FROM user_favorites WHERE target_type='document' AND target_id=d.id) OR EXISTS(SELECT 1 FROM event_sources WHERE document_id=d.id) OR EXISTS(SELECT 1 FROM knowledge_facts WHERE document_id=d.id) OR EXISTS(SELECT 1 FROM knowledge_documents x WHERE x.superseded_by=d.id)) AS dependent,
 (length(CAST(d.body AS BLOB))+length(CAST(d.summary AS BLOB))+COALESCE((SELECT sum(length(CAST(snapshot_json AS BLOB))) FROM console_content_versions WHERE document_id=d.id),0)+COALESCE((SELECT sum(length(CAST(input_json AS BLOB))) FROM console_revision_payloads WHERE document_id=d.id),0)+COALESCE((SELECT sum(length(CAST(text AS BLOB))) FROM knowledge_chunks WHERE document_id=d.id),0)) AS logical_bytes
 FROM knowledge_documents d WHERE d.id=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'`,
      )
      .bind(id)
      .first<Row>();
  }
  private classify(r: Row, cutoff: string) {
    if (r.protected) return "protected";
    if (r.dependent) return "dependency";
    const day = r.published_at
      ? String(r.published_at).length === 10
        ? String(r.published_at)
        : new Date(Date.parse(String(r.published_at)) + 28800000)
            .toISOString()
            .slice(0, 10)
      : null;
    if (
      !day ||
      day >= cutoff ||
      (r.lifecycle_status === "active" &&
        (!r.valid_until ||
          Date.parse(String(r.valid_until)) > Date.parse(this.now())))
    )
      return "valid";
    return "candidate";
  }
  private cleanupGuard(
    plan: string,
    doc: string,
    version: number,
    cutoff: string,
    commandId: string,
  ) {
    return this.db
      .prepare(
        "INSERT INTO console_cleanup_guards(plan_id,document_id,document_version,cutoff,command_id) VALUES(?,?,?,?,?)",
      )
      .bind(plan, doc, version, cutoff, commandId);
  }
  async actPlan(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = RetentionAction.parse(raw),
      p = await this.plan(id),
      f = RetentionFilters.parse(JSON.parse(String(p.filters_json))),
      statements: Statement[] = [];
    let next = String(p.state),
      cursor = String(p.cursor),
      scanned = Number(p.scanned),
      logical = Number(p.logical_bytes);
    if (v.action === "scan") {
      if (p.state !== "previewing")
        throw new ApiError("CONFLICT", "当前计划不在预览阶段。");
      const where = [
          "d.owner_user_id IS NULL",
          "d.data_domain<>'user_private'",
          "d.id>?",
          "(CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)<?",
        ],
        args: unknown[] = [cursor, f.cutoff];
      for (const [column, value] of [
        ["d.source_id", f.sourceId],
        ["s.channel_type", f.sourceType],
        ["d.publication_status", f.publication],
        ["d.body_status", f.body],
      ])
        if (value) {
          where.push(column + "=?");
          args.push(value);
        }
      if (f.q) {
        where.push("d.title LIKE ? ESCAPE '\\'");
        args.push("%" + f.q.replace(/[\\%_]/g, "\\$&") + "%");
      }
      if (f.category) {
        where.push("(d.radar_category=? OR d.knowledge_category=?)");
        args.push(f.category, f.category);
      }
      if (f.tag) {
        where.push(
          "EXISTS(SELECT 1 FROM document_tags t WHERE t.document_id=d.id AND t.content_revision=d.content_revision AND t.tag=?)",
        );
        args.push(f.tag);
      }
      const rows = await this.db
        .prepare(
          "SELECT d.id FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE s.console_managed=1 AND " +
            where.join(" AND ") +
            " ORDER BY d.id LIMIT 5",
        )
        .bind(...args)
        .all<{ id: string }>();
      for (const r of rows.results) {
        const c = await this.classification(r.id);
        if (!c) continue;
        statements.push(
          this.db
            .prepare(
              "INSERT INTO console_cleanup_items(plan_id,document_id,document_version,classification,logical_bytes) VALUES(?,?,?,?,?)",
            )
            .bind(
              id,
              r.id,
              c.version,
              this.classify(c, f.cutoff),
              c.logical_bytes,
            ),
        );
        cursor = r.id;
        scanned++;
        logical += Number(c.logical_bytes);
      }
      if (rows.results.length < 5) next = "ready";
    } else if (v.action === "pause") {
      if (!["previewing", "marking", "purging"].includes(next))
        throw new ApiError("CONFLICT", "当前阶段不能暂停。");
      statements.push(
        this.db
          .prepare(
            "UPDATE console_cleanup_plans SET resume_state=state WHERE id=?",
          )
          .bind(id),
      );
      next = "paused";
    } else if (v.action === "resume") {
      if (next !== "paused") throw new ApiError("CONFLICT", "计划未暂停。");
      next = String(p.resume_state);
    } else if (v.action === "mark") {
      if (!["ready", "marking"].includes(next))
        throw new ApiError("CONFLICT", "请先完成清理预览。");
      if (next === "ready" && v.confirmation !== p.confirmation)
        throw new ApiError("CONFIRMATION_REQUIRED", "请按预览范围确认清理。");
      next = "marking";
      const items = await this.db
        .prepare(
          "SELECT * FROM console_cleanup_items WHERE plan_id=? AND classification='candidate' AND stage='preview' ORDER BY document_id LIMIT 5",
        )
        .bind(id)
        .all<Row>();
      for (const item of items.results) {
        const did = String(item.document_id),
          c = await this.classification(did);
        if (
          !c ||
          Number(c.version) !== Number(item.document_version) ||
          this.classify(c, f.cutoff) !== "candidate"
        ) {
          statements.push(
            this.db
              .prepare(
                "UPDATE console_cleanup_items SET stage='blocked',error='记录已变化或受保护' WHERE plan_id=? AND document_id=?",
              )
              .bind(id, did),
          );
          continue;
        }
        statements.push(
          this.cleanupGuard(id, did, Number(c.version), f.cutoff, v.commandId),
          this.db
            .prepare(
              "UPDATE knowledge_documents SET publication_status='withdrawn',lifecycle_status='withdrawn',version=version+1,updated_at=? WHERE id=? AND version=?",
            )
            .bind(this.now(), did, item.document_version),
          this.db
            .prepare(
              "INSERT INTO console_document_controls(document_id,hold_reason,hold_at) VALUES(?,'retention',?) ON CONFLICT(document_id) DO UPDATE SET generation=generation+1,hold_reason=COALESCE(console_document_controls.hold_reason,'retention'),hold_at=COALESCE(console_document_controls.hold_at,excluded.hold_at)",
            )
            .bind(did, this.now()),
          this.snapshot(did),
          this.db
            .prepare(
              "UPDATE console_cleanup_items SET stage='marked',document_version=document_version+1 WHERE plan_id=? AND document_id=?",
            )
            .bind(id, did),
        );
      }
      if (items.results.length < 5) next = "marked";
    } else if (v.action === "purge") {
      if (!this.purgeAllowed)
        throw new ApiError(
          "FORBIDDEN",
          "此环境永久清理未获批准；可查看预览结果。",
        );
      if (!["marked", "purging"].includes(next))
        throw new ApiError("CONFLICT", "请先标记并使索引失效。");
      if (next === "marked" && v.confirmation !== "永久" + p.confirmation)
        throw new ApiError(
          "CONFIRMATION_REQUIRED",
          "需要再次确认永久清理范围。",
        );
      next = "purging";
      const item = await this.db
        .prepare(
          "SELECT * FROM console_cleanup_items WHERE plan_id=? AND classification='candidate' AND stage IN('marked','versions','payloads','chunks') ORDER BY document_id LIMIT 1",
        )
        .bind(id)
        .first<Row>();
      if (!item) next = "complete";
      else {
        const did = String(item.document_id),
          c = await this.classification(did);
        if (
          !c ||
          Number(c.version) !== Number(item.document_version) ||
          this.classify(c, f.cutoff) !== "candidate"
        )
          statements.push(
            this.db
              .prepare(
                "UPDATE console_cleanup_items SET stage='blocked',error='清理前复查未通过' WHERE plan_id=? AND document_id=?",
              )
              .bind(id, did),
          );
        else {
          statements.push(
            this.cleanupGuard(
              id,
              did,
              Number(c.version),
              f.cutoff,
              v.commandId,
            ),
          );
          let stage = String(item.stage);
          if (stage === "marked") stage = "versions";
          if (stage === "versions") {
            const rows = await this.db
              .prepare(
                "SELECT version FROM console_content_versions WHERE document_id=? AND json_extract(snapshot_json,'$.purged') IS NOT 1 ORDER BY version LIMIT 10",
              )
              .bind(did)
              .all<{ version: number }>();
            for (const r of rows.results)
              statements.push(
                this.db
                  .prepare(
                    "UPDATE console_content_versions SET snapshot_json=json_object('purged',1,'contentRevision',content_revision,'inputHash',input_hash) WHERE document_id=? AND version=?",
                  )
                  .bind(did, r.version),
              );
            if (rows.results.length < 10) stage = "payloads";
          } else if (stage === "payloads") {
            statements.push(
              this.db
                .prepare(
                  "DELETE FROM console_revision_payloads WHERE rowid IN(SELECT rowid FROM console_revision_payloads WHERE document_id=? LIMIT 10)",
                )
                .bind(did),
            );
            const n = await this.db
              .prepare(
                "SELECT count(*) n FROM console_revision_payloads WHERE document_id=?",
              )
              .bind(did)
              .first<{ n: number }>();
            if ((n?.n || 0) <= 10) stage = "chunks";
          } else if (stage === "chunks") {
            statements.push(
              this.db
                .prepare(
                  "DELETE FROM knowledge_chunks WHERE id IN(SELECT id FROM knowledge_chunks WHERE document_id=? LIMIT 10)",
                )
                .bind(did),
            );
            const n = await this.db
              .prepare(
                "SELECT count(*) n FROM knowledge_chunks WHERE document_id=?",
              )
              .bind(did)
              .first<{ n: number }>();
            if ((n?.n || 0) <= 10) {
              stage = "complete";
              statements.push(
                this.db
                  .prepare(
                    "INSERT INTO console_cleanup_tombstones(document_id,source_id,canonical_url,content_hash,plan_id,admin_id,deleted_at) SELECT id,source_id,url,content_hash,?,?,? FROM knowledge_documents WHERE id=? ON CONFLICT(document_id) DO UPDATE SET plan_id=excluded.plan_id,admin_id=excluded.admin_id,deleted_at=excluded.deleted_at,released_at=NULL",
                  )
                  .bind(id, this.actor.id, this.now(), did),
                this.db
                  .prepare(
                    "UPDATE knowledge_documents SET body='内容已清理',summary='',body_status='not_provided',input_hash=NULL,approved_input_hash=NULL,approved_content_revision=NULL,workflow_status='pending',review_status='pending',updated_at=? WHERE id=?",
                  )
                  .bind(this.now(), did),
              );
            }
          }
          statements.push(
            this.db
              .prepare(
                "UPDATE console_cleanup_items SET stage=? WHERE plan_id=? AND document_id=?",
              )
              .bind(stage, id, did),
          );
        }
      }
    }
    statements.push(
      this.db
        .prepare(
          "UPDATE console_cleanup_plans SET state=?,cursor=?,scanned=?,logical_bytes=?,version=version+1,updated_at=?,confirmed_at=CASE WHEN ? IN('marking','marked') THEN COALESCE(confirmed_at,?) ELSE confirmed_at END,completed_at=CASE WHEN ?='complete' THEN ? ELSE completed_at END WHERE id=?",
        )
        .bind(
          next,
          cursor,
          scanned,
          logical,
          this.now(),
          next,
          this.now(),
          next,
          this.now(),
          id,
        ),
    );
    if (next === "complete")
      statements.push(
        this.db
          .prepare(
            "UPDATE console_engine_settings SET last_cleanup_json=json_object('planId',?,'completedAt',?,'logicalBytesPreview',?,'actualStorageFreed',NULL,'purgedDocuments',(SELECT count(*) FROM console_cleanup_items WHERE plan_id=? AND stage='complete')) WHERE id='console-v2-settings'",
          )
          .bind(id, this.now(), logical, id),
      );
    return this.mutate(
      v,
      "retention." + v.action,
      "job",
      id,
      v,
      statements,
      "admin",
    );
  }
}
