import { z } from "zod";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";

export type CollectorCredential = {
  id: string;
  source_ids_json: string;
  admin_id: string;
  auto_discover_sources: number;
};
const AccountSchema = z
  .object({
    accountId: z.string().regex(/^MP_WXS_\d{3,20}$/),
    biz: z.string().min(4).max(64),
    name: z.string().trim().min(1).max(160),
    sourceType: z
      .enum(["wechat_subscription", "wechat_service"])
      .default("wechat_subscription"),
  })
  .strict()
  .refine((a) => {
    try {
      return atob(a.biz) === a.accountId.slice(7);
    } catch {
      return false;
    }
  }, "公众号账号与biz不一致");
const ManifestSchema = z
  .object({ accounts: z.array(AccountSchema).min(1).max(200) })
  .strict();
type Source = {
  version: number;
  id: string;
  display_name: string;
  wechat_id: string | null;
  catalog_metadata_json: string;
  archived_at: string | null;
  enabled: number;
  permission_status: string;
  registered_account: string | null;
};
function identity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^MP_WXS_\d+$/.test(value)) return value;
  try {
    const numeric = atob(value);
    return /^\d+$/.test(numeric) ? "MP_WXS_" + numeric : null;
  } catch {
    return null;
  }
}
/** Owner-enabled local account discovery. Existing pause/archive choices are not undone. */
export async function registerCollectorAccounts(
  db: SqlDatabase,
  credential: CollectorCredential,
  raw: unknown,
) {
  if (!credential.auto_discover_sources)
    throw new ApiError("FORBIDDEN", "此本机连接尚未开启账号自动同步。");
  const input = ManifestSchema.parse(raw);
  if (
    new Set(input.accounts.map((a) => a.accountId)).size !==
    input.accounts.length
  )
    throw new ApiError("INVALID_ARGUMENT", "账号清单包含重复ID。");
  const rows = await db
    .prepare(
      "SELECT s.id,s.version,s.display_name,s.wechat_id,s.catalog_metadata_json,s.archived_at,s.enabled,s.permission_status,p.account_id AS registered_account FROM knowledge_sources s LEFT JOIN campus_collector_sources p ON p.source_id=s.id WHERE s.console_managed=1 AND s.channel_type IN('wechat_subscription','wechat_service') AND s.source_type<>'user_private'",
    )
    .all<Source>();
  const accounts: { accountId: string; sourceId?: string; state: string }[] =
    [];
  const addScopes: string[] = [];
  for (const account of input.accounts) {
    const identified = (s: Source) => {
      const metadata =
        JSON.parse(s.catalog_metadata_json || "{}").wechatAccount || {};
      return (
        s.registered_account ||
        identity(s.wechat_id) ||
        identity(metadata.bookId) ||
        identity(metadata.accountId) ||
        identity(metadata.biz)
      );
    };
    let matches = rows.results.filter(
      (s) => identified(s) === account.accountId,
    );
    if (!matches.length)
      matches = rows.results.filter(
        (s) => !identified(s) && s.display_name === account.name,
      );
    if (matches.length > 1) {
      accounts.push({
        accountId: account.accountId,
        state: "identity_conflict",
      });
      continue;
    }
    const old = matches[0];
    const sourceId = old?.id || "GDUFS-WX-" + account.accountId.slice(7);
    const stamp = new Date().toISOString();
    const statements = [];
    if (!old)
      statements.push(
        db
          .prepare(
            "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed,channel_type,wechat_id,canonical_locator,catalog_metadata_json,connector_type,enabled,operating_status) VALUES(?,?,'official_account','[\"mp.weixin.qq.com\"]','[]','{\"mode\":\"disabled\",\"maxRequests\":0}',1,?,?,?,?, 'wechat_link_manual',1,'active')",
          )
          .bind(
            sourceId,
            account.name,
            account.sourceType,
            account.accountId,
            account.accountId,
            JSON.stringify({
              wechatAccount: {
                bookId: account.accountId,
                biz: account.biz,
                name: account.name,
                collector: "wechat-mp-tools",
                discoveredFrom: "local_account_library",
              },
            }),
          ),
      );
    else if (
      JSON.parse(old.catalog_metadata_json || "{}").wechatAccount?.biz !==
      account.biz
    )
      statements.push(
        db
          .prepare(
            "UPDATE knowledge_sources SET wechat_id=COALESCE(wechat_id,?),catalog_metadata_json=json_set(catalog_metadata_json,'$.wechatAccount',json(?)),version=version+1,updated_at=? WHERE id=?",
          )
          .bind(
            account.accountId,
            JSON.stringify({
              ...JSON.parse(old.catalog_metadata_json || "{}").wechatAccount,
              bookId: account.accountId,
              biz: account.biz,
              name: account.name,
              collector: "wechat-mp-tools",
            }),
            stamp,
            sourceId,
          ),
      );
    if (!old?.registered_account)
      statements.push(
        db
          .prepare(
            "INSERT INTO campus_collector_sources(source_id,account_id,approved_by,permission_basis,updated_at) VALUES(?,?,?,'owner_instruction',?)",
          )
          .bind(sourceId, account.accountId, credential.admin_id, stamp),
      );
    if (statements.length) {
      if (old)
        statements.unshift(
          db
            .prepare(
              "SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_sources WHERE id=? AND version=?) THEN 1 ELSE json_extract('STALE_SOURCE','$') END",
            )
            .bind(old.id, old.version),
        );
      statements.unshift(
        db
          .prepare(
            "SELECT CASE WHEN EXISTS(SELECT 1 FROM campus_collector_tokens t JOIN console_admins a ON a.id=t.admin_id WHERE t.id=? AND t.revoked_at IS NULL AND t.auto_discover_sources=1 AND a.status='active' AND a.role='admin' AND a.principal_type='human') THEN 1 ELSE json_extract('REVOKED','$') END",
          )
          .bind(credential.id),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id,details_json) VALUES(?,?,?,'collector.account_register','source',?,?)",
          )
          .bind(
            crypto.randomUUID(),
            credential.admin_id,
            "本机公众号自动同步",
            sourceId,
            JSON.stringify({
              accountId: account.accountId,
              tokenId: credential.id,
              created: !old,
            }),
          ),
      );
      await db.batch(statements);
    }
    addScopes.push(sourceId);
    accounts.push({
      accountId: account.accountId,
      sourceId,
      state: !old
        ? "created"
        : old.archived_at
          ? "archived"
          : !old.enabled
            ? "paused"
            : "matched",
    });
  }
  const known = new Set(JSON.parse(credential.source_ids_json) as string[]);
  if (addScopes.some((id) => !known.has(id)))
    await db
      .prepare(
        "UPDATE campus_collector_tokens SET source_ids_json=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(source_ids_json) UNION SELECT value FROM json_each(?))) WHERE id=? AND revoked_at IS NULL AND auto_discover_sources=1",
      )
      .bind(JSON.stringify(addScopes), credential.id)
      .run();
  return { accounts };
}
