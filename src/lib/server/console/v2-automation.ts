import { ConsoleGovernanceStore } from "./v2-governance";
import {
  AutoPolicySchema,
  AttestationSchema,
} from "@/domain/console/automation";
import {
  ContentWriteSchema,
  PublishSchema,
  ReviewSchema,
  type ContentDetail,
  type SourceDetail,
} from "@/domain/console/contracts";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";
import {
  contentCompleteness,
  completenessVersion,
} from "@/lib/ingestion/completeness";
import type { Statement } from "../assistant/database";
import { tokenHash } from "../assistant/crypto";
import { CommandSchema, ContentInputSchema } from "@/domain/console/contracts";
import {
  KnowledgeCategorySchema,
  RadarCategorySchema,
} from "@/domain/console/taxonomy";
type Row = Record<string, string | number | null>;
const publisher = {
  id: "sys-console-publisher",
  email: "publisher@system.invalid",
  role: "operator" as const,
};
export class ConsoleAutomationStore extends ConsoleGovernanceStore {
  async classifyArticlePlacement(id: string, raw: unknown) {
    consolePermission(this.actor, "publish");
    const value = CommandSchema.extend({
      radarCategory: RadarCategorySchema.nullable(),
      knowledgeCategory: KnowledgeCategorySchema.nullable(),
    })
      .strict()
      .refine((v) => !!v.radarCategory !== !!v.knowledgeCategory)
      .parse(raw);
    const d = await this.document(id);
    if (!d.inputHash)
      throw new ApiError(
        "INVALID_ARGUMENT",
        "此文章已清理或尚未形成可用修订。",
      );
    if (d.kind === "event" && !value.radarCategory)
      throw new ApiError("INVALID_ARGUMENT", "结构化活动应归入校园雷达。");
    const data = ContentInputSchema.parse(
      Object.fromEntries(
        Object.keys(ContentInputSchema.shape).map((k) => [
          k,
          d[k as keyof typeof d],
        ]),
      ),
    );
    const inputHash = await tokenHash(
      JSON.stringify({
        ...data,
        radarCategory: value.radarCategory,
        knowledgeCategory: value.knowledgeCategory,
      }),
    );
    const revision = d.contentRevision + (inputHash !== d.inputHash ? 1 : 0);
    const result = await this.mutate(
      value,
      "document.classify",
      "document",
      id,
      value,
      [
        this.db
          .prepare(
            "UPDATE knowledge_documents SET radar_category=?,knowledge_category=?,content_revision=?,input_hash=?,approved_content_revision=CASE WHEN workflow_status='approved' THEN ? ELSE NULL END,approved_input_hash=CASE WHEN workflow_status='approved' THEN ? ELSE NULL END,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(
            value.radarCategory,
            value.knowledgeCategory,
            revision,
            inputHash,
            revision,
            inputHash,
            this.now(),
            id,
          ),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO document_tags(document_id,content_revision,tag) SELECT document_id,?,tag FROM document_tags WHERE document_id=? AND content_revision=?",
          )
          .bind(revision, id, d.contentRevision),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO console_content_attestations(document_id,content_revision,input_hash,admin_id,evidence_urls_json,created_at) SELECT document_id,?,?,?,evidence_urls_json,? FROM console_content_attestations WHERE document_id=? AND content_revision=? AND input_hash=?",
          )
          .bind(
            revision,
            inputHash,
            this.actor.id,
            this.now(),
            id,
            d.contentRevision,
            d.inputHash,
          ),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO console_content_attestations(document_id,content_revision,input_hash,admin_id,evidence_urls_json,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_fetches f JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version WHERE f.document_id=? AND v.content_revision=? AND v.input_hash=? AND f.status IN(200,304) AND f.outcome IN('ok','not_modified') AND EXISTS(SELECT 1 FROM console_document_controls c WHERE c.document_id=f.document_id AND c.last_change_origin='source_author'))",
          )
          .bind(
            id,
            revision,
            inputHash,
            this.actor.id,
            JSON.stringify([d.url]),
            this.now(),
            id,
            d.contentRevision,
            d.inputHash,
          ),
        this.snapshot(id),
      ],
      "publish",
      d.sourceId,
    );
    await this.analyse(id);
    return result;
  }

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
        "INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at,content_revision,input_hash) SELECT id,version,json_object('inputRef',CASE WHEN input_hash IS NOT NULL AND content_revision>0 THEN content_revision END,'inputAvailable',input_hash IS NOT NULL AND content_revision>0,'inputHash',input_hash,'publicationStatus',publication_status,'reviewStatus',workflow_status),?,?,content_revision,input_hash FROM knowledge_documents WHERE id=? AND owner_user_id IS NULL AND data_domain<>'user_private'",
      )
      .bind(this.actor.id, this.now(), id);
  }
  override async version(id: string, version: number) {
    const snapshot = await super.version(id, version);
    if (snapshot.inputAvailable === 0 || snapshot.purged === 1)
      throw new ApiError(
        "NOT_FOUND",
        "该修订正文已清理或没有可恢复的修订载荷。",
      );
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
        value.summary =
          value.rightsScope === "metadata_only"
            ? `关于「${value.title.slice(0, 100)}」的来源信息，请以原文为准。`
            : "原文摘录：" + value.body.replace(/\s+/g, " ").slice(0, 180);
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
        !value.radarCategory &&
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
        ? Object.keys(value).filter(
            (k) =>
              !["commandId", "expectedVersion"].includes(k) &&
              JSON.stringify(old[k as keyof typeof old]) !==
                JSON.stringify(value[k as keyof typeof value]),
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
  private pendingReview?: {
    id: string;
    decision: string;
    revision: number;
    hash: string | null;
  };
  override async review(id: string, raw: unknown) {
    const v = ReviewSchema.parse(raw),
      d = await this.document(id);
    this.pendingReview = {
      id,
      decision: v.decision,
      revision: d.contentRevision,
      hash: d.inputHash,
    };
    try {
      const r = await super.review(id, v);
      try {
        await this.analyse(id);
      } catch {
        /* Current input stays unavailable when checks cannot finish. */
      }
      return r;
    } finally {
      this.pendingReview = undefined;
    }
  }
  private pendingHold?: { id: string; withdraw: boolean };
  protected override async mutate(
    ...args: Parameters<ConsoleGovernanceStore["mutate"]>
  ) {
    if (args[1] === "document.review" && this.pendingReview) {
      const r = this.pendingReview;
      args[5] = [
        ...args[5],
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id,review_hold,review_hold_revision,review_hold_input_hash) VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET generation=generation+1,review_hold=excluded.review_hold,review_hold_revision=excluded.review_hold_revision,review_hold_input_hash=excluded.review_hold_input_hash",
          )
          .bind(
            r.id,
            r.decision === "approved" ? null : r.decision,
            r.decision === "approved" ? null : r.revision,
            r.decision === "approved" ? null : r.hash,
          ),
      ];
    }
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
    if (args[1] === "manual.import") {
      const payload = args[4] as {
        items: { originalChecked?: boolean; url: string }[];
      };
      for (const [ordinal, item] of payload.items.entries())
        if (item.originalChecked) {
          consolePermission(this.actor, "admin");
          args[5].push(
            this.db
              .prepare(
                "INSERT OR REPLACE INTO console_content_attestations(document_id,content_revision,input_hash,admin_id,evidence_urls_json,created_at) SELECT d.id,d.content_revision,d.input_hash,?,?,? FROM manual_import_items i JOIN knowledge_documents d ON d.id=i.document_id WHERE i.job_id=? AND i.ordinal=? AND NOT EXISTS(SELECT 1 FROM console_manual_links l WHERE l.job_id=i.job_id AND l.ordinal=i.ordinal)",
              )
              .bind(
                this.actor.id,
                JSON.stringify([item.url]),
                this.now(),
                args[3],
                ordinal,
              ),
            this.db
              .prepare(
                "UPDATE console_document_controls SET generation=generation+1 WHERE document_id=(SELECT document_id FROM manual_import_items WHERE job_id=? AND ordinal=? AND NOT EXISTS(SELECT 1 FROM console_manual_links l WHERE l.job_id=manual_import_items.job_id AND l.ordinal=manual_import_items.ordinal))",
              )
              .bind(args[3], ordinal),
          );
        }
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
  private async metadataPublication(
    d: ContentDetail,
    s: SourceDetail,
    control: Row | null,
  ) {
    if (d.rightsScope !== "metadata_only" || d.kind !== "knowledge")
      return null;
    // A link card asserts only captured metadata. It does not assert an event's
    // time/place or authorize third-party body text, indexing, or a map event.
    const proof = await this.db
      .prepare(
        "SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM console_content_attestations WHERE document_id=? AND content_revision=? AND input_hash=?) OR EXISTS(SELECT 1 FROM document_fetches f JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version WHERE f.document_id=? AND v.content_revision=? AND v.input_hash=? AND f.status IN(200,304) AND f.outcome IN('ok','not_modified') AND EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=f.document_id AND x.last_change_origin='source_author'))",
      )
      .bind(
        d.id,
        d.contentRevision,
        d.inputHash,
        d.id,
        d.contentRevision,
        d.inputHash,
      )
      .first();
    const optOut = await this.db
      .prepare(
        "SELECT 1 AS ok FROM console_publication_policies WHERE source_id=? AND enabled=0",
      )
      .bind(s.id)
      .first();
    const blocked =
      !!optOut ||
      !s.enabled ||
      s.permissionStatus === "denied" ||
      !!control?.hold_reason ||
      control?.review_hold === "rejected" ||
      ["expired", "superseded"].includes(String(control?.lifecycle_status)) ||
      !!(d.validUntil && Date.parse(d.validUntil) <= Date.parse(this.now()));
    const issues =
      blocked || control?.review_hold
        ? [
            {
              code: "blocked",
              severity: "error",
              message: "文章已撤回、停用或失效",
            },
          ]
        : !proof
          ? [
              {
                code: "original_evidence",
                severity: "error",
                message: "原文身份、标题与发布时间尚未核对",
              },
            ]
          : !!d.radarCategory === !!d.knowledgeCategory ||
              d.contentType === "unknown"
            ? [
                {
                  code: "category",
                  severity: "error",
                  message: "请选择唯一分类",
                },
              ]
            : [];
    const outcome = blocked ? "blocked" : issues.length ? "review" : "pass";
    const checkId = crypto.randomUUID();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO console_content_checks(id,document_id,document_version,content_revision,input_hash,source_version,policy_version,control_generation,rule_version,outcome,severity,issues_json,fields_json,evidence_json,created_at,created_by) VALUES(?,?,?,?,?,?,0,?,'console-metadata-v1',?,'error',?,'{}','[]',?,?)",
      )
      .bind(
        checkId,
        d.id,
        d.version,
        d.contentRevision,
        d.inputHash,
        s.version,
        Number(control?.generation || 0),
        outcome,
        JSON.stringify(issues),
        this.now(),
        publisher.id,
      )
      .run();
    const visible = await this.db
      .prepare("SELECT 1 AS ok FROM console_public_documents WHERE id=?")
      .bind(d.id)
      .first();
    if (
      outcome !== "pass" ||
      (visible &&
        control?.last_publication_mode === "auto" &&
        control.auto_policy_version === 0)
    )
      return { id: d.id, outcome, issues, published: !!visible };
    const check = await this.db
      .prepare(
        "SELECT id FROM console_content_checks WHERE document_id=? AND content_revision=? AND input_hash=? AND source_version=? AND policy_version=0 AND control_generation=? AND rule_version='console-metadata-v1' AND outcome='pass'",
      )
      .bind(
        d.id,
        d.contentRevision,
        d.inputHash,
        s.version,
        Number(control?.generation || 0),
      )
      .first<{ id: string }>();
    if (!check)
      return { id: d.id, outcome: "review", issues, published: false };
    const commandId = crypto.randomUUID();
    await this.mutate(
      { commandId, expectedVersion: d.version },
      "document.metadata_publish",
      "document",
      d.id,
      { note: "按负责人默认公开要求发布已核对的文章元数据" },
      [
        this.db
          .prepare(
            "UPDATE knowledge_documents SET workflow_status='approved',review_status='approved',publication_status='published',lifecycle_status='active',approved_content_revision=content_revision,approved_input_hash=input_hash,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(this.now(), d.id),
        this.db
          .prepare(
            "INSERT INTO console_document_controls(document_id,last_publication_mode,auto_policy_version,auto_content_revision,auto_input_hash) VALUES(?,'auto',0,?,?) ON CONFLICT(document_id) DO UPDATE SET last_publication_mode='auto',auto_policy_version=0,auto_content_revision=excluded.auto_content_revision,auto_input_hash=excluded.auto_input_hash",
          )
          .bind(d.id, d.contentRevision, d.inputHash),
        this.snapshot(d.id),
        this.db
          .prepare(
            "INSERT INTO console_auto_publications(command_id,document_id,publication_version,check_id,policy_version,created_at) VALUES(?,?,?,?,0,?)",
          )
          .bind(commandId, d.id, d.version + 1, check.id, this.now()),
      ],
      "write",
      s.id,
      [],
      { checkId: check.id },
    );
    return { id: d.id, outcome, issues, published: true };
  }
  private async evaluate(id: string) {
    const d = await this.document(id),
      s = await this.source(d.sourceId),
      p = await this.autoPolicy(s.id);
    const control = await this.db
      .prepare("SELECT * FROM console_document_controls WHERE document_id=?")
      .bind(id)
      .first<Row>();
    const metadata = await this.metadataPublication(d, s, control);
    if (metadata) return metadata;
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
    if (
      !blocked &&
      (ranks.indexOf(d.rightsScope) < 0 ||
        control?.lifecycle_status === "expired" ||
        control?.lifecycle_status === "superseded" ||
        (d.validUntil &&
          (!Number.isFinite(Date.parse(d.validUntil)) ||
            Date.parse(d.validUntil) <= Date.parse(this.now()))))
    )
      blocked = "内容已过期、被替代或使用范围未确认";
    const provenance = await this.db
      .prepare(
        "SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM document_fetches f JOIN console_content_versions v ON v.document_id=f.document_id AND v.version=f.snapshot_version WHERE f.document_id=? AND EXISTS(SELECT 1 FROM console_document_controls dc WHERE dc.document_id=f.document_id AND dc.last_change_origin='source_author') AND f.status IN(200,304) AND v.content_revision=? AND v.input_hash=(SELECT input_hash FROM knowledge_documents WHERE id=f.document_id) AND f.outcome IN('ok','not_modified')) OR EXISTS(SELECT 1 FROM console_content_attestations WHERE document_id=? AND content_revision=? AND input_hash=?)",
      )
      .bind(id, d.contentRevision, id, d.contentRevision, d.inputHash)
      .first();
    const check = contentCompleteness(d, {
      rights: String(p?.rights_scope || "metadata_only"),
      unknownDate: String(p?.unknown_date_strategy || "review"),
      defaultCategory: String(p?.default_knowledge_category || ""),
      provenance: !!provenance,
    });
    if (
      control?.last_change_origin === "source_author" &&
      JSON.parse(String(control.last_overridden_fields_json || "[]")).includes(
        "validUntil",
      ) &&
      !d.validUntil
    ) {
      check.issues.push({
        code: "validity_changed",
        severity: "error",
        message: "新原文不足以确认此前的有效期，请复核",
      });
      check.outcome = "review";
    }
    if (blocked) {
      check.outcome = "review";
      check.issues.unshift({
        code: "blocked",
        severity: "error",
        message: blocked,
      });
    }
    if (control?.review_hold) {
      check.issues.unshift({
        code: "manual_review",
        severity: "error",
        message:
          control.review_hold_revision === d.contentRevision &&
          control.review_hold_input_hash === d.inputHash
            ? control.review_hold === "rejected"
              ? "当前修订已被人工拒绝"
              : "当前修订已退回处理"
            : "原文出现新修订，请复核此前的人工处理决定",
      });
      check.outcome = "review";
    }
    const outcome =
      blocked ||
      (control?.review_hold === "rejected" &&
        control.review_hold_revision === d.contentRevision &&
        control.review_hold_input_hash === d.inputHash)
        ? "blocked"
        : check.outcome;
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
    const visible = await this.db
      .prepare("SELECT 1 AS ok FROM console_public_documents WHERE id=?")
      .bind(id)
      .first();
    const stillPublished =
      d.publicationStatus === "published" &&
      !!visible &&
      (control?.last_publication_mode !== "auto" ||
        Number(control?.auto_policy_version) === Number(p?.version));
    if (outcome !== "pass" || stillPublished) {
      await this.db.batch([insert]);
      return {
        id,
        outcome,
        issues: check.issues,
        published: !!visible,
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
    const publicReceipt = await this.db
      .prepare("SELECT 1 AS ok FROM console_public_documents WHERE id=?")
      .bind(id)
      .first();
    return { id, outcome, issues: check.issues, published: !!publicReceipt };
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
  protected override async importDefaults(sourceId: string) {
    const p = await this.db
      .prepare(
        "SELECT default_knowledge_category FROM console_publication_policies WHERE source_id=? AND enabled=1 AND expires_at_ms>?",
      )
      .bind(sourceId, Date.parse(this.now()))
      .first<{ default_knowledge_category: string | null }>();
    return { knowledgeCategory: p?.default_knowledge_category || null };
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
