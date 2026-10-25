import { classifyArticle } from "@/domain/console/article-classification";
import { canonicalArticleUrl } from "@/lib/ingestion/canonical-url";
import { IngestionStore } from "./ingestion-store";
import { normalizedContent } from "./store";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";
import {
  ContentInputSchema,
  ContentWriteSchema,
  SafeUrlSchema,
  type ContentDetail,
  type SourceDetail,
} from "@/domain/console/contracts";
import {
  ManualImportSchema,
  ImportPolicySchema,
} from "@/domain/console/manual-import";
import { tokenHash } from "../assistant/crypto";
import type { Statement } from "../assistant/database";
import { approvedUrl, profileFromSource } from "@/lib/ingestion/profiles";
import {
  discoveryStatement,
  eventCandidateStatements,
} from "./intake-evidence";
import { extractEvents } from "@/lib/ingestion/time";

type Policy = {
  version: number;
  rule_version: string;
  rights_scope: string;
  expires_at_ms: number;
};
export const METADATA_BODY = "仅登记公开元数据，未保存第三方正文。";
export function importUrl(source: SourceDetail, raw: string, detail = true) {
  const u = new URL(SafeUrlSchema.parse(raw));
  if (
    u.protocol !== "https:" ||
    u.port ||
    /^(localhost|[\d.:]+)$|\.(local|internal|localhost)$/i.test(u.hostname) ||
    [...u.searchParams.keys()].some((k) =>
      /^(uin|key|pass_ticket|appmsg_token)$/i.test(k),
    )
  )
    throw new ApiError("INVALID_ARGUMENT", "原文链接不在此来源允许的范围内。");
  const host = source.websiteUrl
    ? new URL(source.websiteUrl).hostname
    : ["wechat_subscription", "wechat_service"].includes(source.sourceType)
      ? "mp.weixin.qq.com"
      : "";
  if (u.hostname !== host)
    throw new ApiError("INVALID_ARGUMENT", "原文链接与已核验来源不一致。");
  u.hash = "";
  const profile = profileFromSource({
    sourceId: source.id,
    name: source.displayName,
    websiteUrl: source.websiteUrl,
    webProfileJson: source.webProfileJson,
  });
  if (detail && profile) {
    try {
      return approvedUrl(profile, u.toString());
    } catch {
      throw new ApiError("INVALID_ARGUMENT", "原文不在已批准栏目内。");
    }
  }
  return canonicalArticleUrl(u.toString());
}
function contentProjection(d: ContentDetail) {
  return ContentInputSchema.parse({
    sourceId: d.sourceId,
    title: d.title,
    url: d.url,
    body: d.body,
    bodyStatus: d.bodyStatus,
    kind: d.kind,
    campusScope: d.campusScope,
    validUntil: d.validUntil,
    publishedAt: d.publishedAt,
    sourceUpdatedAt: d.sourceUpdatedAt,
    contentType: d.contentType,
    rightsScope: d.rightsScope,
    radarCategory: d.radarCategory,
    knowledgeCategory: d.knowledgeCategory,
    publisher: d.publisher,
    summary: d.summary,
    tags: d.tags,
    extractedFields: {},
  });
}
export class ManualImportStore extends IngestionStore {
  protected override async mutate(
    ...args: Parameters<IngestionStore["mutate"]>
  ) {
    if (args[1] === "manual.import") {
      const data = args[4] as {
        items?: { bodyStatus?: string; body?: string }[];
      };
      args[9] = {
        ...args[9],
        registryMetadata: Number(
          this.actor.role === "admin" &&
            !!data.items?.length &&
            data.items.every((i) => i.bodyStatus === "not_provided" && !i.body),
        ),
      };
    }
    return super.mutate(...args);
  }

  // Editing/restoring must not become an alternate unlicensed intake path.
  override async writeContent(
    id: string | undefined,
    raw: unknown,
    restoredFrom?: number,
  ) {
    consolePermission(this.actor, "write");
    if (!id)
      throw new ApiError("INVALID_ARGUMENT", "请使用人工导入入口登记内容。");
    const value = ContentWriteSchema.parse(raw);
    await this.document(id);
    const action = restoredFrom ? "document.restore" : "document.edit";
    const prior = await this.db
      .prepare("SELECT details_json FROM console_commands WHERE id=?")
      .bind(value.commandId)
      .first<{ details_json: string }>();
    if (prior) {
      const details = JSON.parse(prior.details_json);
      return this.mutate(
        value,
        action,
        "document",
        id,
        {
          ...value,
          ...(restoredFrom ? { restoredFrom } : {}),
          sourceVersion: details.sourceVersion,
          policyVersion: details.policyVersion,
        },
        [],
        "write",
        value.sourceId,
      );
    }
    const source = await this.source(value.sourceId);
    const { policy, effectiveRights } = await this.importPolicy(source.id);
    if (
      !source.enabled ||
      source.verificationStatus !== "verified" ||
      source.permissionStatus !== "approved" ||
      effectiveRights === "expired"
    )
      throw new ApiError("INVALID_ARGUMENT", "请先核验来源并确认导入许可。");
    importUrl(source, value.url);
    if (value.rightsScope === "metadata_only") {
      if (
        value.body !== METADATA_BODY ||
        !["unknown", "not_provided"].includes(value.bodyStatus)
      )
        throw new ApiError(
          "INVALID_ARGUMENT",
          "仅元数据记录不能保存第三方正文。",
        );
    } else if (
      !["partial", "complete"].includes(value.bodyStatus) ||
      !["excerpt_and_link", "licensed_full_text"].includes(value.rightsScope) ||
      effectiveRights === "metadata_only" ||
      (value.rightsScope === "excerpt_and_link" &&
        (value.bodyStatus !== "partial" || value.body.length > 500)) ||
      (effectiveRights === "excerpt_and_link" &&
        (value.rightsScope !== "excerpt_and_link" ||
          value.bodyStatus !== "partial" ||
          value.body.length > 500))
    )
      throw new ApiError(
        "INVALID_ARGUMENT",
        "当前来源未批准相应正文使用范围。",
      );
    const prepared = await this.prepareContentWrite(id, value);
    return this.mutate(
      value,
      action,
      "document",
      id,
      {
        ...value,
        ...(restoredFrom ? { restoredFrom } : {}),
        sourceVersion: source.version,
        policyVersion: policy?.version || 0,
      },
      prepared.statements,
      "write",
      source.id,
    );
  }
  async importPolicy(sourceId: string) {
    const source = await this.source(sourceId);
    const manual = await this.db
      .prepare(
        "SELECT manual_policy_version AS version,manual_rights_scope AS rights_scope,manual_policy_expires_at_ms AS expires_at_ms FROM knowledge_sources WHERE id=? AND manual_policy_version>0",
      )
      .bind(sourceId)
      .first<Policy>();
    const policy =
      manual ||
      (await this.db
        .prepare(
          "SELECT version,rule_version,rights_scope,expires_at_ms FROM source_collection_policies WHERE source_id=?",
        )
        .bind(sourceId)
        .first<Policy>());
    return {
      sourceVersion: source.version,
      policy,
      effectiveRights: !policy
        ? "metadata_only"
        : policy.expires_at_ms > Date.parse(this.now())
          ? policy.rights_scope
          : "expired",
    };
  }
  async setImportPolicy(sourceId: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const value = ImportPolicySchema.parse(raw),
      source = await this.source(sourceId);
    if (
      !source.enabled ||
      source.verificationStatus !== "verified" ||
      source.permissionStatus !== "approved"
    )
      throw new ApiError("INVALID_ARGUMENT", "请先核验并启用来源。");
    return this.mutate(
      value,
      "source.import-policy",
      "source",
      sourceId,
      value,
      [
        this.db
          .prepare(
            "UPDATE knowledge_sources SET manual_rights_scope=?,manual_policy_evidence_json=?,manual_policy_note=?,manual_policy_expires_at_ms=?,manual_policy_admin_id=?,manual_policy_version=manual_policy_version+1,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(
            value.rightsScope,
            JSON.stringify(value.evidenceUrls),
            value.note,
            Date.parse(this.now()) + (value.validityDays || 1) * 86400000,
            this.actor.id,
            this.now(),
            sourceId,
          ),
      ],
      "admin",
      sourceId,
    );
  }
  private async receipt(
    id: string,
    idempotent: boolean,
    linked: string[] = [],
  ) {
    return {
      id,
      idempotent,
      linked,
      items: (
        await this.db
          .prepare(
            "SELECT document_id AS id,outcome FROM manual_import_items WHERE job_id=? ORDER BY ordinal",
          )
          .bind(id)
          .all<{ id: string; outcome: string }>()
      ).results,
    };
  }
  protected async importDefaults(
    _sourceId: string,
  ): Promise<{ knowledgeCategory: string | null }> {
    void _sourceId;
    return { knowledgeCategory: null };
  }
  async importBatch(raw: unknown) {
    consolePermission(this.actor, "write");
    const value = ManualImportSchema.parse(raw),
      id = "manual-" + value.commandId;
    const command = { commandId: value.commandId, expectedVersion: 0 };
    // Replays still pass the request's server authentication and permission checks.
    const prior = await this.db
      .prepare("SELECT details_json FROM console_commands WHERE id=?")
      .bind(value.commandId)
      .first<{ details_json: string }>();
    if (prior) {
      await this.mutate(
        command,
        "manual.import",
        "job",
        id,
        {
          ...value,
          policyVersion: JSON.parse(prior.details_json).policyVersion,
          note: `人工导入${value.items.length}条`,
        },
        [],
        "write",
        value.sourceId,
      );
      return this.receipt(id, true);
    }
    const source = await this.source(value.sourceId),
      { policy, effectiveRights } = await this.importPolicy(source.id);
    const registryMetadata =
      this.actor.role === "admin" &&
      value.items.every((i) => i.bodyStatus === "not_provided");
    if (
      !source.enabled ||
      (!registryMetadata &&
        (source.verificationStatus !== "verified" ||
          source.permissionStatus !== "approved" ||
          effectiveRights === "expired"))
    )
      throw new ApiError(
        "INVALID_ARGUMENT",
        "来源或导入许可尚未核验，或已失效。",
      );
    if (source.version !== value.sourceVersion)
      throw new ApiError("CONFLICT", "来源已更新，请刷新后重试。");
    const defaults = await this.importDefaults(source.id),
      linkedDocuments: string[] = [];
    const now = this.now(),
      statements: Statement[] = [],
      seen = new Set<string>();
    let bodies = 0,
      duplicates = 0;
    for (const [ordinal, item] of value.items.entries()) {
      const url = importUrl(source, item.url);
      if (seen.has(url))
        throw new ApiError("INVALID_ARGUMENT", "批次中存在重复原文链接。");
      seen.add(url);
      if (
        item.bodyStatus !== "not_provided" &&
        (effectiveRights === "metadata_only" ||
          (effectiveRights === "excerpt_and_link" &&
            (item.bodyStatus !== "partial" || item.body.length > 500)))
      )
        throw new ApiError(
          "INVALID_ARGUMENT",
          "当前来源未批准相应正文使用范围。",
        );
      const rightsScope =
        item.bodyStatus === "not_provided" ? "metadata_only" : effectiveRights;
      const input = normalizedContent(
        ContentInputSchema.parse({
          sourceId: source.id,
          title: item.title,
          url,
          body: item.bodyStatus === "not_provided" ? METADATA_BODY : item.body,
          bodyStatus: item.bodyStatus,
          kind: "knowledge",
          campusScope: item.campusScope,
          validUntil: null,
          publishedAt: item.publishedAt,
          sourceUpdatedAt: item.sourceUpdatedAt,
          contentType: item.contentType,
          rightsScope,
          ...(item.radarCategory || item.knowledgeCategory
            ? {
                radarCategory: item.radarCategory || null,
                knowledgeCategory: item.radarCategory
                  ? null
                  : item.knowledgeCategory,
              }
            : defaults.knowledgeCategory
              ? {
                  radarCategory: null,
                  knowledgeCategory: defaults.knowledgeCategory,
                }
              : classifyArticle({
                  title: item.title,
                  body: item.body,
                  bodyFormat: "plain",
                  bodyStatus: item.bodyStatus,
                  publishedAt: item.publishedAt,
                  originalUrl: item.url,
                })),
          publisher: source.displayName,
          summary:
            item.summary ||
            `关于「${item.title.slice(0, 100)}」的来源信息，请以原文为准。`,
          tags: [...item.tags].sort(),
          extractedFields: {},
        }),
      );
      const existing = await this.db
        .prepare(
          "SELECT d.id FROM knowledge_documents d WHERE d.source_id=? AND d.url=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' ORDER BY d.updated_at DESC,d.id LIMIT 2",
        )
        .bind(source.id, url)
        .all<{ id: string }>();
      if (existing.results.length > 1)
        throw new ApiError("CONFLICT", "原文存在多个记录，请先核对。");
      let old = existing.results[0]
        ? await this.document(existing.results[0].id)
        : null;
      let linked = false;
      if (!old) {
        const shared = await this.db
          .prepare(
            "SELECT d.id FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.url=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 ORDER BY d.id LIMIT 2",
          )
          .bind(url)
          .all<{ id: string }>();
        if (shared.results.length > 1)
          throw new ApiError("CONFLICT", "原文已有冲突记录，请核对原来源。");
        if (shared.results[0]) {
          old = await this.document(shared.results[0].id);
          if (
            old.title !== input.title ||
            (input.publishedAt &&
              old.publishedAt &&
              input.publishedAt !== old.publishedAt) ||
            (item.bodyStatus !== "not_provided" && old.body !== input.body)
          )
            throw new ApiError(
              "CONFLICT",
              "同一原文已有不同修订，请在原来源下核对更新。",
            );
          linked = true;
          linkedDocuments.push(old.id);
          statements.push(
            this.db
              .prepare(
                "INSERT INTO console_manual_links(job_id,ordinal,document_id,document_version,canonical_url,created_at) VALUES(?,?,?,?,?,?)",
              )
              .bind(id, ordinal, old.id, old.version, url, now),
          );
        }
      }
      const unchanged =
        linked ||
        (!!old &&
          JSON.stringify(input) ===
            JSON.stringify(normalizedContent(contentProjection(old))));
      if (
        old &&
        !unchanged &&
        item.expectedVersion !== undefined &&
        item.expectedVersion !== old.version
      )
        throw new ApiError("CONFLICT", "原文已有内容，请核对版本后更新。");
      if (!old && item.expectedVersion)
        throw new ApiError("CONFLICT", "未找到需要更新的原文。");
      const prepared = unchanged
        ? null
        : await this.prepareContentWrite(old?.id, {
            ...input,
            commandId: crypto.randomUUID(),
            expectedVersion: old?.version || 0,
          });
      const documentId = old?.id || prepared!.key,
        version = old ? old.version + (unchanged ? 0 : 1) : 1;
      statements.push(
        this.db
          .prepare(
            "INSERT INTO manual_import_items(job_id,ordinal,document_id,expected_document_version,outcome) VALUES(?,?,?,?,?)",
          )
          .bind(
            id,
            ordinal,
            documentId,
            old?.version || 0,
            unchanged ? "unchanged" : old ? "updated" : "created",
          ),
      );
      if (prepared) {
        statements.push(...prepared.statements);
        if (old)
          statements.push(
            this.db
              .prepare("UPDATE knowledge_documents SET fetched_at=? WHERE id=?")
              .bind(now, documentId),
          );
        if (item.bodyStatus !== "not_provided")
          statements.push(
            ...eventCandidateStatements(
              this.db,
              extractEvents(input.body),
              input.body,
              documentId,
              version,
              prepared.contentRevision,
              prepared.inputHash,
            ),
          );
      } else duplicates++;
      if (item.bodyStatus !== "not_provided") bodies++;
      statements.push(
        this.db
          .prepare(
            "INSERT INTO document_origins(id,source_id,document_id,canonical_url,entry_url,first_seen_at,last_seen_at,input_fingerprint) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,canonical_url) DO UPDATE SET last_seen_at=excluded.last_seen_at",
          )
          .bind(
            crypto.randomUUID(),
            source.id,
            documentId,
            url,
            url,
            now,
            now,
            prepared?.inputHash || old?.inputHash,
          ),
      );
      for (const entry of new Set([
        url,
        ...item.discoveryUrls.map((u) => importUrl(source, u, false)),
      ]))
        statements.push(
          discoveryStatement(
            this.db,
            source.id,
            documentId,
            url,
            "manual",
            entry,
            now,
          ),
        );
      statements.push(
        this.db
          .prepare(
            "INSERT INTO document_fetches(id,job_id,source_id,document_id,snapshot_version,url,checked_at,status,outcome,bytes,body_hash,published_raw,intake_kind,body_status) VALUES(?,?,?,?,?,?,?,0,'manual_import',?,?,?,'manual',?)",
          )
          .bind(
            crypto.randomUUID(),
            id,
            source.id,
            documentId,
            version,
            url,
            now,
            new TextEncoder().encode(item.body).length,
            item.bodyStatus === "not_provided"
              ? null
              : await tokenHash(item.body),
            item.publishedAt,
            item.bodyStatus,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          "UPDATE ingestion_jobs SET status='completed',phase='complete',version=1,found_count=?,body_count=?,duplicate_count=?,updated_at=? WHERE id=?",
        )
        .bind(value.items.length, bodies, duplicates, now, id),
      this.db
        .prepare(
          "UPDATE knowledge_sources SET last_success_at=?,sync_state='completed',last_error=NULL,next_sync_at_ms=?+(SELECT sync_hours FROM console_engine_settings WHERE id='console-v2-settings')*3600000 WHERE id=?",
        )
        .bind(now, Date.parse(now), source.id),
    );
    const outcome = await this.mutate(
      command,
      "manual.import",
      "job",
      id,
      {
        ...value,
        policyVersion: policy?.version || 0,
        note: `人工导入${value.items.length}条`,
      },
      statements,
      "write",
      source.id,
      [
        this.db
          .prepare(
            "INSERT INTO ingestion_jobs(id,source_id,status,version,job_kind,rule_version,source_version,policy_version,run_key,max_articles,updated_at) VALUES(?,?,'queued',0,'manual','manual-import-v1',?,?,?,?,?)",
          )
          .bind(
            id,
            source.id,
            source.version,
            policy?.version || 0,
            id,
            value.items.length,
            now,
          ),
      ],
    );
    return this.receipt(id, outcome.idempotent, linkedDocuments);
  }
}
