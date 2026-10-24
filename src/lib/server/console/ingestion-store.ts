import { ConsoleStore } from "./store";
import { consolePermission } from "./auth";
import { ApiError } from "../errors";
import { tokenHash } from "../assistant/crypto";
import type { Statement } from "../assistant/database";
import { CommandSchema } from "@/domain/console/contracts";
import { discoveryStatement, timeEvidenceStatements } from "./intake-evidence";
import {
  CheckpointSchema,
  PolicySchema,
  CreateJobSchema,
  IngestionResultSchema,
} from "@/domain/console/ingestion";
import {
  approvedUrl as configuredUrl,
  profileFromSource,
} from "@/lib/ingestion/profiles";
async function profileFor(db: IngestionStore["db"], id: string) {
  const row = await db
    .prepare(
      "SELECT id,display_name,website_url,web_profile_json FROM knowledge_sources WHERE id=? AND channel_type='official_web' AND source_type='official_web'",
    )
    .bind(id)
    .first<Record<string, string | number | null>>();
  if (!row)
    throw new ApiError("UNSUPPORTED_INTEGRATION", "此来源尚未配置官网连接器。");
  try {
    const profile = profileFromSource({
      sourceId: String(row.id),
      name: String(row.display_name),
      websiteUrl: row.website_url ? String(row.website_url) : null,
      webProfileJson: row.web_profile_json
        ? String(row.web_profile_json)
        : "{}",
    });
    if (profile) return profile;
  } catch {
    throw new ApiError(
      "UNSUPPORTED_INTEGRATION",
      "官网采集入口或解析规则尚未配置。",
    );
  }
  throw new ApiError(
    "UNSUPPORTED_INTEGRATION",
    "官网采集入口或解析规则尚未配置。",
  );
}
function approvedUrl(...args: Parameters<typeof configuredUrl>) {
  try {
    return configuredUrl(...args);
  } catch {
    throw new ApiError("INVALID_ARGUMENT", "链接不在该来源允许的栏目范围内。");
  }
}
type Row = Record<string, string | number | null>;
const json = JSON.stringify;

export class IngestionStore extends ConsoleStore {
  private async intakeBlock(
    sourceId: string,
    url: string,
    publishedAt: string | null | undefined,
    existingId: string | null = null,
    earliestImportDay?: string,
    latestImportDay?: string,
  ): Promise<"cutoff" | "tombstone" | null> {
    const row = await this.db
      .prepare(
        `SELECT e.earliest_import_day,
    EXISTS(SELECT 1 FROM console_cleanup_tombstones WHERE canonical_url=? AND released_at IS NULL) OR EXISTS(SELECT 1 FROM knowledge_documents d JOIN console_document_controls c ON c.document_id=d.id WHERE d.url=? AND c.hold_reason='retention') OR EXISTS(SELECT 1 FROM knowledge_documents d JOIN console_cleanup_items i ON i.document_id=d.id WHERE d.url=? AND i.stage IN('marked','versions','payloads','chunks')) AS tombstoned,
    EXISTS(SELECT 1 FROM console_protections WHERE target_type='source' AND target_id=? AND active=1 AND history_exempt=1 AND (expires_at_ms IS NULL OR expires_at_ms>?)) OR EXISTS(SELECT 1 FROM knowledge_documents d JOIN console_history_exempt h ON h.id=d.id WHERE d.url=?) AS exempt,
    EXISTS(SELECT 1 FROM knowledge_documents d WHERE d.source_id=? AND d.url=? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND d.lifecycle_status='active' AND (d.valid_until IS NULL OR julianday(d.valid_until)>julianday('now'))) AS maintenance,
    (SELECT published_at FROM knowledge_documents WHERE id=? AND owner_user_id IS NULL AND data_domain<>'user_private') AS known_date FROM console_engine_settings e WHERE e.id='console-v2-settings'`,
      )
      .bind(
        url,
        url,
        url,
        sourceId,
        Date.parse(this.now()),
        url,
        sourceId,
        url,
        existingId,
      )
      .first<Row>();
    if (row?.tombstoned) return "tombstone";
    if (!row || row.exempt || row.maintenance) return null;
    const cutoff = earliestImportDay || String(row.earliest_import_day || "");
    if (!cutoff) return null;
    const date = publishedAt === undefined ? row.known_date : publishedAt;
    const day = date
      ? String(date).length === 10
        ? String(date)
        : new Date(Date.parse(String(date)) + 28800000)
            .toISOString()
            .slice(0, 10)
      : null;
    return !day || day < cutoff || (!!latestImportDay && day > latestImportDay)
      ? "cutoff"
      : null;
  }
  private skipStatement(
    id: string,
    jobId: string,
    sourceId: string,
    url: string,
    reason: "cutoff" | "tombstone",
    publishedAt: string | null,
    documentId: string | null,
  ) {
    return this.db
      .prepare(
        "INSERT INTO console_intake_skips(id,job_id,source_id,document_id,canonical_url,reason,published_at,observed_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        jobId,
        sourceId,
        documentId,
        url,
        reason,
        publishedAt,
        this.now(),
      );
  }
  async policy(sourceId: string) {
    await this.source(sourceId);
    const [p, profile] = await Promise.all([
      this.db
        .prepare("SELECT * FROM source_collection_policies WHERE source_id=?")
        .bind(sourceId)
        .first<Row>(),
      profileFor(this.db, sourceId),
    ]);
    return { profile, policy: p };
  }
  async setPolicy(sourceId: string, raw: unknown) {
    consolePermission(this.actor, "admin");
    const value = PolicySchema.parse(raw),
      source = await this.source(sourceId),
      p = await profileFor(this.db, sourceId);
    if (
      value.ruleVersion !== p.ruleVersion ||
      !source.websiteUrl ||
      new URL(source.websiteUrl).origin !== p.origin ||
      source.verificationStatus !== "verified" ||
      source.officialStatus !== "verified_official" ||
      source.permissionStatus !== "approved"
    )
      throw new ApiError(
        "INVALID_ARGUMENT",
        "请先核验该官网主体与元数据使用许可。",
      );
    return this.mutate(
      value,
      "source.collection-policy",
      "source",
      sourceId,
      value,
      [
        this.db
          .prepare(
            "INSERT INTO source_collection_policies(source_id,rule_version,rights_scope,evidence_urls_json,note,robots_status,robots_hash,expires_at_ms,approved_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET rule_version=excluded.rule_version,rights_scope=excluded.rights_scope,evidence_urls_json=excluded.evidence_urls_json,note=excluded.note,robots_status=excluded.robots_status,robots_hash=excluded.robots_hash,expires_at_ms=excluded.expires_at_ms,approved_by=excluded.approved_by,updated_at=excluded.updated_at,version=source_collection_policies.version+1",
          )
          .bind(
            sourceId,
            p.ruleVersion,
            value.rightsScope,
            json(value.evidenceUrls),
            value.note,
            value.robotsStatus,
            value.robotsHash,
            Date.parse(this.now()) + (value.validityDays || 1) * 86400000,
            this.actor.id,
            this.now(),
          ),
        this.db
          .prepare(
            "UPDATE knowledge_sources SET version=version+1,connector_type='official_web',connector_config_json=?,fetch_policy_json=?,updated_at=? WHERE id=?",
          )
          .bind(
            json({ entryUrl: p.entryUrl, parserProfile: p.ruleVersion }),
            json({ mode: "manual", maxRequests: 2 }),
            this.now(),
            sourceId,
          ),
      ],
    );
  }
  async createJob(raw: unknown) {
    const value = CreateJobSchema.parse(raw),
      { profile, policy } = await this.policy(value.sourceId),
      source = await this.source(value.sourceId),
      id = "job-" + value.commandId;
    if (
      !source.enabled ||
      !policy ||
      policy.rule_version !== profile.ruleVersion ||
      Number(policy.expires_at_ms) <= Date.parse(this.now())
    )
      throw new ApiError("INVALID_ARGUMENT", "采集策略尚未核验或已过期。");
    return this.mutate(
      { commandId: value.commandId, expectedVersion: 0 },
      "job.create",
      "job",
      id,
      value,
      [
        this.db
          .prepare(
            "INSERT INTO ingestion_jobs(id,source_id,status,rule_version,source_version,policy_version,run_key,max_articles,updated_at,checkpoint_json) VALUES(?,?,'queued',?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            value.sourceId,
            profile.ruleVersion,
            source.version,
            policy.version,
            value.sourceId + ":" + value.commandId,
            value.maxArticles,
            this.now(),
            json({ revalidate: value.mode === "revalidate" }),
          ),
      ],
      "write",
      value.sourceId,
    );
  }
  async job(id: string) {
    consolePermission(this.actor, "read");
    const row = await this.db
      .prepare(
        "SELECT j.* FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=? AND s.console_managed=1 AND s.source_type='official_web'",
      )
      .bind(id)
      .first<Row>();
    if (!row) throw new ApiError("NOT_FOUND", "未找到采集任务。");
    return row;
  }
  async claim(id: string, raw: unknown) {
    const value = CommandSchema.parse(raw),
      row = await this.job(id),
      sourceId = String(row.source_id),
      profile = await profileFor(this.db, sourceId);
    if (row.rule_version !== profile.ruleVersion)
      throw new ApiError("CONFLICT", "采集规则已更新，请核验策略后新建任务。");
    const leaseToken = crypto.randomUUID(),
      leaseHash = await tokenHash(this.actor.id + ":" + leaseToken);
    await this.mutate(
      value,
      "job.claim",
      "job",
      id,
      value,
      [
        this.db
          .prepare(
            "UPDATE ingestion_jobs SET status='running',lease_hash=?,lease_fence=lease_fence+1,lease_until_ms=?,version=version+1,attempts=attempts+1,request_count=request_count+2,updated_at=? WHERE id=?",
          )
          .bind(leaseHash, Date.parse(this.now()) + 120000, this.now(), id),
      ],
      "write",
      sourceId,
    );
    const claimed = await this.job(id);
    // A duplicated claim command may not mint a replacement token for an existing lease.
    if (claimed.lease_hash !== leaseHash)
      throw new ApiError("CONFLICT", "任务已被领取，请等待租约到期。");
    const checkpoint = CheckpointSchema.parse(
      JSON.parse(String(claimed.checkpoint_json)),
    );
    const url =
      claimed.phase === "discover"
        ? checkpoint.page ||
          profile.entryUrls?.[checkpoint.entryIndex] ||
          profile.entryUrl
        : checkpoint.urls[checkpoint.index];
    if (!url) throw new ApiError("CONFLICT", "任务检查点无效，请暂停并检查。");
    const origin = await this.db
      .prepare(
        "SELECT etag,last_modified FROM document_origins WHERE source_id=? AND canonical_url=?",
      )
      .bind(sourceId, url)
      .first<Row>();
    return {
      id,
      sourceId,
      profile,
      phase: String(claimed.phase),
      version: Number(claimed.version),
      fence: Number(claimed.lease_fence),
      leaseToken,
      url,
      publishedAtFromList:
        checkpoint.publishedDates.find((entry) => entry.url === url)
          ?.publishedAt || null,
      validators: {
        etag: origin?.etag || null,
        lastModified: origin?.last_modified || null,
      },
    };
  }
  async control(
    id: string,
    raw: unknown,
    action: "pause" | "resume" | "cancel",
  ) {
    const value = CommandSchema.parse(raw),
      row = await this.job(id);
    consolePermission(this.actor, "write");
    if (
      await this.db
        .prepare("SELECT id FROM console_commands WHERE id=?")
        .bind(value.commandId)
        .first()
    )
      return this.mutate(value, "job." + action, "job", id, value, []);
    if (row.phase === "complete" || row.control_state === "cancelled")
      throw new ApiError("CONFLICT", "此任务已结束，请新建任务。");
    return this.mutate(value, "job." + action, "job", id, value, [
      this.db
        .prepare(
          "UPDATE ingestion_jobs SET control_state=?,status=CASE WHEN ?='cancel' THEN 'failed' WHEN ?='resume' THEN 'queued' ELSE status END,error_code=CASE WHEN ?='cancel' THEN 'OPERATOR_CANCELLED' ELSE error_code END,lease_hash=NULL,lease_until_ms=0,lease_fence=lease_fence+1,version=version+1,updated_at=? WHERE id=? AND phase<>'complete'",
        )
        .bind(
          action === "pause"
            ? "paused"
            : action === "cancel"
              ? "cancelled"
              : "active",
          action,
          action,
          action,
          this.now(),
          id,
        ),
    ]);
  }
  async commit(id: string, raw: unknown) {
    const value = IngestionResultSchema.parse(raw),
      row = await this.job(id),
      sourceId = String(row.source_id),
      profile = await profileFor(this.db, sourceId);
    const payload = {
      ...value,
      leaseHash: await tokenHash(this.actor.id + ":" + value.leaseToken),
    };
    if (
      await this.db
        .prepare("SELECT id FROM console_commands WHERE id=?")
        .bind(value.commandId)
        .first()
    )
      return this.mutate(
        value,
        "job.commit",
        "job",
        id,
        payload,
        [],
        "write",
        sourceId,
      );
    if (
      Number(row.lease_until_ms) <= Date.parse(this.now()) ||
      row.control_state !== "active"
    )
      throw new ApiError("CONFLICT", "任务租约已失效，请停止提交。");
    if (row.rule_version !== profile.ruleVersion)
      throw new ApiError("CONFLICT", "采集规则已更新，请核验策略后新建任务。");
    const checkpoint = CheckpointSchema.parse(
        JSON.parse(String(row.checkpoint_json)),
      ),
      phase = String(row.phase),
      url =
        phase === "discover"
          ? checkpoint.page ||
            profile.entryUrls?.[checkpoint.entryIndex] ||
            profile.entryUrl
          : checkpoint.urls[checkpoint.index];
    const { policy } = await this.policy(sourceId);
    if (value.url !== url)
      throw new ApiError("INVALID_ARGUMENT", "采集结果与任务目标不一致。");
    approvedUrl(profile, value.url, phase === "discover" ? "list" : "detail");
    for (const u of value.discovered) approvedUrl(profile, u);
    for (const item of value.discoveredDates) approvedUrl(profile, item.url);
    if (value.nextPage) approvedUrl(profile, value.nextPage, "list");
    const statements: Statement[] = [],
      now = this.now();
    let documentId: string | null = null,
      expectedDocumentVersion: number | null = null,
      duplicate = 0,
      bodyCount = 0,
      nextPhase = phase,
      status = "queued",
      controlState = "active",
      errorCode: string | null = null;
    const error = !["ok", "not_modified"].includes(value.outcome);
    if (error) {
      errorCode = value.outcome.toUpperCase();
      if (
        ["blocked", "too_large"].includes(value.outcome) ||
        Number(row.error_count) >= 2
      ) {
        status = "failed";
        controlState = "paused";
      }
    } else if (phase === "discover") {
      const pageHash = await tokenHash(value.url),
        nextPageHash = value.nextPage ? await tokenHash(value.nextPage) : null,
        repeatedPage =
          !!value.nextPage &&
          (value.nextPage === value.url ||
            checkpoint.pagesSeen.includes(value.nextPage) ||
            checkpoint.visitedPageHashes.includes(nextPageHash || ""));
      checkpoint.pagesSeen = [...checkpoint.pagesSeen, value.url].slice(-10);
      checkpoint.visitedPageHashes = [
        ...checkpoint.visitedPageHashes.filter((hash) => hash !== pageHash),
        pageHash,
      ].slice(-100);
      const discoveredDates = new Map(
        value.discoveredDates.map((item) => [item.url, item.publishedAt]),
      );
      const ignored = new Set<string>();
      if (value.discovered.length) {
        const retired = await this.db
          .prepare(
            `SELECT canonical_url,MAX(CASE WHEN job_id=? THEN 1 ELSE 0 END) AS checked_this_job,MAX(published_at) AS published_at FROM console_intake_skips WHERE source_id=? AND canonical_url IN(${value.discovered.map(() => "?").join(",")}) GROUP BY canonical_url`,
          )
          .bind(id, sourceId, ...value.discovered)
          .all<Row>();
        for (const r of retired.results) {
          const url = String(r.canonical_url);
          if (Number(r.checked_this_job)) {
            ignored.add(url);
            continue;
          }
          const publishedAt = r.published_at
            ? String(r.published_at)
            : discoveredDates.get(url) || null;
          const block = await this.intakeBlock(
              sourceId,
              url,
              publishedAt,
              null,
              profile.earliestImportDay,
              profile.latestImportDay,
            );
          if (block === "tombstone" || (block === "cutoff" && publishedAt))
            ignored.add(url);
        }
      }
      const known = value.discovered.length
        ? (
            await this.db
              .prepare(
                `SELECT canonical_url FROM document_origins WHERE source_id=? AND canonical_url IN (${value.discovered.map(() => "?").join(",")}) ORDER BY last_seen_at,canonical_url`,
              )
              .bind(sourceId, ...value.discovered)
              .all<{ canonical_url: string }>()
          ).results
            .map((x) => x.canonical_url)
            .filter((url) => !ignored.has(url))
        : [];
      const unknown = value.discovered.filter(
        (url) => !known.includes(url) && !ignored.has(url),
      );
      const cutoff = profile.earliestImportDay;
      const allUnknownArticlesAreBeforeCutoff =
        !!cutoff &&
        unknown.length > 0 &&
        unknown.every((url) => {
          const publishedAt = discoveredDates.get(url);
          return !!publishedAt && publishedAt < cutoff;
        });
      const nextPage =
        value.nextPage &&
        !allUnknownArticlesAreBeforeCutoff &&
        !repeatedPage &&
        !checkpoint.visitedPageHashes.includes(nextPageHash || "")
          ? value.nextPage
          : null;
      checkpoint.urls =
        checkpoint.revalidate && known.length ? known : [...unknown, ...known];
      checkpoint.publishedDates = checkpoint.urls.map((url) => ({
        url,
        publishedAt: discoveredDates.get(url) || null,
      }));
      checkpoint.index = 0;
      checkpoint.page = nextPage;
      if (checkpoint.urls.length) nextPhase = "fetch";
      else if (nextPage) nextPhase = "discover";
      else if (checkpoint.entryIndex + 1 < (profile.entryUrls?.length || 1)) {
        checkpoint.entryIndex++;
        checkpoint.page = null;
        checkpoint.urls = [];
        checkpoint.index = 0;
      } else {
        nextPhase = "complete";
        status = "completed";
      }
    } else {
      let origin = await this.db
        .prepare(
          "SELECT * FROM document_origins WHERE source_id=? AND canonical_url=?",
        )
        .bind(sourceId, value.url)
        .first<Row>();
      if (!origin) {
        const same = await this.db
          .prepare(
            "SELECT id FROM knowledge_documents WHERE source_id=? AND url=? AND owner_user_id IS NULL AND data_domain<>'user_private' ORDER BY id LIMIT 2",
          )
          .bind(sourceId, value.url)
          .all<{ id: string }>();
        if (same.results.length > 1)
          throw new ApiError("CONFLICT", "原文已有冲突记录，请核对原来源。");
        if (same.results[0])
          origin = { document_id: same.results[0].id, input_fingerprint: null };
      }
      if (value.outcome === "not_modified") {
        if (!origin?.id)
          throw new ApiError("INVALID_ARGUMENT", "没有可复用的原文记录。");
        const reject = await this.intakeBlock(
          sourceId,
          value.url,
          undefined,
          String(origin.document_id),
          profile.earliestImportDay,
          profile.latestImportDay,
        );
        if (reject)
          statements.push(
            this.skipStatement(
              value.commandId,
              id,
              sourceId,
              value.url,
              reject,
              null,
              String(origin.document_id),
            ),
          );
        else {
          duplicate = 1;
          documentId = String(origin.document_id);
        }
      } else {
        if (
          !value.article ||
          value.article.sourceId !== sourceId ||
          value.article.url !== value.url ||
          !value.bodyHash
        )
          throw new ApiError("INVALID_ARGUMENT", "缺少可核对的文章元数据。");
        if (
          !policy ||
          value.article.tags.length > 4 ||
          value.article.rightsScope !== policy.rights_scope ||
          Object.values(value.article.extractedFields).some(Boolean)
        )
          throw new ApiError(
            "INVALID_ARGUMENT",
            "采集结果不符合当前许可或核验状态。",
          );
        if (
          policy.rights_scope === "metadata_only" &&
          (value.article.body !== "仅登记公开元数据，未保存第三方正文。" ||
            value.events.length ||
            value.chunks.length ||
            value.article.summary)
        )
          throw new ApiError(
            "INVALID_ARGUMENT",
            "当前策略只允许元数据，不接受正文或活动提取。",
          );
        const reject = await this.intakeBlock(
          sourceId,
          value.url,
          value.article.publishedAt,
          origin ? String(origin.document_id) : null,
          profile.earliestImportDay,
          profile.latestImportDay,
        );
        if (reject)
          statements.push(
            this.skipStatement(
              value.commandId,
              id,
              sourceId,
              value.url,
              reject,
              value.article.publishedAt,
              origin ? String(origin.document_id) : null,
            ),
          );
        else {
          const fingerprint = await tokenHash(
            json([value.article, value.bodyHash]),
          );
          if (origin?.input_fingerprint === fingerprint) {
            duplicate = 1;
            documentId = String(origin.document_id);
          } else {
            const previous = origin
              ? await this.document(String(origin.document_id))
              : null;
            const prepared = await this.prepareContentWrite(
              previous?.id,
              {
                ...value.article,
                commandId: value.commandId,
                expectedVersion: previous?.version || 0,
              },
              fingerprint,
            );
            // Cross-URL equal fingerprints are review links, never inherited approval.
            const possibleDuplicate = !origin
              ? await this.db
                  .prepare(
                    "SELECT DISTINCT d.id FROM document_origins o JOIN knowledge_documents d ON d.id=o.document_id JOIN document_fetches f ON f.document_id=d.id WHERE o.source_id=? AND f.body_hash=? AND d.title=? AND d.published_at IS ? AND d.publisher IS ? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' LIMIT 1",
                  )
                  .bind(
                    sourceId,
                    value.bodyHash,
                    value.article.title,
                    value.article.publishedAt,
                    value.article.publisher,
                  )
                  .first<{ id: string }>()
              : null;
            documentId = prepared.key;
            expectedDocumentVersion = previous?.version || 0;
            statements.push(...prepared.statements);
            const version = (previous?.version || 0) + 1;
            for (const chunk of value.chunks) {
              if (
                value.article.body.slice(chunk.startOffset, chunk.endOffset) !==
                chunk.text
              )
                throw new ApiError(
                  "INVALID_ARGUMENT",
                  "知识片段与原文不一致。",
                );
              statements.push(
                this.db
                  .prepare(
                    "INSERT INTO knowledge_chunks(id,document_id,text,start_offset,end_offset,snapshot_version,content_revision,input_hash) VALUES(?,?,?,?,?,?,?,?)",
                  )
                  .bind(
                    crypto.randomUUID(),
                    documentId,
                    chunk.text,
                    chunk.startOffset,
                    chunk.endOffset,
                    version,
                    prepared.contentRevision,
                    prepared.inputHash,
                  ),
              );
            }
            // Only header title/date evidence is retained under metadata-only permission.
            for (const [field, span] of [
              ["title", value.article.title],
              ["published_at", value.publishedRaw],
            ] as const)
              if (span)
                statements.push(
                  this.db
                    .prepare(
                      "INSERT INTO extraction_evidence(id,document_id,snapshot_version,field_name,raw_span,confidence,extractor_version) VALUES(?,?,?,?,?,1,?)",
                    )
                    .bind(
                      crypto.randomUUID(),
                      documentId,
                      version,
                      field,
                      span.slice(0, 250),
                      profile.ruleVersion,
                    ),
                );
            for (const a of value.attachments) {
              approvedUrl(profile, a.url, "attachment");
              statements.push(
                this.db
                  .prepare(
                    "INSERT INTO document_attachments(id,document_id,snapshot_version,url,name) VALUES(?,?,?,?,?)",
                  )
                  .bind(
                    crypto.randomUUID(),
                    documentId,
                    version,
                    a.url,
                    a.name,
                  ),
              );
            }
            for (const [ordinal, event] of value.events.entries()) {
              const eventId = crypto.randomUUID();
              statements.push(
                this.db
                  .prepare(
                    "INSERT INTO event_candidates(id,document_id,snapshot_version,content_revision,input_hash,extractor_version,ordinal,title,organizer,starts_at,ends_at,registration_deadline,registration_url,raw_place_name,campus_scope,audience,change_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  )
                  .bind(
                    eventId,
                    documentId,
                    version,
                    prepared.contentRevision,
                    prepared.inputHash,
                    profile.ruleVersion,
                    ordinal,
                    event.title,
                    event.organizer,
                    event.startsAt,
                    event.endsAt,
                    event.registrationDeadline,
                    event.registrationUrl,
                    event.rawPlaceName,
                    event.campusScope,
                    event.audience,
                    event.changeStatus,
                  ),
              );
              statements.push(
                ...timeEvidenceStatements(
                  this.db,
                  event,
                  value.article.body,
                  documentId,
                  version,
                  eventId,
                  prepared.contentRevision,
                  prepared.inputHash,
                  profile.ruleVersion,
                ),
              );
              for (const [field, span] of [
                ["title", event.title],
                ["organizer", event.organizer],
                ["place", event.rawPlaceName],
              ] as const)
                if (span && value.article.body.includes(span))
                  statements.push(
                    this.db
                      .prepare(
                        "INSERT INTO extraction_evidence(id,document_id,snapshot_version,candidate_id,field_name,raw_span,confidence,extractor_version) VALUES(?,?,?,?,?,?,0.5,?)",
                      )
                      .bind(
                        crypto.randomUUID(),
                        documentId,
                        version,
                        eventId,
                        field,
                        span.slice(0, 200),
                        profile.ruleVersion,
                      ),
                  );
            }
            statements.push(
              this.db
                .prepare(
                  "INSERT INTO document_origins(id,source_id,document_id,canonical_url,entry_url,first_seen_at,last_seen_at,etag,last_modified,input_fingerprint,duplicate_of) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,canonical_url) DO UPDATE SET last_seen_at=excluded.last_seen_at,etag=excluded.etag,last_modified=excluded.last_modified,input_fingerprint=excluded.input_fingerprint",
                )
                .bind(
                  crypto.randomUUID(),
                  sourceId,
                  documentId,
                  value.url,
                  profile.entryUrl,
                  now,
                  now,
                  value.etag,
                  value.lastModified,
                  fingerprint,
                  possibleDuplicate?.id || null,
                ),
            );
          }
          bodyCount = value.bodyTextChars > 0 ? 1 : 0;
        }
      }
      if (documentId)
        statements.push(
          this.db
            .prepare(
              "UPDATE document_origins SET last_seen_at=?,etag=COALESCE(?,etag),last_modified=COALESCE(?,last_modified) WHERE source_id=? AND canonical_url=?",
            )
            .bind(now, value.etag, value.lastModified, sourceId, value.url),
          discoveryStatement(
            this.db,
            sourceId,
            documentId,
            value.url,
            "official_web",
            checkpoint.page || profile.entryUrl,
            now,
          ),
        );
      checkpoint.index++;
      if (checkpoint.index >= checkpoint.urls.length) {
        if (checkpoint.page) {
          nextPhase = "discover";
          checkpoint.urls = [];
          checkpoint.index = 0;
        } else if (
          checkpoint.entryIndex + 1 <
          (profile.entryUrls?.length || 1)
        ) {
          nextPhase = "discover";
          checkpoint.entryIndex++;
          checkpoint.page = null;
          checkpoint.urls = [];
          checkpoint.index = 0;
        } else {
          nextPhase = "complete";
          status = "completed";
        }
      }
    }
    // Guard the exact old document version inside the same batch before any write.
    statements.unshift(
      this.db
        .prepare(
          "INSERT INTO ingestion_job_steps(job_id,step_key,url,stage,outcome,requests,bytes,document_id,expected_document_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          value.commandId,
          value.url,
          phase,
          value.outcome,
          value.requests,
          value.bytes,
          documentId,
          expectedDocumentVersion,
          now,
        ),
    );
    statements.push(
      this.db
        .prepare(
          "INSERT INTO document_fetches(id,job_id,source_id,document_id,snapshot_version,url,checked_at,status,outcome,bytes,etag,last_modified,body_hash,published_raw) VALUES(?,?,?,?,(SELECT version FROM knowledge_documents WHERE id=?),?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          value.commandId,
          id,
          sourceId,
          documentId,
          documentId,
          value.url,
          now,
          value.status,
          value.outcome,
          value.bytes,
          value.etag,
          value.lastModified,
          value.bodyHash,
          value.publishedRaw,
        ),
    );
    statements.push(
      this.db
        .prepare(
          "UPDATE ingestion_jobs SET phase=?,status=?,control_state=?,checkpoint_json=?,error_code=?,error_count=error_count+?,found_count=found_count+?,body_count=body_count+?,duplicate_count=duplicate_count+?,byte_count=byte_count+?,lease_hash=NULL,lease_until_ms=0,next_run_after_ms=?,version=version+1,updated_at=? WHERE id=?",
        )
        .bind(
          nextPhase,
          status,
          controlState,
          json(checkpoint),
          errorCode,
          error ? 1 : 0,
          phase === "discover" ? value.discovered.length : 0,
          bodyCount,
          duplicate,
          value.bytes,
          Date.parse(now) + (error ? 30000 : 0),
          now,
          id,
        ),
    );
    statements.push(
      this.db
        .prepare(
          "UPDATE knowledge_sources SET last_checked_at=?,last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,last_error=? WHERE id=?",
        )
        .bind(now, error ? 1 : 0, now, errorCode, sourceId),
    );
    return this.mutate(
      value,
      "job.commit",
      "job",
      id,
      payload,
      statements,
      "write",
      sourceId,
    );
  }
}
