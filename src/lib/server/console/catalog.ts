import { z } from "zod";
import {
  SourceInputSchema,
  CatalogRefSchema,
} from "@/domain/console/contracts";
import type { SqlDatabase } from "../assistant/database";
import { tokenHash } from "../assistant/crypto";
import { ApiError } from "../errors";
const recordSchema = z
  .object({
    id: z.string().regex(/^GDUFS-SRC-\d{4}$/),
    input: SourceInputSchema,
    officialStatus: z.enum(["claimed_official", "unverified", "unofficial"]),
    canonicalLocator: z.string().max(2000).nullable(),
    originalCatalogRefs: z.array(CatalogRefSchema).max(100),
    catalogMetadata: z.record(z.string(), z.string().max(20000)),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const CatalogManifestSchema = z
  .object({
    version: z.literal("2026-10-17"),
    files: z
      .array(
        z
          .object({
            file: z.string().max(500),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .length(2),
    records: z.array(recordSchema).min(1).max(5000),
  })
  .strict();
export async function validateCatalog(raw: unknown) {
  const manifest = CatalogManifestSchema.parse(raw),
    ids = new Set<string>(),
    locators = new Set<string>();
  for (const record of manifest.records) {
    if (ids.has(record.id))
      throw new ApiError("INVALID_ARGUMENT", "目录中存在重复编号。");
    ids.add(record.id);
    const { catalogHash, ...data } = record;
    if ((await tokenHash(JSON.stringify(data))) !== catalogHash)
      throw new ApiError("INVALID_ARGUMENT", "目录记录哈希不匹配。");
    if (record.canonicalLocator) {
      const key = record.input.sourceType + ":" + record.canonicalLocator;
      if (locators.has(key))
        throw new ApiError("INVALID_ARGUMENT", "目录中存在同渠道重复来源。");
      locators.add(key);
    }
  }
  return manifest;
}
// Privileged offline operator seam. Not exposed as HTTP, a Skill or a SQL API.
export async function importCatalog(
  db: SqlDatabase,
  raw: unknown,
  actorLabel: string,
) {
  const manifest = await validateCatalog(raw),
    manifestHash = await tokenHash(JSON.stringify(manifest));
  const ids = JSON.stringify(manifest.records.map((r) => r.id));
  const existing = await db
    .prepare(
      "SELECT id,catalog_hash FROM knowledge_sources WHERE id IN(SELECT value FROM json_each(?))",
    )
    .bind(ids)
    .all<{ id: string; catalog_hash: string | null }>();
  for (const row of existing.results) {
    if (
      manifest.records.find((r) => r.id === row.id)?.catalogHash !==
      row.catalog_hash
    )
      throw new ApiError(
        "CONFLICT",
        "已有编号与目录内容冲突，未覆盖运营数据。",
      );
  }
  for (let offset = 0; offset < manifest.records.length; offset += 10) {
    const rows = manifest.records.slice(offset, offset + 10).map((row) => ({
      ...row,
      legacyType: ["official_web", "login_service"].includes(
        row.input.sourceType,
      )
        ? "official_web"
        : ["wechat_subscription", "wechat_service"].includes(
              row.input.sourceType,
            )
          ? "official_account"
          : ["student_media", "third_party_web"].includes(row.input.sourceType)
            ? "social_link"
            : "manual",
      domains: row.input.websiteUrl
        ? [new URL(row.input.websiteUrl).hostname]
        : [],
      entries: row.input.websiteUrl ? [row.input.websiteUrl] : [],
    }));
    await db
      .prepare(
        `INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,authorization_status,enabled,console_managed,channel_type,subtype,source_aliases_json,organization,official_status,verification_status,campus_scope,website_url,wechat_id,canonical_locator,evidence_urls_json,original_catalog_refs_json,catalog_metadata_json,catalog_hash,connector_type,connector_config_json,permission_status,priority,version,created_at,updated_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.input.displayName'),json_extract(value,'$.legacyType'),json_extract(value,'$.domains'),json_extract(value,'$.entries'),json_extract(value,'$.input.fetchPolicy'),'pending',0,1,json_extract(value,'$.input.sourceType'),json_extract(value,'$.input.subtype'),json_extract(value,'$.input.sourceAliases'),json_extract(value,'$.input.organization'),json_extract(value,'$.officialStatus'),'candidate',json_extract(value,'$.input.campusScope'),json_extract(value,'$.input.websiteUrl'),json_extract(value,'$.input.wechatId'),json_extract(value,'$.canonicalLocator'),json_extract(value,'$.input.evidenceUrls'),json_extract(value,'$.originalCatalogRefs'),json_set(json_extract(value,'$.catalogMetadata'),'$._importActor',?),json_extract(value,'$.catalogHash'),json_extract(value,'$.input.connectorType'),json_extract(value,'$.input.connectorConfig'),'unreviewed',json_extract(value,'$.input.priority'),1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`,
      )
      .bind(actorLabel, JSON.stringify(rows))
      .run();
  }
  const counts = await db
    .prepare(
      "SELECT count(*) AS imported,sum(enabled) AS enabled,sum(verification_status='candidate') AS candidates,sum(verification_status='verified') AS verified FROM knowledge_sources WHERE console_managed=1 AND id IN(SELECT value FROM json_each(?))",
    )
    .bind(ids)
    .first<{
      imported: number;
      enabled: number;
      candidates: number;
      verified: number;
    }>();
  if (counts?.imported !== manifest.records.length)
    throw new ApiError("SERVICE_UNAVAILABLE", "目录导入未完成，可安全重试。");
  const result = {
    manifestHash,
    expected: manifest.records.length,
    ...counts,
    inserted: manifest.records.length - existing.results.length,
    skipped: existing.results.length,
    failed: 0,
    automaticCollection: false,
    originalFiles: manifest.files,
  };
  await db
    .prepare(
      "INSERT INTO console_import_batches(id,manifest_hash,report_json,actor,created_at) VALUES(?,?,?,?,?) ON CONFLICT(manifest_hash) DO NOTHING",
    )
    .bind(
      "catalog-" + manifestHash.slice(0, 24),
      manifestHash,
      JSON.stringify(result),
      actorLabel,
      new Date().toISOString(),
    )
    .run();
  return result;
}
