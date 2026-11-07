import type { SqlDatabase } from "../assistant/database";
import { OfficialWebConnector, extractEvents } from "@/lib/ingestion/connector";
import { WorkerSafeWebFetcher } from "@/lib/ingestion/worker-safe-fetch";
import { ConsoleSyncStore, cloudRunnerActor } from "./v2-sync";

const MAX_STEPS_PER_TICK = 12;

function outcomeFor(error: unknown) {
  const code = error instanceof Error ? error.message : "NETWORK_ERROR";
  if (/BLOCKED|DENIED|REDIRECT|PRIVATE|ROBOTS|MIME/.test(code))
    return "blocked" as const;
  if (/TOO_LARGE/.test(code)) return "too_large" as const;
  if (
    (error instanceof Error &&
      "code" in error &&
      error.code === "INVALID_ARGUMENT") ||
    /PARSE|ENCODING/.test(code)
  )
    return "parse_error" as const;
  return "network_error" as const;
}

export async function runCloudWebBatch(
  db: SqlDatabase,
  options: { now?: number; maxSteps?: number } = {},
) {
  const now = options.now || Date.now(),
    store = new ConsoleSyncStore(db, cloudRunnerActor);
  // Editing a profile bumps its rule_version, which makes every job created
  // under the previous rule unclaimable (claim() rejects it). Those jobs used
  // to sit at the front of the ORDER BY forever and starve the whole queue, so
  // retire them here instead of letting them block later work.
  await db
    .prepare(
      "UPDATE ingestion_jobs SET status='failed',control_state='cancelled',error_code='RULE_CHANGED',lease_hash=NULL,lease_until_ms=0,updated_at=? WHERE job_kind='web' AND phase<>'complete' AND control_state='active' AND status IN('queued','running') AND EXISTS (SELECT 1 FROM source_collection_policies p WHERE p.source_id=ingestion_jobs.source_id AND p.rule_version<>ingestion_jobs.rule_version)",
    )
    .bind(now)
    .run();
  const jobs = await db
    .prepare(
      "SELECT id FROM ingestion_jobs WHERE job_kind='web' AND control_state='active' AND phase<>'complete' AND status IN('queued','running') AND lease_until_ms<=? AND next_run_after_ms<=? AND ((SELECT auto_sync_enabled FROM console_engine_settings WHERE id='console-v2-settings')=1 OR run_key NOT LIKE 'scheduled:%') ORDER BY created_at,id LIMIT ?",
    )
    .bind(now, now, options.maxSteps || MAX_STEPS_PER_TICK)
    .all<{ id: string }>(),
    results: { jobId: string; phase?: string; outcome: string }[] = [];

  for (const row of jobs.results) {
    let lease: Awaited<ReturnType<typeof store.claim>>;
    try {
      const current = await store.job(row.id);
      lease = await store.claim(row.id, {
        commandId: crypto.randomUUID(),
        expectedVersion: Number(current.version),
      });
    } catch (error) {
      results.push({
        jobId: row.id,
        outcome: error instanceof Error ? error.message : "CLAIM_FAILED",
      });
      continue;
    }

    const profile = lease.profile,
      fetcher = new WorkerSafeWebFetcher(profile);
    fetcher.beforeRequest = () =>
      store
        .permit(row.id, {
          leaseToken: lease.leaseToken,
          fence: lease.fence,
          version: lease.version,
        })
        .then(() => {});
    let result: Record<string, unknown> = {
      url: lease.url,
      status: 0,
      bytes: 0,
      requests: 0,
      outcome: "network_error",
      etag: null,
      lastModified: null,
      bodyHash: null,
      publishedRaw: null,
      bodyTextChars: 0,
      discovered: [],
      discoveredDates: [],
      nextPage: null,
      article: null,
      events: [],
      attachments: [],
      chunks: [],
    };
    const before = fetcher.requests;
    try {
      if (fetcher.robots === null)
        await fetcher.get(profile.origin + "/robots.txt", "robots");
      const page = await fetcher.get(
        lease.url,
        lease.phase === "discover" ? "list" : "detail",
        lease.phase === "fetch"
          ? {
              etag: lease.validators.etag
                ? String(lease.validators.etag)
                : null,
              lastModified: lease.validators.lastModified
                ? String(lease.validators.lastModified)
                : null,
            }
          : undefined,
      );
      result = {
        ...result,
        status: page.status,
        bytes: page.bytes,
        etag: page.etag,
        lastModified: page.lastModified,
      };
      if (page.status === 304) result.outcome = "not_modified";
      else {
        if (page.status !== 200) throw Error("HTTP_NOT_OK");
        if (lease.phase === "discover") {
          const found = new OfficialWebConnector(profile).discover(
            page.html,
            lease.url,
          );
          let nextPage = found.nextPage;
          if (found.allDatedBeforeCutoff && found.undatedUrls.length) {
            const known = await db
              .prepare(
                `SELECT canonical_url FROM document_origins WHERE source_id=? AND canonical_url IN (${found.undatedUrls.map(() => "?").join(",")}) UNION SELECT canonical_url FROM console_intake_skips WHERE source_id=? AND canonical_url IN (${found.undatedUrls.map(() => "?").join(",")}) AND (job_id=? OR (published_at IS NOT NULL AND date(published_at,'+8 hours')<?)) UNION SELECT canonical_url FROM console_cleanup_tombstones WHERE canonical_url IN (${found.undatedUrls.map(() => "?").join(",")}) AND released_at IS NULL`,
              )
              .bind(
                lease.sourceId,
                ...found.undatedUrls,
                lease.sourceId,
                ...found.undatedUrls,
                row.id,
                profile.earliestImportDay,
                ...found.undatedUrls,
              )
              .all<{ canonical_url: string }>();
            if (known.results.length === found.undatedUrls.length)
              nextPage = null;
          }
          result = {
            ...result,
            outcome: "ok",
            discovered: found.urls,
            discoveredDates: found.dates,
            nextPage,
          };
        } else {
          const connector = new OfficialWebConnector(profile),
            parsed = connector.parse(
              page.html,
              lease.url,
              lease.publishedAtFromList,
            ),
            policy = await store.policy(lease.sourceId),
            rightsScope = String(policy.policy?.rights_scope || "");
          if (
            rightsScope !== "metadata_only" &&
            rightsScope !== "excerpt_and_link" &&
            rightsScope !== "licensed_full_text"
          )
            throw Error("POLICY_SCOPE_REQUIRED");
          const article = connector.validate(
            connector.normalize(
              parsed,
              lease.url,
              rightsScope as
                "metadata_only" | "excerpt_and_link" | "licensed_full_text",
            ),
          );
          result = {
            ...result,
            outcome: "ok",
            article,
            bodyHash: parsed.bodyHash,
            publishedRaw: parsed.dateText,
            bodyTextChars: parsed.bodyTextChars,
            attachments: parsed.attachments,
            events:
              article.rightsScope === "metadata_only"
                ? []
                : extractEvents(article.body),
          };
        }
      }
    } catch (error) {
      result.outcome = outcomeFor(error);
    }
    result.requests = fetcher.requests - before;
    try {
      await store.commit(row.id, {
        ...result,
        commandId: crypto.randomUUID(),
        expectedVersion: lease.version,
        leaseToken: lease.leaseToken,
        fence: lease.fence,
      });
      results.push({
        jobId: row.id,
        phase: lease.phase,
        outcome: String(result.outcome),
      });
    } catch (error) {
      results.push({
        jobId: row.id,
        phase: lease.phase,
        outcome: error instanceof Error ? error.message : "COMMIT_FAILED",
      });
    }
  }
  return { processed: results.length, results };
}
