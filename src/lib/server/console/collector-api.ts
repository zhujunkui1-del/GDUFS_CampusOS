import { z } from "zod";
import {
  CollectorArticleSchema,
  CollectorObservationSchema,
  canonicalWechatUrl,
  REMOVAL_CONFIRMATION_MS,
} from "@/domain/console/collector";
import { classifyArticle } from "@/domain/console/article-classification";
import { ConsoleIdSchema, type ConsoleActor } from "@/domain/console/contracts";
import type { SqlDatabase } from "../assistant/database";
import { randomToken, tokenHash } from "../assistant/crypto";
import { readJson } from "../assistant/http-context";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { consoleBindings } from "./auth";
import { sanitizeReadingHtml } from "./reading-html";

type Credential = { id: string; source_ids_json: string };
type Row = Record<string, string | number | null>;
const now = () => new Date().toISOString();
function canonical(raw: string) {
  try {
    return canonicalWechatUrl(raw);
  } catch (e) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      e instanceof Error ? e.message : "文章地址无效。",
    );
  }
}
function observed(raw: string) {
  const ms = Date.parse(raw);
  if (ms > Date.now() + 300000 || ms < Date.UTC(2000, 0, 1))
    throw new ApiError("INVALID_ARGUMENT", "采集时间无效。");
  return new Date(ms).toISOString();
}
function assertion(db: SqlDatabase, sql: string, args: unknown[] = []) {
  return db
    .prepare(
      `SELECT CASE WHEN (${sql}) THEN 1 ELSE json_extract('COLLECTOR_CONFLICT','$') END AS consistent`,
    )
    .bind(...args);
}
async function authenticate(request: Request, db: SqlDatabase) {
  const origin = request.headers.get("Origin"),
    header = request.headers.get("Authorization") || "";
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError("FORBIDDEN", "采集器来源无效。");
  if (!/^Bearer [\w-]{40,100}$/.test(header))
    throw new ApiError("UNAUTHORIZED", "需要采集器凭据。");
  const row = await db
    .prepare(
      "SELECT t.id,t.source_ids_json FROM campus_collector_tokens t JOIN console_admins a ON a.id=t.admin_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at_ms>? AND a.status='active' AND a.role='admin' AND a.principal_type='human'",
    )
    .bind(await tokenHash(header.slice(7)), Date.now())
    .first<Credential>();
  if (!row)
    throw new ApiError("UNAUTHORIZED", "采集器凭据已失效，请在后台重新签发。");
  return row;
}
async function source(
  db: SqlDatabase,
  credential: Credential,
  sourceId: string,
) {
  if (!(JSON.parse(credential.source_ids_json) as string[]).includes(sourceId))
    throw new ApiError("FORBIDDEN", "账号不在此采集器的范围内。");
  const p = await db
    .prepare(
      "SELECT p.*,s.display_name,s.catalog_metadata_json FROM campus_collector_sources p JOIN knowledge_sources s ON s.id=p.source_id JOIN console_admins a ON a.id=p.approved_by WHERE p.source_id=? AND p.enabled=1 AND s.enabled=1 AND s.archived_at IS NULL AND s.console_managed=1 AND s.permission_status<>'denied' AND s.channel_type IN('wechat_subscription','wechat_service') AND a.principal_type='human' AND a.role='admin' AND a.status='active'",
    )
    .bind(sourceId)
    .first<Row>();
  if (!p) throw new ApiError("FORBIDDEN", "此公众号已暂停或不允许同步。");
  return p;
}
async function existing(db: SqlDatabase, url: string) {
  return db
    .prepare(
      "SELECT c.*,d.version,d.content_revision,d.publication_status,d.lifecycle_status,d.body_format,d.input_hash,d.source_updated_at,d.body,d.title,d.published_at,d.radar_category,d.knowledge_category,EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND (x.hold_reason IS NOT NULL OR x.review_hold IS NOT NULL)) AS held FROM campus_collector_articles c JOIN knowledge_documents d ON d.id=c.document_id WHERE c.canonical_url=?",
    )
    .bind(url)
    .first<Row>();
}
async function replay(
  db: SqlDatabase,
  credential: Credential,
  id: string,
  hash: string,
) {
  const receipt = await db
    .prepare(
      "SELECT token_id,payload_hash,result_json FROM campus_collector_receipts WHERE request_id=?",
    )
    .bind(id)
    .first<Row>();
  if (!receipt) return null;
  if (receipt.token_id !== credential.id || receipt.payload_hash !== hash)
    throw new ApiError("CONFLICT", "同一请求标识不能提交不同内容。");
  return JSON.parse(String(receipt.result_json)) as Row;
}
function receipt(
  db: SqlDatabase,
  c: Credential,
  id: string,
  sourceId: string,
  documentId: string,
  hash: string,
  result: Row,
) {
  return db
    .prepare(
      "INSERT INTO campus_collector_receipts(request_id,token_id,source_id,document_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(id, c.id, sourceId, documentId, hash, JSON.stringify(result), now());
}
async function commit(
  db: SqlDatabase,
  statements: Parameters<SqlDatabase["batch"]>[0],
) {
  try {
    await db.batch(statements);
  } catch {
    throw new ApiError(
      "CONFLICT",
      "同步状态已变化，请重新读取后重试；文章未被部分写入。",
      true,
    );
  }
}

async function ingest(db: SqlDatabase, c: Credential, raw: unknown) {
  const v = CollectorArticleSchema.parse(raw),
    p = await source(db, c, v.sourceId);
  if (v.accountId !== p.account_id)
    throw new ApiError("FORBIDDEN", "公众号 ID 与信息源不一致。");
  const url = canonical(v.url),
    seen = observed(v.observedAt),
    published = new Date(v.publishedAt).toISOString();
  if (Date.parse(published) > Date.parse(seen) + 300000)
    throw new ApiError("INVALID_ARGUMENT", "原文发布时间晚于采集时间。");
  if (
    new Date(Date.parse(published) + 28800000).toISOString().slice(0, 10) <
    String(p.since_day)
  )
    throw new ApiError("INVALID_ARGUMENT", "文章早于该来源的导入起日。");
  const u = new URL(url);
  if (u.searchParams.has("__biz")) {
    const catalog = JSON.parse(String(p.catalog_metadata_json || "{}"));
    if (u.searchParams.get("__biz") !== catalog.wechatAccount?.biz)
      throw new ApiError("FORBIDDEN", "长链接的公众号标识与信息源不一致。");
  }
  const safe = sanitizeReadingHtml(v.readingHtml),
    mediaOmitted = safe.mediaOmitted || v.mediaOmitted;
  const placement = classifyArticle(v.title);
  const hash = await tokenHash(
    JSON.stringify([
      v.sourceId,
      v.title,
      url,
      published,
      v.sourceUpdatedAt,
      safe.html,
      mediaOmitted,
      placement,
    ]),
  );
  const requestHash = await tokenHash(
    JSON.stringify([hash, seen, v.provenance]),
  );
  const prior = await replay(db, c, v.requestId, requestHash);
  if (prior) return prior;
  const old = await existing(db, url);
  if (old && old.source_id !== v.sourceId)
    throw new ApiError("CONFLICT", "该链接已属于另一个信息源。");
  if (old && String(old.observed_at) > seen) {
    const result: Row = {
      documentId: String(old.document_id),
      state: "stale",
      changed: 0,
      htmlBytes: 0,
    };
    await commit(db, [
      receipt(
        db,
        c,
        v.requestId,
        v.sourceId,
        String(old.document_id),
        requestHash,
        result,
      ),
    ]);
    return result;
  }
  if (old && old.observed_at === seen && old.current_hash !== hash) {
    // A cleaner may compact the same observed article. Source facts and the
    // newly canonical reading fragment must still be identical before rewriting.
    const normalizedOldHash =
      old.state !== "removed" && old.body
        ? await tokenHash(
            JSON.stringify([
              old.source_id,
              old.title,
              old.canonical_url,
              old.published_at,
              old.source_updated_at,
              sanitizeReadingHtml(String(old.body)).html,
              !!old.media_omitted,
              {
                radarCategory: old.radar_category,
                knowledgeCategory: old.knowledge_category,
              },
            ]),
          )
        : null;
    const restoringSourceLayout =
      Number(old.rendering_version) < 2 &&
      old.state !== "removed" &&
      old.title === v.title &&
      old.published_at === published &&
      old.source_updated_at === v.sourceUpdatedAt;
    if (normalizedOldHash !== hash && !restoringSourceLayout)
      throw new ApiError("CONFLICT", "同一采集时间出现不同内容，请重新采集。");
  }
  const id = old
    ? String(old.document_id)
    : "wx-" + (await tokenHash(url)).slice(0, 40);
  const held = !!old?.held;
  const changed = !old || old.current_hash !== hash || old.state === "removed";
  const result: Row = {
    documentId: id,
    state: held ? "held" : "published",
    changed: changed ? 1 : 0,
    htmlBytes: new TextEncoder().encode(safe.html).length,
  };
  const statements = [
    receipt(db, c, v.requestId, v.sourceId, id, requestHash, result),
  ];
  if (old)
    statements.push(
      assertion(
        db,
        "EXISTS(SELECT 1 FROM knowledge_documents d JOIN campus_collector_articles c ON c.document_id=d.id WHERE d.id=? AND d.version=? AND c.observed_at=?)",
        [id, old.version, old.observed_at],
      ),
    );
  else
    statements.push(
      assertion(
        db,
        "NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=? OR url=?)",
        [id, url],
      ),
    );
  const stamp = now();
  if (!old)
    statements.push(
      db
        .prepare(
          "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,published_at,fetched_at,campus_scope,data_domain,content_type,rights_scope,body_status,body_format,candidate_kind,summary,publisher,input_hash,content_revision,source_updated_at,updated_at,radar_category,knowledge_category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          v.sourceId,
          v.title,
          url,
          safe.html,
          hash,
          published,
          seen,
          "all",
          "approved_life_experience",
          placement.knowledgeCategory ? "guide" : "notice",
          "licensed_full_text",
          mediaOmitted ? "partial" : "complete",
          "reading_html",
          "knowledge",
          safe.summary,
          p.display_name,
          hash,
          1,
          v.sourceUpdatedAt,
          stamp,
          placement.radarCategory,
          placement.knowledgeCategory,
        ),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO campus_collector_articles(document_id,source_id,canonical_url,current_hash,state,observed_at,last_outcome,provenance,media_omitted,last_changed_at,rendering_version) VALUES(?,?,?,?,'available',?,'available',?,?,?,2) ON CONFLICT(document_id) DO UPDATE SET current_hash=excluded.current_hash,state='available',observed_at=excluded.observed_at,last_outcome='available',missing_since_ms=NULL,missing_count=0,provenance=excluded.provenance,media_omitted=excluded.media_omitted,rendering_version=2,last_changed_at=CASE WHEN current_hash<>excluded.current_hash OR state='removed' THEN excluded.last_changed_at ELSE last_changed_at END",
      )
      .bind(
        id,
        v.sourceId,
        url,
        hash,
        seen,
        v.provenance,
        mediaOmitted ? 1 : 0,
        stamp,
      ),
  );
  if (old && changed)
    statements.push(
      db
        .prepare(
          "UPDATE knowledge_documents SET title=?,body=?,content_hash=?,published_at=?,fetched_at=?,source_updated_at=?,updated_at=?,summary=?,publisher=?,content_type=?,radar_category=?,knowledge_category=?,body_status=?,body_format='reading_html',input_hash=?,content_revision=content_revision+1,version=version+1,publication_status='draft',review_status='approved',workflow_status='approved',lifecycle_status='active',approved_input_hash=NULL,approved_content_revision=NULL WHERE id=?",
        )
        .bind(
          v.title,
          safe.html,
          hash,
          published,
          seen,
          v.sourceUpdatedAt,
          stamp,
          safe.summary,
          p.display_name,
          placement.knowledgeCategory ? "guide" : "notice",
          placement.radarCategory,
          placement.knowledgeCategory,
          mediaOmitted ? "partial" : "complete",
          hash,
          id,
        ),
    );
  if (!old || changed || (!held && old.publication_status !== "published")) {
    statements.push(
      db
        .prepare(
          "INSERT INTO console_document_controls(document_id,last_change_origin,last_publication_mode) VALUES(?,'wechat_collector','auto') ON CONFLICT(document_id) DO UPDATE SET last_change_origin='wechat_collector',last_publication_mode='auto'",
        )
        .bind(id),
    );
    statements.push(
      db
        .prepare(
          "UPDATE knowledge_documents SET review_status='approved',workflow_status='approved',approved_content_revision=content_revision,approved_input_hash=input_hash,publication_status=?,lifecycle_status='active' WHERE id=?",
        )
        .bind(held ? "draft" : "published", id),
    );
  }
  if (changed && old) {
    // Search chunks are derived, never historical body storage.
    statements.push(
      db.prepare("DELETE FROM knowledge_facts WHERE document_id=?").bind(id),
    );
    statements.push(
      db.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").bind(id),
    );
  }
  await commit(db, statements);
  return result;
}

async function observeRemoval(db: SqlDatabase, c: Credential, raw: unknown) {
  const v = CollectorObservationSchema.parse(raw);
  await source(db, c, v.sourceId);
  const url = canonical(v.url),
    seen = observed(v.observedAt);
  // Old exports can be imported. Deletion observations must be recent direct observations.
  if (Date.now() - Date.parse(seen) > 3600000)
    throw new ApiError(
      "INVALID_ARGUMENT",
      "下架确认必须来自最近一小时的原文检查。",
    );
  const hash = await tokenHash(
    JSON.stringify([v.sourceId, url, seen, v.outcome]),
  );
  const prior = await replay(db, c, v.requestId, hash);
  if (prior) return prior;
  const old = await existing(db, url);
  if (!old || old.source_id !== v.sourceId)
    throw new ApiError("NOT_FOUND", "未找到此来源的同步文章。");
  if (String(old.observed_at) >= seen)
    throw new ApiError("CONFLICT", "重复或过期的下架检查已忽略。");
  const failure = v.outcome === "access_failed";
  const since = failure
    ? null
    : Number(old.missing_since_ms || Date.parse(seen));
  const count = failure ? 0 : Number(old.missing_count || 0) + 1;
  const removed =
    old.state === "removed" ||
    (!failure &&
      count >= 2 &&
      Date.parse(seen) - Number(since) >= REMOVAL_CONFIRMATION_MS);
  const state = removed
    ? "removed"
    : failure
      ? "available"
      : "suspected_missing";
  const id = String(old.document_id),
    result: Row = {
      documentId: id,
      state,
      changed: removed && old.state !== "removed" ? 1 : 0,
    };
  const statements = [
    receipt(db, c, v.requestId, v.sourceId, id, hash, result),
    assertion(
      db,
      "EXISTS(SELECT 1 FROM knowledge_documents d JOIN campus_collector_articles c ON c.document_id=d.id WHERE d.id=? AND d.version=? AND c.observed_at=?)",
      [id, old.version, old.observed_at],
    ),
  ];
  if (removed && old.state !== "removed") {
    const tombstoneHash = await tokenHash("removed:" + id + ":" + seen);
    statements.push(
      db
        .prepare(
          "UPDATE knowledge_documents SET body='',summary='',body_status='not_provided',input_hash=?,content_hash=?,approved_input_hash=NULL,approved_content_revision=NULL,publication_status='withdrawn',lifecycle_status='withdrawn',content_revision=content_revision+1,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(tombstoneHash, tombstoneHash, now(), id),
    );
    statements.push(
      db.prepare("DELETE FROM knowledge_facts WHERE document_id=?").bind(id),
      db.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").bind(id),
    );
  }
  statements.push(
    db
      .prepare(
        "UPDATE campus_collector_articles SET state=?,observed_at=?,missing_since_ms=?,missing_count=?,last_outcome=?,last_changed_at=CASE WHEN state<>? THEN ? ELSE last_changed_at END WHERE document_id=?",
      )
      .bind(state, seen, since, count, v.outcome, state, now(), id),
  );
  await commit(db, statements);
  return result;
}

export const collectorApi = withApi(async (request) => {
  const db = consoleBindings().db,
    c = await authenticate(request, db);
  const path = new URL(request.url).pathname.replace(
    /^\/api\/collector\/?/,
    "",
  );
  const scopes = JSON.parse(c.source_ids_json) as string[];
  if (request.method === "GET" && path === "sources") {
    const r = await db
      .prepare(
        `SELECT p.source_id,p.account_id,p.enabled,p.since_day,p.interval_minutes,p.requested_at,s.display_name,s.catalog_metadata_json FROM campus_collector_sources p JOIN knowledge_sources s ON s.id=p.source_id WHERE p.source_id IN(${scopes.map(() => "?").join(",")}) AND p.enabled=1 AND s.enabled=1 AND s.archived_at IS NULL AND s.permission_status<>'denied' ORDER BY p.source_id`,
      )
      .bind(...scopes)
      .all<Row>();
    return {
      sources: r.results.map((r) => ({
        sourceId: r.source_id,
        accountId: r.account_id,
        name: r.display_name,
        sinceDay: r.since_day,
        intervalMinutes: r.interval_minutes,
        requestedAt: r.requested_at,
        biz:
          JSON.parse(String(r.catalog_metadata_json || "{}")).wechatAccount
            ?.biz || null,
      })),
      format: "reading_html",
      serverTime: now(),
    };
  }
  if (request.method === "GET" && path === "articles") {
    const q = z
      .object({
        sourceId: ConsoleIdSchema,
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    await source(db, c, q.sourceId);
    return {
      items: (
        await db
          .prepare(
            "SELECT canonical_url AS url,observed_at AS observedAt,state FROM campus_collector_articles WHERE source_id=? ORDER BY document_id LIMIT 100 OFFSET ?",
          )
          .bind(q.sourceId, q.offset)
          .all()
      ).results,
    };
  }
  if (request.method === "POST" && path === "articles")
    return ingest(db, c, await readJson(request, 3000000));
  if (request.method === "POST" && path === "observations")
    return observeRemoval(db, c, await readJson(request, 8192));
  if (request.method === "POST" && path === "heartbeat") {
    const v = z
      .object({
        mode: z.enum(["local_exports", "publisher_exports"]),
        status: z.enum(["idle", "syncing", "blocked", "error"]),
        imported: z.number().int().min(0).max(1000000),
        errorCode: z
          .enum([
            "EXPORT_UNAVAILABLE",
            "AUTH_REQUIRED",
            "ACCESS_DENIED",
            "SYNC_FAILED",
          ])
          .nullable()
          .default(null),
      })
      .strict()
      .parse(await readJson(request, 4096));
    await db.batch([
      db
        .prepare(
          "INSERT INTO campus_collector_heartbeats(token_id,mode,status,last_seen_at,imported,last_error) VALUES(?,?,?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET mode=excluded.mode,status=excluded.status,last_seen_at=excluded.last_seen_at,imported=excluded.imported,last_error=excluded.last_error",
        )
        .bind(c.id, v.mode, v.status, now(), v.imported, v.errorCode),
      db
        .prepare("UPDATE campus_collector_tokens SET last_seen_at=? WHERE id=?")
        .bind(now(), c.id),
    ]);
    return { received: true };
  }
  throw new ApiError("NOT_FOUND", "未找到采集接口。");
});

export async function collectorAdministration(
  db: SqlDatabase,
  actor: ConsoleActor,
  request: Request,
  path: string[],
) {
  if (actor.role !== "admin")
    throw new ApiError("FORBIDDEN", "采集配置仅供管理员操作。");
  const [section, id] = path;
  if (request.method === "GET" && !section) {
    const [sources, tokens, heartbeats] = await Promise.all([
      db
        .prepare(
          "SELECT p.source_id,p.account_id,p.since_day,p.interval_minutes,CASE WHEN p.enabled=1 AND s.enabled=1 AND s.archived_at IS NULL AND s.permission_status<>'denied' THEN 1 ELSE 0 END AS enabled,s.display_name,(SELECT count(*) FROM campus_collector_articles c WHERE c.source_id=p.source_id) AS article_count,(SELECT count(*) FROM campus_collector_articles c WHERE c.source_id=p.source_id AND c.state='removed') AS removed_count,(SELECT max(observed_at) FROM campus_collector_articles c WHERE c.source_id=p.source_id) AS last_observed_at FROM campus_collector_sources p JOIN knowledge_sources s ON s.id=p.source_id ORDER BY s.display_name",
        )
        .all(),
      db
        .prepare(
          "SELECT id,label,created_at,expires_at_ms,revoked_at,last_seen_at,json_array_length(source_ids_json) AS source_count FROM campus_collector_tokens ORDER BY created_at DESC LIMIT 20",
        )
        .all(),
      db
        .prepare(
          "SELECT h.*,t.label FROM campus_collector_heartbeats h JOIN campus_collector_tokens t ON t.id=h.token_id WHERE t.revoked_at IS NULL AND t.expires_at_ms>? ORDER BY h.last_seen_at DESC LIMIT 5",
        )
        .bind(Date.now())
        .all(),
    ]);
    return {
      sources: sources.results,
      tokens: tokens.results,
      heartbeats: heartbeats.results,
      reviewEnabled: false,
      versionsEnabled: false,
    };
  }
  if (request.method === "POST" && section === "credentials" && !id) {
    const v = z
      .object({
        label: z.string().trim().min(2).max(80),
        sourceIds: z
          .array(ConsoleIdSchema)
          .min(1)
          .max(100)
          .refine((a) => new Set(a).size === a.length),
        validityDays: z.number().int().min(1).max(365).default(90),
      })
      .strict()
      .parse(await readJson(request, 20000));
    const rows = await db
      .prepare(
        `SELECT source_id FROM campus_collector_sources WHERE source_id IN(${v.sourceIds.map(() => "?").join(",")})`,
      )
      .bind(...v.sourceIds)
      .all();
    if (rows.results.length !== v.sourceIds.length)
      throw new ApiError("INVALID_ARGUMENT", "存在未配置的公众号来源。");
    const token = randomToken(),
      tokenId = "collector-" + crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO campus_collector_tokens(id,token_hash,label,source_ids_json,admin_id,created_at,expires_at_ms) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        tokenId,
        await tokenHash(token),
        v.label,
        JSON.stringify(v.sourceIds),
        actor.id,
        now(),
        Date.now() + v.validityDays * 86400000,
      )
      .run();
    return { id: tokenId, token };
  }
  if (request.method === "POST" && section === "credentials" && id) {
    ConsoleIdSchema.parse(id);
    await db
      .prepare("UPDATE campus_collector_tokens SET revoked_at=? WHERE id=?")
      .bind(now(), id)
      .run();
    return { revoked: true };
  }
  if (request.method === "POST" && section === "range" && !id) {
    const v = z
      .object({
        sourceIds: z.array(ConsoleIdSchema).min(1).max(100),
        sinceDay: z.iso.date(),
      })
      .strict()
      .parse(await readJson(request, 20000));
    await db.batch(
      v.sourceIds.map((sourceId) =>
        db
          .prepare(
            "UPDATE campus_collector_sources SET since_day=?,approved_by=?,updated_at=? WHERE source_id=?",
          )
          .bind(v.sinceDay, actor.id, now(), sourceId),
      ),
    );
    return { saved: true };
  }
  if (request.method === "POST" && section === "sources" && !id) {
    const v = z
      .object({
        sourceIds: z.array(ConsoleIdSchema).min(1).max(100),
        enabled: z.boolean(),
        sinceDay: z.iso.date(),
        intervalMinutes: z.number().int().min(60).max(10080),
      })
      .strict()
      .parse(await readJson(request, 20000));
    await db.batch(
      v.sourceIds.map((id) =>
        db
          .prepare(
            "UPDATE campus_collector_sources SET enabled=?,since_day=?,interval_minutes=?,approved_by=?,updated_at=? WHERE source_id=?",
          )
          .bind(
            v.enabled ? 1 : 0,
            v.sinceDay,
            v.intervalMinutes,
            actor.id,
            now(),
            id,
          ),
      ),
    );
    return { saved: true };
  }
  if (request.method === "POST" && section === "requests" && !id) {
    const v = z
      .object({ sourceIds: z.array(ConsoleIdSchema).min(1).max(100) })
      .strict()
      .parse(await readJson(request, 20000));
    const stamp = now();
    await db.batch(
      v.sourceIds.map((id) =>
        db
          .prepare(
            "UPDATE campus_collector_sources SET requested_at=? WHERE source_id=? AND enabled=1",
          )
          .bind(stamp, id),
      ),
    );
    return { requestedAt: stamp };
  }
  throw new ApiError("NOT_FOUND", "未找到采集配置接口。");
}
