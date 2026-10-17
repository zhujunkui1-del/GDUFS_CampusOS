import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { webProfiles, profileFor } from "../src/lib/ingestion/profiles";
import {
  OfficialWebConnector,
  extractEvents,
} from "../src/lib/ingestion/connector";
import { SafeWebFetcher } from "../src/lib/ingestion/safe-fetch";
import type { SourceDetail } from "../src/domain/console/contracts";
const args = process.argv.slice(2),
  option = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      profiles: webProfiles.map((x) => ({
        sourceId: x.sourceId,
        entryUrl: x.entryUrl,
        ruleVersion: x.ruleVersion,
      })),
      usage:
        "--run --source <id> [--job <id>] [--approve-metadata] --base <localhost8787|preview> --report <path>",
      limits: { articles: 1, requests: 20, intervalMs: 10000 },
      modelCalls: 0,
    }),
  );
} else {
  const base = option("--base") || "http://127.0.0.1:8787";
  if (
    ![
      "http://127.0.0.1:8787",
      "http://localhost:8787",
      "https://campusos-preview.zhujunkui1.workers.dev",
    ].includes(base)
  )
    throw Error("UNAPPROVED_API_ORIGIN");
  const remote = base.startsWith("https:");
  const secrets = JSON.parse(
    readFileSync(
      remote
        ? ".map-tools/s3-a/preview-secrets.json"
        : ".map-tools/s3-a/local-secrets.json",
      "utf8",
    ),
  );
  const key = remote
    ? secrets.CONSOLE_ADMIN_ACCESS_KEY
    : secrets.CONSOLE_LOCAL_ACCESS_KEY;
  let cookie = "",
    csrf = "";
  const rpcTimes: number[] = [];
  const api = async <T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const started = performance.now();
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-Console-CSRF": csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    rpcTimes.push(Math.round(performance.now() - started));
    const response = await r.json();
    if (!r.ok || !response.ok)
      throw Error(`API_${r.status}_${response.error?.code || "ERROR"}`);
    if (path === "/api/console-auth" && method === "POST")
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    return response.data as T;
  };
  const auth = await api<{ csrf: string }>("/api/console-auth", "POST", {
    key,
  });
  csrf = auth.csrf;
  const events: Record<string, unknown>[] = [];
  let websiteRequests = 0,
    jobId = option("--job") || "";
  try {
    const profile = profileFor(option("--source") || ""),
      sourceId = profile.sourceId;
    const connector = new OfficialWebConnector(profile),
      fetcher = new SafeWebFetcher(profile);
    if (args.includes("--approve-metadata")) {
      let source = await api<SourceDetail>("/api/admin/sources/" + sourceId);
      if (source.websiteUrl?.replace(/\/$/, "") !== profile.origin)
        throw Error("SOURCE_IDENTITY_CONFLICT");
      if (source.verificationStatus !== "candidate" && !source.enabled)
        throw Error("MANUAL_SOURCE_STATE_CONFLICT");
      if (source.verificationStatus === "candidate" && !source.enabled) {
        await api("/api/admin/sources/" + sourceId + "/verify", "POST", {
          commandId: crypto.randomUUID(),
          expectedVersion: source.version,
          status: "verified",
          officialStatus: "verified_official",
          permissionStatus: "approved",
          note: "S3-B逐站公开机构/栏目核验：只允许标题、链接、日期及HTTP元数据；robots404不是全文许可，禁止正文/图片镜像和外部模型处理。",
          evidenceUrls: [
            profile.origin + "/",
            profile.entryUrl,
            profile.origin + "/robots.txt",
          ],
          authorityConfirmed: true,
        });
        source = await api<SourceDetail>("/api/admin/sources/" + sourceId);
      }
      if (
        source.verificationStatus !== "verified" ||
        source.officialStatus !== "verified_official" ||
        source.permissionStatus !== "approved"
      )
        throw Error("MANUAL_SOURCE_STATE_CONFLICT");
      const current = await api<{ policy: { expires_at_ms: number } | null }>(
        "/api/admin/sources/" + sourceId + "/collection-policy",
      );
      if (!current.policy || current.policy.expires_at_ms <= Date.now()) {
        await api(
          "/api/admin/sources/" + sourceId + "/collection-policy",
          "POST",
          {
            commandId: crypto.randomUUID(),
            expectedVersion: source.version,
            ruleVersion: profile.ruleVersion,
            rightsScope: "metadata_only",
            evidenceUrls: [
              profile.origin + "/",
              profile.entryUrl,
              profile.origin + "/robots.txt",
            ],
            note: "S3-B手动元数据小批次策略：20次/UTC日全局保守网络预算，每次间隔至少10秒，24小时到期；当日只读robots404已留证，执行时再次检查，遇限制即暂停；不含全文许可。",
            robotsStatus: 404,
            robotsHash: null,
          },
        );
        source = await api<SourceDetail>("/api/admin/sources/" + sourceId);
      }
      if (!source.enabled)
        await api("/api/admin/sources/" + sourceId + "/enabled", "POST", {
          commandId: crypto.randomUUID(),
          expectedVersion: source.version,
          enabled: true,
        });
    }
    if (!jobId)
      jobId = (
        await api<{ id: string }>("/api/admin/jobs", "POST", {
          commandId: crypto.randomUUID(),
          sourceId,
          maxArticles: 1,
          mode: args.includes("--revalidate") ? "revalidate" : "incremental",
        })
      ).id;
    const maxSteps = Number(option("--steps") || 6);
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 6)
      throw Error("INVALID_STEP_LIMIT");
    for (let step = 0; step < maxSteps; step++) {
      const row = await api<Record<string, unknown>>(
        "/api/admin/jobs/" + jobId,
      );
      if (row.source_id !== sourceId) throw Error("JOB_SOURCE_MISMATCH");
      if (
        row.phase === "complete" ||
        row.control_state !== "active" ||
        row.status === "failed"
      )
        break;
      if (Number(row.next_run_after_ms) > Date.now())
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(31000, Number(row.next_run_after_ms) - Date.now() + 50),
          ),
        );
      const lease = await api<{
        version: number;
        fence: number;
        leaseToken: string;
        phase: string;
        url: string;
        validators: { etag: string | null; lastModified: string | null };
      }>("/api/admin/jobs/" + jobId + "/claim", "POST", {
        commandId: crypto.randomUUID(),
        expectedVersion: row.version,
      });
      const before = fetcher.requests;
      const started = performance.now();
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
      };
      try {
        if (fetcher.robots === null)
          await fetcher.get(profile.origin + "/robots.txt", "robots");
        const page = await fetcher.get(
          lease.url,
          lease.phase === "discover" ? "list" : "detail",
          lease.phase === "fetch" ? lease.validators : undefined,
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
            const found = connector.discover(page.html, lease.url);
            result = {
              ...result,
              outcome: "ok",
              discovered: found.urls,
              nextPage: found.nextPage,
            };
          } else {
            const parsed = connector.parse(page.html, lease.url),
              article = connector.validate(
                connector.normalize(parsed, lease.url),
              );
            // Live policies are metadata-only. Licensed fixture extraction is tested separately.
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
                  : extractEvents(parsed.bodyText),
            };
            events.push({
              url: lease.url,
              parse: "metadata_ok",
              publishedAt: parsed.publishedAt,
              bodyTextChars: parsed.bodyTextChars,
              imageCount: parsed.imageCount,
              fullTextPersisted: false,
            });
          }
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : "NETWORK_ERROR";
        result.outcome = /BLOCKED|DENIED|REDIRECT|PRIVATE|ROBOTS|MIME/.test(
          code,
        )
          ? "blocked"
          : /TOO_LARGE/.test(code)
            ? "too_large"
            : /PARSE|ENCODING/.test(code)
              ? "parse_error"
              : "network_error";
        events.push({
          url: lease.url,
          error: code.replace(/[^A-Z_]/g, "").slice(0, 40),
        });
      }
      result.requests = fetcher.requests - before;
      websiteRequests = fetcher.requests;
      const commit = {
        ...result,
        commandId: crypto.randomUUID(),
        expectedVersion: lease.version,
        leaseToken: lease.leaseToken,
        fence: lease.fence,
      };
      await api("/api/admin/jobs/" + jobId + "/commit", "POST", commit);
      events.push({
        phase: lease.phase,
        outcome: result.outcome,
        wallMs: Math.round(performance.now() - started),
        requests: result.requests,
      });
      if (result.outcome !== "ok" && result.outcome !== "not_modified") break;
    }
    const final = await api<Record<string, unknown>>(
      "/api/admin/jobs/" + jobId,
    );
    const report = {
      recordedAt: new Date().toISOString(),
      environment: remote ? "real-cloudflare-preview" : "local-worker",
      sourceId,
      jobId,
      final: {
        status: final.status,
        controlState: final.control_state,
        phase: final.phase,
        found: final.found_count,
        bodyTextParsed: final.body_count,
        duplicates: final.duplicate_count,
        errors: final.error_count,
        reservedRequests: final.request_count,
      },
      websiteRequests,
      events,
      apiWallMs: rpcTimes,
      modelCalls: 0,
      fullTextPersisted: false,
      autoApproved: 0,
      autoPublished: 0,
    };
    const path = option("--report");
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify(report));
    if (final.status !== "completed" && !option("--steps"))
      process.exitCode = 1;
  } finally {
    await api("/api/console-auth", "DELETE").catch(() => {});
  }
}
