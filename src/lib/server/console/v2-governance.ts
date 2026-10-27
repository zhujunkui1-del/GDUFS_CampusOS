import { z } from "zod";
import { protectedDocumentSql, protectedSourceSql } from "./v2-sql";
import { readSourceCounts, sourceDocumentPairs } from "./source-counts";
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
  type Governance,
  type SourceV2,
} from "@/domain/console/v2";
import { WebProfileSaveSchema } from "@/domain/console/web-profile";
import { profileFromSource, webProfiles } from "@/lib/ingestion/profiles";
type Row = Record<string, string | number | null>;
const visible = "s.console_managed=1 AND s.source_type<>'user_private'";
const docs = "d.owner_user_id IS NULL AND d.data_domain<>'user_private'";
const active = "s.enabled=1 AND s.archived_at IS NULL";
const pattern = (s: string) => "%" + s.replace(/[\\%_]/g, "\\$&") + "%";
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
          "UPDATE knowledge_sources SET enabled=?,archived_at=CASE WHEN ?=1 THEN NULL ELSE archived_at END,operating_status=CASE WHEN ?=1 THEN 'active' ELSE 'closed' END,version=version+1,next_sync_at_ms=CASE WHEN ?=1 THEN ? ELSE NULL END,updated_at=? WHERE id=?",
        )
        .bind(
          Number(v.enabled),
          Number(v.enabled),
          Number(v.enabled),
          Number(v.enabled),
          Date.parse(this.now()),
          this.now(),
          id,
        ),
    ];
    statements.push(
      this.db
        .prepare(
          "UPDATE campus_collector_sources SET enabled=?,updated_at=? WHERE source_id=?",
        )
        .bind(Number(v.enabled), this.now(), id),
    );
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
    const row = await this.db
      .prepare(
        "SELECT * FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<Row>();
    if (row) delete row.network_budget;
    return row;
  }
  async saveEngineSettings(raw: unknown) {
    const v = EngineSettingsSchema.parse(raw);
    consolePermission(this.actor, "admin");
    const old = await this.engineSettings();
    if (v.earliestImportDay !== old?.earliest_import_day)
      throw new ApiError(
        "INVALID_ARGUMENT",
        "请在过时信息清理中预览并确认门禁时间。",
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
            "UPDATE console_engine_settings SET sync_hours=?,auto_sync_enabled=?,earliest_import_day=?,sync_revision=sync_revision+CASE WHEN sync_hours<>? OR auto_sync_enabled<>? THEN 1 ELSE 0 END,version=version+1,updated_at=? WHERE id='console-v2-settings'",
          )
          .bind(
            v.syncHours,
            Number(v.autoSync),
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
                  "UPDATE knowledge_sources SET sync_hours_override=NULL,next_sync_at_ms=CASE WHEN last_success_at IS NULL THEN ? ELSE CAST((julianday(last_success_at)-2440587.5)*86400000 AS INTEGER)+? END,sync_policy_version=(SELECT sync_revision FROM console_engine_settings WHERE id='console-v2-settings') WHERE console_managed=1 AND channel_type='official_web' AND source_type='official_web' AND archived_at IS NULL",
                )
                .bind(Date.parse(this.now()), v.syncHours * 3600000),
            ]
          : []),
      ],
      "admin",
    );
  }
  async saveSourceSync(id: string, raw: unknown) {
    void raw;
    consolePermission(this.actor, "admin");
    const source = await this.sourceV2(id);
    if (source.sourceType !== "official_web")
      throw new ApiError("INVALID_ARGUMENT", "采集间隔仅适用于官网来源。");
    throw new ApiError(
      "INVALID_ARGUMENT",
      "所有官网使用官网采集中的统一间隔。",
    );
  }
  async saveWebProfile(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const value = WebProfileSaveSchema.parse(raw),
      source = await this.db
        .prepare(
          "SELECT id,display_name,website_url,channel_type,source_type,console_managed,archived_at,version FROM knowledge_sources WHERE id=?",
        )
        .bind(id)
        .first<Row>();
    if (
      !source ||
      source.console_managed !== 1 ||
      source.archived_at ||
      source.channel_type !== "official_web" ||
      source.source_type !== "official_web" ||
      !source.website_url
    )
      throw new ApiError("INVALID_ARGUMENT", "该来源没有可用的官网地址。");
    const ruleVersion = `official-web-${new Date(this.now())
      .toISOString()
      .slice(0, 10)}.${Number(source.version) + 1}`;
    const config = {
      configurationStatus: value.configurationStatus,
      earliestImportDay: value.earliestImportDay,
      latestImportDay: value.latestImportDay,
      entryUrls: value.entryUrls,
      articlePathPrefixes: value.articlePathPrefixes,
      titleSelector: value.titleSelector,
      titleSuffix: value.titleSuffix,
      dateSelector: value.dateSelector,
      dateLabel: value.dateLabel,
      bodySelector: value.bodySelector,
      allowQueryUrls: value.allowQueryUrls,
      requestIntervalMs: value.requestIntervalMs,
      ruleVersion,
    };
    try {
      profileFromSource({
        sourceId: id,
        name: String(source.display_name),
        websiteUrl: String(source.website_url),
        webProfileJson: JSON.stringify(config),
      });
    } catch {
      throw new ApiError(
        "INVALID_ARGUMENT",
        "列表入口和文章路径必须属于该官网的 HTTPS 域名。",
      );
    }
    return this.mutate(
      value,
      "source.web-profile",
      "source",
      id,
      { ...value, ruleVersion },
      [
        this.db
          .prepare(
            "UPDATE knowledge_sources SET web_profile_json=?,connector_type='official_web',sync_state='ready',next_sync_at_ms=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(JSON.stringify(config), Date.parse(this.now()), this.now(), id),
        this.db
          .prepare(
            "UPDATE source_collection_policies SET expires_at_ms=?,version=version+1,updated_at=? WHERE source_id=?",
          )
          .bind(Date.parse(this.now()), this.now(), id),
      ],
      "admin",
      id,
    );
  }
  async setOwnerWebCollectionPolicy(id: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const value = CommandSchema.extend({
        robotsStatus: z.union([z.literal(200), z.literal(404)]),
        robotsHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
        .strict()
        .parse(raw),
      source = await this.db
        .prepare(
          "SELECT id,display_name,website_url,web_profile_json,enabled,archived_at,channel_type,source_type,version FROM knowledge_sources WHERE id=?",
        )
        .bind(id)
        .first<Row>();
    if (
      !source ||
      source.archived_at ||
      source.enabled !== 1 ||
      source.channel_type !== "official_web" ||
      source.source_type !== "official_web"
    )
      throw new ApiError(
        "INVALID_ARGUMENT",
        "只能为启用中的官网来源登记本次采集任务。",
      );
    let profile: ReturnType<typeof profileFromSource> = null;
    try {
      profile = profileFromSource({
        sourceId: String(source.id),
        name: String(source.display_name),
        websiteUrl: source.website_url ? String(source.website_url) : null,
        webProfileJson: source.web_profile_json
          ? String(source.web_profile_json)
          : "{}",
      });
    } catch {
      profile = null;
    }
    if (!profile)
      throw new ApiError("INVALID_ARGUMENT", "该官网没有可复用的已配置入口。");
    const now = this.now(),
      note =
        "负责人指定官网文章采集并直接发布；此记录依据负责人指令，不代表另行核验来源方许可。";
    return this.mutate(
      value,
      "source.owner-web-policy",
      "source",
      id,
      { ...value, note, ruleVersion: profile.ruleVersion },
      [
        this.db
          .prepare(
            "INSERT INTO source_collection_policies(source_id,rule_version,rights_scope,evidence_urls_json,note,robots_status,robots_hash,expires_at_ms,approved_by,updated_at) VALUES(?,?,'licensed_full_text',?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET rule_version=excluded.rule_version,rights_scope=excluded.rights_scope,evidence_urls_json=excluded.evidence_urls_json,note=excluded.note,robots_status=excluded.robots_status,robots_hash=excluded.robots_hash,expires_at_ms=excluded.expires_at_ms,approved_by=excluded.approved_by,updated_at=excluded.updated_at,version=source_collection_policies.version+1",
          )
          .bind(
            id,
            profile.ruleVersion,
            JSON.stringify(profile.entryUrls.slice(0, 10)),
            note,
            value.robotsStatus,
            value.robotsHash,
            Date.parse(now) + 36500 * 86400000,
            this.actor.id,
            now,
          ),
        this.db
          .prepare(
            "UPDATE knowledge_sources SET connector_type='official_web',sync_state='ready',next_sync_at_ms=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(Date.parse(now), now, id),
      ],
      "admin",
      id,
    );
  }
  private sourceProjection(row: Row): SourceV2 {
    let profile: ReturnType<typeof profileFromSource> = null;
    try {
      profile = profileFromSource({
        sourceId: String(row.id),
        name: String(row.display_name),
        websiteUrl: row.website_url ? String(row.website_url) : null,
        webProfileJson: row.web_profile_json
          ? String(row.web_profile_json)
          : "{}",
      });
    } catch {
      profile = null;
    }
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
        `SELECT s.*,${collectorState} AS collector_enabled,${protectedSourceSql} AS protected,p.rule_version AS policy_rule,p.expires_at_ms AS policy_expires FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE ${visible} AND s.id=?`,
      )
      .bind(id)
      .first<Row>();
    if (!row) throw new ApiError("NOT_FOUND", "未找到信息源。");
    const counts = (await readSourceCounts(this.db, [id])).get(id);
    return {
      ...this.sourceProjection({ ...row, ...counts }),
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
      const configured =
        "(s.web_profile_json<>'{}' AND json_array_length(json_extract(s.web_profile_json,'$.entryUrls'))>0 AND json_array_length(json_extract(s.web_profile_json,'$.articlePathPrefixes'))>0)";
      where.push(
        q.automatic === "1"
          ? `(${configured} OR s.id IN (${ids.map(() => "?").join(",")}))`
          : `NOT(${configured} OR s.id IN (${ids.map(() => "?").join(",")}))`,
      );
      args.push(...ids);
    }
    if (q.protected)
      where.push((q.protected === "0" ? "NOT " : "") + protectedSourceSql);
    const order = {
      name: "s.display_name",
      updated: "s.updated_at",
      articles: "COALESCE(c.article_count,0)",
      next_sync: "s.next_sync_at_ms",
    }[q.sort];
    const byArticles = q.sort === "articles";
    const selectedSources = byArticles
      ? `WITH selected(source_id) AS MATERIALIZED(SELECT s.id FROM knowledge_sources s WHERE ${where.join(" AND ")}),
          ${sourceDocumentPairs},
          article_counts AS(SELECT source_id,count(*) AS article_count FROM pairs
            WHERE NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=pairs.document_id AND t.released_at IS NULL)
            GROUP BY source_id)`
      : "";
    const sourceFrom = byArticles
      ? "selected x JOIN knowledge_sources s ON s.id=x.source_id LEFT JOIN article_counts c ON c.source_id=s.id"
      : "knowledge_sources s";
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `${selectedSources} SELECT s.*,${collectorState} AS collector_enabled,${protectedSourceSql} AS protected,p.rule_version AS policy_rule,p.expires_at_ms AS policy_expires FROM ${sourceFrom} LEFT JOIN source_collection_policies p ON p.source_id=s.id ${byArticles ? "" : `WHERE ${where.join(" AND ")}`} ORDER BY ${order} ${q.direction},s.id LIMIT ? OFFSET ?`,
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
    const counts = await readSourceCounts(
      this.db,
      rows.results.map((row) => String(row.id)),
    );
    return {
      items: rows.results.map((r) =>
        this.sourceProjection({ ...r, ...counts.get(String(r.id)) }),
      ),
      total: count?.n || 0,
      limit: q.limit,
      offset: q.offset,
    };
  }
  async articlesV2(raw: unknown) {
    const q = ArticleV2Query.parse(raw);
    consolePermission(this.actor, "read");
    const selectedDocsCte = q.sourceId
      ? `WITH selected_docs(id) AS MATERIALIZED (
          SELECT id FROM knowledge_documents WHERE source_id=?
          UNION
          SELECT document_id FROM document_origins WHERE source_id=?
        )`
      : "";
    const where = [
        docs,
        visible,
        "NOT EXISTS(SELECT 1 FROM console_cleanup_tombstones t WHERE t.document_id=d.id AND t.released_at IS NULL)",
      ],
      args: unknown[] = q.sourceId ? [q.sourceId, q.sourceId] : [];
    if (q.q) {
      where.push(
        q.titleOnly === "1"
          ? "d.title LIKE ? ESCAPE '\\'"
          : "(d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\' OR d.summary LIKE ? ESCAPE '\\')",
      );
      args.push(...Array(q.titleOnly === "1" ? 1 : 3).fill(pattern(q.q)));
    }
    if (q.sourceId) {
      where.push("d.id IN(SELECT id FROM selected_docs)");
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
      where.push("(c.radar_category=? OR c.knowledge_category=?)");
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
    const base = ` FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_article_classifications c ON c.document_id=d.id WHERE ${where.join(" AND ")}`;
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `${selectedDocsCte} SELECT EXISTS(SELECT 1 FROM console_public_documents pub WHERE pub.id=d.id) AS public_visible,d.id,d.source_id,s.display_name AS source_name,d.title,d.published_at,d.fetched_at,d.updated_at,d.content_type,c.radar_category,c.knowledge_category,c.primary_destination,c.has_registration,c.classification_origin,d.workflow_status,d.publication_status,d.lifecycle_status,d.body_status,d.version${base} ORDER BY ${order} ${q.direction},d.id LIMIT ? OFFSET ?`,
        )
        .bind(...args, q.limit, q.offset)
        .all<Row>(),
      this.db
        .prepare(selectedDocsCte + " SELECT count(*) AS n" + base)
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
  async officialWebCollection(raw: unknown) {
    consolePermission(this.actor, "read");
    const q = z
        .object({
          q: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(2000).default(50),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .strict()
        .parse(raw),
      where = [
        "s.console_managed=1",
        "s.source_type='official_web'",
        "s.channel_type='official_web'",
        "s.archived_at IS NULL",
      ],
      args: unknown[] = [];
    if (q.q) {
      where.push("s.display_name LIKE ? ESCAPE '\\'");
      args.push(pattern(q.q));
    }
    const filter = where.join(" AND "),
      staticProfiles = webProfiles.map((profile) => ({
        id: profile.sourceId,
        ruleVersion: profile.ruleVersion,
      })),
      staticProfilesSql = staticProfiles.map(() => "(?,?)").join(","),
      now = Date.parse(this.now()),
      [rows, count, summary, settings] = await Promise.all([
        this.db
          .prepare(
            `SELECT s.id,s.display_name,s.website_url,s.web_profile_json,s.enabled,s.operating_status,s.verification_status,s.official_status,s.permission_status,s.authorization_status,s.version,s.sync_hours_override,s.next_sync_at_ms,s.last_success_at,s.last_error,s.last_executor,s.sync_state,p.version AS policy_version,p.rule_version AS policy_rule,p.rights_scope,p.expires_at_ms AS policy_expires FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE ${filter} ORDER BY s.display_name,s.id LIMIT ? OFFSET ?`,
          )
          .bind(...args, q.limit, q.offset)
          .all<Row>(),
        this.db
          .prepare(
            `SELECT count(*) AS n FROM knowledge_sources s WHERE ${filter}`,
          )
          .bind(...args)
          .first<{ n: number }>(),
        this.db
          .prepare(
            `WITH static_profiles(id,rule_version) AS (VALUES ${staticProfilesSql}),
              source_rows AS (
                SELECT s.id,s.web_profile_json,s.enabled,s.operating_status,s.verification_status,s.official_status,s.permission_status,s.authorization_status,s.sync_state,
                  p.rule_version AS policy_rule,p.expires_at_ms AS policy_expires,sp.id AS static_id,sp.rule_version AS static_rule,
                  CASE
                    WHEN s.web_profile_json IS NOT NULL AND s.web_profile_json<>'{}' THEN
                      CASE WHEN json_valid(s.web_profile_json) THEN
                        CASE WHEN json_type(s.web_profile_json,'$.ruleVersion')='text'
                          AND json_type(s.web_profile_json,'$.entryUrls')='array'
                          AND json_array_length(s.web_profile_json,'$.entryUrls')>0
                          AND json_type(s.web_profile_json,'$.articlePathPrefixes')='array'
                          AND json_array_length(s.web_profile_json,'$.articlePathPrefixes')>0 THEN 1 ELSE 0 END
                      ELSE 0 END
                    WHEN sp.id IS NOT NULL THEN 1 ELSE 0
                  END AS profile_configured,
                  CASE WHEN json_valid(s.web_profile_json) THEN
                    CASE WHEN json_extract(s.web_profile_json,'$.configurationStatus')='discovered' THEN 1 ELSE 0 END
                  ELSE 0 END AS profile_candidate,
                  CASE
                    WHEN s.web_profile_json IS NOT NULL AND s.web_profile_json<>'{}' THEN
                      CASE WHEN json_valid(s.web_profile_json) AND json_type(s.web_profile_json,'$.ruleVersion')='text' THEN json_extract(s.web_profile_json,'$.ruleVersion') ELSE NULL END
                    ELSE sp.rule_version
                  END AS profile_rule
                FROM knowledge_sources s
                LEFT JOIN source_collection_policies p ON p.source_id=s.id
                LEFT JOIN static_profiles sp ON sp.id=s.id
                WHERE s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.archived_at IS NULL
              ), readiness AS (
                SELECT *,
                  CASE WHEN profile_rule IS NOT NULL AND policy_rule=profile_rule AND COALESCE(policy_expires,0)>? THEN 1 ELSE 0 END AS policy_ready,
                  CASE WHEN enabled=1 AND operating_status='active' AND verification_status='verified' AND official_status='verified_official' AND permission_status='approved' AND authorization_status='approved' AND sync_state<>'blocked' THEN 1 ELSE 0 END AS source_ready,
                  CASE WHEN sync_state IN('queued','running') THEN 1 ELSE 0 END AS active_job
                FROM source_rows
              )
              SELECT count(*) AS all_total,
                COALESCE(sum(profile_configured),0) AS configured_total,
                COALESCE(sum(profile_candidate),0) AS candidate_total,
                COALESCE(sum(CASE WHEN profile_configured=0 THEN 1 ELSE 0 END),0) AS missing_profile_total,
                COALESCE(sum(CASE WHEN profile_configured=1 AND profile_candidate=0 AND policy_ready=0 THEN 1 ELSE 0 END),0) AS policy_pending_total,
                COALESCE(sum(CASE WHEN profile_configured=1 AND profile_candidate=0 AND policy_ready=1 AND source_ready=0 THEN 1 ELSE 0 END),0) AS source_pending_total,
                COALESCE(sum(CASE WHEN profile_configured=1 AND profile_candidate=0 AND policy_ready=1 AND source_ready=1 AND active_job=1 THEN 1 ELSE 0 END),0) AS active_job_total,
                COALESCE(sum(CASE WHEN profile_configured=1 AND profile_candidate=0 AND policy_ready=1 AND source_ready=1 AND active_job=0 THEN 1 ELSE 0 END),0) AS ready_total
              FROM readiness`,
          )
          .bind(
            ...staticProfiles.flatMap((profile) => [
              profile.id,
              profile.ruleVersion,
            ]),
            now,
          )
          .first<{
            all_total: number;
            configured_total: number | null;
            candidate_total: number | null;
            missing_profile_total: number | null;
            policy_pending_total: number | null;
            source_pending_total: number | null;
            active_job_total: number | null;
            ready_total: number | null;
          }>(),
        this.engineSettings(),
      ]);
    const items = rows.results.map((row) => {
      let profile: ReturnType<typeof profileFromSource> = null;
      try {
        profile = profileFromSource({
          sourceId: String(row.id),
          name: String(row.display_name),
          websiteUrl: row.website_url ? String(row.website_url) : null,
          webProfileJson: row.web_profile_json
            ? String(row.web_profile_json)
            : "{}",
        });
      } catch {
        profile = null;
      }
      const policyReady =
        !!profile &&
        row.policy_rule === profile.ruleVersion &&
        Number(row.policy_expires) > now;
      return {
        id: String(row.id),
        displayName: String(row.display_name),
        websiteUrl: row.website_url ? String(row.website_url) : null,
        enabled: row.enabled === 1,
        operatingStatus: String(row.operating_status),
        verificationStatus: String(row.verification_status),
        officialStatus: String(row.official_status),
        permissionStatus: String(row.permission_status),
        authorizationStatus: String(row.authorization_status),
        version: Number(row.version),
        profileConfigured: !!profile,
        entryUrls: profile?.entryUrls || (profile ? [profile.entryUrl] : []),
        articlePathPrefixes: profile?.detailPathPrefixes || [],
        profile: profile
          ? {
              configurationStatus: profile.configurationStatus || "verified",
              earliestImportDay: profile.earliestImportDay || null,
              latestImportDay: profile.latestImportDay || null,
              titleSelector: profile.titleSelector,
              titleSuffix: profile.titleSuffix,
              dateSelector: profile.dateSelector,
              dateLabel: profile.dateLabel,
              bodySelector: profile.bodySelector,
              allowQueryUrls: profile.allowQueryUrls || false,
              requestIntervalMs: profile.requestIntervalMs ?? 1000,
            }
          : null,
        ruleVersion: profile?.ruleVersion || null,
        policyReady,
        policyRule: row.policy_rule ? String(row.policy_rule) : null,
        policyExpires: Number(row.policy_expires) || null,
        rightsScope: row.rights_scope ? String(row.rights_scope) : null,
        lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
        lastExecutor: row.last_executor ? String(row.last_executor) : null,
        nextSyncAt: policyReady
          ? row.sync_hours_override !== null
            ? row.last_success_at
              ? Date.parse(String(row.last_success_at)) +
                Number(settings?.sync_hours || 24) * 3600000
              : now
            : row.next_sync_at_ms
              ? Number(row.next_sync_at_ms)
              : null
          : null,
        syncState: String(row.sync_state),
        lastError: row.last_error ? String(row.last_error).slice(0, 100) : null,
        automatic:
          policyReady &&
          row.enabled === 1 &&
          row.operating_status === "active" &&
          row.verification_status === "verified" &&
          row.official_status === "verified_official" &&
          row.permission_status === "approved" &&
          row.authorization_status === "approved" &&
          profile?.configurationStatus !== "discovered" &&
          row.sync_state !== "blocked",
      };
    });
    return {
      items,
      total: count?.n || 0,
      allTotal: Number(summary?.all_total || 0),
      configuredTotal: Number(summary?.configured_total || 0),
      readiness: {
        candidateTotal: Number(summary?.candidate_total || 0),
        missingProfileTotal: Number(summary?.missing_profile_total || 0),
        policyPendingTotal: Number(summary?.policy_pending_total || 0),
        sourcePendingTotal: Number(summary?.source_pending_total || 0),
        activeJobTotal: Number(summary?.active_job_total || 0),
        readyTotal: Number(summary?.ready_total || 0),
      },
      offset: q.offset,
      limit: q.limit,
      settings,
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
