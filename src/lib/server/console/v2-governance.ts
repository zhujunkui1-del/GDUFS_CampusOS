import { protectedDocumentSql, protectedSourceSql } from "./v2-sql";
import { ManualImportStore } from "./manual-store";
import { sqlLegacyType, sourceLocator } from "./store";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";
import type { Statement } from "../assistant/database";
import {
  VerificationSchema,
  PermissionSchema,
  OfficialStatusSchema,
  SourceTypeSchema,
  SourceEnableSchema,
  SourceVerifySchema,
  CommandSchema,
} from "@/domain/console/contracts";
import {
  GovernanceSchema,
  SourceCreateV2Schema,
  SourceEditV2Schema,
  SourcesV2Query,
  ArticleV2Query,
  EngineSettingsSchema,
  SourceSyncSchema,
  type Governance,
  type SourceV2,
} from "@/domain/console/v2";
import { webProfiles } from "@/lib/ingestion/profiles";
type Row = Record<string, string | number | null>;
const visible = "s.console_managed=1 AND s.source_type<>'user_private'";
const docs = "d.owner_user_id IS NULL AND d.data_domain<>'user_private'";
const active = "s.enabled=1 AND s.archived_at IS NULL";
const pattern = (s: string) => "%" + s.replace(/[\\%_]/g, "\\$&") + "%";
const articleCount =
  "(SELECT count(DISTINCT d.id) FROM knowledge_documents d WHERE " +
  docs +
  " AND (d.source_id=s.id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=s.id)))";
const publishedCount =
  "(SELECT count(DISTINCT d.id) FROM console_public_documents d WHERE d.source_id=s.id OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=s.id))";
const collectorState =
  "(SELECT enabled FROM campus_collector_sources WHERE source_id=s.id)";
export class ConsoleGovernanceStore extends ManualImportStore {
  private pendingCreate?: {
    governance?: Omit<Governance, "commandId" | "expectedVersion">;
    miniProgramId: string | null;
    sourceNote: string;
  };
  protected override async mutate(
    command: { commandId: string; expectedVersion: number },
    action: string,
    type: "source" | "document" | "job" | "admin",
    id: string,
    payload: unknown,
    statements: Statement[],
    permission = "write",
    sourceId?: string,
    before: Statement[] = [],
    trusted: Record<string, unknown> = {},
  ) {
    let data = payload;
    const additions: Statement[] = [];
    const details: Record<string, unknown> = { ...trusted, v2: 1 };
    if (action === "source.governance") details.governance = payload;
    if (action === "source.create" && this.pendingCreate) {
      const p = this.pendingCreate;
      if (p.governance) details.governance = p.governance;
      data = { ...(payload as object), ...p };
      additions.push(
        this.db
          .prepare(
            "UPDATE knowledge_sources SET mini_program_id=?,source_note=? WHERE id=?",
          )
          .bind(p.miniProgramId, p.sourceNote, id),
      );
      if (p.governance)
        additions.push(this.governanceWrite(id, p.governance, false));
    }
    return super.mutate(
      command,
      action,
      type,
      id,
      data,
      [...statements, ...additions],
      permission,
      sourceId,
      before,
      details,
    );
  }
  override async source(id: string) {
    return super.source(id);
  }
  async createGovernedSource(raw: unknown) {
    const v = SourceCreateV2Schema.parse(raw);
    const { miniProgramId, sourceNote, governance, ...base } = v;
    this.pendingCreate = { miniProgramId, sourceNote, governance };
    try {
      return await super.createSource(base);
    } finally {
      this.pendingCreate = undefined;
    }
  }
  private governanceWrite(
    id: string,
    v: Omit<Governance, "commandId" | "expectedVersion">,
    increment = true,
  ) {
    return this.db
      .prepare(
        `UPDATE knowledge_sources SET affiliation_status=?,operating_status=?,affiliation_evidence_json=?,operating_evidence_json=?,governance_note=?,governance_checked_at=?,enabled=?,retain_history=?,verification_status=CASE WHEN ?='confirmed' THEN 'verified' ELSE verification_status END,next_sync_at_ms=CASE WHEN ?=1 THEN ? ELSE NULL END,version=version+?,updated_at=? WHERE id=?`,
      )
      .bind(
        v.affiliation,
        v.operating,
        JSON.stringify(v.affiliationEvidence),
        JSON.stringify(v.operatingEvidence),
        v.note,
        this.now(),
        Number(v.enabled),
        Number(v.retainHistory),
        v.affiliation,
        Number(v.enabled),
        Date.parse(this.now()),
        Number(increment),
        this.now(),
        id,
      );
  }
  async governSource(id: string, raw: unknown) {
    const v = GovernanceSchema.parse(raw);
    await super.source(id);
    const statements = [this.governanceWrite(id, v)];
    if (!v.enabled)
      statements.push(
        this.db
          .prepare(
            "UPDATE ingestion_jobs SET control_state='paused',lease_hash=NULL,lease_until_ms=0,lease_fence=lease_fence+1,version=version+1,updated_at=? WHERE source_id=? AND phase<>'complete' AND control_state<>'cancelled'",
          )
          .bind(this.now(), id),
      );
    return this.mutate(v, "source.governance", "source", id, v, statements);
  }
  override async enableSource(id: string, raw: unknown) {
    const v = SourceEnableSchema.parse(raw);
    await super.source(id);
    const statements = [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET enabled=?,operating_status=CASE WHEN ?=1 THEN 'active' ELSE 'closed' END,version=version+1,next_sync_at_ms=CASE WHEN ?=1 THEN ? ELSE NULL END,updated_at=? WHERE id=?",
        )
        .bind(
          Number(v.enabled),
          Number(v.enabled),
          Number(v.enabled),
          Date.parse(this.now()),
          this.now(),
          id,
        ),
    ];
    if (!v.enabled)
      statements.push(
        this.db
          .prepare(
            "UPDATE ingestion_jobs SET control_state='paused',lease_until_ms=0,lease_hash=NULL,lease_fence=lease_fence+1,version=version+1,updated_at=? WHERE source_id=? AND phase<>'complete' AND control_state<>'cancelled'",
          )
          .bind(this.now(), id),
      );
    return this.mutate(v, "source.enable", "source", id, v, statements);
  }
  override async editSource(id: string, raw: unknown) {
    const value = SourceEditV2Schema.parse(raw);
    const old = await super.source(id);
    const priorIdentifier =
      value.miniProgramId !== undefined
        ? await this.db
            .prepare("SELECT mini_program_id FROM knowledge_sources WHERE id=?")
            .bind(id)
            .first<{ mini_program_id: string | null }>()
        : null;
    const identity =
      (priorIdentifier !== null &&
        priorIdentifier.mini_program_id !== value.miniProgramId) ||
      old.websiteUrl !== value.websiteUrl ||
      old.wechatId !== value.wechatId ||
      old.sourceType !== value.sourceType ||
      old.organization !== value.organization;
    const values: Record<string, unknown> = {
      display_name: value.displayName,
      source_aliases_json: JSON.stringify(value.sourceAliases),
      subtype: value.subtype,
      campus_scope: value.campusScope,
      evidence_urls_json: JSON.stringify(value.evidenceUrls),
      priority: value.priority,
      connector_type: value.connectorType,
      connector_config_json: JSON.stringify(value.connectorConfig),
      fetch_policy_json: JSON.stringify(value.fetchPolicy),
    };
    if (value.miniProgramId !== undefined)
      values.mini_program_id = value.miniProgramId;
    if (value.sourceNote !== undefined) values.source_note = value.sourceNote;
    if (identity)
      Object.assign(values, {
        website_url: value.websiteUrl,
        wechat_id: value.wechatId,
        organization: value.organization,
        channel_type: value.sourceType,
        source_type: sqlLegacyType(value.sourceType),
        allowed_domains_json: JSON.stringify(
          value.websiteUrl ? [new URL(value.websiteUrl).hostname] : [],
        ),
        entry_urls_json: JSON.stringify(
          value.websiteUrl ? [value.websiteUrl] : [],
        ),
        canonical_locator: sourceLocator(value),
        enabled: 0,
        affiliation_status: "unknown",
        operating_status: "unknown",
        governance_checked_at: null,
        verification_status: "pending",
        permission_status: "unreviewed",
        authorization_status: "pending",
        official_status:
          old.officialStatus === "verified_official"
            ? "claimed_official"
            : old.officialStatus,
      });
    return this.mutate(value, "source.edit", "source", id, value, [
      this.db
        .prepare(
          `UPDATE knowledge_sources SET ${Object.keys(values)
            .map((k) => k + "=?")
            .join(",")},version=version+1,updated_at=? WHERE id=?`,
        )
        .bind(...Object.values(values), this.now(), id),
    ]);
  }
  override async verifySource(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const v = SourceVerifySchema.parse(raw);
    const old = await super.source(id);
    if (
      (v.status === "verified" || v.officialStatus === "verified_official") &&
      !v.evidenceUrls.length
    )
      throw new ApiError("INVALID_ARGUMENT", "请提供来源核验证据。");
    if (
      v.officialStatus === "verified_official" &&
      (!v.authorityConfirmed || old.sourceType === "student_media")
    )
      throw new ApiError("INVALID_ARGUMENT", "请核对官方主体证据。");
    return this.mutate(
      v,
      "source.verify",
      "source",
      id,
      v,
      [
        this.db
          .prepare(
            "UPDATE knowledge_sources SET verification_status=?,official_status=?,permission_status=?,authorization_status=?,evidence_urls_json=?,last_checked_at=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(
            v.status,
            v.officialStatus,
            v.permissionStatus,
            v.permissionStatus === "approved"
              ? "approved"
              : v.permissionStatus === "denied"
                ? "rejected"
                : "pending",
            JSON.stringify(v.evidenceUrls),
            this.now(),
            this.now(),
            id,
          ),
      ],
      "admin",
    );
  }
  async restoreSource(id: string, raw: unknown) {
    const v = CommandSchema.parse(raw);
    return this.mutate(v, "source.restore", "source", id, v, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET archived_at=NULL,enabled=0,operating_status='unknown',next_sync_at_ms=NULL,version=version+1,updated_at=? WHERE id=? AND console_managed=1",
        )
        .bind(this.now(), id),
    ]);
  }
  override async archiveSource(id: string, raw: unknown) {
    const v = CommandSchema.parse(raw);
    await super.source(id);
    return this.mutate(v, "source.archive", "source", id, v, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET archived_at=?,enabled=0,next_sync_at_ms=NULL,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(this.now(), this.now(), id),
      this.db
        .prepare(
          "UPDATE ingestion_jobs SET control_state='cancelled',status='failed',error_code='SOURCE_ARCHIVED',lease_hash=NULL,lease_until_ms=0,lease_fence=lease_fence+1,version=version+1 WHERE source_id=? AND phase<>'complete' AND control_state<>'cancelled'",
        )
        .bind(id),
    ]);
  }
  async engineSettings() {
    consolePermission(this.actor, "read");
    return this.db
      .prepare(
        "SELECT * FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<Row>();
  }
  async saveEngineSettings(raw: unknown) {
    const v = EngineSettingsSchema.parse(raw);
    consolePermission(this.actor, "admin");
    const old = await this.engineSettings();
    if (
      v.earliestImportDay !== old?.earliest_import_day &&
      !v.confirmImportCutoff
    )
      throw new ApiError(
        "CONFIRMATION_REQUIRED",
        "请确认最早导入日期变更；已有内容不会自动删除。",
      );
    return this.mutate(
      v,
      "engine.settings",
      "job",
      "console-v2-settings",
      v,
      [
        this.db
          .prepare(
            "UPDATE console_engine_settings SET sync_hours=?,auto_sync_enabled=?,network_budget=?,earliest_import_day=?,sync_revision=sync_revision+CASE WHEN sync_hours<>? OR auto_sync_enabled<>? THEN 1 ELSE 0 END,version=version+1,updated_at=? WHERE id='console-v2-settings'",
          )
          .bind(
            v.syncHours,
            Number(v.autoSync),
            v.networkBudget,
            v.earliestImportDay,
            v.syncHours,
            Number(v.autoSync),
            this.now(),
          ),
        ...(old?.sync_hours !== v.syncHours ||
        old.auto_sync_enabled !== Number(v.autoSync)
          ? [
              this.db
                .prepare(
                  `UPDATE knowledge_sources SET next_sync_at_ms=CASE WHEN last_success_at IS NULL THEN ? ELSE CAST((julianday(last_success_at)-2440587.5)*86400000 AS INTEGER)+? END,sync_policy_version=(SELECT sync_revision FROM console_engine_settings WHERE id='console-v2-settings') WHERE console_managed=1 AND sync_hours_override IS NULL AND id IN(${webProfiles.map(() => "?").join(",")})`,
                )
                .bind(
                  Date.parse(this.now()),
                  v.syncHours * 3600000,
                  ...webProfiles.map((p) => p.sourceId),
                ),
            ]
          : []),
      ],
      "admin",
    );
  }
  async saveSourceSync(id: string, raw: unknown) {
    const v = SourceSyncSchema.parse(raw);
    await super.source(id);
    return this.mutate(v, "source.sync-settings", "source", id, v, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET sync_hours_override=?,next_sync_at_ms=?,sync_policy_version=0,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(v.hours, Date.parse(this.now()), this.now(), id),
    ]);
  }
  private sourceProjection(row: Row): SourceV2 {
    const profile = webProfiles.find((p) => p.sourceId === row.id);
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      sourceType: SourceTypeSchema.parse(row.channel_type),
      verificationStatus: VerificationSchema.parse(row.verification_status),
      permissionStatus: PermissionSchema.parse(row.permission_status),
      officialStatus: OfficialStatusSchema.parse(row.official_status),
      organization: String(row.organization),
      campusScope: String(row.campus_scope),
      websiteUrl: row.website_url ? String(row.website_url) : null,
      wechatId: row.wechat_id ? String(row.wechat_id) : null,
      miniProgramId: row.mini_program_id ? String(row.mini_program_id) : null,
      sourceNote: String(row.source_note || ""),
      affiliation: String(row.affiliation_status),
      operating: String(row.operating_status),
      enabled: row.enabled === 1 && !row.archived_at,
      registeredEnabled: row.enabled === 1,
      collectorEnabled:
        row.collector_enabled == null ? null : row.collector_enabled === 1,
      version: Number(row.version),
      automatic:
        row.sync_state !== "blocked" &&
        !!profile &&
        row.policy_rule === profile.ruleVersion &&
        Number(row.policy_expires) > Date.parse(this.now()) &&
        row.official_status === "verified_official" &&
        row.permission_status === "approved" &&
        row.authorization_status === "approved" &&
        row.operating_status === "active" &&
        row.enabled === 1,
      lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
      nextSyncAt:
        profile &&
        Number(row.policy_expires) > Date.parse(this.now()) &&
        row.next_sync_at_ms
          ? Number(row.next_sync_at_ms)
          : null,
      syncHours: Number(row.sync_hours_override || row.global_hours || 24),
      syncOverride: row.sync_hours_override
        ? Number(row.sync_hours_override)
        : null,
      syncState: String(row.sync_state),
      articleCount: Number(row.article_count || 0),
      publishedCount: Number(row.published_count || 0),
      lastError: row.last_error ? String(row.last_error).slice(0, 80) : null,
      protected: !!row.protected,
      governanceCheckedAt: row.governance_checked_at
        ? String(row.governance_checked_at)
        : null,
      affiliationEvidence: JSON.parse(String(row.affiliation_evidence_json)),
      operatingEvidence: JSON.parse(String(row.operating_evidence_json)),
      governanceNote: String(row.governance_note),
      retainHistory: row.retain_history === 1,
    };
  }
  async sourceV2(id: string) {
    consolePermission(this.actor, "read");
    const row = await this.db
      .prepare(
        `SELECT s.*,${collectorState} AS collector_enabled,${protectedSourceSql} AS protected,p.rule_version AS policy_rule,p.expires_at_ms AS policy_expires,e.sync_hours AS global_hours,${articleCount} AS article_count,${publishedCount} AS published_count FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id CROSS JOIN console_engine_settings e WHERE ${visible} AND s.id=?`,
      )
      .bind(id)
      .first<Row>();
    if (!row) throw new ApiError("NOT_FOUND", "未找到信息源。");
    return {
      ...this.sourceProjection(row),
      archivedAt: row.archived_at ? String(row.archived_at) : null,
    };
  }
  async sourcesV2(raw: unknown) {
    consolePermission(this.actor, "read");
    const q = SourcesV2Query.parse(raw),
      where = [
        visible,
        q.state === "archived"
          ? "s.archived_at IS NOT NULL"
          : "s.archived_at IS NULL",
      ],
      args: unknown[] = [];
    if (q.q) {
      where.push("s.display_name LIKE ? ESCAPE '\\'");
      args.push(pattern(q.q));
    }
    for (const [column, value] of [
      ["s.verification_status", q.verification],
      ["s.permission_status", q.permission],
      ["s.official_status", q.official],
      ["s.channel_type", q.type],

      ["s.affiliation_status", q.affiliation],
      ["s.operating_status", q.operating],
    ])
      if (value) {
        where.push(column + "=?");
        args.push(value);
      }
    if (q.state === "enabled") where.push(active);
    if (q.state === "paused")
      where.push(`NOT(${active}) AND s.operating_status<>'closed'`);
    if (q.state === "closed") where.push("s.enabled=0");
    if (q.error)
      where.push(
        q.error === "1" ? "s.last_error IS NOT NULL" : "s.last_error IS NULL",
      );
    if (q.updatedAfter) {
      where.push("date(s.updated_at,'+8 hours')>=?");
      args.push(q.updatedAfter);
    }
    if (q.updatedBefore) {
      where.push("date(s.updated_at,'+8 hours')<=?");
      args.push(q.updatedBefore);
    }
    const ids = webProfiles.map((p) => p.sourceId);
    if (q.automatic) {
      where.push(
        `s.id ${q.automatic === "1" ? "IN" : "NOT IN"} (${ids.map(() => "?").join(",")})`,
      );
      args.push(...ids);
    }
    if (q.protected)
      where.push((q.protected === "0" ? "NOT " : "") + protectedSourceSql);
    const order = {
      name: "s.display_name",
      updated: "s.updated_at",
      articles: "article_count",
      next_sync: "s.next_sync_at_ms",
    }[q.sort];
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT s.*,${collectorState} AS collector_enabled,${protectedSourceSql} AS protected,p.rule_version AS policy_rule,p.expires_at_ms AS policy_expires,e.sync_hours AS global_hours,${articleCount} AS article_count,${publishedCount} AS published_count FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id CROSS JOIN console_engine_settings e WHERE ${where.join(" AND ")} ORDER BY ${order} ${q.direction},s.id LIMIT ? OFFSET ?`,
        )
        .bind(...args, q.limit, q.offset)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT count(*) AS n FROM knowledge_sources s WHERE ${where.join(" AND ")}`,
        )
        .bind(...args)
        .first<{ n: number }>(),
    ]);
    return {
      items: rows.results.map((r) => this.sourceProjection(r)),
      total: count?.n || 0,
      limit: q.limit,
      offset: q.offset,
    };
  }
  async articlesV2(raw: unknown) {
    const q = ArticleV2Query.parse(raw);
    consolePermission(this.actor, "read");
    const where = [docs, visible],
      args: unknown[] = [];
    if (q.q) {
      where.push(
        q.titleOnly === "1"
          ? "d.title LIKE ? ESCAPE '\\'"
          : "(d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\' OR d.summary LIKE ? ESCAPE '\\')",
      );
      args.push(...Array(q.titleOnly === "1" ? 1 : 3).fill(pattern(q.q)));
    }
    if (q.sourceId) {
      where.push(
        "(d.source_id=? OR EXISTS(SELECT 1 FROM document_origins o WHERE o.document_id=d.id AND o.source_id=?))",
      );
      args.push(q.sourceId, q.sourceId);
    }
    for (const [column, value] of [
      ["d.content_type", q.type],

      ["d.publication_status", q.publication],
    ])
      if (value) {
        where.push(column + "=?");
        args.push(value);
      }
    if (q.review) {
      where.push(
        q.review === "unapproved"
          ? "d.workflow_status<>'approved'"
          : "d.workflow_status=?",
      );
      if (q.review !== "unapproved") args.push(q.review);
    }
    if (q.state)
      where.push(
        (q.state === "pending" ? "NOT " : "") +
          "EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id)",
      );
    if (q.category) {
      where.push("(d.radar_category=? OR d.knowledge_category=?)");
      args.push(q.category, q.category);
    }
    if (q.tag) {
      where.push(
        "EXISTS(SELECT 1 FROM document_tags t WHERE t.document_id=d.id AND t.content_revision=d.content_revision AND t.tag=?)",
      );
      args.push(q.tag);
    }
    for (const [column, after, before] of [
      ["d.published_at", q.publishedAfter, q.publishedBefore],
      ["d.fetched_at", q.fetchedAfter, q.fetchedBefore],
    ]) {
      if (after) {
        where.push(`date(${column},'+8 hours')>=?`);
        args.push(after);
      }
      if (before) {
        where.push(`date(${column},'+8 hours')<=?`);
        args.push(before);
      }
    }
    if (q.expired)
      where.push(
        q.expired === "1"
          ? "(d.lifecycle_status<>'active' OR julianday(d.valid_until)<=julianday('now'))"
          : "d.lifecycle_status='active' AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))",
      );
    if (q.protected)
      where.push((q.protected === "0" ? "NOT " : "") + protectedDocumentSql());
    if (q.issues === "1")
      where.push(
        "EXISTS(SELECT 1 FROM console_content_checks c WHERE c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.outcome='review' AND c.source_version=s.version AND c.policy_version=COALESCE((SELECT version FROM console_publication_policies WHERE source_id=s.id),0) AND c.control_generation=COALESCE((SELECT generation FROM console_document_controls WHERE document_id=d.id),0))",
      );
    if (q.severity || q.issue) {
      const clauses = [
        "c.document_id=d.id",
        "c.content_revision=d.content_revision",
        "c.input_hash=d.input_hash",
        "c.outcome='review'",
      ];
      if (q.severity) {
        clauses.push("c.severity=?");
        args.push(q.severity);
      }
      if (q.issue) {
        clauses.push(
          "EXISTS(SELECT 1 FROM json_each(c.issues_json) j WHERE json_extract(j.value,'$.code')=?)",
        );
        args.push(q.issue);
      }
      where.push(
        "EXISTS(SELECT 1 FROM console_content_checks c WHERE " +
          clauses.join(" AND ") +
          ")",
      );
    }
    const order = {
      updated: "d.updated_at",
      published: "d.published_at",
      title: "d.title",
    }[q.sort];
    const base = ` FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${where.join(" AND ")}`;
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM console_public_documents pub WHERE pub.id=d.id) AS public_visible,d.id,d.source_id,s.display_name AS source_name,d.title,d.published_at,d.fetched_at,d.updated_at,d.content_type,d.radar_category,d.knowledge_category,d.workflow_status,d.publication_status,d.lifecycle_status,d.body_status,d.version${base} ORDER BY ${order} ${q.direction},d.id LIMIT ? OFFSET ?`,
        )
        .bind(...args, q.limit, q.offset)
        .all<Row>(),
      this.db
        .prepare("SELECT count(*) AS n" + base)
        .bind(...args)
        .first<{ n: number }>(),
    ]);
    return {
      items: rows.results.map((row) => ({
        ...row,
        publication_state: row.public_visible === 1 ? "published" : "pending",
      })),
      total: count?.n || 0,
      limit: q.limit,
      offset: q.offset,
    };
  }
  async dashboard(raw: unknown) {
    const q = SourcesV2Query.parse(raw);
    const sources = await this.sourcesV2({ ...q, limit: 1 });
    const stats = await this.db
      .prepare(
        `SELECT (SELECT count(*) FROM knowledge_sources s WHERE ${visible} AND archived_at IS NULL) AS sources,(SELECT count(*) FROM knowledge_sources s WHERE ${visible} AND ${active}) AS enabled,(SELECT count(*) FROM knowledge_sources s WHERE ${visible} AND archived_at IS NULL AND NOT(${active}) AND operating_status NOT IN('closed','unreachable')) AS paused,(SELECT count(*) FROM knowledge_sources s WHERE ${visible} AND operating_status IN('closed','unreachable') AND archived_at IS NULL) AS unavailable,(SELECT count(*) FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${docs} AND ${visible} AND date((SELECT created_at FROM console_content_versions v WHERE v.document_id=d.id AND v.version=1),'+8 hours')=date('now','+8 hours')) AS todayNew,(SELECT count(*) FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${docs} AND ${visible} AND NOT EXISTS(SELECT 1 FROM console_public_documents p WHERE p.id=d.id)) AS pending,(SELECT count(*) FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${docs} AND ${visible} AND (d.publication_status='withdrawn' OR d.lifecycle_status<>'active' OR julianday(d.valid_until)<=julianday('now'))) AS inactive,(SELECT count(*) FROM ingestion_jobs WHERE status='failed') AS failed,(SELECT max(last_success_at) FROM knowledge_sources WHERE console_managed=1) AS lastSync,(SELECT min(next_sync_at_ms) FROM knowledge_sources s WHERE ${visible} AND ${active}) AS nextSync`,
      )
      .first<Row>();
    const storage = await this.db
      .prepare(
        "SELECT * FROM console_storage_samples ORDER BY measured_at DESC,id DESC LIMIT 10",
      )
      .all<Row>();
    const settings = await this.engineSettings();
    const usage = await this.db
      .prepare(
        "SELECT count(*)*2 AS reserved FROM console_commands WHERE action='job.claim' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now')",
      )
      .first<Row>();
    return {
      stats,
      filteredSources: sources.total,
      settings,
      networkUsage: Number(usage?.reserved || 0),
      storage: storage.results,
      unsupported: Math.max(
        0,
        Number(stats?.sources || 0) -
          Number(
            (
              await this.db
                .prepare(
                  `SELECT count(*) n FROM knowledge_sources WHERE console_managed=1 AND archived_at IS NULL AND id IN(${webProfiles.map(() => "?").join(",")})`,
                )
                .bind(...webProfiles.map((p) => p.sourceId))
                .first<{ n: number }>()
            )?.n || 0,
          ),
      ),
      scheduler: "not_connected",
      autoPublishedToday: null as number | null,
      protectedSources: null as number | null,
      protectedArticles: null as number | null,
      latestJobs: (await this.jobs({ limit: 5 })).items,
    };
  }
}
