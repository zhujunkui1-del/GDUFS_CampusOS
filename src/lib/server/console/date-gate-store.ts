import { z } from "zod";
import { ConsoleRetentionStore } from "./v2-retention";
import { consolePermission } from "./auth";
import { protectedDocumentSql } from "./v2-sql";
import { CommandSchema, ConsoleIdSchema } from "@/domain/console/contracts";
import { ApiError } from "../errors";
import type { Statement } from "../assistant/database";

type Row = Record<string, string | number | null>;
type GateDetail = Record<string, unknown> & {
  id: string;
  version: number;
  state: string;
  restored_count: number;
  items: Row[];
  offset: number;
};
const day =
  "(CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)";
const scope = `d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'
 AND (${day}<? OR (? IS NOT NULL AND ${day}>=? AND ${day}<? AND EXISTS(SELECT 1 FROM console_date_unrestricted_documents u WHERE u.id=d.id)))
 AND NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)`;
const range = (cutoff: string, previous: string | number | null) => [
  cutoff,
  previous,
  cutoff,
  previous,
];
const page = z
  .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
  .strict();

export class ConsoleDateGateStore extends ConsoleRetentionStore {
  private gateAssert(condition: string, args: unknown[] = []) {
    return this.db
      .prepare(
        `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('DATE_GATE_CHANGED','$') END`,
      )
      .bind(...args);
  }
  async gateSettings() {
    consolePermission(this.actor, "read");
    return this.engineSettings();
  }
  async gateHistory(raw: unknown) {
    consolePermission(this.actor, "read");
    const q = page.parse(raw);
    const [items, count] = await Promise.all([
      this.db
        .prepare(
          "SELECT p.*,(SELECT count(*) FROM console_cleanup_items i WHERE i.plan_id=p.id AND i.stage='complete') AS cleaned_count,(SELECT count(*) FROM console_cleanup_items i WHERE i.plan_id=p.id AND i.stage='complete' AND i.gate_action='hide') AS hidden_count,(SELECT count(*) FROM console_cleanup_items i WHERE i.plan_id=p.id AND i.stage='complete' AND i.gate_action='restore') AS restored_count FROM console_cleanup_plans p WHERE confirmed_at IS NOT NULL ORDER BY confirmed_at DESC,id DESC LIMIT 20 OFFSET ?",
        )
        .bind(q.offset)
        .all<Row>(),
      this.db
        .prepare(
          "SELECT count(*) AS n FROM console_cleanup_plans WHERE confirmed_at IS NOT NULL",
        )
        .first<{ n: number }>(),
    ]);
    return { items: items.results, total: count?.n || 0, offset: q.offset };
  }
  async gateDetail(id: string, raw: unknown = {}): Promise<GateDetail> {
    consolePermission(this.actor, "read");
    ConsoleIdSchema.parse(id);
    const q = page.parse(raw);
    const plan = await this.db
      .prepare("SELECT * FROM console_cleanup_plans WHERE id=?")
      .bind(id)
      .first<Row>();
    if (!plan) throw new ApiError("NOT_FOUND", "未找到门禁记录。");
    const [items, counts] = await Promise.all([
      this.db
        .prepare(
          "SELECT document_id,saved_title AS title,saved_published_at AS published_at,saved_source_id AS source_id,saved_source_name AS source_name,saved_url AS url,classification,stage,error,gate_action FROM console_cleanup_items WHERE plan_id=? ORDER BY document_id LIMIT 20 OFFSET ?",
        )
        .bind(id, q.offset)
        .all<Row>(),
      this.db
        .prepare(
          "SELECT count(*) AS total,sum(classification='candidate') AS candidates,sum(classification='candidate' AND gate_action='hide') AS hide_count,sum(classification='candidate' AND gate_action='restore') AS restore_count,sum(classification='protected') AS protected_count,sum(stage='complete') AS cleaned_count,sum(stage='complete' AND gate_action='hide') AS hidden_count,sum(stage='complete' AND gate_action='restore') AS restored_count,sum(stage='blocked') AS skipped_count FROM console_cleanup_items WHERE plan_id=?",
        )
        .bind(id)
        .first<Row>(),
    ]);
    return {
      ...plan,
      ...counts,
      id: String(plan.id),
      version: Number(plan.version),
      state: String(plan.state),
      restored_count: Number(counts?.restored_count || 0),
      items: items.results,
      offset: q.offset,
    };
  }
  async previewGate(raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = z
      .object({ commandId: z.string().uuid(), cutoff: z.iso.date() })
      .strict()
      .parse(raw);
    const settings = await this.engineSettings();
    if (!settings)
      throw new ApiError("SERVICE_UNAVAILABLE", "门禁设置暂不可读。");
    const id = "retention-" + v.commandId;
    await this.mutate(
      { commandId: v.commandId, expectedVersion: 0 },
      "retention.gate-preview",
      "job",
      id,
      v,
      [
        this.gateAssert(
          "EXISTS(SELECT 1 FROM console_engine_settings WHERE id='console-v2-settings' AND version=?)",
          [settings.version],
        ),
        this.db
          .prepare(
            "INSERT INTO console_cleanup_plans(id,admin_id,filters_json,state,mode,gate_behavior,previous_cutoff,settings_version,created_at,updated_at) VALUES(?,?,?,'ready','date_gate','visibility',?,?,?,?)",
          )
          .bind(
            id,
            this.actor.id,
            JSON.stringify({ cutoff: v.cutoff }),
            settings.earliest_import_day,
            settings.version,
            this.now(),
            this.now(),
          ),
        this.db
          .prepare(
            `INSERT INTO console_cleanup_items(plan_id,document_id,document_version,classification,saved_title,saved_published_at,saved_source_id,saved_source_name,saved_url,gate_action) SELECT ?,d.id,d.version,CASE WHEN ${protectedDocumentSql()} THEN 'protected' ELSE 'candidate' END,d.title,d.published_at,d.source_id,s.display_name,d.url,CASE WHEN ${day}<? THEN 'hide' ELSE 'restore' END FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${scope}`,
          )
          .bind(id, v.cutoff, ...range(v.cutoff, settings.earliest_import_day)),
        this.db
          .prepare(
            "UPDATE console_cleanup_plans SET scanned=(SELECT count(*) FROM console_cleanup_items WHERE plan_id=?) WHERE id=?",
          )
          .bind(id, id),
      ],
      "admin",
    );
    return this.gateDetail(id);
  }
  async actGate(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = CommandSchema.extend({
      action: z.enum(["confirm", "cancel", "clean"]),
    })
      .strict()
      .parse(raw);
    const p = await this.db
      .prepare(
        "SELECT * FROM console_cleanup_plans WHERE id=? AND mode='date_gate'",
      )
      .bind(ConsoleIdSchema.parse(id))
      .first<Row>();
    if (!p || p.gate_cancelled_at)
      throw new ApiError("CONFLICT", "此门禁预览已取消或不存在。");
    if (p.gate_behavior !== "visibility" && v.action !== "cancel")
      throw new ApiError("CONFLICT", "旧清理预览已停用，请重新预览门禁日期。");
    const cutoff = z.iso
      .date()
      .parse(JSON.parse(String(p.filters_json)).cutoff);
    const statements: Statement[] = [];
    if (v.action === "cancel") {
      if (p.confirmed_at)
        throw new ApiError(
          "CONFLICT",
          "已确认的门禁不能取消；可完成当前清理后再预览新的日期。",
        );
      statements.push(
        this.db
          .prepare(
            "UPDATE console_cleanup_plans SET gate_cancelled_at=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), this.now(), id),
      );
    } else if (v.action === "confirm") {
      if (
        p.state !== "ready" ||
        p.confirmed_at ||
        Date.parse(this.now()) - Date.parse(String(p.created_at)) > 1800000
      )
        throw new ApiError("CONFLICT", "请重新预览后确认门禁日期。");
      // Date, complete membership and every version/protection status must match the review.
      statements.push(
        this.gateAssert(
          "NOT EXISTS(SELECT 1 FROM console_cleanup_plans WHERE mode='date_gate' AND gate_behavior='visibility' AND state='purging' AND confirmed_at IS NOT NULL AND id<>?)",
          [id],
        ),
        this.gateAssert(
          "EXISTS(SELECT 1 FROM console_engine_settings WHERE id='console-v2-settings' AND version=?)",
          [p.settings_version],
        ),
        this.gateAssert(
          `(SELECT count(*) FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${scope})=(SELECT count(*) FROM console_cleanup_items WHERE plan_id=?)`,
          [...range(cutoff, p.previous_cutoff), id],
        ),
        this.gateAssert(
          `NOT EXISTS(SELECT 1 FROM console_cleanup_items i LEFT JOIN knowledge_documents d ON d.id=i.document_id WHERE i.plan_id=? AND (d.id IS NULL OR d.version<>i.document_version OR i.classification<>CASE WHEN ${protectedDocumentSql()} THEN 'protected' ELSE 'candidate' END))`,
          [id],
        ),
        this.db
          .prepare(
            "UPDATE console_engine_settings SET earliest_import_day=?,public_visibility_revision=public_visibility_revision+1,version=version+1,updated_at=? WHERE id='console-v2-settings'",
          )
          .bind(cutoff, this.now()),
        this.db
          .prepare(
            "UPDATE campus_collector_sources SET since_day=?,updated_at=?",
          )
          .bind(cutoff, this.now()),
        this.db
          .prepare(
            "UPDATE console_cleanup_plans SET state='purging',confirmed_at=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), this.now(), id),
      );
    } else {
      if (!p.confirmed_at || !["purging", "complete"].includes(String(p.state)))
        throw new ApiError("CONFLICT", "请先确认门禁时间。");
      if (p.state === "complete") return this.gateDetail(id);
      const rows = await this.db
        .prepare(
          "SELECT document_id,document_version,gate_action FROM console_cleanup_items WHERE plan_id=? AND classification='candidate' AND stage='preview' ORDER BY document_id LIMIT 25",
        )
        .bind(id)
        .all<Row>();
      for (const item of rows.results) {
        const did = String(item.document_id);
        const current = await this.db
          .prepare(
            `SELECT d.version,${protectedDocumentSql()} AS protected FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=? AND ${scope}`,
          )
          .bind(did, ...range(cutoff, p.previous_cutoff))
          .first<Row>();
        if (
          !current ||
          current.version !== item.document_version ||
          current.protected
        ) {
          statements.push(
            this.db
              .prepare(
                "UPDATE console_cleanup_items SET stage='blocked',error='文章已变化或受到保护，请重新预览' WHERE plan_id=? AND document_id=?",
              )
              .bind(id, did),
          );
          continue;
        }
        statements.push(
          // Public visibility follows the current date window and whitelist.
          // Batch processing only invalidates derived indexes and records the
          // reviewed result; content, approvals and publication receipts survive.
          this.db
            .prepare(
              "INSERT INTO content_index_invalidations(document_id,version,reason) VALUES(?,?,?)",
            )
            .bind(did, item.document_version, "date_gate_" + item.gate_action),
          this.db
            .prepare(
              "UPDATE console_cleanup_items SET stage='complete' WHERE plan_id=? AND document_id=?",
            )
            .bind(id, did),
        );
      }
      statements.push(
        this.db
          .prepare(
            "UPDATE console_cleanup_plans SET state=CASE WHEN EXISTS(SELECT 1 FROM console_cleanup_items WHERE plan_id=? AND classification='candidate' AND stage='preview') THEN 'purging' ELSE 'complete' END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM console_cleanup_items WHERE plan_id=? AND classification='candidate' AND stage='preview') THEN ? ELSE NULL END,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(id, id, this.now(), this.now(), id),
      );
    }
    await this.mutate(
      v,
      v.action === "clean"
        ? "retention.gate-apply"
        : "retention.gate-" + v.action,
      "job",
      id,
      v,
      statements,
      "admin",
    );
    return this.gateDetail(id);
  }
}
