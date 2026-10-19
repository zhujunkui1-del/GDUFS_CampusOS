import { z } from "zod";
import type { SqlDatabase, Statement } from "../assistant/database";
import { ApiError } from "../errors";
import { tokenHash } from "../assistant/crypto";
import { consolePermission } from "./auth";
import { campusData } from "@/features/campus-map/data/campus";
import {
  SourceInputSchema,
  ContentInputSchema,
  ExtractedFieldsSchema,
  PageQuerySchema,
  SourceVerifySchema,
  SourceEditSchema,
  SourceEnableSchema,
  ContentWriteSchema,
  ReviewSchema,
  PublishSchema,
  RestoreSchema,
  CommandSchema,
  type ConsoleActor,
  type SourceSummary,
  type SourceDetail,
  type ContentSummary,
  type ContentDetail,
  type ContentInput,
} from "@/domain/console/contracts";
import { TopicTagsSchema } from "@/domain/console/taxonomy";

type Row = Record<string, string | number | null>;
const sourceScope = "console_managed=1 AND source_type<>'user_private'";
const documentScope =
  "d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.source_type<>'user_private'";
const json = (value: unknown) => JSON.stringify(value);
const parse = (value: string | number | null | undefined) =>
  JSON.parse(String(value || "null"));
export const sqlLegacyType = (type: string) =>
  ["official_web", "login_service"].includes(type)
    ? "official_web"
    : ["wechat_subscription", "wechat_service"].includes(type)
      ? "official_account"
      : ["student_media", "third_party_web"].includes(type)
        ? "social_link"
        : "manual";
const sourceCreateSchema = SourceInputSchema.extend({
  commandId: z.string().uuid(),
}).strict();
export function sourceLocator(value: z.infer<typeof SourceInputSchema>) {
  if (
    ["official_web", "third_party_web", "login_service"].includes(
      value.sourceType,
    ) &&
    value.websiteUrl
  ) {
    const url = new URL(value.websiteUrl);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }
  return ["wechat_subscription", "wechat_service"].includes(value.sourceType) &&
    value.wechatId
    ? value.wechatId.toLowerCase()
    : null;
}
export function normalizedContent(input: ContentInput): ContentInput {
  const result = {
    ...input,
    validUntil: input.validUntil
      ? new Date(input.validUntil).toISOString()
      : null,
    publishedAt: input.publishedAt
      ? input.publishedAt.length === 10
        ? input.publishedAt
        : new Date(input.publishedAt).toISOString()
      : null,
    sourceUpdatedAt: input.sourceUpdatedAt
      ? new Date(input.sourceUpdatedAt).toISOString()
      : null,
    extractedFields: { ...input.extractedFields },
  };
  for (const field of ["startAt", "endAt", "registrationDeadline"] as const)
    if (result.extractedFields[field])
      result.extractedFields[field] = new Date(
        result.extractedFields[field],
      ).toISOString();
  if (result.kind === "event" && !result.validUntil)
    result.validUntil = result.extractedFields.endAt || null;
  return result;
}
export class ConsoleStore {
  constructor(
    readonly db: SqlDatabase,
    readonly actor: ConsoleActor,
    readonly now = () => new Date().toISOString(),
    readonly sessionHash?: string,
  ) {}
  async overview() {
    consolePermission(this.actor, "read");
    return this.db
      .prepare(
        `SELECT
    (SELECT count(*) FROM knowledge_sources WHERE ${sourceScope} AND archived_at IS NULL) AS sources,
    (SELECT count(*) FROM knowledge_sources WHERE ${sourceScope} AND archived_at IS NULL AND verification_status='candidate') AS candidates,
    (SELECT count(*) FROM knowledge_sources WHERE ${sourceScope} AND archived_at IS NULL AND verification_status='verified') AS verified,
    (SELECT count(*) FROM knowledge_sources WHERE ${sourceScope} AND archived_at IS NULL AND enabled=1) AS enabled,
    (SELECT count(*) FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${documentScope} AND d.workflow_status='pending' AND d.lifecycle_status='active') AS pending,
    (SELECT count(*) FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE s.console_managed=1 AND s.source_type<>'user_private' AND j.status='failed') AS failedJobs,
    (SELECT count(*) FROM content_index_invalidations i JOIN knowledge_documents d ON d.id=i.document_id JOIN knowledge_sources s ON s.id=d.source_id WHERE i.state='pending' AND ${documentScope}) AS pendingInvalidations`,
      )
      .first();
  }
  private sourceSummary(row: Row): SourceSummary {
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      sourceType: SourceInputSchema.shape.sourceType.parse(row.channel_type),
      organization: String(row.organization),
      officialStatus: SourceVerifySchema.shape.officialStatus.parse(
        row.official_status,
      ),
      verificationStatus: SourceVerifySchema.shape.status.parse(
        row.verification_status,
      ),
      permissionStatus: SourceVerifySchema.shape.permissionStatus.parse(
        row.permission_status,
      ),
      enabled: row.enabled === 1,
      priority: Number(row.priority),
      version: Number(row.version),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    };
  }
  async sources(query: unknown) {
    consolePermission(this.actor, "read");
    const q = PageQuerySchema.parse(query),
      clauses = [sourceScope, "archived_at IS NULL"],
      args: unknown[] = [];
    if (q.q) {
      clauses.push(
        "(display_name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR source_aliases_json LIKE ? ESCAPE '\\')",
      );
      const pattern = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
      args.push(pattern, pattern, pattern);
    }
    for (const [field, value] of [
      ["channel_type", q.type],
      ["verification_status", q.verification],
      ["official_status", q.official],
      ["permission_status", q.permission],
      ["enabled", q.enabled === undefined ? undefined : Number(q.enabled)],
    ] as const)
      if (value !== undefined) {
        clauses.push(field + "=?");
        args.push(value);
      }
    const where = clauses.join(" AND ");
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT id,display_name,channel_type,organization,official_status,verification_status,permission_status,enabled,priority,version,updated_at FROM knowledge_sources WHERE ${where} ORDER BY priority,id LIMIT ? OFFSET ?`,
        )
        .bind(...args, q.limit, q.offset)
        .all<Row>(),
      this.db
        .prepare(`SELECT count(*) AS n FROM knowledge_sources WHERE ${where}`)
        .bind(...args)
        .first<{ n: number }>(),
    ]);
    return {
      items: rows.results.map((row) => this.sourceSummary(row)),
      total: count?.n || 0,
      offset: q.offset,
      limit: q.limit,
    };
  }
  async source(id: string): Promise<SourceDetail> {
    consolePermission(this.actor, "read");
    const row = await this.db
      .prepare(
        `SELECT * FROM knowledge_sources WHERE id=? AND ${sourceScope} AND archived_at IS NULL`,
      )
      .bind(id)
      .first<Row>();
    if (!row) throw new ApiError("NOT_FOUND", "未找到该信息源。");
    return {
      ...this.sourceSummary(row),
      ...SourceInputSchema.parse({
        displayName: row.display_name,
        sourceAliases: parse(row.source_aliases_json),
        sourceType: row.channel_type,
        subtype: row.subtype,
        organization: row.organization,
        campusScope: row.campus_scope,
        websiteUrl: row.website_url,
        wechatId: row.wechat_id,
        evidenceUrls: parse(row.evidence_urls_json),
        priority: row.priority,
        connectorType: row.connector_type,
        connectorConfig: parse(row.connector_config_json),
        fetchPolicy: parse(row.fetch_policy_json),
      }),
      originalCatalogRefs: parse(row.original_catalog_refs_json) || [],
      catalogMetadata: parse(row.catalog_metadata_json) || {},
      lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
      lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
      lastError: row.last_error ? "信息源最近检查未完成。" : null,
      archivedAt: null,
    };
  }
  protected async mutate(
    command: { commandId: string; expectedVersion: number },
    action: string,
    type: "source" | "document" | "job" | "admin",
    id: string,
    payload: unknown,
    statements: Statement[],
    permission = "write",
    sourceId?: string,
    before: Statement[] = [],
    trustedDetails: Record<string, unknown> = {},
  ) {
    consolePermission(this.actor, permission);
    const fingerprint = await tokenHash(json([action, id, payload]));
    const details: Record<string, unknown> = { ...trustedDetails };
    if (payload && typeof payload === "object")
      for (const key of [
        "note",
        "decision",
        "status",
        "officialStatus",
        "permissionStatus",
        "enabled",
        "restoredFrom",
        "fence",
        "leaseHash",
        "sourceVersion",
        "policyVersion",
        "syncHours",
        "hours",
        "autoSync",
        "networkBudget",
        "earliestImportDay",
      ]) {
        const value = (payload as Record<string, unknown>)[key];
        if (["string", "number", "boolean"].includes(typeof value))
          details[key] = value;
      }
    const previous = () =>
      this.db
        .prepare(
          "SELECT admin_id,action,target_id,request_hash,expected_version FROM console_commands WHERE id=?",
        )
        .bind(command.commandId)
        .first<Row>();
    const duplicate = (row: Row) => {
      if (
        row.admin_id !== this.actor.id ||
        row.action !== action ||
        row.target_id !== id ||
        row.request_hash !== fingerprint
      )
        throw new ApiError("CONFLICT", "操作编号已被使用，请刷新后重试。");
      return {
        id,
        version: Number(row.expected_version) + 1,
        idempotent: true,
      };
    };
    const old = await previous();
    if (old) return duplicate(old);
    if (
      command.expectedVersion >=
      (type === "job" && action.startsWith("retention.") ? 1000000 : 1000)
    )
      throw new ApiError("RUN_LIMIT_EXCEEDED", "此记录已达到版本上限。");
    try {
      await this.db.batch([
        ...before,
        this.db
          .prepare(
            "INSERT INTO console_commands(id,admin_id,action,target_type,target_id,source_id,expected_version,request_hash,session_hash,details_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            command.commandId,
            this.actor.id,
            action,
            type,
            id,
            sourceId || null,
            command.expectedVersion,
            fingerprint,
            this.sessionHash || null,
            json(details),
          ),
        ...statements,
      ]);
    } catch (error) {
      const raced = await previous();
      if (raced) return duplicate(raced);
      const message = String(error);
      if (message.includes("CONSOLE_DENIED"))
        throw new ApiError("FORBIDDEN", "管理权限已失效。");
      if (message.includes("CONSOLE_STALE"))
        throw new ApiError("CONFLICT", "记录已更新，请刷新后重试。");
      if (message.includes("CONSOLE_RETENTION"))
        throw new ApiError(
          "INVALID_ARGUMENT",
          "原文早于导入截止日期、日期未知或已被永久清理；请核对保留策略。",
        );
      if (message.includes("CONSOLE_BUDGET"))
        throw new ApiError("RATE_LIMITED", "今日采集预算已用完，请稍后再试。");
      if (message.includes("CONSOLE_SOURCE_NOT_READY"))
        throw new ApiError("INVALID_ARGUMENT", "请先核验来源并确认采集许可。");
      if (message.includes("CONSOLE_CONTENT_NOT_READY"))
        throw new ApiError(
          "INVALID_ARGUMENT",
          "请先完成内容审核，并核对来源状态与有效期。",
        );
      if (message.includes("CONSOLE_") || message.includes("UNIQUE constraint"))
        throw new ApiError("INVALID_ARGUMENT", "此操作不满足审核或数据约束。");
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        "操作未保存，请稍后重试。",
        true,
      );
    }
    return { id, version: command.expectedVersion + 1, idempotent: false };
  }
  async createSource(raw: unknown) {
    const input = sourceCreateSchema.parse(raw),
      id = "source-" + input.commandId;
    const value = SourceInputSchema.parse(
      Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== "commandId"),
      ),
    );
    return this.mutate(
      { commandId: input.commandId, expectedVersion: 0 },
      "source.create",
      "source",
      id,
      value,
      [
        this.db
          .prepare(
            "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed,channel_type,subtype,source_aliases_json,organization,campus_scope,website_url,wechat_id,evidence_urls_json,connector_type,connector_config_json,priority,canonical_locator,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            value.displayName,
            sqlLegacyType(value.sourceType),
            json(value.websiteUrl ? [new URL(value.websiteUrl).hostname] : []),
            json(value.websiteUrl ? [value.websiteUrl] : []),
            json(value.fetchPolicy),
            value.sourceType,
            value.subtype,
            json(value.sourceAliases),
            value.organization,
            value.campusScope,
            value.websiteUrl,
            value.wechatId,
            json(value.evidenceUrls),
            value.connectorType,
            json(value.connectorConfig),
            value.priority,
            sourceLocator(value),
            this.now(),
            this.now(),
          ),
      ],
    );
  }
  async editSource(id: string, raw: unknown) {
    const value = SourceEditSchema.parse(raw);
    await this.source(id);
    return this.mutate(value, "source.edit", "source", id, value, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET display_name=?,source_type=?,channel_type=?,subtype=?,source_aliases_json=?,organization=?,campus_scope=?,website_url=?,wechat_id=?,evidence_urls_json=?,connector_type=?,connector_config_json=?,fetch_policy_json=?,priority=?,allowed_domains_json=?,entry_urls_json=?,canonical_locator=?,verification_status='pending',permission_status='unreviewed',authorization_status='pending',official_status=CASE WHEN official_status='verified_official' THEN 'claimed_official' ELSE official_status END,enabled=0,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(
          value.displayName,
          sqlLegacyType(value.sourceType),
          value.sourceType,
          value.subtype,
          json(value.sourceAliases),
          value.organization,
          value.campusScope,
          value.websiteUrl,
          value.wechatId,
          json(value.evidenceUrls),
          value.connectorType,
          json(value.connectorConfig),
          json(value.fetchPolicy),
          value.priority,
          json(value.websiteUrl ? [new URL(value.websiteUrl).hostname] : []),
          json(value.websiteUrl ? [value.websiteUrl] : []),
          sourceLocator(value),
          this.now(),
          id,
        ),
    ]);
  }
  async verifySource(id: string, raw: unknown) {
    const value = SourceVerifySchema.parse(raw),
      source = await this.source(id);
    if (
      (value.status === "verified" ||
        value.officialStatus === "verified_official") &&
      !value.evidenceUrls.length
    )
      throw new ApiError("INVALID_ARGUMENT", "核验通过需要可追溯的证据链接。");
    if (
      value.officialStatus === "verified_official" &&
      (!value.authorityConfirmed || source.sourceType === "student_media")
    )
      throw new ApiError(
        "INVALID_ARGUMENT",
        "请先明确核验官方主体，学生自媒体不能自动标为官方。",
      );
    return this.mutate(value, "source.verify", "source", id, value, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET verification_status=?,official_status=?,permission_status=?,authorization_status=?,evidence_urls_json=?,last_checked_at=?,enabled=CASE WHEN ?='verified' AND ? IN('approved','entry_only') THEN enabled ELSE 0 END,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(
          value.status,
          value.officialStatus,
          value.permissionStatus,
          value.permissionStatus === "approved"
            ? "approved"
            : value.permissionStatus === "denied"
              ? "rejected"
              : "pending",
          json(value.evidenceUrls),
          this.now(),
          value.status,
          value.permissionStatus,
          this.now(),
          id,
        ),
    ]);
  }
  async enableSource(id: string, raw: unknown) {
    const value = SourceEnableSchema.parse(raw);
    await this.source(id);
    return this.mutate(value, "source.enable", "source", id, value, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET enabled=?,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(value.enabled ? 1 : 0, this.now(), id),
    ]);
  }
  async archiveSource(id: string, raw: unknown) {
    const value = CommandSchema.parse(raw);
    return this.mutate(value, "source.archive", "source", id, value, [
      this.db
        .prepare(
          "UPDATE knowledge_sources SET enabled=0,archived_at=?,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(this.now(), this.now(), id),
    ]);
  }
  async content(query: unknown) {
    consolePermission(this.actor, "read");
    const q = PageQuerySchema.parse(query),
      args: unknown[] = [],
      clauses = [documentScope];
    if (q.q) {
      clauses.push("d.title LIKE ?");
      args.push("%" + q.q + "%");
    }
    if (q.status) {
      const publication = ["published", "withdrawn"].includes(q.status);
      clauses.push(
        publication ? "d.publication_status=?" : "d.workflow_status=?",
      );
      args.push(q.status);
    }
    const where = clauses.join(" AND ");
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT d.*,s.display_name AS source_name FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${where} ORDER BY COALESCE(d.updated_at,d.fetched_at) DESC,d.id LIMIT ? OFFSET ?`,
        )
        .bind(...args, q.limit, q.offset)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT count(*) AS n FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${where}`,
        )
        .bind(...args)
        .first<{ n: number }>(),
    ]);
    return {
      items: rows.results.map((row) => this.contentSummary(row)),
      total: count?.n || 0,
      offset: q.offset,
      limit: q.limit,
    };
  }
  private contentSummary(row: Row): ContentSummary {
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      sourceName: String(row.source_name),
      title: String(row.title),
      kind: row.candidate_kind === "event" ? "event" : "knowledge",
      version: Number(row.version),
      reviewStatus: String(row.workflow_status),
      publicationStatus: String(row.publication_status),
      url: String(row.url),
      validUntil: row.valid_until ? String(row.valid_until) : null,
    };
  }
  async document(id: string): Promise<ContentDetail> {
    consolePermission(this.actor, "read");
    const row = await this.db
      .prepare(
        `SELECT d.*,s.display_name AS source_name FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id=? AND ${documentScope}`,
      )
      .bind(id)
      .first<Row>();
    if (!row) throw new ApiError("NOT_FOUND", "未找到该内容。");
    const versions = await this.db
      .prepare(
        "SELECT version,created_at FROM console_content_versions WHERE document_id=? ORDER BY version DESC LIMIT 100",
      )
      .bind(id)
      .all<{ version: number; created_at: string }>();
    return {
      ...this.contentSummary(row),
      body: String(row.body),
      bodyStatus: ContentInputSchema.shape.bodyStatus.parse(row.body_status),
      discoveries: (
        await this.db
          .prepare(
            "SELECT finder,entry_url FROM document_discoveries WHERE document_id=? ORDER BY id LIMIT 50",
          )
          .bind(id)
          .all<{ finder: string; entry_url: string }>()
      ).results.map((r) => ({ finder: r.finder, entryUrl: r.entry_url })),
      timeEvidence: (
        await this.db
          .prepare(
            "SELECT field_name,raw_span,date_value,time_value,precision,inferred,snapshot_version,content_revision,verification_status FROM extraction_evidence WHERE document_id=? AND content_revision=? ORDER BY snapshot_version,id LIMIT 30",
          )
          .bind(id, Number(row.content_revision))
          .all<Row>()
      ).results.map((e) => ({
        field: String(e.field_name),
        rawText: String(e.raw_span),
        date: e.date_value ? String(e.date_value) : null,
        time: e.time_value ? String(e.time_value) : null,
        precision: String(e.precision),
        inferred: !!e.inferred,
        snapshotVersion: Number(e.snapshot_version),
        contentRevision: Number(e.content_revision),
        verificationStatus: String(e.verification_status),
      })),
      campusScope: ContentInputSchema.shape.campusScope.parse(row.campus_scope),
      extractedFields: ExtractedFieldsSchema.parse(
        parse(row.extracted_fields_json),
      ),
      publishedAt: row.published_at ? String(row.published_at) : null,
      fetchedAt: String(row.fetched_at),
      sourceUpdatedAt: row.source_updated_at
        ? String(row.source_updated_at)
        : null,
      updatedAt: row.updated_at ? String(row.updated_at) : null,
      contentRevision: Number(row.content_revision),
      inputHash: row.input_hash ? String(row.input_hash) : null,
      contentType: String(row.content_type),
      duplicateOf:
        (
          await this.db
            .prepare(
              "SELECT duplicate_of FROM document_origins WHERE document_id=? AND duplicate_of IS NOT NULL LIMIT 1",
            )
            .bind(id)
            .first<{ duplicate_of: string }>()
        )?.duplicate_of || null,
      rightsScope: String(row.rights_scope),
      radarCategory: row.radar_category ? String(row.radar_category) : null,
      knowledgeCategory: row.knowledge_category
        ? String(row.knowledge_category)
        : null,
      publisher: row.publisher ? String(row.publisher) : null,
      summary: String(row.summary),
      tags: TopicTagsSchema.parse(
        (
          await this.db
            .prepare(
              "SELECT tag FROM document_tags WHERE document_id=? AND content_revision=? ORDER BY tag LIMIT 12",
            )
            .bind(id, Number(row.content_revision))
            .all<{ tag: string }>()
        ).results.map((x) => x.tag),
      ),
      eventCandidates: (
        await this.db
          .prepare(
            "SELECT id,title,organizer,starts_at,ends_at,registration_deadline,raw_place_name,verification_status FROM event_candidates WHERE document_id=? AND content_revision=? ORDER BY ordinal LIMIT 10",
          )
          .bind(id, Number(row.content_revision))
          .all<Row>()
      ).results.map((e) => ({
        id: String(e.id),
        title: String(e.title),
        organizer: e.organizer ? String(e.organizer) : null,
        startsAt: e.starts_at ? String(e.starts_at) : null,
        endsAt: e.ends_at ? String(e.ends_at) : null,
        registrationDeadline: e.registration_deadline
          ? String(e.registration_deadline)
          : null,
        rawPlaceName: e.raw_place_name ? String(e.raw_place_name) : null,
        verificationStatus: String(e.verification_status),
      })),
      versions: versions.results.map((v) => ({
        version: v.version,
        createdAt: v.created_at,
      })),
    };
  }
  protected snapshot(id: string) {
    return this.db
      .prepare(
        `INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at,content_revision,input_hash)
    SELECT id,version,json_object('input',json_object('sourceId',source_id,'title',title,'url',url,'body',body,'bodyStatus',body_status,'kind',candidate_kind,'campusScope',campus_scope,'validUntil',valid_until,'publishedAt',published_at,'sourceUpdatedAt',source_updated_at,'contentType',content_type,'rightsScope',rights_scope,'radarCategory',radar_category,'knowledgeCategory',knowledge_category,'publisher',publisher,'summary',summary,'tags',json((SELECT json_group_array(tag) FROM document_tags t WHERE t.document_id=knowledge_documents.id AND t.content_revision=knowledge_documents.content_revision)),'extractedFields',json(extracted_fields_json)),'publicationStatus',publication_status,'reviewStatus',workflow_status),?,?,content_revision,input_hash FROM knowledge_documents WHERE id=? AND owner_user_id IS NULL AND data_domain<>'user_private'`,
      )
      .bind(this.actor.id, this.now(), id);
  }
  async writeContent(
    id: string | undefined,
    raw: unknown,
    restoredFrom?: number,
  ) {
    const prepared = await this.prepareContentWrite(id, raw);
    const { value, data, key, statements } = prepared;
    return this.mutate(
      value,
      restoredFrom
        ? "document.restore"
        : id
          ? "document.edit"
          : "document.create",
      "document",
      key,
      restoredFrom ? { ...value, restoredFrom } : value,
      statements,
      "write",
      data.sourceId,
    );
  }
  protected async prepareContentWrite(
    id: string | undefined,
    raw: unknown,
    sourceFingerprint?: string,
  ) {
    const value = ContentWriteSchema.parse(raw),
      source = await this.source(value.sourceId);
    const key = id || "content-" + value.commandId;
    const previous = id ? await this.document(id) : null;
    if (!id && value.expectedVersion !== 0)
      throw new ApiError("INVALID_ARGUMENT", "新内容版本应从零开始。");
    const data = normalizedContent(
        ContentInputSchema.parse(
          Object.fromEntries(
            Object.entries(value).filter(
              ([k]) => !["commandId", "expectedVersion"].includes(k),
            ),
          ),
        ),
      ),
      contentHash = await tokenHash(data.body),
      inputHash = await tokenHash(
        json(sourceFingerprint ? [data, sourceFingerprint] : data),
      ),
      contentRevision = previous
        ? previous.contentRevision + (previous.inputHash !== inputHash ? 1 : 0)
        : 1;
    const statements: Statement[] = id
      ? [
          this.db
            .prepare(
              "UPDATE knowledge_documents SET source_id=?,title=?,url=?,body=?,content_hash=?,candidate_kind=?,campus_scope=?,valid_until=?,published_at=?,extracted_fields_json=?,data_domain=?,version=version+1,review_status='pending',workflow_status='pending',publication_status='draft',lifecycle_status='active',updated_at=?,source_updated_at=?,content_revision=?,input_hash=?,approved_content_revision=NULL,approved_input_hash=NULL,content_type=?,rights_scope=?,radar_category=?,knowledge_category=?,publisher=?,summary=? WHERE id=?",
            )
            .bind(
              data.sourceId,
              data.title,
              data.url,
              data.body,
              contentHash,
              data.kind,
              data.campusScope,
              data.validUntil,
              data.publishedAt,
              json(data.extractedFields),
              source.officialStatus === "verified_official"
                ? "official_policy"
                : "approved_life_experience",
              this.now(),
              data.sourceUpdatedAt,
              contentRevision,
              inputHash,
              data.contentType,
              data.rightsScope,
              data.radarCategory,
              data.knowledgeCategory,
              data.publisher,
              data.summary,
              key,
            ),
        ]
      : [
          this.db
            .prepare(
              "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain,candidate_kind,valid_until,published_at,extracted_fields_json,updated_at,source_updated_at,content_revision,input_hash,content_type,rights_scope,radar_category,knowledge_category,publisher,summary) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              key,
              data.sourceId,
              data.title,
              data.url,
              data.body,
              contentHash,
              this.now(),
              data.campusScope,
              source.officialStatus === "verified_official"
                ? "official_policy"
                : "approved_life_experience",
              data.kind,
              data.validUntil,
              data.publishedAt,
              json(data.extractedFields),
              this.now(),
              data.sourceUpdatedAt,
              contentRevision,
              inputHash,
              data.contentType,
              data.rightsScope,
              data.radarCategory,
              data.knowledgeCategory,
              data.publisher,
              data.summary,
            ),
        ];
    if (id && sourceFingerprint)
      statements.push(
        this.db
          .prepare("UPDATE knowledge_documents SET fetched_at=? WHERE id=?")
          .bind(this.now(), key),
      );
    return {
      value,
      data,
      key,
      contentRevision,
      inputHash,
      statements: [
        ...statements,
        this.db
          .prepare("UPDATE knowledge_documents SET body_status=? WHERE id=?")
          .bind(data.bodyStatus, key),
        ...data.tags.map((tag) =>
          this.db
            .prepare(
              "INSERT OR IGNORE INTO document_tags(document_id,content_revision,tag) VALUES(?,?,?)",
            )
            .bind(key, contentRevision, tag),
        ),
        this.snapshot(key),
      ],
    };
  }
  async review(id: string, raw: unknown) {
    const value = ReviewSchema.parse(raw);
    if (!value.note || value.note === "管理员操作")
      value.note =
        "管理员" +
        { approved: "批准", returned: "退回", rejected: "拒绝" }[
          value.decision
        ];
    await this.document(id);
    return this.mutate(
      value,
      "document.review",
      "document",
      id,
      value,
      [
        this.db
          .prepare(
            "UPDATE knowledge_documents SET workflow_status=?,review_status=?,publication_status='draft',version=version+1,updated_at=?,approved_content_revision=CASE WHEN ?='approved' THEN content_revision ELSE NULL END,approved_input_hash=CASE WHEN ?='approved' THEN input_hash ELSE NULL END WHERE id=?",
          )
          .bind(
            value.decision,
            value.decision === "returned" ? "pending" : value.decision,
            this.now(),
            value.decision,
            value.decision,
            id,
          ),
        this.db
          .prepare(
            "INSERT INTO console_content_reviews(id,document_id,version,decision,admin_id,note,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            value.commandId,
            id,
            value.expectedVersion,
            value.decision,
            this.actor.id,
            value.note,
            this.now(),
          ),
        this.snapshot(id),
      ],
      "review",
    );
  }
  async publish(id: string, raw: unknown, withdraw = false) {
    const value = PublishSchema.parse(raw),
      document = await this.document(id);
    if (!value.note || value.note === "管理员操作")
      value.note = withdraw ? "管理员撤回" : "管理员发布";
    consolePermission(this.actor, "publish");
    if (!withdraw) {
      if (
        document.reviewStatus !== "approved" ||
        !document.inputHash ||
        document.contentRevision <= 0 ||
        !["metadata_only", "excerpt_and_link", "licensed_full_text"].includes(
          document.rightsScope,
        ) ||
        document.contentType === "unknown" ||
        !!document.radarCategory === !!document.knowledgeCategory ||
        (document.kind === "event" && !document.radarCategory) ||
        (document.validUntil &&
          Date.parse(document.validUntil) <= Date.parse(this.now()))
      )
        throw new ApiError("INVALID_ARGUMENT", "内容尚未审核通过或已经过期。");
      if (document.kind === "event") {
        const f = document.extractedFields;
        if (
          !f.timeVerified ||
          !f.placeVerified ||
          !f.startAt ||
          !f.endAt ||
          (f.startAt &&
            Date.parse(f.endAt || f.startAt) <= Date.parse(this.now())) ||
          document.campusScope === "unknown" ||
          !f.deadlineVerified ||
          (f.endAt && Date.parse(f.endAt) < Date.parse(f.startAt)) ||
          (document.campusScope === "university_town" &&
            !campusData.places.some((p) => p.id === f.placeId))
        )
          throw new ApiError(
            "INVALID_ARGUMENT",
            "请先核验活动时间、截止日期和校区地点。",
          );
      }
    }
    return this.mutate(
      value,
      withdraw ? "document.withdraw" : "document.publish",
      "document",
      id,
      value,
      [
        this.db
          .prepare(
            "UPDATE knowledge_documents SET publication_status=?,lifecycle_status=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(
            withdraw ? "withdrawn" : "published",
            withdraw ? "withdrawn" : "active",
            this.now(),
            id,
          ),
        ...(withdraw
          ? [
              this.db
                .prepare(
                  "INSERT INTO console_content_reviews(id,document_id,version,decision,admin_id,note,created_at) VALUES(?,?,?,'withdrawn',?,?,?)",
                )
                .bind(
                  value.commandId,
                  id,
                  value.expectedVersion,
                  this.actor.id,
                  value.note,
                  this.now(),
                ),
            ]
          : []),
        this.snapshot(id),
      ],
      "publish",
    );
  }
  async version(id: string, version: number) {
    await this.document(id);
    const row = await this.db
      .prepare(
        "SELECT snapshot_json FROM console_content_versions WHERE document_id=? AND version=?",
      )
      .bind(id, version)
      .first<{ snapshot_json: string }>();
    if (!row) throw new ApiError("NOT_FOUND", "未找到该内容版本。");
    return parse(row.snapshot_json);
  }
  async restore(id: string, raw: unknown) {
    const input = RestoreSchema.parse(raw),
      snapshot = await this.version(id, input.version);
    const data = ContentInputSchema.parse(snapshot.input);
    return this.writeContent(
      id,
      {
        ...data,
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
      },
      input.version,
    );
  }
  async jobs(query: unknown) {
    consolePermission(this.actor, "read");
    const q = PageQuerySchema.parse(query);
    const rows = await this.db
      .prepare(
        "SELECT j.id,j.source_id,s.display_name AS source_name,j.status,j.control_state,j.phase,j.error_code,j.found_count,j.body_count,j.duplicate_count,j.request_count,j.error_count,j.version,j.created_at FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE s.console_managed=1 AND s.source_type<>'user_private' ORDER BY j.created_at DESC,j.id LIMIT ? OFFSET ?",
      )
      .bind(q.limit, q.offset)
      .all<Row>();
    return {
      collectorEnabled: true,
      items: rows.results.map((row) => ({
        ...row,
        error_code: row.error_code ? String(row.error_code).slice(0, 50) : null,
      })),
      offset: q.offset,
      limit: q.limit,
    };
  }
  async cancelJob(id: string, raw: unknown) {
    const value = CommandSchema.parse(raw);
    return this.mutate(value, "job.cancel", "job", id, value, [
      this.db
        .prepare(
          "UPDATE ingestion_jobs SET status='failed',error_code='OPERATOR_CANCELLED',version=version+1 WHERE id=? AND status='queued'",
        )
        .bind(id),
    ]);
  }
  async audit(query: unknown) {
    consolePermission(this.actor, "read");
    const q = PageQuerySchema.parse(query);
    return {
      items: (
        await this.db
          .prepare(
            "SELECT id,actor_label,action,target_type,target_id,version,details_json,created_at FROM console_audit_logs ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
          )
          .bind(q.limit, q.offset)
          .all()
      ).results,
      offset: q.offset,
      limit: q.limit,
    };
  }
  async admins() {
    consolePermission(this.actor, "admin");
    return (
      await this.db
        .prepare(
          "SELECT id,email,role,status,version FROM console_admins ORDER BY created_at LIMIT 50",
        )
        .all()
    ).results;
  }
  async revokeAdmin(id: string, raw: unknown) {
    const value = CommandSchema.parse(raw);
    consolePermission(this.actor, "admin");
    return this.mutate(
      value,
      "admin.revoke",
      "admin",
      id,
      value,
      [
        this.db
          .prepare(
            "UPDATE console_admins SET status='revoked',version=version+1 WHERE id=? AND version=?",
          )
          .bind(id, value.expectedVersion),
        this.db
          .prepare(
            "UPDATE console_sessions SET revoked_at_ms=? WHERE admin_id=?",
          )
          .bind(Date.parse(this.now()), id),
      ],
      "admin",
    );
  }
}

// Every future FTS/vector hit must pass this fresh authoritative gate, including
// its revision. A pending invalidation never grants visibility to stale hits.
export async function filterPublicContent(
  db: SqlDatabase,
  hits: { id: string; version: number }[],
  purpose: "metadata" | "excerpt" | "full_text" = "excerpt",
) {
  if (hits.length > 50)
    throw new ApiError("INVALID_ARGUMENT", "检索候选过多。");
  if (!hits.length) return [];
  const allowed =
    purpose === "full_text"
      ? "'licensed_full_text'"
      : "'excerpt_and_link','licensed_full_text'";
  const permissionGate =
    purpose === "metadata"
      ? ""
      : ` AND NOT EXISTS(SELECT 1 FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=console_public_documents.source_id AND ((s.manual_policy_version>0 AND (s.manual_rights_scope NOT IN (${allowed}) OR s.manual_policy_expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) OR (s.manual_policy_version=0 AND p.source_id IS NOT NULL AND (p.rights_scope NOT IN (${allowed}) OR p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))`;
  const rows = await db
    .prepare(
      `SELECT id,version FROM console_public_documents WHERE id IN (${hits.map(() => "?").join(",")}) AND rights_scope IN (${purpose === "metadata" ? "'metadata_only','excerpt_and_link','licensed_full_text'" : allowed})${permissionGate}`,
    )
    .bind(...hits.map((h) => h.id))
    .all<{ id: string; version: number }>();
  return hits.filter((hit) =>
    rows.results.some(
      (row) => row.id === hit.id && row.version === hit.version,
    ),
  );
}
