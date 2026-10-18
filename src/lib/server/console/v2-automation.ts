import { ConsoleGovernanceStore } from "./v2-governance";
import {
  AutoPolicySchema,
  AttestationSchema,
} from "@/domain/console/automation";
import { ContentWriteSchema, PublishSchema } from "@/domain/console/contracts";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";
import {
  contentCompleteness,
  completenessVersion,
} from "@/lib/ingestion/completeness";
import type { Statement } from "../assistant/database";
type Row = Record<string, string | number | null>;
const publisher = {
  id: "sys-console-publisher",
  email: "publisher@system.invalid",
  role: "operator" as const,
};
export class ConsoleAutomationStore extends ConsoleGovernanceStore {
  async autoPolicy(id: string) {
    await this.source(id);
    return this.db
      .prepare("SELECT * FROM console_publication_policies WHERE source_id=?")
      .bind(id)
      .first<Row>();
  }
  async setAutoPolicy(id: string, raw: unknown) {
    consolePermission(this.actor, "publish");
    const v = AutoPolicySchema.parse(raw),
      s = await this.source(id);
    if (
      v.enabled &&
      (!s.enabled ||
        s.permissionStatus !== "approved" ||
        (s.officialStatus !== "verified_official" &&
          (!v.allowUnofficial || v.rightsScope !== "metadata_only")))
    )
      throw new ApiError("INVALID_ARGUMENT", "请先核验来源与用途许可。");
    if (v.enabled) {
      const { effectiveRights } = await this.importPolicy(id);
      const ranks = ["metadata_only", "excerpt_and_link", "licensed_full_text"];
      if (ranks.indexOf(effectiveRights) < ranks.indexOf(v.rightsScope))
        throw new ApiError(
          "INVALID_ARGUMENT",
          "自动发布不得扩大来源使用许可。",
        );
    }
    return this.mutate(
      v,
      "source.auto-policy",
      "source",
      id,
      v,
      [
        this.db
          .prepare(
            "INSERT INTO console_publication_policies(source_id,enabled,rights_scope,default_knowledge_category,unknown_date_strategy,allow_unofficial,expires_at_ms,evidence_urls_json,note,approved_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET version=version+1,enabled=excluded.enabled,rights_scope=excluded.rights_scope,default_knowledge_category=excluded.default_knowledge_category,unknown_date_strategy=excluded.unknown_date_strategy,allow_unofficial=excluded.allow_unofficial,expires_at_ms=excluded.expires_at_ms,evidence_urls_json=excluded.evidence_urls_json,note=excluded.note,approved_by=excluded.approved_by,updated_at=excluded.updated_at",
          )
          .bind(
            id,
            Number(v.enabled),
            v.rightsScope,
            v.defaultCategory,
            v.unknownDate,
            Number(v.allowUnofficial),
            Date.parse(this.now()) + v.validityDays * 86400000,
            JSON.stringify(v.evidenceUrls),
            v.note,
            this.actor.id,
            this.now(),
          ),
        this.db
          .prepare(
            "UPDATE knowledge_sources SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), id),
      ],
      "publish",
    );
  }
  protected override snapshot(id: string): Statement {
    return this.db
      .prepare(
        "INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at,content_revision,input_hash) SELECT id,version,json_object('inputRef',content_revision,'inputHash',input_hash,'publicationStatus',publication_status,'reviewStatus',workflow_status),?,?,content_revision,input_hash FROM knowledge_documents WHERE id=? AND owner_user_id IS NULL AND data_domain<>'user_private'",
      )
      .bind(this.actor.id, this.now(), id);
  }
  override async version(id: string, version: number) {
    const snapshot = await super.version(id, version);
    if (!snapshot.inputRef) return snapshot;
    const payload = await this.db
      .prepare(
        "SELECT input_json FROM console_revision_payloads WHERE document_id=? AND content_revision=? AND input_hash=?",
      )
      .bind(id, snapshot.inputRef, snapshot.inputHash)
      .first<{ input_json: string }>();
    if (!payload) throw new ApiError("NOT_FOUND", "此修订的内容已清理。");
    return { ...snapshot, input: JSON.parse(payload.input_json) };
  }
  protected override async prepareContentWrite(
    id: string | undefined,
    raw: unknown,
    sourceFingerprint?: string,
  ) {
    const value = ContentWriteSchema.parse(raw);
    const p = await this.db
      .prepare(
        "SELECT default_knowledge_category FROM console_publication_policies WHERE source_id=? AND enabled=1",
      )
      .bind(value.sourceId)
      .first<Row>();
    if (sourceFingerprint) {
      if (!value.summary)
        value.summary = `关于「${value.title.slice(0, 100)}」的来源信息，请以原文为准。`;
      if (value.contentType === "unknown")
        value.contentType = /制度|办法|规定/.test(value.title)
          ? "policy"
          : /指南|办理流程/.test(value.title)
            ? "guide"
            : /活动|讲座|比赛/.test(value.title)
              ? "event"
              : "notice";
      if (
        value.kind === "knowledge" &&
        !value.knowledgeCategory &&
        p?.default_knowledge_category
      )
        value.knowledgeCategory = String(p.default_knowledge_category);
    }
    const old = id ? await this.document(id) : null;
    const prepared = await super.prepareContentWrite(
      id,
      value,
      sourceFingerprint,
    );
    const changes =
      old && sourceFingerprint
        ? [
            "title",
            "body",
            "summary",
            "publishedAt",
            "contentType",
            "knowledgeCategory",
          ].filter(
            (k) =>
              old[k as keyof typeof old] !== value[k as keyof typeof value],
          )
        : [];
    if (!old || prepared.inputHash !== old.inputHash)
      prepared.statements.push(
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id,last_change_origin,last_overridden_fields_json) VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET generation=generation+1,last_change_origin=excluded.last_change_origin,last_overridden_fields_json=excluded.last_overridden_fields_json",
          )
          .bind(
            prepared.key,
            sourceFingerprint
              ? "source_author"
              : id
                ? "human_edit"
                : "manual_import",
            JSON.stringify(changes),
          ),
      );
    if (old && sourceFingerprint && old.inputHash !== prepared.inputHash)
      prepared.statements.push(
        this.db
          .prepare(
            "UPDATE campus_events SET review_status='pending' WHERE id IN(SELECT event_id FROM event_sources WHERE document_id=?)",
          )
          .bind(prepared.key),
      );
    return prepared;
  }
  override async publish(id: string, raw: unknown, withdraw = false) {
    const v = PublishSchema.parse(raw);
    // The hold is written in the same command transaction as publication/withdrawal.
    this.pendingHold = { id, withdraw };
    try {
      return await super.publish(id, v, withdraw);
    } finally {
      this.pendingHold = undefined;
    }
  }
  private pendingHold?: { id: string; withdraw: boolean };
  protected override async mutate(
    ...args: Parameters<ConsoleGovernanceStore["mutate"]>
  ) {
    if (
      this.pendingHold &&
      ["document.publish", "document.withdraw"].includes(args[1])
    ) {
      const h = this.pendingHold;
      args[5] = [
        ...args[5],
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id,hold_reason,hold_at,last_publication_mode) VALUES(?,?,?,'manual') ON CONFLICT(document_id) DO UPDATE SET generation=generation+1,hold_reason=excluded.hold_reason,hold_at=excluded.hold_at,last_publication_mode='manual'",
          )
          .bind(
            h.id,
            h.withdraw ? "manual_withdrawal" : null,
            h.withdraw ? this.now() : null,
          ),
      ];
    }
    return super.mutate(...args);
  }
  async attest(id: string, raw: unknown) {
    consolePermission(this.actor, "publish");
    const v = AttestationSchema.parse(raw),
      d = await this.document(id);
    return this.mutate(
      v,
      "document.attest",
      "document",
      id,
      v,
      [
        this.db
          .prepare(
            "INSERT OR REPLACE INTO console_content_attestations(document_id,content_revision,input_hash,admin_id,evidence_urls_json,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            id,
            d.contentRevision,
            d.inputHash,
            this.actor.id,
            JSON.stringify(v.evidenceUrls),
            this.now(),
          ),
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id) VALUES(?) ON CONFLICT(document_id) DO UPDATE SET generation=generation+1",
          )
          .bind(id),
        this.db
          .prepare(
            "UPDATE knowledge_documents SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), id),
        this.snapshot(id),
      ],
      "publish",
    );
  }
  async checkDetails(id: string) {
    await this.document(id);
    return this.db
      .prepare(
        "SELECT * FROM console_content_checks WHERE document_id=? ORDER BY created_at DESC,id DESC LIMIT 10",
      )
      .bind(id)
      .all<Row>();
  }
  async analyse(id: string) {
    await this.document(id); // caller still needs current read permission
    return new ConsoleAutomationStore(this.db, publisher, this.now).evaluate(
      id,
    );
  }
  private async evaluate(id: string) {
    const d = await this.document(id),
      s = await this.source(d.sourceId),
      p = await this.autoPolicy(s.id);
    const control = await this.db
      .prepare("SELECT * FROM console_document_controls WHERE document_id=?")
      .bind(id)
      .first<Row>();
    let blocked: string | null = null;
    if (!s.enabled || s.permissionStatus !== "approved")
      blocked = "来源暂停或访问许可失效";
    else if (control?.hold_reason) blocked = "内容已撤回、取消或待清理";
    else if (!p?.enabled || Number(p.expires_at_ms) <= Date.parse(this.now()))
      blocked = "来源尚未授权自动发布或授权过期";
    else if (
      s.officialStatus !== "verified_official" &&
      (!p.allow_unofficial || p.rights_scope !== "metadata_only")
    )
      blocked = "来源身份不满足批准策略";
    const rights = await this.importPolicy(s.id);
    const ranks = ["metadata_only", "excerpt_and_link", "licensed_full_text"];
    if (
      !blocked &&
      (ranks.indexOf(rights.effectiveRights) <
        ranks.indexOf(String(p?.rights_scope)) ||
        ranks.indexOf(d.rightsScope) > ranks.indexOf(String(p?.rights_scope)))
    )
      blocked = "正文使用范围未获许可";
    const provenance = await this.db
      .prepare(
        "SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM document_fetches f JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version WHERE f.document_id=? AND f.status IN(200,304) AND v.content_revision=? AND v.input_hash=(SELECT input_hash FROM knowledge_documents WHERE id=f.document_id) AND f.outcome IN('ok','not_modified')) OR EXISTS(SELECT 1 FROM console_content_attestations WHERE document_id=? AND content_revision=? AND input_hash=?)",
      )
      .bind(id, d.contentRevision, id, d.contentRevision, d.inputHash)
      .first();
    const check = contentCompleteness(d, {
      rights: String(p?.rights_scope || "metadata_only"),
      unknownDate: String(p?.unknown_date_strategy || "review"),
      defaultCategory: String(p?.default_knowledge_category || ""),
      provenance: !!provenance,
    });
    if (blocked) {
      check.outcome = "review";
      check.issues.unshift({
        code: "blocked",
        severity: "error",
        message: blocked,
      });
    }
    const outcome = blocked ? "blocked" : check.outcome;
    const checkId = crypto.randomUUID();
    const insert = this.db
      .prepare(
        "INSERT OR IGNORE INTO console_content_checks(id,document_id,document_version,content_revision,input_hash,source_version,policy_version,control_generation,rule_version,outcome,severity,issues_json,fields_json,evidence_json,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        checkId,
        id,
        d.version,
        d.contentRevision,
        d.inputHash,
        s.version,
        Number(p?.version || 0),
        Number(control?.generation || 0),
        completenessVersion,
        outcome,
        "error",
        JSON.stringify(check.issues),
        JSON.stringify(check.fields),
        JSON.stringify(check.evidence),
        this.now(),
        publisher.id,
      );
    if (outcome !== "pass" || d.publicationStatus === "published") {
      await this.db.batch([insert]);
      return {
        id,
        outcome,
        issues: check.issues,
        published: d.publicationStatus === "published",
      };
    }
    const current = await this.db
      .prepare(
        "SELECT id FROM console_content_checks WHERE document_id=? AND content_revision=? AND input_hash=? AND source_version=? AND policy_version=? AND control_generation=? AND rule_version=?",
      )
      .bind(
        id,
        d.contentRevision,
        d.inputHash,
        s.version,
        Number(p?.version || 0),
        Number(control?.generation || 0),
        completenessVersion,
      )
      .first<{ id: string }>();
    const usedId = current?.id || checkId;
    const commandId = crypto.randomUUID();
    await this.mutate(
      { commandId, expectedVersion: d.version },
      "document.auto_publish",
      "document",
      id,
      { note: "来源级授权自动发布" },
      [
        this.db
          .prepare(
            "UPDATE knowledge_documents SET workflow_status='approved',review_status='approved',publication_status='published',lifecycle_status='active',approved_content_revision=content_revision,approved_input_hash=input_hash,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), id),
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id,last_publication_mode,auto_policy_version,auto_content_revision,auto_input_hash) VALUES(?,'auto',?,?,?) ON CONFLICT(document_id) DO UPDATE SET last_publication_mode='auto',auto_policy_version=excluded.auto_policy_version,auto_content_revision=excluded.auto_content_revision,auto_input_hash=excluded.auto_input_hash",
          )
          .bind(id, p!.version, d.contentRevision, d.inputHash),
        this.snapshot(id),
        this.db
          .prepare(
            "INSERT INTO console_auto_publications(command_id,document_id,publication_version,check_id,policy_version,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(commandId, id, d.version + 1, usedId, p!.version, this.now()),
      ],
      "write",
      s.id,
      [insert],
      { checkId: usedId },
    );
    return { id, outcome, issues: check.issues, published: true };
  }
  override async writeContent(
    id: string | undefined,
    raw: unknown,
    restoredFrom?: number,
  ) {
    const result = await super.writeContent(id, raw, restoredFrom);
    try {
      await this.analyse(result.id);
    } catch {
      /* Remains a draft when processing is unavailable. */
    }
    return result;
  }
  override async importBatch(raw: unknown) {
    const receipt = await super.importBatch(raw);
    const processing = [];
    for (const item of receipt.items)
      try {
        processing.push(await this.analyse(item.id));
      } catch {
        processing.push({ id: item.id, outcome: "processing_pending" });
      }
    return { ...receipt, processing };
  }
  override async commit(id: string, raw: unknown) {
    const result = await super.commit(id, raw);
    const row = await this.db
      .prepare(
        "SELECT document_id FROM ingestion_job_steps WHERE job_id=? AND step_key=?",
      )
      .bind(id, (raw as { commandId: string }).commandId)
      .first<{ document_id: string }>();
    if (row?.document_id)
      try {
        await this.analyse(row.document_id);
      } catch {
        /* The draft remains unavailable; bounded recheck is safe. */
      }
    return result;
  }
}
